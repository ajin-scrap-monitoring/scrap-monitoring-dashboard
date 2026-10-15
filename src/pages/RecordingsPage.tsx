import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import cameraFrame from "../assets/camera-frame.png";
import { DashboardPageShell } from "../components/DashboardShell";
import { ExpandIcon, SectionTitle } from "../components/DashboardPrimitives";
import { DataReceptionMeta } from "../components/DataReceptionMeta";
import { Pagination } from "../components/Pagination";
import { DateTimeField } from "../components/DateTimeField";
import { DetailDialog } from "../components/DetailDialog";
import { RecordingStatusDetails } from "../components/RecordingStatusDetails";
import { dateTimeValue, isValidDateTime, recentPeriods, recentRange } from "../date-range";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { DashboardData, DataAreaState, DataReception, EventCategory, HeaderNotification, Recording, UserSession } from "../domain/dashboard";
import { clipIdentifier } from "../data/recording-coverage";
import { dailyPlaybackTimestamp, dailyRecordingAvailability } from "../data/daily-recordings";
import { useDelayedState } from "../use-delayed-state";
import { useModalFocus } from "../use-modal-focus";
import { useLatestRequest } from "../use-latest-request";
import { recordingErrorCode, recordingStatus } from "../recording-status";

const recordingsPerPage = 6;
const recordingTypes = ["전체", "수거", "알림", "오류"];
const RecordingCoverageDetails = lazy(() => import("../components/RecordingCoverageDetails"));
const DailyRecordingVideo = lazy(() => import("../components/DailyRecordingVideo"));
const DailyRecordingTimeline = lazy(() => import("../components/DailyRecordingTimeline"));

function recordingKey(recording: Recording) { return `${recording.source ?? "event"}:${recording.id}`; }

function dailyTimestamp(recording: Recording, seconds: number) {
  const at = recording.daily ? dailyPlaybackTimestamp(recording.daily, seconds) : null;
  return at ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(at)) : null;
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
  serverTime?: string;
  session?: UserSession | null;
};

