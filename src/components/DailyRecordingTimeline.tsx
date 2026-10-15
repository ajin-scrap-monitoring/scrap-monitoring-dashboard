import type { MouseEvent } from "react";

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

function ranges(recording: DailyRecording, now: number): TimeRange[] {
  const start = Date.parse(recording.windowStartsAt);
  const end = Date.parse(recording.windowEndsAt);
  const coverage = Date.parse(recording.coverageAsOfAt);
  const unavailable = dailyRecordingAvailability(recording, now).originalUnavailable;
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

export function DailyRecordingTimeline({ recording, now, onSeek }: { recording: DailyRecording; now: number; onSeek: (seconds: number) => void }) {
  const start = Date.parse(recording.windowStartsAt);
  const end = Date.parse(recording.windowEndsAt);
  const duration = end - start;
  const timeRanges = ranges(recording, now);
  const availability = dailyRecordingAvailability(recording, now);
  const observedPoints = recording.availableIntervals.filter(interval => !availability.originalUnavailable && interval.startsAt === interval.endsAt && Date.parse(interval.startsAt) <= now);
  const seek = (event: MouseEvent<HTMLButtonElement>, range: TimeRange) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const progress = event.detail > 0 && bounds.width > 0 ? Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) : 0;
    const at = Math.min(range.end - 1, range.start + Math.floor((range.end - range.start) * progress));
    const seconds = dailyPlaybackPosition(recording, new Date(at).toISOString());
    if (seconds !== null) onSeek(seconds);
  };
  const presentStates = [...new Set([...timeRanges.map(range => range.state), ...(observedPoints.length ? ["available" as const] : [])])];

  return <section className="daily-recording-timeline" aria-label="날짜 녹화 범위">
    <div className="daily-recording-timeline-heading">
      <span>녹화 범위 (한국 시간)</span>
      <span>{recording.hasGaps || recording.coverage === "partial" ? "부분 저장" : recording.coverage === "complete" ? "전체 구간 확보" : recording.coverage === "none" ? "확보된 영상 없음" : "확보 구간 확인 중"}</span>
    </div>
    <div className="daily-recording-timeline-track" role="group" aria-label="00:00부터 24:00까지 녹화 범위">
      {timeRanges.map(range => {
        const label = `${labels[range.state]} ${clock(range.start, end)} ~ ${clock(range.end, end)}`;
        const style = { left: `${(range.start - start) / duration * 100}%`, width: `${(range.end - range.start) / duration * 100}%` };
        return range.state === "available" && availability.playbackReady
          ? <button type="button" key={range.start} className={`daily-recording-range daily-recording-range-${range.state}`} style={style} aria-label={`${label}, 재생`} title={label} onClick={event => seek(event, range)} />
          : <span key={range.start} className={`daily-recording-range daily-recording-range-${range.state}`} style={style} role="img" aria-label={label} title={label} />;
      })}
      {observedPoints.map((interval, index) => {
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
}

export default DailyRecordingTimeline;
