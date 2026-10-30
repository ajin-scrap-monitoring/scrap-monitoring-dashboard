import { memo, useMemo, useState, type MouseEvent } from "react";

import { dailyPlaybackPosition, dailyRecordingAvailability, type dailyTimeState, type DailyRecording } from "../data/daily-recordings";

type TimeState = ReturnType<typeof dailyTimeState>;
type TimeRange = { start: number; end: number; state: TimeState };
const labels: Record<TimeState, string> = {
  available: "확보 구간",
  gap: "누락 구간",
  processing: "확인 중 구간",
  future: "아직 도래하지 않은 구간",
  unknown: "확보 여부 미확인 구간",
  unavailable: "재생 불가 구간",
  outside: "조회 범위 밖",
};

function clock(at: number, end: number): string {
  return at === end ? "24:00:00" : new Date(at + 9 * 60 * 60 * 1000).toISOString().slice(11, 19);
}

function ranges(recording: DailyRecording, now: number, unavailable: boolean): TimeRange[] {
  const start = Date.parse(recording.windowStartsAt);
  const end = Date.parse(recording.windowEndsAt);
  const coverage = Date.parse(recording.coverageAsOfAt);
  const available = recording.availableIntervals.map(interval => ({ start: Date.parse(interval.startsAt), end: Date.parse(interval.endsAt) }));
  const gaps = recording.gaps.map(gap => ({ start: Date.parse(gap.startsAt), end: Date.parse(gap.endsAt) }));
  const boundaries = [...new Set([
    start, end, Math.max(start, Math.min(end, now)), coverage,
    ...available.flatMap(interval => [interval.start, interval.end]),
    ...gaps.flatMap(gap => [gap.start, gap.end]),
  ])].sort((a, b) => a - b);
  const result: TimeRange[] = [];
  let availableIndex = 0;
  let gapIndex = 0;
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const at = start + (end - start) / 2;
    while (availableIndex < available.length && available[availableIndex].end <= at) availableIndex += 1;
    while (gapIndex < gaps.length && gaps[gapIndex].end <= at) gapIndex += 1;
    const state: TimeState = unavailable ? "unavailable" : at > now ? "future"
      : availableIndex < available.length && available[availableIndex].start <= at ? "available"
        : gapIndex < gaps.length && gaps[gapIndex].start <= at ? "gap" : at < coverage ? "unknown" : "processing";
    const previous = result.at(-1);
    if (previous?.state === state && previous.end === start) previous.end = end;
    else result.push({ start, end, state });
  }
  return result;
}

function rangeLabel(range: TimeRange, end: number) {
  return range.start === range.end ? `확보 시점 ${clock(range.start, end)}` : `${labels[range.state]} ${clock(range.start, end)} ~ ${clock(range.end, end)}`;
}

function rangeAt(ranges: TimeRange[], at: number) {
  let left = 0;
  let right = ranges.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (ranges[middle].end <= at) left = middle + 1;
    else right = middle;
  }
  const range = ranges[left];
  return range && range.start <= at ? range : undefined;
}

