import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import cameraFrame from "../assets/camera-frame.png";
import { DashboardPageShell } from "../components/DashboardShell";
import { ExpandIcon, SectionTitle } from "../components/DashboardPrimitives";
import { DataReceptionMeta } from "../components/DataReceptionMeta";
import { Pagination } from "../components/Pagination";
import { DateTimeField } from "../components/DateTimeField";
import { DetailDialog } from "../components/DetailDialog";
import { RecordingStatusDetails } from "../components/RecordingStatusDetails";
import { seoulDateTime } from "../display-time";
import { dateTimeValue, isValidDateTime, recentPeriods, recentRange } from "../date-range";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { DashboardData, DataAreaState, DataReception, EventCategory, HeaderNotification, Recording, RecordingList, RecordingListSnapshot, UserSession } from "../domain/dashboard";
import { recordingsPerPage } from "../data/recording-list";
import { clipIdentifier } from "../data/recording-coverage";
import { dailyPlaybackTimestamp, dailyRecordingAvailability } from "../data/daily-recordings";
import { useDelayedState } from "../use-delayed-state";
import { useModalFocus } from "../use-modal-focus";
import { useLatestRequest } from "../use-latest-request";
import { recordingErrorCode, recordingStatus } from "../recording-status";

const recordingTypes = ["전체", "수거", "알림", "오류"];
const RecordingCoverageDetails = lazy(() => import("../components/RecordingCoverageDetails"));
const DailyRecordingVideo = lazy(() => import("../components/DailyRecordingVideo"));
const DailyRecordingTimeline = lazy(() => import("../components/DailyRecordingTimeline"));
const EventReplayPlayer = lazy(() => import("../components/EventReplayPlayer"));
const recordingTimeFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function retryableRecordingError(error: unknown) {
  if (error && typeof error === "object" && "status" in error) return [408, 429, 500, 502, 503, 504].includes(Number(error.status));
  return error instanceof TypeError;
}

function recordingKey(recording: Recording) { return `${recording.source ?? "event"}:${recording.id}`; }

function dailyTimestamp(recording: Recording, seconds: number) {
  const at = recording.daily ? dailyPlaybackTimestamp(recording.daily, seconds) : null;
  return at ? recordingTimeFormat.format(new Date(at)) : null;
}

function replayPlayable(recording: Recording | undefined) {
  const replay = recording?.replay;
  return Boolean(replay && (replay.state === "AVAILABLE" || replay.state === "PARTIAL") && replay.parts.length > 0 && replay.playbackSeconds > 0);
}

function replayTimestamp(recording: Recording, seconds: number) {
  const parts = recording.replay?.parts ?? [];
  const part = parts.find((item) => seconds < item.relativeEndSeconds) ?? parts.at(-1);
  if (!part) return null;
  const at = Date.parse(part.fromAt) + Math.max(0, seconds - part.relativeStartSeconds) * 1000;
  return recordingTimeFormat.format(new Date(Math.min(at, Date.parse(part.toAt))));
}

function aspectRatio(recording: Recording | undefined) {
  if (!recording) return "정보 없음";
  const { width, height } = recording;
  if (width === null || height === null) return "정보 없음";
  return width * 3 === height * 4 ? "4:3" : width * 9 === height * 16 ? "16:9" : `${width}:${height}`;
}

function playbackTimestamp(start: string, elapsedSeconds: number) {
  const timestamp = dateTimeValue(start);
  if (!Number.isFinite(timestamp)) return start;
  const value = new Date(timestamp + elapsedSeconds * 1000);
  const part = (number: number) => String(number).padStart(2, "0");
  return `${value.getUTCFullYear()}-${part(value.getUTCMonth() + 1)}-${part(value.getUTCDate())} ${part(value.getUTCHours())}:${part(value.getUTCMinutes())}:${part(value.getUTCSeconds())}`;
}

function recordingRange(recording: Recording) {
  const start = Math.floor(dateTimeValue(recording.start) / 60_000) * 60_000;
  const end = Math.max(start + 60_000, Math.ceil(dateTimeValue(recording.end) / 60_000) * 60_000);
  return { start: new Date(start).toISOString().slice(0, 16), end: new Date(end).toISOString().slice(0, 16) };
}

type RecordingsPageProps = {
  dataSource?: DashboardDataSource;
  headerNotifications: HeaderNotification[];
  headerUnreadCount?: number | null;
  headerNotificationState?: DataAreaState;
  reception: DataReception;
  queryEndsAt?: string;
  recordings: DashboardData["recordings"];
  recordingsState?: DataAreaState;
  recordingsSource?: "daily" | "event";
  recordingsList?: RecordingList;
  recordingsTotal?: number;
  serverTime?: string;
  session?: UserSession | null;
};

