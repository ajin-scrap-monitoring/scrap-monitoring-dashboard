import { useCallback, useState } from "react";

import cameraFrame from "../assets/camera-frame.png";
import { DashboardPageShell } from "../components/DashboardShell";
import { DashboardStatusLabel, ExpandIcon, SectionTitle } from "../components/DashboardPrimitives";
import { Pagination } from "../components/Pagination";
import { DateTimeField } from "../components/DateTimeField";
import { isValidDateTime, recentPeriods, recentRange } from "../date-range";
import type { DashboardData, HeaderNotification } from "../domain/dashboard";
import { useDelayedState } from "../use-delayed-state";
import { useModalFocus } from "../use-modal-focus";

const recordingsPerPage = 6;
const recordingTypes = ["전체", "수거", "알림", "오류"];

type RecordingsPageProps = {
  headerNotifications: HeaderNotification[];
  lastMeasuredAt: string;
  recordings: DashboardData["recordings"];
  status: DashboardData["monitoring"]["status"];
};

export function RecordingsPage({ recordings, headerNotifications, lastMeasuredAt, status }: RecordingsPageProps) {
  const latestEnd = recordings.reduce((latest, recording) => recording.end > latest ? recording.end : latest, "") || new Date().toISOString();
  const [range, setRange] = useState(() => recentRange(168, latestEnd));
  const [preset, setPreset] = useState<number | null>(168);
  const [applied, setApplied] = useState(() => ({ ...recentRange(168, latestEnd), type: "전체" }));
  const [queryError, setQueryError] = useState("");
  const [recordType, setRecordType] = useState("전체");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [recordingPage, setRecordingPage] = useState(0);
  const [downloadState, setDownloadState, setDownloadStateAfter] =
    useDelayedState<"idle" | "processing" | "complete">("idle");
  const closeRecording = useCallback(() => setRecordingOpen(false), []);
  const recordingModalRef = useModalFocus<HTMLDivElement>(recordingOpen, closeRecording);

  const visibleRecordings = recordings.filter((recording) =>
    (applied.type === "전체" || recording.type === applied.type)
    && new Date(recording.start.replace(" ", "T")).getTime() <= new Date(applied.end).getTime()
    && new Date(recording.end.replace(" ", "T")).getTime() >= new Date(applied.start).getTime());
  const totalRecordingPages = Math.max(1, Math.ceil(visibleRecordings.length / recordingsPerPage));
  const pageStart = recordingPage * recordingsPerPage;
  const pagedRecordings = visibleRecordings.slice(pageStart, pageStart + recordingsPerPage);
  const selectedRecording = visibleRecordings[selectedIndex] ?? visibleRecordings[0];

  const selectRecordingPage = (page: number) => {
    setRecordingPage(page);
    setSelectedIndex(page * recordingsPerPage);
    setIsPlaying(false);
  };

  const requestDownload = () => {
    setDownloadState("processing");
    setDownloadStateAfter("complete", 400);
  };

  return (
    <DashboardPageShell activePage="recordings" headerNotifications={headerNotifications}>
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
              if (!isValidDateTime(range.start) || !isValidDateTime(range.end) || new Date(range.start).getTime() >= new Date(range.end).getTime()) {
                setQueryError("올바른 날짜와 시간을 입력하고, 종료 시각을 시작 시각보다 늦게 설정하세요.");
                return;
              }
              setApplied({ ...range, type: recordType });
              setSelectedIndex(0);
              setRecordingPage(0);
              setIsPlaying(false);
              setRecordingOpen(false);
              setDownloadState("idle");
              setQueryError("");
            }}>
              <div className="query-type" role="group" aria-label="빠른 기간 선택">
                <span>빠른 선택</span>
                <div>{recentPeriods.map(({ hours, label }) => <button key={hours} type="button" className={preset === hours ? "selected" : ""} aria-pressed={preset === hours} onClick={() => { setRange(recentRange(hours, latestEnd)); setPreset(hours); }}>{label}</button>)}</div>
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
              <button className="primary-button" type="submit">조회</button>
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
                    key={recording.date}
                    className={`recording-item ${selectedRecording?.date === recording.date ? "selected" : ""}`}
                    type="button"
                    onClick={() => {
                      setSelectedIndex(pageStart + index);
                      setIsPlaying(false);
                    }}
                  >
                    <img src={cameraFrame} alt="" />
                    <span className="recording-item-main">
                      <strong>{recording.date}</strong>
                      <span>{recording.time}</span>
                      <span className="status-text ok">정상</span>
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
                        <img src={cameraFrame} alt={`${selectedRecording.date} 녹화 영상`} />
                        <span className="recorded-time">{selectedRecording.date} 00:12:36</span>
                        <button
                          className="recording-expand"
                          type="button"
                          aria-label="녹화 영상 크게 보기"
                          onClick={() => setRecordingOpen(true)}
                        >
                          <ExpandIcon />
                        </button>
                      </div>
                    </div>
                    <div className="recording-controls">
                      <button
                        type="button"
                        aria-label={isPlaying ? "일시 정지" : "재생"}
                        onClick={() => setIsPlaying((playing) => !playing)}
                      >
                        {isPlaying ? "||" : ">"}
                      </button>
                      <div className="recording-timeline" aria-label="재생 위치"><span /></div>
                      <time>00:12:36</time>
                    </div>
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
                      <div><dt>파일 형식</dt><dd>MP4</dd></div>
                      <div><dt>비디오 코덱</dt><dd>H.264</dd></div>
                      <div><dt>해상도</dt><dd>640 x 480</dd></div>
                      <div><dt>화면 비율</dt><dd>4:3</dd></div>
                      <div><dt>프레임 속도</dt><dd>30 fps</dd></div>
                      <div><dt>파일 용량</dt><dd>1.8 GB</dd></div>
                      <div className="recording-retention"><dt>보관 기간</dt><dd><span>{selectedRecording.retentionStartsAt}</span><span>~ {selectedRecording.retentionEndsAt}</span></dd></div>
                    </dl>
                  </section>
                  <section className="card recording-download">
                    <SectionTitle>녹화 파일</SectionTitle>
                    <p>선택한 녹화 영상의 다운로드 요청을 확인합니다.</p>
                    <button type="button" disabled={downloadState === "processing"} onClick={requestDownload}>
                      {downloadState === "processing" ? "다운로드 요청 확인 중" : "녹화 영상 다운로드"}
                    </button>
                    {downloadState === "complete" && <p role="status">다운로드는 서버 연동 후 시작됩니다.</p>}
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
              <img src={cameraFrame} alt={`${selectedRecording.date} 녹화 영상 확대`} />
              <span className="recorded-time">{selectedRecording.date} 00:12:36</span>
            </div>
          </div>
        </div>
      )}
    </DashboardPageShell>
  );
}

export default RecordingsPage;
