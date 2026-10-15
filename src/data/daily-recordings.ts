import type { DailyRecording } from "../domain/daily-recording";
import { timestamp as validTimestamp, timestampValue } from "./contract-values";

export type { DailyRecording } from "../domain/daily-recording";

export const dailyRecordingIdentifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(): never { throw new Error("Unexpected daily recording contract."); }

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : fail();
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fail();
}

function boolean(value: unknown): boolean { return typeof value === "boolean" ? value : fail(); }

function choice<const T extends readonly string[]>(value: unknown, options: T): T[number] {
  return typeof value === "string" && options.includes(value) ? value : fail();
}

function timestamp(value: unknown): string {
  const result = text(value);
  if (!validTimestamp(result)) return fail();
  return result;
}

function nullableTimestamp(value: unknown): string | null { return value === null ? null : timestamp(value); }

function date(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(`${result}T00:00:00.000Z`))
    || new Date(`${result}T00:00:00.000Z`).toISOString().slice(0, 10) !== result) return fail();
  return result;
}

function entries<T>(value: unknown, convert: (entry: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(convert) : fail();
}

function publicPath(value: unknown, expected: string): string | null {
  return value === null ? null : value === expected ? expected : fail();
}

export function dailyRecording(value: unknown, cameraId: string): DailyRecording {
  const item = object(value);
  const id = text(item.recording_id);
  if (!dailyRecordingIdentifier.test(id) || item.camera_id !== cameraId || !cameraId) return fail();
  const recordingDate = date(item.recording_date);
  const windowStartsAt = timestamp(item.window_start_at);
  const windowEndsAt = timestamp(item.window_end_at);
  const start = timestampValue(windowStartsAt);
  const end = timestampValue(windowEndsAt);
  const coverageAsOfAt = timestamp(item.coverage_as_of_at);
  const coverageUntil = timestampValue(coverageAsOfAt);
  if (item.timezone !== "Asia/Seoul" || start !== Date.parse(`${recordingDate}T00:00:00.000+09:00`)
    || end - start !== 86_400_000 || coverageUntil < start || coverageUntil > end) return fail();

  const gaps = entries(item.gaps, (entry) => {
    const gap = object(entry);
    return { startsAt: timestamp(gap.start_at), endsAt: timestamp(gap.end_at), reasonCode: text(gap.reason_code) };
  });
  let previousGapEnd = start;
  for (const gap of gaps) {
    const gapStart = timestampValue(gap.startsAt);
    const gapEnd = timestampValue(gap.endsAt);
    if (gapStart < previousGapEnd || gapEnd < gapStart || gapEnd > coverageUntil) return fail();
    previousGapEnd = gapEnd;
  }

  const availableIntervals = entries(item.available_intervals, (entry) => {
    const interval = object(entry);
    return {
      startsAt: timestamp(interval.start_at), endsAt: timestamp(interval.end_at),
      playbackStartsAtSeconds: number(interval.playback_start_seconds), playbackEndsAtSeconds: number(interval.playback_end_seconds),
    };
  });
  let previousEnd = start;
  let previousPlaybackEnd = 0;
  for (const interval of availableIntervals) {
    const intervalStart = timestampValue(interval.startsAt);
    const intervalEnd = timestampValue(interval.endsAt);
    if (intervalStart < previousEnd || intervalEnd < intervalStart || intervalEnd > coverageUntil
      || interval.playbackStartsAtSeconds !== previousPlaybackEnd
      || interval.playbackEndsAtSeconds <= interval.playbackStartsAtSeconds || interval.playbackEndsAtSeconds > 86_400) return fail();
    previousEnd = intervalEnd;
    previousPlaybackEnd = interval.playbackEndsAtSeconds;
  }
  let gapIndex = 0;
  for (const interval of availableIntervals) {
    if (timestampValue(interval.startsAt) === timestampValue(interval.endsAt)) continue;
    while (gapIndex < gaps.length && timestampValue(gaps[gapIndex].endsAt) <= timestampValue(interval.startsAt)) gapIndex += 1;
    if (gapIndex < gaps.length && timestampValue(gaps[gapIndex].startsAt) < timestampValue(interval.endsAt)) return fail();
  }
  const recordedSeconds = number(item.recorded_seconds);
  const playableUntilAt = nullableTimestamp(item.playable_until_at);
  if (recordedSeconds > 86_400 || Math.abs(previousPlaybackEnd - recordedSeconds) > 0.001
    || (availableIntervals.length === 0 ? playableUntilAt !== null
      : playableUntilAt === null || timestampValue(playableUntilAt) !== timestampValue(availableIntervals.at(-1)!.endsAt))) return fail();
  const hasGaps = boolean(item.has_gaps);
  if (hasGaps !== (gaps.length > 0)) return fail();
  const error = item.error === null ? null : object(item.error);
  if (error !== null && (typeof error.code !== "string" || !/^[A-Z0-9_]{1,100}$/.test(error.code) || typeof error.message !== "string")) return fail();
  const sizeBytes = item.size_bytes === null ? null : number(item.size_bytes);
  if (sizeBytes !== null && !Number.isSafeInteger(sizeBytes)) return fail();
  const playbackState = choice(item.playback_state, ["pending", "ready", "unavailable"]);
  const exportState = choice(item.export_state, ["not_requested", "processing", "ready", "failed"]);
  const playbackPath = publicPath(item.playback_path, `/media/daily-recordings/${id}/hls/index.m3u8`);
  const downloadPath = publicPath(item.download_path, `/media/daily-recordings/${id}/content?download=true`);
  if ((playbackPath !== null && playbackState !== "ready") || (downloadPath !== null && exportState !== "ready")) return fail();

  return {
    source: "daily", id, cameraId, recordingDate, timezone: "Asia/Seoul", windowStartsAt, windowEndsAt,
    status: choice(item.status, ["recording", "finalizing", "closed", "failed", "expired", "deleted"]),
    coverage: item.coverage === null ? null : choice(item.coverage, ["complete", "partial", "none"]),
    hasGaps, coverageAsOfAt, playableUntilAt, recordedSeconds, gaps, availableIntervals,
    playbackState,
    playbackProtocol: item.playback_protocol === null ? null : choice(item.playback_protocol, ["hls"]),
    playbackPath,
    exportAllowed: boolean(item.export_allowed),
    exportState,
    downloadPath,
    sizeBytes, expiresAt: nullableTimestamp(item.expires_at), exportExpiresAt: nullableTimestamp(item.export_expires_at),
    error: error === null ? null : { code: text(error.code), message: "녹화 처리에 실패했습니다." },
  };
}

export function dailyRecordingPage(value: unknown, cameraId: string): { items: DailyRecording[]; nextCursor: string | null } {
  const page = object(value);
  return {
    items: entries(page.items, (entry) => dailyRecording(entry, cameraId)),
    nextCursor: page.next_cursor === null ? null : typeof page.next_cursor === "string" && page.next_cursor.length <= 4096 ? text(page.next_cursor) : fail(),
  };
}

function accessible(recording: DailyRecording) { return recording.status !== "deleted" && recording.status !== "expired"; }

export function dailyPlaybackTimestamp(recording: DailyRecording, seconds: number): string | null {
  if (!accessible(recording) || !Number.isFinite(seconds) || seconds < 0) return null;
  const interval = recording.availableIntervals.find((item) => seconds >= item.playbackStartsAtSeconds && seconds < item.playbackEndsAtSeconds)
    ?? (seconds === recording.availableIntervals.at(-1)?.playbackEndsAtSeconds ? recording.availableIntervals.at(-1) : undefined);
  if (!interval) return null;
  const progress = (seconds - interval.playbackStartsAtSeconds) / (interval.playbackEndsAtSeconds - interval.playbackStartsAtSeconds);
  return new Date(timestampValue(interval.startsAt) + progress * (timestampValue(interval.endsAt) - timestampValue(interval.startsAt))).toISOString();
}

export function dailyPlaybackPosition(recording: DailyRecording, receivedAt: string): number | null {
  if (!accessible(recording) || !validTimestamp(receivedAt)) return null;
  const at = timestampValue(receivedAt);
  if (!Number.isFinite(at)) return null;
  const interval = recording.availableIntervals.find((item) => at >= timestampValue(item.startsAt) && (at < timestampValue(item.endsAt)
    || (at === timestampValue(item.startsAt) && timestampValue(item.startsAt) === timestampValue(item.endsAt))))
    ?? (at === timestampValue(recording.availableIntervals.at(-1)?.endsAt ?? "") ? recording.availableIntervals.at(-1) : undefined);
  if (!interval) return null;
  const duration = timestampValue(interval.endsAt) - timestampValue(interval.startsAt);
  if (duration === 0) return interval.playbackStartsAtSeconds;
  const progress = (at - timestampValue(interval.startsAt)) / duration;
  return interval.playbackStartsAtSeconds + progress * (interval.playbackEndsAtSeconds - interval.playbackStartsAtSeconds);
}

export function dailyRecordingAvailability(recording: DailyRecording, now: number) {
  if (!Number.isFinite(now)) throw new Error("A valid server time is required.");
  const originalUnavailable = !accessible(recording) || (recording.expiresAt !== null && Date.parse(recording.expiresAt) <= now);
  const exportCacheExpired = recording.exportExpiresAt !== null && Date.parse(recording.exportExpiresAt) <= now;
  const exportable = !originalUnavailable && recording.exportAllowed && recording.status === "closed"
    && now >= Date.parse(recording.windowEndsAt) && recording.recordedSeconds > 0;
  const downloadReady = exportable && recording.exportState === "ready" && !exportCacheExpired
    && recording.downloadPath !== null;
  return {
    originalUnavailable,
    exportCacheExpired,
    playbackReady: !originalUnavailable && recording.playbackState === "ready" && recording.playbackProtocol === "hls" && recording.playbackPath !== null && recording.availableIntervals.length > 0,
    downloadReady,
    exportProcessing: !originalUnavailable && recording.exportState === "processing",
    canPrepareExport: exportable && !downloadReady && recording.exportState !== "processing",
  };
}

export function dailyTimeState(recording: DailyRecording, receivedAt: string, now: number): "available" | "gap" | "processing" | "future" | "outside" | "unavailable" | "unknown" {
  if (!Number.isFinite(now)) throw new Error("A valid server time is required.");
  const at = Date.parse(receivedAt);
  if (!validTimestamp(receivedAt) || at < Date.parse(recording.windowStartsAt) || at >= Date.parse(recording.windowEndsAt)) return "outside";
  if (dailyRecordingAvailability(recording, now).originalUnavailable) return "unavailable";
  if (at > now) return "future";
  if (recording.availableIntervals.some((item) => at >= Date.parse(item.startsAt) && at < Date.parse(item.endsAt))) return "available";
  if (recording.gaps.some((gap) => at >= Date.parse(gap.startsAt) && at < Date.parse(gap.endsAt))) return "gap";
  if (at < Date.parse(recording.coverageAsOfAt)) return "unknown";
  return "processing";
}