export function RecordingsPage({ dataSource, recordings, recordingsState, recordingsSource = "event", serverTime, headerNotifications, headerUnreadCount, headerNotificationState, reception, queryEndsAt, session }: RecordingsPageProps) {
  const requestedRecordingId = new URLSearchParams(window.location.search).get("recordingId");
  const requestedRecording = recordings.find((recording) => recording.id === requestedRecordingId);
  const [availableRecordings, setAvailableRecordings] = useState(recordings);
  const dailyRangeEnd = recordingsSource === "daily" && serverTime && Number.isFinite(Date.parse(serverTime))
    ? new Date(Date.parse(serverTime) + 9 * 3_600_000).toISOString().slice(0, 16) : undefined;
  const defaultRangeEnd = dailyRangeEnd ?? queryEndsAt ?? (recordings.reduce((latest, recording) => recording.end > latest ? recording.end : latest, "") || new Date().toISOString());
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
  const [recordType, setRecordType] = useState(initialType);
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, recordings.findIndex((recording) => recording.id === requestedRecordingId)));
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [coverageRecordingId, setCoverageRecordingId] = useState<string | null>(null);
  const closeCoverage = useCallback(() => setCoverageRecordingId(null), []);
  const [recordingPage, setRecordingPage] = useState(0);
  const [detailState, setDetailState] = useState<{ key?: string; ready: boolean; error?: string }>({ ready: false });
  const [playbackError, setPlaybackError] = useState<{ key?: string; message: string } | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [detailRevision, setDetailRevision] = useState(0);
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
    (applied.type === "날짜" ? recording.source === "daily" : recording.source !== "daily" && (applied.type === "전체" || recording.type === applied.type))
    && dateTimeValue(recording.start) <= dateTimeValue(applied.end)
    && dateTimeValue(recording.end) >= dateTimeValue(applied.start));
  const totalRecordingPages = Math.max(1, Math.ceil(visibleRecordings.length / recordingsPerPage));
  const pageStart = recordingPage * recordingsPerPage;
  const pagedRecordings = visibleRecordings.slice(pageStart, pageStart + recordingsPerPage);
  const selectedRecording = visibleRecordings[selectedIndex] ?? visibleRecordings[0];
  const selectedId = selectedRecording?.id;
  const selectedKey = selectedRecording ? recordingKey(selectedRecording) : undefined;
  const selectedSource = selectedRecording?.source ?? "event";
  const selectedSample = selectedRecording?.sample;
  const detailRequired = Boolean(dataSource?.getRecording && !selectedSample);
  const detailReady = !detailRequired || (detailState.key === selectedKey && detailState.ready);
  const dailyNow = Date.parse(serverTime ?? "");
  const dailyAvailability = selectedRecording?.daily && Number.isFinite(dailyNow) ? dailyRecordingAvailability(selectedRecording.daily, dailyNow) : undefined;
  const selectedPlaybackAvailable = Boolean(detailReady && selectedRecording && playbackError?.key !== selectedKey && (selectedRecording.daily ? dailyAvailability?.playbackReady : selectedRecording.contentUrl || selectedRecording.sample));
  const selectedDownloadAvailable = Boolean(detailReady && selectedRecording && (selectedRecording.daily ? dailyAvailability?.downloadReady : selectedRecording.downloadUrl || selectedRecording.sample));
  const canPrepareDownload = Boolean(detailReady && dailyAvailability?.canPrepareExport && typeof dataSource?.prepareDailyRecordingExport === "function");
  const preparingExport = Boolean(dailyAvailability?.exportProcessing);
  const exportFailed = selectedRecording?.daily?.exportState === "failed" && !dailyAvailability?.originalUnavailable;
  const exportErrorCode = exportFailed ? recordingErrorCode(selectedRecording?.errorCode ?? selectedRecording?.daily?.error?.code) : null;
  const recordedTime = selectedRecording?.daily ? dailyTimestamp(selectedRecording, playbackSeconds)
    : selectedRecording ? playbackTimestamp(selectedRecording.start, selectedRecording.contentUrl ? playbackSeconds : 756) : null;

  useEffect(() => {
    if (!dataSource?.getRecording || !selectedId || selectedSample) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const recording = selectedSource === "daily" ? await dataSource.getRecording?.(selectedId, controller.signal, "daily")
          : await dataSource.getRecording?.(selectedId, controller.signal);
        if (controller.signal.aborted) return;
        setAvailableRecordings((items) => items.map((item) => recordingKey(item) !== selectedKey ? item : recording ?? { ...item, status: "unavailable", contentUrl: undefined, downloadUrl: undefined, daily: undefined }));
        setDetailState({ key: selectedKey, ready: Boolean(recording), error: recording ? undefined : "녹화 정보가 없습니다." });
        if (recording?.status === "processing" || recording?.mediaStatus === "collecting" || recording?.mediaStatus === "processing"
          || recording?.daily?.status === "recording" || recording?.daily?.status === "finalizing" || recording?.daily?.exportState === "processing") {
          timer = setTimeout(() => { void refresh(); }, 2000);
        }
      } catch {
        if (!controller.signal.aborted) setDetailState({ key: selectedKey, ready: false, error: "녹화 정보를 확인하지 못했습니다." });
      }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [dataSource, selectedId, selectedKey, selectedSource, selectedSample, detailRevision]);
  useEffect(() => () => downloadController.current?.abort(), [dataSource]);

  const selectRecordingPage = (page: number) => {
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
        if (refreshed) setAvailableRecordings((items) => items.map((item) => item.id === refreshed.id ? refreshed : item));
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
              const applyResult = (nextRecordings?: DashboardData["recordings"]) => {
                downloadController.current?.abort();
                if (nextRecordings) setAvailableRecordings(nextRecordings);
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
              void dataSource.queryRecordings({ eventCategory: category, from: range.start, to: range.end,
                ...(recordType === "날짜" ? { recordingSource: "daily" as const } : {}) }, signal)
                .then((value) => { if (!signal.aborted) applyResult(value); })
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
                  {(dataSource?.supportsDailyRecordings ? ["날짜", ...recordingTypes] : recordingTypes).map((type) => (
                    <button
                      key={type}
                      className={recordType === type ? "selected" : ""}
                      type="button"
                      onClick={() => setRecordType(type)}
                    >
                      {type === "전체" && dataSource?.supportsDailyRecordings ? "이벤트" : type}
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
                <span>{initialError && !recordingsState?.stale ? "확인 불가" : `${visibleRecordings.length}건`}</span>
              </div>
              <div className="recordings-list-items">
                {pagedRecordings.length > 0 ? pagedRecordings.map((recording, index) => (
                  <button
                    key={recording.id}
                    className={`recording-item ${selectedRecording?.id === recording.id ? "selected" : ""}`}
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
                        {selectedPlaybackAvailable && selectedRecording?.daily?.playbackPath
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
                    {selectedRecording?.daily && Number.isFinite(dailyNow) && <Suspense fallback={null}><DailyRecordingTimeline recording={selectedRecording.daily} now={dailyNow} onSeek={seconds => {
                      const player = playerRef.current;
                      if (selectedPlaybackAvailable && player && player.readyState >= 1) { player.currentTime = seconds; setPlaybackSeconds(seconds); }
                    }} /></Suspense>}
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
                        {selectedRecording?.source !== "daily" && selectedRecording?.coverage === "partial" && dataSource?.getRecordingCoverage && clipIdentifier.test(selectedRecording.id) && <button className="detail-trigger recording-coverage-trigger" type="button" aria-haspopup="dialog" onClick={() => setCoverageRecordingId(selectedRecording.id)}>부분 저장</button>}
                        {selectedRecording && (!selectedRecording.sample || selectedRecording.mediaStatus || selectedRecording.errorCode) && <RecordingStatusDetails
                          key={selectedKey} recording={selectedRecording} error={(detailState.key === selectedKey ? detailState.error : undefined) ?? (playbackError?.key === selectedKey ? playbackError?.message : undefined)} pending={detailRequired && !detailReady} />}
                      </div>
                    </div>
                    <dl>
                      <div><dt>{selectedRecording?.daily ? "관리 구간 시작" : "시작 시각"}</dt><dd>{selectedRecording?.start ?? "정보 없음"}</dd></div>
                      <div><dt>{selectedRecording?.daily ? "관리 구간 종료" : "종료 시각"}</dt><dd>{selectedRecording?.end ?? "정보 없음"}</dd></div>
                      <div><dt>{selectedRecording?.daily ? "확보된 길이" : "기간"}</dt><dd>{selectedRecording?.duration ?? "정보 없음"}</dd></div>
                      <div><dt>{selectedRecording?.daily ? "녹화 유형" : "발생 유형"}</dt><dd>{selectedRecording ? <span className={`recording-type ${selectedRecording.tone}`}>{selectedRecording.type}</span> : "정보 없음"}</dd></div>
                      <div><dt>{selectedRecording?.daily ? "재생 형식" : "파일 형식"}</dt><dd>{selectedRecording?.daily ? selectedRecording.daily.playbackProtocol?.toUpperCase() ?? "정보 없음" : selectedRecording?.format ?? "정보 없음"}</dd></div>
                      <div><dt>비디오 코덱</dt><dd>{selectedRecording?.codec ?? "정보 없음"}</dd></div>
                      <div><dt>해상도</dt><dd>{selectedRecording?.width == null || selectedRecording.height === null ? "정보 없음" : `${selectedRecording.width} x ${selectedRecording.height}`}</dd></div>
                      <div><dt>화면 비율</dt><dd>{aspectRatio(selectedRecording)}</dd></div>
                      <div><dt>프레임 속도</dt><dd>{selectedRecording?.frameRate == null ? "정보 없음" : `${selectedRecording.frameRate} fps`}</dd></div>
                      <div><dt>파일 용량</dt><dd>{selectedRecording?.size ?? "정보 없음"}</dd></div>
                      <div className="recording-retention"><dt>{selectedRecording?.daily ? "보관 만료" : "보관 기간"}</dt><dd>{!selectedRecording ? "정보 없음" : selectedRecording.daily ? <span>{selectedRecording.retentionEndsAt}</span> : <><span>{selectedRecording.retentionStartsAt}</span><span>~ {selectedRecording.retentionEndsAt}</span></>}</dd></div>
                    </dl>
                  </section>
                  <section className="card recording-download">
                    <SectionTitle>녹화 파일</SectionTitle>
                    <p role={downloadError || exportFailed ? "alert" : !selectedDownloadAvailable || downloadState === "complete" ? "status" : undefined}
                      title={exportFailed ? `오류 코드: ${exportErrorCode ?? "제공되지 않음"}` : undefined}>
                      {downloadError || (preparingExport ? "다운로드 파일을 준비하고 있습니다. 준비가 끝나면 다운로드할 수 있습니다."
                        : exportFailed ? "MP4 파일 준비에 실패했습니다. 녹화 상태 상세에서 오류 코드를 확인하고 다시 준비하세요."
                        : canPrepareDownload ? "지난 날짜의 확보된 영상으로 MP4 다운로드 파일을 준비합니다. 누락 구간은 포함되지 않습니다."
                        : selectedRecording?.daily && !selectedRecording.daily.exportAllowed && (selectedRecording.daily.status === "recording" || selectedRecording.daily.status === "finalizing") ? "오늘 녹화는 재생만 가능합니다. 날짜가 종료된 뒤 다운로드할 수 있습니다."
                        : !selectedDownloadAvailable ? "이 녹화 영상은 다운로드할 수 없습니다."
                        : downloadState === "complete" ? selectedRecording?.sample ? "예시 데이터에서는 파일을 다운로드하지 않습니다." : "다운로드를 시작했습니다."
                          : "선택한 녹화 영상의 다운로드 요청을 확인합니다.")}
                    </p>
                    <button type="button" disabled={downloadState === "processing" || preparingExport || (!selectedDownloadAvailable && !canPrepareDownload)} onClick={() => { if (canPrepareDownload && !selectedDownloadAvailable) void prepareDownload(); else void requestDownload(); }}>
                      {preparingExport ? "다운로드 준비 중" : downloadState === "processing" ? "다운로드 요청 확인 중" : canPrepareDownload && !selectedDownloadAvailable ? "MP4 다운로드 준비" : !selectedDownloadAvailable ? "다운로드 불가" : "녹화 영상 다운로드"}
                    </button>
                  </section>
                </aside>
          </div>
        </div>
      </main>
      {coverageRecordingId && dataSource && <DetailDialog id="recording-coverage-title" title="녹화 범위 상세" onClose={closeCoverage}>
        <Suspense fallback={<p role="status">녹화 범위 확인 중</p>}><RecordingCoverageDetails key={coverageRecordingId} dataSource={dataSource} recordingId={coverageRecordingId} /></Suspense>
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
              {selectedPlaybackAvailable && selectedRecording.daily?.playbackPath
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
