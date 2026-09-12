import { useCallback, useState } from "react";

import cameraFrame from "../assets/camera-frame.png";
import { DashboardPageShell } from "../components/DashboardShell";
import { DashboardStatusLabel, ExpandIcon, SectionTitle } from "../components/DashboardPrimitives";
import { Pagination } from "../components/Pagination";
import { DateTimeField } from "../components/DateTimeField";
import { dateTimeValue, isValidDateTime, recentPeriods, recentRange } from "../date-range";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { DashboardData, EventCategory, HeaderNotification, UserSession } from "../domain/dashboard";
import { useDelayedState } from "../use-delayed-state";
import { useModalFocus } from "../use-modal-focus";

const recordingsPerPage = 6;
const recordingTypes = ["전체", "수거", "알림", "오류"];

function playbackTimestamp(start: string, elapsedSeconds: number) {
  const timestamp = dateTimeValue(start);
  if (!Number.isFinite(timestamp)) return start;
  const value = new Date(timestamp + elapsedSeconds * 1000);
  const part = (number: number) => String(number).padStart(2, "0");
  return `${value.getUTCFullYear()}-${part(value.getUTCMonth() + 1)}-${part(value.getUTCDate())} ${part(value.getUTCHours())}:${part(value.getUTCMinutes())}:${part(value.getUTCSeconds())}`;
}

type RecordingsPageProps = {
  dataSource?: DashboardDataSource;
  headerNotifications: HeaderNotification[];
  headerUnreadCount?: number;
  lastMeasuredAt: string;
  queryEndsAt?: string;
  recordings: DashboardData["recordings"];
  session?: UserSession | null;
  status: DashboardData["monitoring"]["status"];
};

