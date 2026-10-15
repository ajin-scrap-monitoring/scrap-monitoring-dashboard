import { useCallback, useEffect, useRef, useState } from "react";

import { ROUTES } from "../app-routing";
import { v1MonitoringEnabled } from "../build-features";
import { DashboardPageShell } from "../components/DashboardShell";
import { DashboardStatusLabel, SectionTitle } from "../components/DashboardPrimitives";
import { Pagination } from "../components/Pagination";
import { DateTimeField } from "../components/DateTimeField";
import { DetailDialog } from "../components/DetailDialog";
import { DetailFields } from "../components/DetailFields";
import { dateTimeValue, isValidDateTime, recentPeriods, recentRange } from "../date-range";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { AlertEvidence, AlertEvidencePage, DashboardData, DataAreaState, EventCategory, HeaderNotification, HistoryEvent, HistoryLoadSample, UserSession } from "../domain/dashboard";
import { useLatestRequest } from "../use-latest-request";

const historyEventsPerPage = 8;

function HistoryLoadChart({ chartEvents, loadSamples: samples, startsAt, endsAt, thresholds: thresholdPoints, loadState }: DashboardData["history"]) {
  const [activeEvent, setActiveEvent] = useState<number | null>(null);
  const [activeLoadIndex, setActiveLoadIndex] = useState<number | null>(null);
  const left = 58;
  const right = 1900;
  const top = 62;
  const bottom = 192;
  const duration = (dateTimeValue(endsAt) - dateTimeValue(startsAt)) / 3_600_000;
  const toX = (hour: number) => left + (right - left) * (hour / duration);
  const tickStep = duration <= 24 ? 3 : Math.max(24, Math.ceil(duration / 168) * 24);
  const ticks = Array.from({ length: Math.ceil(duration / tickStep) }, (_, index) => {
    const hour = index * tickStep;
    const date = new Date(dateTimeValue(startsAt) + hour * 3_600_000);
    const label = duration <= 24
      ? `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`
      : `${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(date.getUTCDate()).padStart(2, "0")}`;
    return { hour, label };
  });
  const toY = (value: number) => bottom - value * ((bottom - top) / 100);
  const segments: Array<Array<HistoryLoadSample & { value: number }>> = [];
  let segment: Array<HistoryLoadSample & { value: number }> = [];
  for (const sample of samples) {
    if (sample.value === null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else segment.push({ ...sample, value: sample.value });
  }
  if (segment.length) segments.push(segment);
  const previousResult = loadState?.status === "error" && loadState.stale === true && segments.length > 0;
  const unavailable = (loadState?.status === "error" && !previousResult) || loadState?.status === "unsupported" || loadState?.status === "loading";
  const emptyMessage = loadState?.status === "unsupported" ? loadState.message ?? "v2 적재율 추이는 최대 7일까지 조회할 수 있습니다."
    : loadState?.status === "error" ? "적재율 이력을 조회하지 못했습니다."
      : loadState?.status === "loading" ? "적재율 이력을 불러오는 중입니다."
        : samples.some((sample) => sample.dataState !== "NO_DATA") ? "유효한 적재율 데이터가 없습니다." : "조회된 적재율 데이터가 없습니다.";
  const thresholdPath = thresholdPoints.map((sample, index) => {
    const next = thresholdPoints[index + 1];
    return `${index === 0 ? "M" : "L"}${toX(sample.hour)} ${toY(sample.value)}${next ? `H${toX(next.hour)}` : `H${right}`}`;
  }).join(" ");
  const eventAnnotations = v1MonitoringEnabled ? chartEvents.map((event) => {
    const sample = { hour: event.hour, value: event.value };
    const x = toX(sample.hour);
    const direction = x > right - 120 ? -1 : event.label === "수거 필요" ? -1 : 1;
    const row = event.label === "수거 필요" ? 0 : event.label === "수거 완료" ? 1 : 2;
    const elbowY = top - 8;
    const labelY = 17 + row * 17;
    const labelX = x + direction * 38;
    return { ...event, direction, elbowY, labelX, labelY, sample, x };
  }) : [];
  const selectedEvent = activeEvent === null ? null : eventAnnotations[activeEvent] ?? null;
  const selectedSample = selectedEvent?.sample ?? null;
  const tooltipX = selectedSample === null ? 0 : Math.max(left + 8, Math.min(toX(selectedSample.hour) - 96, right - 200));
  const tooltipY = selectedSample === null ? 0 : 132;
  const selectedLoad = activeLoadIndex === null ? null : samples[activeLoadIndex] ?? null;
  const loadTooltipX = selectedLoad ? Math.max(left + 8, Math.min(toX(selectedLoad.hour) - 130, right - 340)) : 0;
  return (
    <svg className="history-chart" viewBox="0 0 1960 230" role="img" aria-label="조회 기간 대표 적재율 변화 그래프">
      <g stroke="#e2e8ef" strokeWidth="1">
        {[0, 20, 40, 60, 80, 100].map((value) => <path key={value} d={`M${left} ${toY(value)}H${right}`} />)}
      </g>
      <g fill="#61708a" fontSize="12">
        {[100, 80, 60, 40, 20, 0].map((value) => <text key={value} x="48" y={toY(value)} textAnchor="end" dominantBaseline="middle">{value}%</text>)}
        {ticks.map(({ hour, label }) => <text key={hour} x={toX(hour)} y="218" textAnchor={hour === 0 ? "start" : "middle"}>{label}</text>)}
      </g>
      {thresholdPath && <path d={thresholdPath} stroke="#607086" strokeDasharray="6 6" strokeWidth="1.5" fill="none" />}
      {previousResult && <text x="980" y="45" textAnchor="middle" fill="#61708a" fontSize="12">이전 조회 결과 / 갱신 실패</text>}
      {!unavailable && segments.length > 0 ? segments.map((points, index) => {
        const path = points.map((sample, sampleIndex) => `${sampleIndex === 0 ? "M" : "L"}${toX(sample.hour)} ${toY(sample.value)}`).join(" ");
        return <g key={`history-load-${index}`}><path d={`${path}V${bottom}H${toX(points[0].hour)}Z`} fill="#f58a07" fillOpacity="0.1" /><path className="history-load-line" d={path} fill="none" stroke="#f58a07" strokeWidth="4" />{points.length === 1 && <circle cx={toX(points[0].hour)} cy={toY(points[0].value)} r="2.5" fill="#f58a07" />}</g>;
      }) : <text x="980" y="130" textAnchor="middle" fill="#61708a">{loadState?.message && loadState.message !== emptyMessage && <title>{loadState.message}</title>}{emptyMessage}</text>}
      {!unavailable && samples.map((sample, index) => sample.value !== null && sample.dataState === "LIMITED" && <circle key={`history-limited-${index}`} cx={toX(sample.hour)} cy={toY(sample.value)} r="3.5" fill="#ffffff" stroke="#f58a07" strokeWidth="2" tabIndex={0} aria-label={`판단 생성 ${sample.generatedAt ?? "정보 없음"}, 대표 적재율 ${sample.value}%, 입력 제한, 관측 ${sample.observedAt ?? "정보 없음"}`} onPointerEnter={() => setActiveLoadIndex(index)} onPointerLeave={() => setActiveLoadIndex(null)} onFocus={() => setActiveLoadIndex(index)} onBlur={() => setActiveLoadIndex(null)}><title>입력 제한 상태의 적재율 {sample.value}%</title></circle>)}
      <g stroke="#8b9aad" strokeWidth="1.2">
        {ticks.map(({ hour }) => <path key={hour} d={`M${toX(hour)} ${bottom}V${bottom + 6}`} />)}
      </g>
      <g className="history-event-annotations">
        {v1MonitoringEnabled && eventAnnotations.map((event, index) => {
          const targetLeft = event.direction === -1 ? event.labelX - 78 : event.labelX - 4;
          const targetWidth = 82;
          return (
            <g key={event.id}>
              <path d={`M${event.x} ${toY(event.sample.value)}V${event.elbowY}L${event.labelX} ${event.labelY + 4}`} fill="none" stroke={event.color} strokeOpacity="0.72" strokeWidth="1.5" />
              <text x={event.labelX + event.direction * 5} y={event.labelY} fill={event.color} fontSize="11" fontWeight="700" textAnchor={event.direction === -1 ? "end" : "start"}>{event.label}</text>
              <rect
                className="history-event-target"
                x={targetLeft}
                y={event.labelY - 14}
                width={targetWidth}
                height="20"
                fill="transparent"
                tabIndex={0}
                aria-label={`${event.time} ${event.label} ${event.detail}`}
                onPointerEnter={() => setActiveEvent(index)}
                onPointerLeave={() => setActiveEvent(null)}
                onFocus={() => setActiveEvent(index)}
                onBlur={() => setActiveEvent(null)}
              />
            </g>
          );
        })}
      </g>
      {v1MonitoringEnabled && selectedEvent !== null && (
        <g className="history-chart-tooltip" transform={`translate(${tooltipX} ${tooltipY})`} pointerEvents="none">
          <rect width="200" height="48" rx="5" />
          <text x="10" y="18">{selectedEvent.time} {selectedEvent.label}</text>
          <text x="10" y="36">{selectedEvent.detail}</text>
        </g>
      )}
      {!unavailable && selectedLoad?.value !== null && selectedLoad?.dataState === "LIMITED" && <g className="history-chart-tooltip" transform={`translate(${loadTooltipX} 132)`} pointerEvents="none">
        <rect width="340" height="64" rx="5" />
        <text x="10" y="18">판단 생성 {selectedLoad.generatedAt ?? "정보 없음"}</text>
        <text x="10" y="36">대표 적재율 {selectedLoad.value}% / 입력 제한</text>
        <text x="10" y="54">관측 {selectedLoad.observedAt ?? "정보 없음"}</text>
      </g>}
    </svg>
  );
}


export function HistoryPage({ dataSource, history, headerNotifications, headerUnreadCount, headerNotificationState, lastMeasuredAt, session, status }: { dataSource?: DashboardDataSource; history: DashboardData["history"]; headerNotifications: HeaderNotification[]; headerUnreadCount?: number | null; headerNotificationState?: DataAreaState; lastMeasuredAt: string; session?: UserSession | null; status: DashboardData["monitoring"]["status"] }) {
  const [displayedHistory, setDisplayedHistory] = useState(history);
  const [eventType, setEventType] = useState("전체");
  const [eventPage, setEventPage] = useState(0);
  const [range, setRange] = useState(() => recentRange(168, history.endsAt));
  const [preset, setPreset] = useState<number | null>(168);
  const [applied, setApplied] = useState(() => ({ ...recentRange(168, history.endsAt), eventType: "전체" }));
  const [queryError, setQueryError] = useState("");
  const [queryState, setQueryState] = useState({ source: dataSource, busy: false });
  const querying = queryState.source === dataSource && queryState.busy;
  const setQuerying = (busy: boolean) => setQueryState({ source: dataSource, busy });
  const startQuery = useLatestRequest(dataSource);
  const evidenceController = useRef<AbortController | null>(null);
  useEffect(() => () => { evidenceController.current?.abort(); }, [dataSource]);
  const [evidenceSelection, setEvidenceSelection] = useState<{
    event: HistoryEvent;
    source: DashboardDataSource;
    page: AlertEvidencePage | null;
    evidence: AlertEvidence | null;
    busy: boolean;
    error: string;
    requestedOffset: number;
  } | null>(null);
  const activeEvidence = evidenceSelection?.source === dataSource ? evidenceSelection : null;
  const queryEvidence = (event: HistoryEvent, offset: number) => {
    if (!dataSource?.getAlertEvidencePage) return;
    evidenceController.current?.abort();
    const controller = new AbortController();
    evidenceController.current = controller;
    const signal = controller.signal;
    setEvidenceSelection((previous) => ({ event, source: dataSource, page: previous?.event.id === event.id ? previous.page : null, evidence: null, busy: true, error: "", requestedOffset: offset }));
    void dataSource.getAlertEvidencePage(offset, signal)
      .then((page) => {
        if (signal.aborted) return;
        setEvidenceSelection((previous) => previous?.event.id === event.id && previous.source === dataSource
          ? { ...previous, page, evidence: page.items.find((item) => item.eventId === event.id) ?? null, busy: false } : previous);
      })
      .catch(() => {
        if (!signal.aborted) setEvidenceSelection((previous) => previous?.event.id === event.id && previous.source === dataSource
          ? { ...previous, busy: false, error: "경보 근거를 조회하지 못했습니다. 근거가 없는 것으로 확정할 수 없습니다." } : previous);
      });
  };
  const closeEvidence = useCallback(() => { evidenceController.current?.abort(); setEvidenceSelection(null); }, []);
  const startTime = dateTimeValue(applied.start);
  const endTime = dateTimeValue(applied.end);
  const originTime = dateTimeValue(displayedHistory.startsAt);
  const inRange = (time: string) => {
    const timestamp = dateTimeValue(time);
    return timestamp >= startTime && timestamp <= endTime;
  };
  const filteredEvents = displayedHistory.events.filter((event) => inRange(event.time) && (applied.eventType === "전체" || event.type === applied.eventType));
  const chartEvents = v1MonitoringEnabled && dataSource?.monitoringVersion !== "v2" ? displayedHistory.chartEvents.filter((event) => {
    const type = event.label === "수거 필요" ? "알림" : event.label === "수거 완료" ? "수거" : "오류";
    return inRange(event.time) && (applied.eventType === "전체" || applied.eventType === type);
  }).map((event) => ({ ...event, hour: event.hour + (originTime - startTime) / 3_600_000 })) : [];
  const startHour = (startTime - originTime) / 3_600_000;
  const endHour = (endTime - originTime) / 3_600_000;
  const loadSamples = displayedHistory.loadSamples.filter((sample) => sample.hour >= startHour && sample.hour <= endHour)
    .map((sample) => ({ ...sample, hour: sample.hour - startHour }));
  const thresholds = displayedHistory.thresholds.filter((sample, index, values) => sample.hour <= endHour && (sample.hour >= startHour || index === values.findLastIndex((candidate) => candidate.hour <= startHour)))
    .map((sample) => ({ ...sample, hour: Math.max(0, sample.hour - startHour) }));
  const showLegend = (type: string) => dataSource?.monitoringVersion !== "v2" && (applied.eventType === "전체" || applied.eventType === type);
  const totalEventPages = Math.max(1, Math.ceil(filteredEvents.length / historyEventsPerPage));
  const visibleEvents = filteredEvents.slice(eventPage * historyEventsPerPage, (eventPage + 1) * historyEventsPerPage);
  return (
    <DashboardPageShell activePage="history" dataSource={dataSource} headerNotifications={headerNotifications} headerUnreadCount={headerUnreadCount} notificationState={headerNotificationState} session={session}>
      <main className="history-page" aria-label="스크랩 모니터링 이력">
        <div className="page-heading"><h1>이력</h1><div className="page-meta"><DashboardStatusLabel status={status} /><span className="meta-divider" aria-hidden="true" /><span>마지막 측정 {lastMeasuredAt}</span></div></div>
        <div className="history-content">
          {dataSource?.monitoringVersion === "v2" && <p>적재율은 v2 STATE 판단이며, 이벤트 목록은 v1 운영 기록입니다.</p>}
          <section className="card history-query">
            <SectionTitle>조회 조건</SectionTitle>
            <form className="query-controls" onSubmit={(event) => {
              event.preventDefault();
              if (!isValidDateTime(range.start) || !isValidDateTime(range.end) || dateTimeValue(range.start) >= dateTimeValue(range.end)) {
                setQueryError("올바른 날짜와 시간을 입력하고, 종료 시각을 시작 시각보다 늦게 설정하세요.");
                return;
              }
              const applyResult = (nextHistory?: DashboardData["history"]) => {
                if (nextHistory) setDisplayedHistory(nextHistory);
                setApplied({ ...range, eventType });
                setEventPage(0);
                setQueryError("");
              };
              if (!dataSource?.queryHistory) {
                applyResult();
                return;
              }
              const category = ({ "수거": "collection", "알림": "alert", "오류": "error" } as const)[eventType as "수거" | "알림" | "오류"] as EventCategory | undefined;
              const signal = startQuery();
              setQuerying(true);
              void dataSource.queryHistory({ eventCategory: category, from: range.start, to: range.end }, signal)
                .then((value) => { if (!signal.aborted) applyResult(value); })
                .catch(() => { if (!signal.aborted) setQueryError("이력 데이터를 조회하지 못했습니다. 기존 조회 결과를 유지합니다."); })
                .finally(() => { if (!signal.aborted) setQuerying(false); });
            }}>
              <div className="query-type" role="group" aria-label="빠른 기간 선택">
                <span>빠른 선택</span>
                <div>{recentPeriods.map(({ hours, label }) => (
                  <button key={hours} type="button" className={preset === hours ? "selected" : ""} aria-pressed={preset === hours} onClick={() => { setRange(recentRange(hours, history.endsAt)); setPreset(hours); }}>{label}</button>
                ))}</div>
              </div>
              <DateTimeField label="시작 시각" value={range.start} onChange={(value) => { setRange({ ...range, start: value }); setPreset(null); }} />
              <DateTimeField label="종료 시각" value={range.end} onChange={(value) => { setRange({ ...range, end: value }); setPreset(null); }} />
              <div className="query-type"><span>이벤트 유형</span><div>{["전체", "수거", "알림", "오류"].map((type) => <button key={type} className={eventType === type ? "selected" : ""} type="button" onClick={() => setEventType(type)}>{type}</button>)}</div></div>
              <button className="primary-button" type="submit" disabled={querying}>{querying ? "조회 중" : "조회"}</button>
            </form>
            {queryError && <p role="alert">{queryError}</p>}
          </section>
          <section className="card history-load"><div className="history-card-head"><SectionTitle>적재율 이력</SectionTitle><div className="history-legend" aria-label="그래프 범례"><span><i className="history-legend-line" />{displayedHistory.loadState?.thresholdKind === "current" ? "현재 임계율(참고)" : "수거 임계율"}</span>{v1MonitoringEnabled && showLegend("알림") && <span><i className="history-legend-leader need" />수거 필요</span>}{v1MonitoringEnabled && showLegend("수거") && <span><i className="history-legend-leader complete" />수거 완료</span>}{v1MonitoringEnabled && showLegend("오류") && <span><i className="history-legend-leader error" />오류</span>}</div></div><HistoryLoadChart key={`${applied.start}-${applied.end}-${applied.eventType}`} {...displayedHistory} startsAt={applied.start} endsAt={applied.end} loadSamples={loadSamples} chartEvents={chartEvents} thresholds={thresholds} /></section>
          <section className="card history-events"><div className="history-card-head"><SectionTitle>이벤트 이력</SectionTitle><span>{displayedHistory.eventsState?.status === "error" ? "조회 실패" : `총 ${filteredEvents.length}건`}</span></div><div className="history-table-wrap"><table><thead><tr><th>시각</th><th>유형</th><th>상태</th><th>내용</th><th>관련 녹화</th></tr></thead><tbody>{visibleEvents.length > 0 ? visibleEvents.map((event) => <tr key={event.id}><td>{event.time}</td><td>{event.type}</td><td><span className={`event-dot ${event.tone}`} />{event.status}</td><td>{dataSource?.monitoringVersion === "v2" && dataSource.getAlertEvidencePage && event.type === "알림" ? <button className="detail-trigger" type="button" aria-label={`${event.time} ${event.content} 경보 근거 보기`} onClick={() => queryEvidence(event, 0)}>{event.content}</button> : event.content}</td><td>{event.recordingId ? <a href={`${ROUTES.recordings}?recordingId=${encodeURIComponent(event.recordingId)}`}>영상 보기</a> : "-"}</td></tr>) : <tr><td className="table-empty" colSpan={5}>{displayedHistory.eventsState?.status === "error" ? "이벤트 이력을 조회하지 못했습니다." : "조회된 이벤트가 없습니다."}</td></tr>}</tbody></table></div><Pagination ariaLabel="이벤트 이력 페이지" currentPage={eventPage} itemLabel="이벤트" onPageChange={setEventPage} totalPages={totalEventPages} /></section>
        </div>
      </main>
      {activeEvidence && <DetailDialog title="경보 근거" id="alert-evidence-title" onClose={closeEvidence}>
        <p>{activeEvidence.event.time} {activeEvidence.event.content}</p>
        {activeEvidence.busy ? <p role="status">경보 근거를 조회하는 중입니다.</p>
          : activeEvidence.error ? <><p role="alert">{activeEvidence.error}</p><button type="button" onClick={() => queryEvidence(activeEvidence.event, activeEvidence.requestedOffset)}>다시 조회</button></>
            : activeEvidence.evidence ? <DetailFields fields={[
              ["경보 당시 적재율", activeEvidence.evidence.loadPercent === null ? "정보 없음" : `${activeEvidence.evidence.loadPercent}%`],
              ["관측 시각", activeEvidence.evidence.observedAt],
              ["경보 시각", activeEvidence.evidence.triggeredAt],
              ["판단 ID", activeEvidence.evidence.assessmentId],
              ["알림 ID", activeEvidence.evidence.notificationId],
              ["읽음 시각", activeEvidence.evidence.readAt ?? "미읽음"],
            ]} /> : <p>현재 조회 범위에서 이 기록의 근거를 확인할 수 없습니다.</p>}
        {activeEvidence.page && <p>{activeEvidence.busy || activeEvidence.error ? "마지막 성공 조회 범위" : "조회 범위"} {activeEvidence.page.items.length ? `${activeEvidence.page.offset + 1}-${activeEvidence.page.offset + activeEvidence.page.items.length}` : "결과 없음"} / 총 {activeEvidence.page.totalItems}건</p>}
        {!activeEvidence.busy && !activeEvidence.error && !activeEvidence.evidence && activeEvidence.page && activeEvidence.page.offset + activeEvidence.page.limit < activeEvidence.page.totalItems
          && (activeEvidence.page.offset + activeEvidence.page.limit <= 10000
            ? <button type="button" onClick={() => queryEvidence(activeEvidence.event, activeEvidence.page!.offset + activeEvidence.page!.limit)}>다음 범위 조회</button>
            : <p>이후 범위는 서버의 조회 한도를 초과합니다.</p>)}
      </DetailDialog>}
    </DashboardPageShell>
  );
}

export default HistoryPage;