export function RecordingsPage({ dataSource, recordings, recordingsState, recordingsSource = "event", recordingsList, recordingsTotal, serverTime, headerNotifications, headerUnreadCount, headerNotificationState, reception, queryEndsAt, session }: RecordingsPageProps) {
  const requestedRecordingId = new URLSearchParams(window.location.search).get("recordingId");
  const requestedRecording = recordings.find((recording) => recording.id === requestedRecordingId);
  const [availableRecordings, setAvailableRecordings] = useState(recordings);
  const dailyRangeEnd = recordingsSource === "daily" && serverTime && Number.isFinite(Date.parse(serverTime))
    ? seoulDateTime(Date.parse(serverTime)).slice(0, 16) : undefined;
  const defaultRangeEnd = dailyRangeEnd ?? queryEndsAt ?? (recordings.reduce((latest, recording) => recording.end > latest ? recording.end : latest, "") || seoulDateTime(new Date().getTime()));
  const initialRange = requestedRecording
    ? recordingRange(requestedRecording)
    : recentRange(168, defaultRangeEnd);
  const [range, setRange] = useState(initialRange);
  const [preset, setPreset] = useState<number | null>(requestedRecording ? null : 168);
  const initialType = recordingsSource === "daily" ? "날짜" : "전체";
  const [applied, setApplied] = useState(() => ({ ...initialRange, type: initialType }));
  const [queryCompleted, setQueryCompleted] = useState(false);
  const initialError = !queryCompleted && recordingsState?.status === "error" ? recordingsState.message ?? "녹화 목록 조회 실패" : undefined;
  const [queryState, setQueryState] = useState({ source: dataSource, busy: false });
  const querying = queryState.source === dataSource && queryState.busy;
  const setQuerying = (busy: boolean) => setQueryState({ source: dataSource, busy });
  const startQuery = useLatestRequest(dataSource);
  const startPageRequest = useLatestRequest(dataSource);
  // 서버 페이지 단위로 이어서 가져오는 목록 핸들과 전체 건수이다. 핸들이 없으면 받은 목록이 전부이다.
  const [list, setList] = useState<RecordingList | undefined>(recordingsList);
  const [listInfo, setListInfo] = useState<{ total: number; complete: boolean } | null>(recordingsList && recordingsTotal !== undefined ? { total: recordingsTotal, complete: false } : null);
  const [pageLoading, setPageLoading] = useState(false);
  const [recordType, setRecordType] = useState(initialType);
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, recordings.findIndex((recording) => recording.id === requestedRecordingId)));
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [coverageRecordingId, setCoverageRecordingId] = useState<string | null>(null);
  const closeCoverage = useCallback(() => setCoverageRecordingId(null), []);
  const [recordingPage, setRecordingPage] = useState(0);
  const [detailState, setDetailState] = useState<{ source?: DashboardDataSource; key?: string; ready: boolean; fresh?: boolean; error?: string }>({ ready: false });
  const [playbackError, setPlaybackError] = useState<{ key?: string; message: string } | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [detailRevision, setDetailRevision] = useState(0);
  const [deletion, setDeletion] = useState<{ id: string; date: string; busy: boolean; error?: string } | null>(null);
  const [deletionNotice, setDeletionNotice] = useState("");
  const closeDeletion = useCallback(() => setDeletion(null), []);
  const playerRef = useRef<HTMLVideoElement>(null);
  const expandedPlayerRef = useRef<HTMLVideoElement>(null);
  const downloadController = useRef<AbortController | null>(null);
  type DownloadState = "idle" | "processing" | "complete";
  const [download, updateDownload, updateDownloadAfter] =
    useDelayedState<{ source?: DashboardDataSource; value: DownloadState }>({ source: dataSource, value: "idle" });
  const downloadState = download.source === dataSource ? download.value : "idle";
  const setDownloadState = (value: DownloadState) => updateDownload({ source: dataSource, value });
  const setDownloadStateAfter = (value: DownloadState, delay: number) => updateDownloadAfter({ source: dataSource, value }, delay);
  const closeRecording = useCallback(() => {
    const expanded = expandedPlayerRef.current;
    if (expanded) {
      expanded.pause();
      if (expanded.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !expanded.seeking && Number.isFinite(expanded.currentTime)) {
        if (playerRef.current) playerRef.current.currentTime = expanded.currentTime;
        setPlaybackSeconds(expanded.currentTime);
      }
    }
    setRecordingOpen(false);
  }, []);
  const recordingModalRef = useModalFocus<HTMLDivElement>(recordingOpen, closeRecording);

  const visibleRecordings = availableRecordings.filter((recording) =>
    (applied.type === "전체" || (applied.type === "날짜" ? recording.source === "daily" : recording.source !== "daily" && recording.type === applied.type))
    && dateTimeValue(recording.start) <= dateTimeValue(applied.end)
    && dateTimeValue(recording.end) >= dateTimeValue(applied.start));
  const totalRecordingCount = listInfo?.total ?? visibleRecordings.length;
  const totalRecordingPages = Math.max(1, Math.ceil(totalRecordingCount / recordingsPerPage));
  const pageStart = recordingPage * recordingsPerPage;
  const pagedRecordings = visibleRecordings.slice(pageStart, pageStart + recordingsPerPage);
  const selectedRecording = visibleRecordings[selectedIndex] ?? visibleRecordings[0];
  const selectedId = selectedRecording?.id;
  const selectedKey = selectedRecording ? recordingKey(selectedRecording) : undefined;
  const selectedSource = selectedRecording?.source ?? "event";
  const selectedSample = selectedRecording?.sample;
  const detailRequired = Boolean(dataSource?.getRecording && !selectedSample);
  const detailReady = !detailRequired || (detailState.source === dataSource && detailState.key === selectedKey && detailState.ready);
  const detailFresh = !detailRequired || (detailReady && detailState.fresh);
  const dailyNow = Date.parse(serverTime ?? "");
  const dailyAvailability = selectedRecording?.daily && Number.isFinite(dailyNow) ? dailyRecordingAvailability(selectedRecording.daily, dailyNow) : undefined;
  const selectedPlaybackAvailable = Boolean(detailReady && selectedRecording && playbackError?.key !== selectedKey && (selectedRecording.daily ? dailyAvailability?.playbackReady : selectedRecording.contentUrl || selectedRecording.sample || replayPlayable(selectedRecording)));
  const selectedDownloadAvailable = Boolean(detailFresh && selectedRecording && (selectedRecording.daily ? dailyAvailability?.downloadReady : selectedRecording.downloadUrl || selectedRecording.sample));
  const canPrepareDownload = Boolean(detailFresh && dailyAvailability?.canPrepareExport && typeof dataSource?.prepareDailyRecordingExport === "function");
  const preparingExport = Boolean(dailyAvailability?.exportProcessing);
  const exportFailed = selectedRecording?.daily?.exportState === "failed" && !dailyAvailability?.originalUnavailable;
  const exportErrorCode = exportFailed ? recordingErrorCode(selectedRecording?.errorCode ?? selectedRecording?.daily?.error?.code) : null;
  const recordedTime = selectedRecording?.replay ? replayTimestamp(selectedRecording, playbackSeconds)
    : selectedRecording?.daily ? dailyTimestamp(selectedRecording, playbackSeconds)
    : selectedRecording ? playbackTimestamp(selectedRecording.start, selectedRecording.contentUrl ? playbackSeconds : 756) : null;
  const seekDailyRecording = useCallback((seconds: number) => {
    const player = playerRef.current;
    if (selectedPlaybackAvailable && player && player.readyState >= 1) { player.currentTime = seconds; setPlaybackSeconds(seconds); }
  }, [selectedPlaybackAvailable]);

  useEffect(() => {
    if (!dataSource?.getRecording || !selectedId || selectedSample) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const refresh = async () => {
      try {
        const recording = selectedSource === "daily" ? await dataSource.getRecording?.(selectedId, controller.signal, "daily")
          : await dataSource.getRecording?.(selectedId, controller.signal);
        if (controller.signal.aborted) return;
        setAvailableRecordings((items) => items.map((item) => recordingKey(item) !== selectedKey ? item : recording ?? { ...item, status: "unavailable", contentUrl: undefined, downloadUrl: undefined, daily: undefined }));
        failures = 0;
        setDetailState({ source: dataSource, key: selectedKey, ready: Boolean(recording), fresh: Boolean(recording), error: recording ? undefined : "녹화 정보가 없습니다." });
        if (recording?.status === "processing" || recording?.mediaStatus === "collecting" || recording?.mediaStatus === "processing"
          || recording?.daily?.status === "recording" || recording?.daily?.status === "finalizing" || recording?.daily?.exportState === "processing") {
          timer = setTimeout(() => { void refresh(); }, 2000);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const retryable = retryableRecordingError(error);
        setDetailState(previous => ({ source: dataSource, key: selectedKey,
          ready: Boolean(retryable && previous.source === dataSource && previous.key === selectedKey && previous.ready), fresh: false,
          error: "녹화 정보를 확인하지 못했습니다." }));
        if (retryable && failures < 3) {
          timer = setTimeout(() => { void refresh(); }, 2000 * 2 ** failures);
          failures += 1;
        }
      }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [dataSource, selectedId, selectedKey, selectedSource, selectedSample, detailRevision]);
  useEffect(() => () => downloadController.current?.abort(), [dataSource]);

  const canDeleteDaily = Boolean(session?.user.role === "administrator" && typeof dataSource?.deleteDailyRecording === "function"
    && selectedRecording?.daily && detailFresh && !["recording", "finalizing"].includes(selectedRecording.daily.status)
    && selectedRecording.daily.exportState !== "processing");

  const confirmDeletion = async () => {
    if (!deletion || !dataSource?.deleteDailyRecording) return;
    setDeletion({ ...deletion, busy: true, error: undefined });
    try {
      const result = await dataSource.deleteDailyRecording(deletion.id);
      const deletedId = deletion.id;
      setAvailableRecordings((items) => items
        .filter((item) => !(item.daily && item.id === deletedId))
        .map((item) => item.replay?.parts.some((part) => part.recordingId === deletedId)
          ? { ...item, replay: undefined, status: "processing" as const, contentUrl: undefined } : item));
      setDetailState({ ready: false });
      setPlaybackError(null);
      setRecordingOpen(false);
      setIsPlaying(false);
      setPlaybackSeconds(0);
      setSelectedIndex(0);
      setRecordingPage(0);
      setDetailRevision((value) => value + 1);
      setDeletionNotice(result.outcome === "deleted" ? `${deletion.date} 날짜 녹화를 삭제했습니다. 같은 날짜 영상을 쓰는 이벤트 구간은 재생할 수 없습니다.`
        : `${deletion.date} 날짜 녹화는 삭제된 것으로 확인했지만 저장 공간 정리 완료 여부는 확인하지 못했습니다.`);
      setDeletion(null);
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
      setDeletion((current) => current && { ...current, busy: false, error: status === 409
        ? "녹화 중이거나 마감 중이거나 다운로드 준비 중인 녹화는 삭제할 수 없습니다. 상태를 다시 확인했습니다."
        : status === 403 || status === 401 ? "날짜 녹화를 삭제할 권한이 없습니다."
        : "날짜 녹화를 삭제하지 못했습니다. 상태를 다시 확인한 뒤 시도하세요." });
      setDetailState({ ready: false });
      setDetailRevision((value) => value + 1);
    }
  };

  const mergeSnapshot = (snapshot: RecordingListSnapshot) => {
    setAvailableRecordings((items) => {
      const known = new Map(items.map((item) => [recordingKey(item), item]));
      return snapshot.items.map((item) => known.get(recordingKey(item)) ?? item);
    });
    setListInfo({ total: snapshot.total, complete: snapshot.complete });
  };

  const selectRecordingPage = (page: number) => {
    if (list && !listInfo?.complete) {
      const signal = startPageRequest();
      setPageLoading(true);
      void list.ensure((page + 1) * recordingsPerPage, signal)
        .then((snapshot) => {
          if (signal.aborted) return;
          mergeSnapshot(snapshot);
          setPageLoading(false);
          showRecordingPage(page);
        })
        .catch(() => { if (!signal.aborted) setPageLoading(false); });
      return;
    }
    showRecordingPage(page);
  };

  const showRecordingPage = (page: number) => {
    downloadController.current?.abort();
    setDownloadState("idle");
    setDownloadError("");
    setDetailState({ ready: false });
    setPlaybackError(null);
    setDetailRevision((value) => value + 1);
    setRecordingPage(page);
    setSelectedIndex(page * recordingsPerPage);
    setIsPlaying(false);
    setPlaybackSeconds(0);
  };

  const requestDownload = async () => {
    if (!selectedRecording) return;
    const controller = new AbortController();
    downloadController.current?.abort();
    downloadController.current = controller;
    setDownloadState("processing");
    setDownloadError("");
    let recording = selectedRecording;
    try {
      if (!recording.sample && dataSource?.getRecording) {
        const refreshed = recording.daily ? await dataSource.getRecording(recording.id, controller.signal, "daily")
          : await dataSource.getRecording(recording.id, controller.signal);
        if (controller.signal.aborted) return;
        if (refreshed) setAvailableRecordings((items) => items.map((item) => recordingKey(item) === recordingKey(refreshed) ? refreshed : item));
        if (!refreshed?.downloadUrl) {
          setDownloadError("이 녹화 영상은 다운로드할 수 없습니다.");
          setDownloadState("idle");
          return;
        }
        recording = refreshed;
      }
    } catch {
      if (!controller.signal.aborted) {
        setDownloadError("다운로드 전에 녹화 정보를 확인하지 못했습니다.");
        setDownloadState("idle");
      }
      return;
    }
    if (recording.downloadUrl) {
      const link = document.createElement("a");
      link.href = recording.downloadUrl;
      link.download = recording.daily ? `${recording.daily.recordingDate}.mp4`
        : recording.format === "정보 없음" ? recording.id : `${recording.id}.${recording.format.toLowerCase()}`;
      document.body.append(link);
      link.click();
      link.remove();
    }
    setDownloadStateAfter("complete", 400);
  };

  const prepareDownload = async () => {
    if (!selectedRecording?.daily || !canPrepareDownload || !dataSource?.prepareDailyRecordingExport) return;
    const controller = new AbortController();
    downloadController.current?.abort();
    downloadController.current = controller;
    setDownloadState("processing");
    setDownloadError("");
    try {
      const recording = await dataSource.prepareDailyRecordingExport(selectedRecording.id, controller.signal);
      if (controller.signal.aborted) return;
      setAvailableRecordings(items => items.map(item => recordingKey(item) === recordingKey(recording) ? recording : item));
      setDetailRevision(value => value + 1);
    } catch {
      if (!controller.signal.aborted) setDownloadError("다운로드 파일을 준비하지 못했습니다. 녹화 상태를 확인한 뒤 다시 시도하세요.");
    } finally { if (!controller.signal.aborted) setDownloadState("idle"); }
  };

  return (
    <DashboardPageShell activePage="recordings" dataSource={dataSource} headerNotifications={headerNotifications} headerUnreadCount={headerUnreadCount} notificationState={headerNotificationState} session={session}>
      <main className="recordings-page" aria-label="스크랩 모니터링 녹화 영상">
        <div className="page-heading">
          <h1>녹화 영상</h1>
          <DataReceptionMeta reception={reception} />
        </div>
        <div className="recordings-content">
          <section className="card recordings-query">
            <SectionTitle>조회 조건</SectionTitle>
            <form className="query-controls" onSubmit={(event) => {
              event.preventDefault();
              if (!isValidDateTime(range.start) || !isValidDateTime(range.end) || dateTimeValue(range.start) >= dateTimeValue(range.end)) {
                const input = event.currentTarget.querySelectorAll<HTMLInputElement>("input")[isValidDateTime(range.start) ? 1 : 0];
                if (input) {
                  input.setCustomValidity("올바른 날짜와 시간을 입력하고, 종료 시각을 시작 시각보다 늦게 설정하세요.");
                  input.reportValidity();
                  input.setCustomValidity("");
                }
                return;
              }
              if (recordType !== "날짜" && dataSource?.supportsEventRecordingRangeLimit && dateTimeValue(range.end) - dateTimeValue(range.start) > 90 * 86_400_000) {
                const input = event.currentTarget.querySelectorAll<HTMLInputElement>("input")[1];
                if (input) {
                  input.setCustomValidity("이벤트 녹화는 최대 90일 범위까지 조회할 수 있습니다.");
                  input.reportValidity();
                  input.setCustomValidity("");
                }
                return;
              }
              const applyResult = (nextRecordings?: DashboardData["recordings"], nextList?: { list: RecordingList; total: number; complete: boolean }) => {
                downloadController.current?.abort();
                if (nextRecordings) setAvailableRecordings(nextRecordings);
                setList(nextList?.list);
                setListInfo(nextList ? { total: nextList.total, complete: nextList.complete } : null);
                setPageLoading(false);
                setDetailState({ ready: false });
                setPlaybackError(null);
                setDetailRevision((value) => value + 1);
                setApplied({ ...range, type: recordType });
                setSelectedIndex(0);
                setRecordingPage(0);
                setIsPlaying(false);
                setPlaybackSeconds(0);
                setRecordingOpen(false);
                setCoverageRecordingId(null);
                setDownloadState("idle");
                setDownloadError("");
                setQueryCompleted(true);
              };
              if (!dataSource?.queryRecordings) {
                applyResult();
                return;
              }
              const category = ({ "수거": "collection", "알림": "alert", "오류": "error" } as const)[recordType as "수거" | "알림" | "오류"] as EventCategory | undefined;
              const signal = startQuery();
              setQuerying(true);
              const query = { eventCategory: category, from: range.start, to: range.end,
                ...(recordType === "날짜" ? { recordingSource: "daily" as const }
                  : recordType === "전체" && dataSource.supportsDailyRecordings ? { recordingSource: "all" as const } : {}) };
              // 목록은 첫 페이지에 필요한 만큼만 조회하고 다른 페이지는 이동할 때 이어서 가져온다.
              const nextList = dataSource.openRecordingList?.(query);
              void (nextList ? nextList.ensure(recordingsPerPage, signal).then((snapshot) => { if (!signal.aborted) applyResult(snapshot.items, { list: nextList, total: snapshot.total, complete: snapshot.complete }); })
                : dataSource.queryRecordings(query, signal).then((value) => { if (!signal.aborted) applyResult(value); }))
                .catch(() => undefined)
                .finally(() => { if (!signal.aborted) setQuerying(false); });
            }}>
              <div className="query-type" role="group" aria-label="빠른 기간 선택">
                <span>빠른 선택</span>
                <div>{recentPeriods.map(({ hours, label }) => <button key={hours} type="button" className={preset === hours ? "selected" : ""} aria-pressed={preset === hours} onClick={() => { setRange(recentRange(hours, defaultRangeEnd)); setPreset(hours); }}>{label}</button>)}</div>
              </div>
              <DateTimeField label="시작 시각" value={range.start} onChange={(value) => { setRange({ ...range, start: value }); setPreset(null); }} />
              <DateTimeField label="종료 시각" value={range.end} onChange={(value) => { setRange({ ...range, end: value }); setPreset(null); }} />
              <div className="query-type">
                <span>{dataSource?.supportsDailyRecordings ? "녹화 유형" : "이벤트 유형"}</span>
                <div>
                  {(dataSource?.supportsDailyRecordings ? ["전체", "날짜", ...recordingTypes.slice(1)] : recordingTypes).map((type) => (
                    <button
                      key={type}
                      className={recordType === type ? "selected" : ""}
                      type="button"
                      onClick={() => setRecordType(type)}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              <button className="primary-button" type="submit" disabled={querying}>{querying ? "조회 중" : "조회"}</button>
            </form>
          </section>
          <div className="recordings-main">
            <section className="card recordings-list">
              <div className="recordings-card-head">
                <SectionTitle>녹화 목록</SectionTitle>
                <span>{initialError && !recordingsState?.stale ? "확인 불가" : `${totalRecordingCount}건${pageLoading ? " / 불러오는 중" : ""}`}</span>
              </div>
              <div className="recordings-list-items">
                {pagedRecordings.length > 0 ? pagedRecordings.map((recording, index) => (
                  <button
                    key={recordingKey(recording)}
                    className={`recording-item ${selectedKey === recordingKey(recording) ? "selected" : ""}`}
                    type="button"
                    onClick={() => {
                      downloadController.current?.abort();
                      setDownloadState("idle");
                      setDownloadError("");
                      setDetailState({ key: recordingKey(recording), ready: false });
                      setPlaybackError(null);
                      setDetailRevision((value) => value + 1);
                      setSelectedIndex(pageStart + index);
                      setIsPlaying(false);
                      setPlaybackSeconds(0);
                    }}
                  >
                    {recording.thumbnailUrl || recording.sample
                      ? <img src={recording.thumbnailUrl ?? cameraFrame} alt="" />
                      : <span className="recording-thumbnail-empty" aria-hidden="true">미리보기 없음</span>}
                    <span className="recording-item-main">
                      <strong>{recording.date}</strong>
                      <span>{recording.time}</span>
                      <span className={`status-text ${recording.status === "available" ? "ok" : recording.status === "processing" ? "muted" : "error"}`}>{recordingStatus(recording)}{!recording.daily && recording.coverage === "partial" ? " (부분 녹화)" : ""}</span>
                    </span>
                    <span className="recording-item-side">
                      <span className={`recording-type ${recording.tone}`}>{recording.type}</span>
                      {recording.duration !== "정보 없음" && <span>{recording.duration}</span>}
                    </span>
                  </button>
                )) : <p className="collection-empty" role={initialError ? "alert" : undefined}>{initialError ? `${initialError} 조회 버튼으로 다시 시도하세요.` : "조회된 녹화 영상이 없습니다."}</p>}
              </div>
              <Pagination
                ariaLabel="녹화 목록 페이지"
                currentPage={recordingPage}
                itemLabel="녹화 목록"
                onPageChange={selectRecordingPage}
                totalPages={totalRecordingPages}
              />
            </section>
                <section className="card recording-player">
                  <SectionTitle>녹화 영상</SectionTitle>
                  <div className="recording-player-center">
                    <div className="recording-stage">
                      <div className="recording-frame">
                        {selectedPlaybackAvailable && selectedRecording?.replay && replayPlayable(selectedRecording)
                          ? <Suspense fallback={<div className="recording-media-unavailable" role="status">영상을 준비 중입니다.</div>}><EventReplayPlayer key={selectedKey} replay={selectedRecording.replay} label={`${selectedRecording.date} 이벤트 녹화 영상`} onError={() => setPlaybackError({ key: selectedKey, message: "영상을 재생하지 못했습니다. 접근 상태를 확인하세요." })} onPosition={setPlaybackSeconds} /></Suspense>
                          : selectedPlaybackAvailable && selectedRecording?.daily?.playbackPath
                          ? <Suspense fallback={<div className="recording-media-unavailable" role="status">영상을 준비 중입니다.</div>}><DailyRecordingVideo key={selectedKey} videoRef={playerRef} path={selectedRecording.daily.playbackPath} label={`${selectedRecording.date} 녹화 영상`} onError={() => setPlaybackError({ key: selectedKey, message: "영상을 재생하지 못했습니다. 접근 상태를 확인하세요." })} onTimeUpdate={seconds => { if (!recordingOpen) setPlaybackSeconds(seconds); }} /></Suspense>
                          : selectedPlaybackAvailable && selectedRecording?.contentUrl
                          ? <video ref={playerRef} src={selectedRecording.contentUrl} poster={selectedRecording.thumbnailUrl} controls preload="metadata" aria-label={`${selectedRecording.date} 녹화 영상`} onError={() => setPlaybackError({ key: selectedKey, message: "영상 접근 상태를 확인하세요." })} onTimeUpdate={(event) => { if (!recordingOpen) setPlaybackSeconds(event.currentTarget.currentTime); }} />
                          : selectedRecording?.sample
                            ? <img src={cameraFrame} alt={`${selectedRecording.date} 녹화 영상`} />
                            : <div className="recording-media-unavailable" role="status">{selectedRecording ? "재생 가능한 영상이 없습니다." : "선택할 수 있는 녹화 영상이 없습니다."}</div>}
                        {selectedPlaybackAvailable && recordedTime && <span className="recorded-time">{recordedTime}</span>}
                        {selectedPlaybackAvailable && <button
                          className="recording-expand"
                          type="button"
                          aria-label="녹화 영상 크게 보기"
                          onClick={() => { playerRef.current?.pause(); setRecordingOpen(true); }}
                        >
                          <ExpandIcon />
                        </button>}
                      </div>
                    </div>
                    {selectedRecording?.daily && Number.isFinite(dailyNow) && <Suspense fallback={null}><DailyRecordingTimeline recording={selectedRecording.daily} now={dailyNow} onSeek={seekDailyRecording} /></Suspense>}
                    {selectedRecording?.sample && !selectedRecording.contentUrl && <div className="recording-controls">
                      <button
                        type="button"
                        aria-label={isPlaying ? "일시 정지" : "재생"}
                        onClick={() => setIsPlaying((playing) => !playing)}
                      >
                        {isPlaying ? "||" : ">"}
                      </button>
                      <div className="recording-timeline" aria-label="재생 위치"><span /></div>
                      <time>00:12:36</time>
                    </div>}
                  </div>
                </section>
                <aside className="recordings-side">
                  <section className="card recording-info">
                    <div className="recording-info-heading">
                      <SectionTitle>녹화 정보</SectionTitle>
                      <div className="recording-info-actions">
                        {(Boolean(selectedRecording?.source !== "daily" && selectedRecording?.coverage === "partial" && dataSource?.getRecordingCoverage && clipIdentifier.test(selectedRecording.id))
                          || Boolean(selectedRecording?.replay && selectedRecording.replay.unavailableIntervals.length > 0)
                          || Boolean(selectedRecording?.daily && selectedRecording.daily.gaps.length > 0)) && <button className="detail-trigger recording-coverage-trigger" type="button" aria-haspopup="dialog" onClick={() => setCoverageRecordingId(selectedRecording.id)}>{selectedRecording?.source !== "daily" && selectedRecording?.coverage === "partial" && dataSource?.getRecordingCoverage && clipIdentifier.test(selectedRecording.id) ? "부분 저장" : "누락 구간"}</button>}
                        {selectedRecording && (!selectedRecording.sample || selectedRecording.mediaStatus || selectedRecording.errorCode) && <RecordingStatusDetails
                          key={selectedKey} recording={selectedRecording} error={(detailState.source === dataSource && detailState.key === selectedKey ? detailState.error : undefined) ?? (playbackError?.key === selectedKey ? playbackError?.message : undefined)} pending={detailRequired && !detailReady} />}
                      </div>
                    </div>
                    <dl>
                      <div><dt>{selectedRecording?.daily ? "관리 구간 시작" : "시작 시각"}</dt><dd>{selectedRecording?.start ?? "정보 없음"}</dd></div>
                      <div><dt>{selectedRecording?.daily ? "관리 구간 종료" : "종료 시각"}</dt><dd>{selectedRecording?.end ?? "정보 없음"}</dd></div>
                      <div><dt>{selectedRecording?.daily ? "확보된 길이" : selectedRecording?.replay ? "재생 길이" : "기간"}</dt><dd>{selectedRecording?.duration ?? "정보 없음"}</dd></div>
                      <div><dt>{selectedRecording?.daily ? "녹화 유형" : "발생 유형"}</dt><dd>{selectedRecording ? <span className={`recording-type ${selectedRecording.tone}`}>{selectedRecording.type}</span> : "정보 없음"}</dd></div>
                      <div><dt>{selectedRecording?.daily ? "재생 형식" : "파일 형식"}</dt><dd>{selectedRecording?.daily ? selectedRecording.daily.playbackProtocol?.toUpperCase() ?? "정보 없음" : selectedRecording?.format ?? "정보 없음"}</dd></div>
                      <div><dt>비디오 코덱</dt><dd>{selectedRecording?.codec ?? "정보 없음"}</dd></div>
                      <div><dt>해상도</dt><dd>{selectedRecording?.width == null || selectedRecording.height === null ? "정보 없음" : `${selectedRecording.width} x ${selectedRecording.height}`}</dd></div>
                      <div><dt>화면 비율</dt><dd>{aspectRatio(selectedRecording)}</dd></div>
                      <div><dt>프레임 속도</dt><dd>{selectedRecording?.frameRate == null ? "정보 없음" : `${selectedRecording.frameRate} fps`}</dd></div>
                      <div><dt>파일 용량</dt><dd>{selectedRecording?.size ?? "정보 없음"}</dd></div>
                      <div className="recording-retention"><dt>{selectedRecording?.daily || selectedRecording?.eventWindow ? "보관 만료" : "보관 기간"}</dt><dd>{!selectedRecording ? "정보 없음" : selectedRecording.daily || selectedRecording.eventWindow ? <span>{selectedRecording.retentionEndsAt}</span> : <><span>{selectedRecording.retentionStartsAt}</span><span>~ {selectedRecording.retentionEndsAt}</span></>}</dd></div>
                    </dl>
                  </section>
                  <section className="card recording-download">
                    <SectionTitle>녹화 파일</SectionTitle>
                    <p role={downloadError || exportFailed ? "alert" : !selectedDownloadAvailable || downloadState === "complete" ? "status" : undefined}
                      title={exportFailed ? `오류 코드: ${exportErrorCode ?? "제공되지 않음"}` : undefined}>
                      {deletionNotice || downloadError || (preparingExport ? "다운로드 파일을 준비하고 있습니다. 준비가 끝나면 다운로드할 수 있습니다."
                        : exportFailed ? "MP4 파일 준비에 실패했습니다. 녹화 상태 상세에서 오류 코드를 확인하고 다시 준비하세요."
                        : canPrepareDownload ? "지난 날짜의 확보된 영상으로 MP4 다운로드 파일을 준비합니다. 누락 구간은 포함되지 않습니다."
                        : selectedRecording?.daily && !selectedRecording.daily.exportAllowed && (selectedRecording.daily.status === "recording" || selectedRecording.daily.status === "finalizing") ? "오늘 녹화는 재생만 가능합니다. 날짜가 종료된 뒤 다운로드할 수 있습니다."
                        : selectedRecording?.eventWindow ? "이벤트 구간의 MP4 다운로드는 아직 제공되지 않습니다."
                        : !selectedDownloadAvailable ? "이 녹화 영상은 다운로드할 수 없습니다."
                        : downloadState === "complete" ? selectedRecording?.sample ? "예시 데이터에서는 파일을 다운로드하지 않습니다." : "다운로드를 시작했습니다."
                          : "선택한 녹화 영상의 다운로드 요청을 확인합니다.")}
                    </p>
                    <div className="recording-download-actions">
                      {canDeleteDaily && selectedRecording?.daily && <button type="button" className="recording-delete" onClick={() => setDeletion({ id: selectedRecording.id, date: selectedRecording.date, busy: false })}>날짜 녹화 삭제</button>}
                      <button type="button" disabled={downloadState === "processing" || preparingExport || (!selectedDownloadAvailable && !canPrepareDownload)} onClick={() => { if (canPrepareDownload && !selectedDownloadAvailable) void prepareDownload(); else void requestDownload(); }}>
                        {preparingExport ? "다운로드 준비 중" : downloadState === "processing" ? "다운로드 요청 확인 중" : canPrepareDownload && !selectedDownloadAvailable ? "MP4 다운로드 준비" : !selectedDownloadAvailable ? "다운로드 불가" : "녹화 영상 다운로드"}
                      </button>
                    </div>
                  </section>
                </aside>
          </div>
        </div>
      </main>
      {coverageRecordingId && <DetailDialog id="recording-coverage-title" title="녹화 범위 상세" onClose={closeCoverage}>
        <Suspense fallback={<p role="status">녹화 범위 확인 중</p>}><RecordingCoverageDetails key={coverageRecordingId} dataSource={dataSource} recordingId={coverageRecordingId} recording={selectedRecording?.id === coverageRecordingId ? selectedRecording : undefined} /></Suspense>
      </DetailDialog>}
      {deletion && <DetailDialog id="recording-delete-title" title="날짜 녹화 삭제" onClose={deletion.busy ? () => undefined : closeDeletion}>
        <p>{deletion.date} 날짜 녹화 영상 전체가 영구 삭제됩니다. 이 영상을 사용하는 모든 알림, 오류 및 수거 이벤트 구간도 재생할 수 없게 됩니다.</p>
        {deletion.error && <p role="alert">{deletion.error}</p>}
        <div className="recording-delete-actions">
          <button type="button" onClick={closeDeletion} disabled={deletion.busy}>취소</button>
          <button type="button" className="recording-delete" onClick={() => { void confirmDeletion(); }} disabled={deletion.busy}>{deletion.busy ? "삭제 중" : "영구 삭제"}</button>
        </div>
      </DetailDialog>}
      {recordingOpen && selectedRecording && (
        <div
          ref={recordingModalRef}
          className="video-modal"
          role="dialog"
          aria-modal="true"
          aria-label="녹화 영상 크게 보기"
          onClick={closeRecording}
        >
          <div className="video-modal-panel" onClick={(event) => event.stopPropagation()}>
            <button className="video-modal-close" type="button" aria-label="녹화 영상 닫기" onClick={closeRecording}>닫기</button>
            <div className="video-modal-frame">
              {selectedPlaybackAvailable && selectedRecording.replay && replayPlayable(selectedRecording)
                ? <Suspense fallback={<div className="recording-media-unavailable" role="status">영상을 준비 중입니다.</div>}><EventReplayPlayer key={`${selectedKey}-expanded`} replay={selectedRecording.replay} label={`${selectedRecording.date} 이벤트 녹화 영상 확대`} initialSeconds={playbackSeconds} onError={() => setPlaybackError({ key: selectedKey, message: "영상을 재생하지 못했습니다. 접근 상태를 확인하세요." })} onPosition={setPlaybackSeconds} /></Suspense>
                : selectedPlaybackAvailable && selectedRecording.daily?.playbackPath
                ? <Suspense fallback={<div className="recording-media-unavailable" role="status">영상을 준비 중입니다.</div>}><DailyRecordingVideo key={`${selectedKey}-expanded`} videoRef={expandedPlayerRef} path={selectedRecording.daily.playbackPath} label={`${selectedRecording.date} 녹화 영상 확대`} initialTime={playbackSeconds} onError={() => setPlaybackError({ key: selectedKey, message: "영상 접근 상태를 확인하세요." })} onTimeUpdate={setPlaybackSeconds} /></Suspense>
                : selectedPlaybackAvailable && selectedRecording.contentUrl
                ? <video ref={expandedPlayerRef} src={selectedRecording.contentUrl} poster={selectedRecording.thumbnailUrl} controls autoPlay aria-label={`${selectedRecording.date} 녹화 영상 확대`} onLoadedMetadata={(event) => { event.currentTarget.currentTime = playbackSeconds; }} onError={() => setPlaybackError({ key: selectedKey, message: "영상 접근 상태를 확인하세요." })} onTimeUpdate={(event) => setPlaybackSeconds(event.currentTarget.currentTime)} />
                : selectedRecording.sample
                  ? <img src={cameraFrame} alt={`${selectedRecording.date} 녹화 영상 확대`} />
                  : <div className="recording-media-unavailable" role="status">재생 가능한 영상이 없습니다.</div>}
              {selectedPlaybackAvailable && recordedTime && <span className="recorded-time">{recordedTime}</span>}
            </div>
          </div>
        </div>
      )}
    </DashboardPageShell>
  );
}

export default RecordingsPage;