export function RecordingsPage({ dataSource, recordings, headerNotifications, headerUnreadCount, lastMeasuredAt, queryEndsAt, session, status }: RecordingsPageProps) {
  const requestedRecordingId = new URLSearchParams(window.location.search).get("recordingId");
  const requestedRecording = recordings.find((recording) => recording.id === requestedRecordingId);
  const [availableRecordings, setAvailableRecordings] = useState(recordings);
  const defaultRangeEnd = queryEndsAt ?? (recordings.reduce((latest, recording) => recording.end > latest ? recording.end : latest, "") || new Date().toISOString());
  const initialRange = requestedRecording
    ? { start: requestedRecording.start.replace(" ", "T").slice(0, 16), end: requestedRecording.end.replace(" ", "T").slice(0, 16) }
    : recentRange(168, defaultRangeEnd);
  const [range, setRange] = useState(initialRange);
  const [preset, setPreset] = useState<number | null>(requestedRecording ? null : 168);
  const [applied, setApplied] = useState(() => ({ ...initialRange, type: "전체" }));
  const [queryError, setQueryError] = useState("");
  const [querying, setQuerying] = useState(false);
  const [recordType, setRecordType] = useState("전체");
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, recordings.findIndex((recording) => recording.id === requestedRecordingId)));
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [recordingPage, setRecordingPage] = useState(0);
  const [downloadState, setDownloadState, setDownloadStateAfter] =
    useDelayedState<"idle" | "processing" | "complete">("idle");
  const closeRecording = useCallback(() => setRecordingOpen(false), []);
  const recordingModalRef = useModalFocus<HTMLDivElement>(recordingOpen, closeRecording);

  const visibleRecordings = availableRecordings.filter((recording) =>
    (applied.type === "전체" || recording.type === applied.type)
    && dateTimeValue(recording.start) <= dateTimeValue(applied.end)
    && dateTimeValue(recording.end) >= dateTimeValue(applied.start));
  const totalRecordingPages = Math.max(1, Math.ceil(visibleRecordings.length / recordingsPerPage));
  const pageStart = recordingPage * recordingsPerPage;
  const pagedRecordings = visibleRecordings.slice(pageStart, pageStart + recordingsPerPage);
  const selectedRecording = visibleRecordings[selectedIndex] ?? visibleRecordings[0];
  const selectedPlaybackAvailable = Boolean(selectedRecording && (selectedRecording.contentUrl || selectedRecording.sample));
  const selectedDownloadAvailable = Boolean(selectedRecording && (selectedRecording.downloadUrl || selectedRecording.sample));

  const selectRecordingPage = (page: number) => {
    setRecordingPage(page);
    setSelectedIndex(page * recordingsPerPage);
    setIsPlaying(false);
    setPlaybackSeconds(0);
  };

  const requestDownload = () => {
    setDownloadState("processing");
    if (selectedRecording?.downloadUrl) {
      const link = document.createElement("a");
      link.href = selectedRecording.downloadUrl;
      link.download = `${selectedRecording.id}.${selectedRecording.format.toLowerCase()}`;
      document.body.append(link);
      link.click();
      link.remove();
    }
    setDownloadStateAfter("complete", 400);
  };

  return (
    <DashboardPageShell activePage="recordings" dataSource={dataSource} headerNotifications={headerNotifications} headerUnreadCount={headerUnreadCount} session={session}>
      <main className="recordings-page" aria-label="스크랩 모니터링 녹화 영상">
        <div className="page-heading">
          <h1>녹화 영상</h1>
          <div className="page-meta">
            <DashboardStatusLabel status={status} />
            <span className="meta-divider" aria-hidden="true" />
            <span>마지막 측정 {lastMeasuredAt}</span>
          </div>
        </div>
        <div className="recordings-content">
          <section className="card recordings-query">
            <SectionTitle>조회 조건</SectionTitle>
            <form className="query-controls" onSubmit={(event) => {
              event.preventDefault();
              if (!isValidDateTime(range.start) || !isValidDateTime(range.end) || dateTimeValue(range.start) >= dateTimeValue(range.end)) {
                setQueryError("올바른 날짜와 시간을 입력하고, 종료 시각을 시작 시각보다 늦게 설정하세요.");
                return;
              }
              const applyResult = (nextRecordings?: DashboardData["recordings"]) => {
                if (nextRecordings) setAvailableRecordings(nextRecordings);
                setApplied({ ...range, type: recordType });
                setSelectedIndex(0);
                setRecordingPage(0);
                setIsPlaying(false);
                setPlaybackSeconds(0);
                setRecordingOpen(false);
                setDownloadState("idle");
                setQueryError("");
              };
              if (!dataSource?.queryRecordings) {
                applyResult();
                return;
              }
              const category = ({ "수거": "collection", "알림": "alert", "오류": "error" } as const)[recordType as "수거" | "알림" | "오류"] as EventCategory | undefined;
              setQuerying(true);
              void dataSource.queryRecordings({ eventCategory: category, from: range.start, to: range.end })
                .then(applyResult)
                .catch(() => setQueryError("녹화 영상을 조회하지 못했습니다. 기존 조회 결과를 유지합니다."))
                .finally(() => setQuerying(false));
            }}>
              <div className="query-type" role="group" aria-label="빠른 기간 선택">
                <span>빠른 선택</span>
                <div>{recentPeriods.map(({ hours, label }) => <button key={hours} type="button" className={preset === hours ? "selected" : ""} aria-pressed={preset === hours} onClick={() => { setRange(recentRange(hours, defaultRangeEnd)); setPreset(hours); }}>{label}</button>)}</div>
              </div>
              <DateTimeField label="시작 시각" value={range.start} onChange={(value) => { setRange({ ...range, start: value }); setPreset(null); }} />
              <DateTimeField label="종료 시각" value={range.end} onChange={(value) => { setRange({ ...range, end: value }); setPreset(null); }} />
              <div className="query-type">
                <span>이벤트 유형</span>
                <div>
                  {recordingTypes.map((type) => (
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
            {queryError && <p role="alert">{queryError}</p>}
          </section>
          <div className="recordings-main">
            <section className="card recordings-list">
              <div className="recordings-card-head">
                <SectionTitle>녹화 목록</SectionTitle>
                <span>{visibleRecordings.length}건</span>
              </div>
              <div className="recordings-list-items">
                {pagedRecordings.length > 0 ? pagedRecordings.map((recording, index) => (
                  <button
                    key={recording.id}
                    className={`recording-item ${selectedRecording?.id === recording.id ? "selected" : ""}`}
                    type="button"
                    onClick={() => {
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
                      <span className={`status-text ${recording.status === "available" ? "ok" : "error"}`}>{recording.status === "available" ? "정상" : recording.status === "processing" ? "처리 중" : recording.status === "expired" ? "보관 만료" : "사용 불가"}</span>
                    </span>
                    <span className="recording-item-side">
                      <span className={`recording-type ${recording.tone}`}>{recording.type}</span>
                      <span>{recording.duration}</span>
                    </span>
                  </button>
                )) : <p className="collection-empty">조회된 녹화 영상이 없습니다.</p>}
              </div>
              <Pagination
                ariaLabel="녹화 목록 페이지"
                currentPage={recordingPage}
                itemLabel="녹화 목록"
                onPageChange={selectRecordingPage}
                totalPages={totalRecordingPages}
              />
            </section>
            {selectedRecording ? (
              <>
                <section className="card recording-player">
                  <SectionTitle>녹화 영상</SectionTitle>
                  <div className="recording-player-center">
                    <div className="recording-stage">
                      <div className="recording-frame">
                        {selectedRecording.contentUrl
                          ? <video src={selectedRecording.contentUrl} poster={selectedRecording.thumbnailUrl} controls preload="metadata" aria-label={`${selectedRecording.date} 녹화 영상`} onTimeUpdate={(event) => setPlaybackSeconds(event.currentTarget.currentTime)} />
                          : selectedRecording.sample
                            ? <img src={cameraFrame} alt={`${selectedRecording.date} 녹화 영상`} />
                            : <div className="recording-media-unavailable" role="status">재생 가능한 영상이 없습니다.</div>}
                        {selectedPlaybackAvailable && <span className="recorded-time">{playbackTimestamp(selectedRecording.start, selectedRecording.contentUrl ? playbackSeconds : 756)}</span>}
                        {selectedPlaybackAvailable && <button
                          className="recording-expand"
                          type="button"
                          aria-label="녹화 영상 크게 보기"
                          onClick={() => setRecordingOpen(true)}
                        >
                          <ExpandIcon />
                        </button>}
                      </div>
                    </div>
                    {selectedRecording.sample && !selectedRecording.contentUrl && <div className="recording-controls">
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
                    <SectionTitle>녹화 정보</SectionTitle>
                    <dl>
                      <div><dt>시작 시각</dt><dd>{selectedRecording.start}</dd></div>
                      <div><dt>종료 시각</dt><dd>{selectedRecording.end}</dd></div>
                      <div><dt>기간</dt><dd>{selectedRecording.duration}</dd></div>
                      <div><dt>발생 유형</dt><dd><span className={`recording-type ${selectedRecording.tone}`}>{selectedRecording.type}</span></dd></div>
                      <div><dt>파일 형식</dt><dd>{selectedRecording.format}</dd></div>
                      <div><dt>비디오 코덱</dt><dd>{selectedRecording.codec}</dd></div>
                      <div><dt>해상도</dt><dd>{selectedRecording.width} x {selectedRecording.height}</dd></div>
                      <div><dt>화면 비율</dt><dd>{selectedRecording.width * 3 === selectedRecording.height * 4 ? "4:3" : selectedRecording.width * 9 === selectedRecording.height * 16 ? "16:9" : `${selectedRecording.width}:${selectedRecording.height}`}</dd></div>
                      <div><dt>프레임 속도</dt><dd>{selectedRecording.frameRate} fps</dd></div>
                      <div><dt>파일 용량</dt><dd>{selectedRecording.size}</dd></div>
                      <div className="recording-retention"><dt>보관 기간</dt><dd><span>{selectedRecording.retentionStartsAt}</span><span>~ {selectedRecording.retentionEndsAt}</span></dd></div>
                    </dl>
                  </section>
                  <section className="card recording-download">
                    <SectionTitle>녹화 파일</SectionTitle>
                    <p>선택한 녹화 영상의 다운로드 요청을 확인합니다.</p>
                    <button type="button" disabled={downloadState === "processing" || !selectedDownloadAvailable} onClick={requestDownload}>
                      {!selectedDownloadAvailable ? "다운로드 불가" : downloadState === "processing" ? "다운로드 요청 확인 중" : "녹화 영상 다운로드"}
                    </button>
                    {!selectedDownloadAvailable && <p role="status">이 녹화 영상은 다운로드할 수 없습니다.</p>}
                    {downloadState === "complete" && <p role="status">{selectedRecording.downloadUrl ? "다운로드를 시작했습니다." : "예시 데이터에서는 파일을 다운로드하지 않습니다."}</p>}
                  </section>
                </aside>
              </>
            ) : (
              <section className="card recordings-empty-panel">
                <SectionTitle>녹화 영상</SectionTitle>
                <p className="collection-empty">선택할 수 있는 녹화 영상이 없습니다.</p>
              </section>
            )}
          </div>
        </div>
      </main>
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
              {selectedRecording.contentUrl
                ? <video src={selectedRecording.contentUrl} poster={selectedRecording.thumbnailUrl} controls autoPlay aria-label={`${selectedRecording.date} 녹화 영상 확대`} onTimeUpdate={(event) => setPlaybackSeconds(event.currentTarget.currentTime)} />
                : selectedRecording.sample
                  ? <img src={cameraFrame} alt={`${selectedRecording.date} 녹화 영상 확대`} />
                  : <div className="recording-media-unavailable" role="status">재생 가능한 영상이 없습니다.</div>}
              {selectedPlaybackAvailable && <span className="recorded-time">{playbackTimestamp(selectedRecording.start, selectedRecording.contentUrl ? playbackSeconds : 756)}</span>}
            </div>
          </div>
        </div>
      )}
    </DashboardPageShell>
  );
}

export default RecordingsPage;
