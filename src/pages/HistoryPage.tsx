import { useState } from "react";

import { ROUTES } from "../app-routing";
import { DashboardPageShell } from "../components/DashboardShell";
import { DashboardStatusLabel, SectionTitle } from "../components/DashboardPrimitives";
import { Pagination } from "../components/Pagination";
import { DateTimeField } from "../components/DateTimeField";
import { isValidDateTime, recentPeriods, recentRange } from "../date-range";
import type { DashboardData, HeaderNotification } from "../domain/dashboard";

const historyEventsPerPage = 8;

function HistoryLoadChart({ chartEvents, loadSamples: samples, startsAt, endsAt }: DashboardData["history"]) {
  const [activeEvent, setActiveEvent] = useState<number | null>(null);
  const left = 58;
  const right = 1900;
  const top = 62;
  const bottom = 192;
  const duration = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3_600_000;
  const toX = (hour: number) => left + (right - left) * (hour / duration);
  const tickStep = duration <= 24 ? 3 : Math.max(24, Math.ceil(duration / 168) * 24);
  const ticks = Array.from({ length: Math.ceil(duration / tickStep) }, (_, index) => {
    const hour = index * tickStep;
    const date = new Date(new Date(startsAt).getTime() + hour * 3_600_000);
    const label = duration <= 24
      ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
      : `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
    return { hour, label };
  });
  const toY = (value: number) => bottom - value * ((bottom - top) / 100);
  const path = samples.map((sample, index) => `${index === 0 ? "M" : "L"}${toX(sample.hour)} ${toY(sample.value)}`).join(" ");
  const fillPath = `${path}V${bottom}H${samples.length > 0 ? toX(samples[0].hour) : left}Z`;
  const eventAnnotations = chartEvents.map((event) => {
    const sample = samples.find((item) => item.hour === event.hour);
    if (!sample) return null;
    const x = toX(sample.hour);
    const direction = x > right - 120 ? -1 : event.label === "수거 필요" ? -1 : 1;
    const row = event.label === "수거 필요" ? 0 : event.label === "수거 완료" ? 1 : 2;
    const elbowY = top - 8;
    const labelY = 17 + row * 17;
    const labelX = x + direction * 38;
    return { ...event, direction, elbowY, labelX, labelY, sample, x };
  }).filter((event): event is NonNullable<typeof event> => event !== null);
  const selectedEvent = activeEvent === null ? null : eventAnnotations[activeEvent];
  const selectedSample = selectedEvent?.sample ?? null;
  const tooltipX = selectedSample === null ? 0 : Math.max(left + 8, Math.min(toX(selectedSample.hour) - 96, right - 200));
  const tooltipY = selectedSample === null ? 0 : 132;
  return (
    <svg className="history-chart" viewBox="0 0 1960 230" role="img" aria-label="조회 기간 대표 적재율 변화 그래프">
      <g stroke="#e2e8ef" strokeWidth="1">
        {[0, 20, 40, 60, 80, 100].map((value) => <path key={value} d={`M${left} ${toY(value)}H${right}`} />)}
      </g>
      <g fill="#61708a" fontSize="12">
        {[100, 80, 60, 40, 20, 0].map((value) => <text key={value} x="48" y={toY(value)} textAnchor="end" dominantBaseline="middle">{value}%</text>)}
        {ticks.map(({ hour, label }) => <text key={hour} x={toX(hour)} y="218" textAnchor={hour === 0 ? "start" : "middle"}>{label}</text>)}
      </g>
      <path d={`M${left} ${toY(80)}H${right}`} stroke="#607086" strokeDasharray="6 6" strokeWidth="1.5" />
      {samples.length > 0 ? <><path d={fillPath} fill="#f58a07" fillOpacity="0.1" /><path d={path} fill="none" stroke="#f58a07" strokeWidth="4" /></> : <text x="980" y="130" textAnchor="middle" fill="#61708a">조회된 적재율 데이터가 없습니다.</text>}
      <g stroke="#8b9aad" strokeWidth="1.2">
        {ticks.map(({ hour }) => <path key={hour} d={`M${toX(hour)} ${bottom}V${bottom + 6}`} />)}
      </g>
      <g className="history-event-annotations">
        {eventAnnotations.map((event, index) => {
          const targetLeft = event.direction === -1 ? event.labelX - 78 : event.labelX - 4;
          const targetWidth = 82;
          return (
            <g key={`${event.label}-${event.time}`}>
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
      {selectedEvent !== null && (
        <g className="history-chart-tooltip" transform={`translate(${tooltipX} ${tooltipY})`} pointerEvents="none">
          <rect width="200" height="48" rx="5" />
          <text x="10" y="18">{selectedEvent.time} {selectedEvent.label}</text>
          <text x="10" y="36">{selectedEvent.detail}</text>
        </g>
      )}
    </svg>
  );
}


export function HistoryPage({ history, headerNotifications, lastMeasuredAt, status }: { history: DashboardData["history"]; headerNotifications: HeaderNotification[]; lastMeasuredAt: string; status: DashboardData["monitoring"]["status"] }) {
  const [eventType, setEventType] = useState("전체");
  const [eventPage, setEventPage] = useState(0);
  const [range, setRange] = useState(() => recentRange(168, history.endsAt));
  const [preset, setPreset] = useState<number | null>(168);
  const [applied, setApplied] = useState(() => ({ ...recentRange(168, history.endsAt), eventType: "전체" }));
  const [queryError, setQueryError] = useState("");
  const startTime = new Date(applied.start).getTime();
  const endTime = new Date(applied.end).getTime();
  const originTime = new Date(history.startsAt).getTime();
  const inRange = (time: string) => {
    const timestamp = new Date(time.replace(" ", "T")).getTime();
    return timestamp >= startTime && timestamp <= endTime;
  };
  const filteredEvents = history.events.filter((event) => inRange(event.time) && (applied.eventType === "전체" || event.type === applied.eventType));
  const chartEvents = history.chartEvents.filter((event) => {
    const type = event.label === "수거 필요" ? "알림" : event.label === "수거 완료" ? "수거" : "오류";
    return inRange(event.time) && (applied.eventType === "전체" || applied.eventType === type);
  }).map((event) => ({ ...event, hour: event.hour + (originTime - startTime) / 3_600_000 }));
  const startHour = (startTime - originTime) / 3_600_000;
  const endHour = (endTime - originTime) / 3_600_000;
  const boundarySample = (hour: number) => {
    const nextIndex = history.loadSamples.findIndex((sample) => sample.hour >= hour);
    if (nextIndex <= 0 || history.loadSamples[nextIndex].hour === hour) return [];
    const before = history.loadSamples[nextIndex - 1];
    const after = history.loadSamples[nextIndex];
    return [{ hour, value: before.value + (after.value - before.value) * ((hour - before.hour) / (after.hour - before.hour)) }];
  };
  const loadSamples = [...boundarySample(startHour), ...history.loadSamples.filter((sample) => sample.hour >= startHour && sample.hour <= endHour), ...boundarySample(endHour)]
    .map((sample) => ({ ...sample, hour: sample.hour - startHour }));
  const showLegend = (type: string) => applied.eventType === "전체" || applied.eventType === type;
  const totalEventPages = Math.max(1, Math.ceil(filteredEvents.length / historyEventsPerPage));
  const visibleEvents = filteredEvents.slice(eventPage * historyEventsPerPage, (eventPage + 1) * historyEventsPerPage);
  return (
    <DashboardPageShell activePage="history" headerNotifications={headerNotifications}>
      <main className="history-page" aria-label="스크랩 모니터링 이력">
        <div className="page-heading"><h1>이력</h1><div className="page-meta"><DashboardStatusLabel status={status} /><span className="meta-divider" aria-hidden="true" /><span>마지막 측정 {lastMeasuredAt}</span></div></div>
        <div className="history-content">
          <section className="card history-query">
            <SectionTitle>조회 조건</SectionTitle>
            <form className="query-controls" onSubmit={(event) => {
              event.preventDefault();
              if (!isValidDateTime(range.start) || !isValidDateTime(range.end) || new Date(range.start).getTime() >= new Date(range.end).getTime()) {
                setQueryError("올바른 날짜와 시간을 입력하고, 종료 시각을 시작 시각보다 늦게 설정하세요.");
                return;
              }
              setApplied({ ...range, eventType });
              setEventPage(0);
              setQueryError("");
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
              <button className="primary-button" type="submit">조회</button>
            </form>
            {queryError && <p role="alert">{queryError}</p>}
          </section>
          <section className="card history-load"><div className="history-card-head"><SectionTitle>적재율 이력</SectionTitle><div className="history-legend" aria-label="그래프 범례"><span><i className="history-legend-line" />수거 임계율</span>{showLegend("알림") && <span><i className="history-legend-leader need" />수거 필요</span>}{showLegend("수거") && <span><i className="history-legend-leader complete" />수거 완료</span>}{showLegend("오류") && <span><i className="history-legend-leader error" />오류</span>}</div></div><HistoryLoadChart key={`${applied.start}-${applied.end}-${applied.eventType}`} {...history} startsAt={applied.start} endsAt={applied.end} loadSamples={loadSamples} chartEvents={chartEvents} /></section>
          <section className="card history-events"><div className="history-card-head"><SectionTitle>이벤트 이력</SectionTitle><span>총 {filteredEvents.length}건</span></div><div className="history-table-wrap"><table><thead><tr><th>시각</th><th>유형</th><th>상태</th><th>내용</th><th>관련 녹화</th></tr></thead><tbody>{visibleEvents.length > 0 ? visibleEvents.map((event) => <tr key={event.time}><td>{event.time}</td><td>{event.type}</td><td><span className={`event-dot ${event.tone}`} />{event.content}</td><td>{event.detail}</td><td><a href={ROUTES.recordings}>영상 보기</a></td></tr>) : <tr><td className="table-empty" colSpan={5}>조회된 이벤트가 없습니다.</td></tr>}</tbody></table></div><Pagination ariaLabel="이벤트 이력 페이지" currentPage={eventPage} itemLabel="이벤트" onPageChange={setEventPage} totalPages={totalEventPages} /></section>
        </div>
      </main>
    </DashboardPageShell>
  );
}

export default HistoryPage;