function DenseTimeline({ timeRanges, points, start, end, playable, onSeekAt }: {
  timeRanges: TimeRange[]; points: { at: number }[]; start: number; end: number; playable: boolean; onSeekAt: (at: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const { paths, choices, pointPath } = useMemo(() => {
    const paths = new Map<TimeState, string[]>();
    const choices = timeRanges.filter(range => range.state === "available");
    for (const range of timeRanges) {
      const left = (range.start - start) / (end - start) * 1000;
      const width = (range.end - range.start) / (end - start) * 1000;
      const path = paths.get(range.state) ?? [];
      path.push(`M${left} 0h${width}v1h${-width}Z`);
      paths.set(range.state, path);
    }
    for (const point of points) choices.push({ start: point.at, end: point.at, state: "available" });
    choices.sort((a, b) => a.start - b.start);
    return { paths: [...paths].map(([state, paths]) => ({ state, d: paths.join("") })), choices,
      pointPath: points.map(point => `M${(point.at - start) / (end - start) * 1000} 0v1`).join("") };
  }, [timeRanges, points, start, end]);
  const currentIndex = Math.min(index, choices.length - 1);
  const choice = choices[currentIndex];
  const choiceLabel = choice && rangeLabel(choice, end);
  const hit = (event: MouseEvent<HTMLButtonElement | SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return undefined;
    const at = Math.min(end - 1, start + Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * (end - start));
    let left = 0;
    let right = points.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (points[middle].at <= at) left = middle + 1;
      else right = middle;
    }
    // SVG 관측점은 개별 관측점 버튼과 같은 2px 선택 범위를 사용한다.
    const point = points[left - 1];
    return point && at - point.at <= (end - start) * 2 / bounds.width
      ? { start: point.at, end: point.at, state: "available" as const } : rangeAt(timeRanges, at);
  };
  return <>
    <svg className="daily-recording-timeline-dense" viewBox="0 0 1000 1" preserveAspectRatio="none" role="img" aria-label="녹화 범위의 확보 및 누락 구간"
      onMouseMove={playable ? undefined : event => {
        const range = hit(event);
        const title = event.currentTarget.querySelector("title");
        if (title) title.textContent = range ? rangeLabel(range, end) : "";
      }}>
      {!playable && <title>녹화 범위</title>}
      {paths.map(path => <path key={path.state} className={`daily-recording-range-${path.state}`} d={path.d} />)}
      {pointPath && <path d={pointPath} stroke="#0ba58f" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
    </svg>
    {playable && choice && <button className="daily-recording-timeline-seek" type="button"
      aria-label={`${choiceLabel}, 재생. 방향키로 확보 구간 선택, Home 처음, End 마지막`} title={choiceLabel}
      onMouseMove={event => { const range = hit(event); event.currentTarget.title = range ? rangeLabel(range, end) : ""; }}
      onClick={event => {
        if (event.detail === 0) { onSeekAt(choice.start); return; }
        const range = hit(event);
        if (range?.state !== "available") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        onSeekAt(range.start === range.end ? range.start : Math.min(range.end - 1, Math.max(range.start, start + (event.clientX - bounds.left) / bounds.width * (end - start))));
      }}
      onKeyDown={event => {
        const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1
          : event.key === "ArrowLeft" ? Math.max(0, currentIndex - 1) : event.key === "ArrowRight" ? Math.min(choices.length - 1, currentIndex + 1) : null;
        if (next !== null) { event.preventDefault(); setIndex(next); }
      }} />}
  </>;
}

export const DailyRecordingTimeline = memo(function DailyRecordingTimeline({ recording, now, onSeek }: { recording: DailyRecording; now: number; onSeek: (seconds: number) => void }) {
  const start = Date.parse(recording.windowStartsAt);
  const end = Date.parse(recording.windowEndsAt);
  const duration = end - start;
  const availability = dailyRecordingAvailability(recording, now);
  const timelineNow = Math.min(end, now);
  const unavailable = availability.originalUnavailable;
  const { timeRanges, observedPoints, points } = useMemo(() => {
    const observedPoints = recording.availableIntervals.filter(interval => !unavailable && interval.startsAt === interval.endsAt && Date.parse(interval.startsAt) <= timelineNow);
    return { timeRanges: ranges(recording, timelineNow, unavailable), observedPoints, points: observedPoints.map(interval => ({ at: Date.parse(interval.startsAt) })) };
  }, [recording, timelineNow, unavailable]);
  const dense = timeRanges.length + observedPoints.length > 256;
  const seekAt = (at: number) => {
    const seconds = dailyPlaybackPosition(recording, new Date(at).toISOString());
    if (seconds !== null) onSeek(seconds);
  };
  const seek = (event: MouseEvent<HTMLButtonElement>, range: TimeRange) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const progress = event.detail > 0 && bounds.width > 0 ? Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) : 0;
    const at = Math.min(range.end - 1, range.start + Math.floor((range.end - range.start) * progress));
    seekAt(at);
  };
  const presentStates = [...new Set([...timeRanges.map(range => range.state), ...(observedPoints.length ? ["available" as const] : [])])];

  return <section className="daily-recording-timeline" aria-label="날짜 녹화 범위">
    <div className="daily-recording-timeline-heading">
      <span>녹화 범위 (한국 시간)</span>
      <span>{recording.hasGaps || recording.coverage === "partial" ? "부분 저장" : recording.coverage === "complete" ? "전체 구간 확보" : recording.coverage === "none" ? "확보된 영상 없음" : "확보 구간 확인 중"}</span>
    </div>
    <div className="daily-recording-timeline-track" role="group" aria-label="00:00부터 24:00까지 녹화 범위">
      {dense ? <DenseTimeline key={recording.id} timeRanges={timeRanges} points={points} start={start} end={end} playable={availability.playbackReady} onSeekAt={seekAt} /> : timeRanges.map(range => {
        const label = rangeLabel(range, end);
        const style = { left: `${(range.start - start) / duration * 100}%`, width: `${(range.end - range.start) / duration * 100}%` };
        return range.state === "available" && availability.playbackReady
          ? <button type="button" key={range.start} className={`daily-recording-range daily-recording-range-${range.state}`} style={style} aria-label={`${label}, 재생`} title={label} onClick={event => seek(event, range)} />
          : <span key={range.start} className={`daily-recording-range daily-recording-range-${range.state}`} style={style} role="img" aria-label={label} title={label} />;
      })}
      {!dense && observedPoints.map((interval, index) => {
        const at = Date.parse(interval.startsAt);
        const label = `확보 시점 ${clock(at, end)}`;
        const style = { left: `${(at - start) / duration * 100}%` };
        return availability.playbackReady
          ? <button type="button" key={`${interval.startsAt}-${index}`} className="daily-recording-point" style={style} aria-label={`${label}, 재생`} title={label} onClick={() => onSeek(interval.playbackStartsAtSeconds)} />
          : <span key={`${interval.startsAt}-${index}`} className="daily-recording-point" style={style} role="img" aria-label={label} title={label} />;
      })}
    </div>
    <div className="daily-recording-timeline-ticks" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
    <div className="daily-recording-timeline-legend">{presentStates.map(state => <span key={state}><i className={`daily-recording-range-${state}`} aria-hidden="true" />{labels[state]}</span>)}</div>
  </section>;
});

export default DailyRecordingTimeline;
