import type {
  DailyAvailableInterval,
  DailyGap,
  DailyIntervalPage,
  DailyRecording,
  DailyRecordingFull,
  DailyRecordingMetadata,
} from "../domain/daily-recording";
import { record, timestamp as validTimestamp, timestampValue } from "./contract-values";

export type {
  DailyAvailableInterval,
  DailyGap,
  DailyIntervalPage,
  DailyRecording,
  DailyRecordingFull,
  DailyRecordingMetadata,
} from "../domain/daily-recording";

export const dailyRecordingIdentifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(): never { throw new Error("Unexpected daily recording contract."); }

function choice<const T extends readonly string[]>(value: unknown, options: T): T[number] {
  if (typeof value === "string" && (options as readonly string[]).includes(value)) return value;
  return fail();
}

function object(value: unknown): Record<string, unknown> {
  return record(value) ? value : fail();
}

function text(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : fail();
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fail();
}

function boolean(value: unknown): boolean { return typeof value === "boolean" ? value : fail(); }

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

function nextCursorValue(value: unknown): string | null {
  return value === null ? null : typeof value === "string" && value.length <= 4096 ? text(value) : fail();
}

function errorDetail(value: unknown, message: string): { code: string; message: string } | null {
  if (value === undefined || value === null) return null;
  const parsed = object(value);
  if (typeof parsed.code !== "string" || !/^[A-Z0-9_]{1,100}$/.test(parsed.code) || typeof parsed.message !== "string") return fail();
  return { code: text(parsed.code), message };
}

function parseGapEntries(value: unknown) {
  const starts: number[] = [];
  const ends: number[] = [];
  const gaps = entries(value, (entry): DailyGap => {
    const gap = object(entry);
    const startsAt = timestamp(gap.start_at);
    const endsAt = timestamp(gap.end_at);
    starts.push(timestampValue(startsAt));
    ends.push(timestampValue(endsAt));
    return { startsAt, endsAt, reasonCode: text(gap.reason_code) };
  });
  return { gaps, starts, ends };
}

function parseAvailableIntervalEntries(value: unknown) {
  const starts: number[] = [];
  const ends: number[] = [];
  const intervals = entries(value, (entry): DailyAvailableInterval => {
    const interval = object(entry);
    const startsAt = timestamp(interval.start_at);
    const endsAt = timestamp(interval.end_at);
    starts.push(timestampValue(startsAt));
    ends.push(timestampValue(endsAt));
    return {
      startsAt,
      endsAt,
      playbackStartsAtSeconds: number(interval.playback_start_seconds),
      playbackEndsAtSeconds: number(interval.playback_end_seconds),
    };
  });
  return { intervals, starts, ends };
}

function parseDailyRecordingBase(value: unknown, cameraId: string) {
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

  const recordedSeconds = number(item.recorded_seconds);
  const playableUntilAt = nullableTimestamp(item.playable_until_at);
  if (recordedSeconds > 86_400) return fail();
  if (playableUntilAt !== null) {
    const playableUntil = timestampValue(playableUntilAt);
    if (playableUntil < start || playableUntil > coverageUntil) return fail();
  }
  const hasGaps = boolean(item.has_gaps);
  const error = errorDetail(item.error === undefined ? fail() : item.error, "녹화 처리에 실패했습니다.");
  const sizeBytes = item.size_bytes === null ? null : number(item.size_bytes);
  if (sizeBytes !== null && !Number.isSafeInteger(sizeBytes)) return fail();
  const playbackState = choice(item.playback_state, ["pending", "ready", "unavailable"]);
  const exportState = choice(item.export_state, ["not_requested", "processing", "ready", "failed"]);
  const playbackPath = publicPath(item.playback_path, `/media/daily-recordings/${id}/hls/index.m3u8`);
  const downloadPath = publicPath(item.download_path, `/media/daily-recordings/${id}/content?download=true`);
  if ((playbackPath !== null && playbackState !== "ready") || (downloadPath !== null && exportState !== "ready")) return fail();

  const cleanupState = item.cleanup_state === undefined || item.cleanup_state === null ? null : choice(item.cleanup_state, ["pending", "failed", "complete"]);
  const cleanupCompletedAt = item.cleanup_completed_at === undefined || item.cleanup_completed_at === null ? null : nullableTimestamp(item.cleanup_completed_at);
  const cleanupError = errorDetail(item.cleanup_error, "파일 정리에 실패했습니다.");
  const deletedAt = item.deleted_at === undefined || item.deleted_at === null ? null : nullableTimestamp(item.deleted_at);
  if (item.space_reclaimed !== undefined && item.space_reclaimed !== null) return fail();

  return {
    item,
    start,
    coverageUntil,
    base: {
      source: "daily" as const,
      id,
      cameraId,
      recordingDate,
      timezone: "Asia/Seoul" as const,
      windowStartsAt,
      windowEndsAt,
      status: choice(item.status, ["recording", "finalizing", "closed", "failed", "expired", "deleted"]),
      coverage: item.coverage === null ? null : choice(item.coverage, ["complete", "partial", "none"]),
      hasGaps,
      coverageAsOfAt,
      playableUntilAt,
      recordedSeconds,
      playbackState,
      playbackProtocol: item.playback_protocol === null ? null : choice(item.playback_protocol, ["hls"]),
      playbackPath,
      exportAllowed: boolean(item.export_allowed),
      exportState,
      downloadPath,
      sizeBytes,
      expiresAt: nullableTimestamp(item.expires_at),
      exportExpiresAt: nullableTimestamp(item.export_expires_at),
      error,
      deletedAt,
      cleanupState,
      cleanupCompletedAt,
      cleanupError,
      spaceReclaimed: null,
    },
  };
}

export function dailyRecording(value: unknown, cameraId: string): DailyRecordingFull {
  const { item, start, coverageUntil, base } = parseDailyRecordingBase(value, cameraId);

  // 항목마다 수천 개인 구간의 시각은 한 번만 해석해 검증에 재사용한다.
  const { gaps, starts: gapStarts, ends: gapEnds } = parseGapEntries(item.gaps);
  let previousGapEnd = start;
  for (let index = 0; index < gaps.length; index += 1) {
    if (gapStarts[index] < previousGapEnd || gapEnds[index] < gapStarts[index] || gapEnds[index] > coverageUntil) return fail();
    previousGapEnd = gapEnds[index];
  }

  const { intervals: availableIntervals, starts: intervalStarts, ends: intervalEnds } = parseAvailableIntervalEntries(item.available_intervals);
  let previousEnd = start;
  let previousPlaybackEnd = 0;
  for (let index = 0; index < availableIntervals.length; index += 1) {
    const interval = availableIntervals[index];
    if (intervalStarts[index] < previousEnd || intervalEnds[index] < intervalStarts[index] || intervalEnds[index] > coverageUntil
      || interval.playbackStartsAtSeconds !== previousPlaybackEnd
      || interval.playbackEndsAtSeconds <= interval.playbackStartsAtSeconds || interval.playbackEndsAtSeconds > 86_400) return fail();
    previousEnd = intervalEnds[index];
    previousPlaybackEnd = interval.playbackEndsAtSeconds;
  }
  let gapIndex = 0;
  for (let index = 0; index < availableIntervals.length; index += 1) {
    if (intervalStarts[index] === intervalEnds[index]) continue;
    while (gapIndex < gaps.length && gapEnds[gapIndex] <= intervalStarts[index]) gapIndex += 1;
    if (gapIndex < gaps.length && gapStarts[gapIndex] < intervalEnds[index]) return fail();
  }
  if (Math.abs(previousPlaybackEnd - base.recordedSeconds) > 0.001
    || (availableIntervals.length === 0 ? base.playableUntilAt !== null
      : base.playableUntilAt === null || timestampValue(base.playableUntilAt) !== intervalEnds[intervalEnds.length - 1])) return fail();
  if (base.hasGaps !== (gaps.length > 0)) return fail();

  return { ...base, view: "full", gaps, availableIntervals };
}

export function dailyRecordingMetadata(value: unknown, cameraId: string): DailyRecordingMetadata {
  const { item, base } = parseDailyRecordingBase(value, cameraId);
  if ("gaps" in item || "available_intervals" in item || "gap_count" in item || "available_interval_count" in item) return fail();
  const revision = number(item.revision);
  if (!Number.isSafeInteger(revision)) return fail();
  return { ...base, view: "metadata", revision };
}

export function dailyMetadataPage(value: unknown, cameraId: string): { items: DailyRecordingMetadata[]; nextCursor: string | null } {
  const page = object(value);
  if ("view" in page) return fail();
  return {
    items: entries(page.items, (entry) => dailyRecordingMetadata(entry, cameraId)),
    nextCursor: nextCursorValue(page.next_cursor),
  };
}

function parseIntervalPageHeader(value: unknown, recordingId: string) {
  const page = object(value);
  const id = text(page.recording_id);
  if (!dailyRecordingIdentifier.test(id) || id.toLowerCase() !== recordingId.toLowerCase()) return fail();
  const revision = number(page.revision);
  if (!Number.isSafeInteger(revision)) return fail();
  const snapshot = typeof page.snapshot === "string" && page.snapshot.length > 0 && page.snapshot.length <= 4096 ? page.snapshot : fail();
  const total = number(page.total);
  if (!Number.isSafeInteger(total)) return fail();
  return { page, recordingId: id, revision, snapshot, total, nextCursor: nextCursorValue(page.next_cursor) };
}

export function dailyGapPage(value: unknown, recordingId: string): DailyIntervalPage<DailyGap> {
  const header = parseIntervalPageHeader(value, recordingId);
  const { gaps, starts, ends } = parseGapEntries(header.page.items);
  if (header.total < gaps.length) return fail();
  let previousEnd = -Infinity;
  for (let index = 0; index < gaps.length; index += 1) {
    if (starts[index] < previousEnd || ends[index] < starts[index]) return fail();
    previousEnd = ends[index];
  }
  return {
    recordingId: header.recordingId,
    revision: header.revision,
    snapshot: header.snapshot,
    items: gaps,
    total: header.total,
    nextCursor: header.nextCursor,
  };
}

export function dailyAvailableIntervalPage(value: unknown, recordingId: string): DailyIntervalPage<DailyAvailableInterval> {
  const header = parseIntervalPageHeader(value, recordingId);
  const { intervals, starts, ends } = parseAvailableIntervalEntries(header.page.items);
  if (header.total < intervals.length) return fail();
  let previousEnd = -Infinity;
  let previousPlaybackEnd: number | null = null;
  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index];
    if (starts[index] < previousEnd || ends[index] < starts[index]
      || (previousPlaybackEnd !== null && interval.playbackStartsAtSeconds !== previousPlaybackEnd)
      || interval.playbackEndsAtSeconds <= interval.playbackStartsAtSeconds || interval.playbackEndsAtSeconds > 86_400) return fail();
    previousEnd = ends[index];
    previousPlaybackEnd = interval.playbackEndsAtSeconds;
  }
  return {
    recordingId: header.recordingId,
    revision: header.revision,
    snapshot: header.snapshot,
    items: intervals,
    total: header.total,
    nextCursor: header.nextCursor,
  };
}

function accessible(recording: DailyRecording) { return recording.status !== "deleted" && recording.status !== "expired"; }

export function dailyPlaybackTimestamp(
  recording: DailyRecording,
  seconds: number,
  availableIntervals?: readonly DailyAvailableInterval[],
): string | null {
  const intervals = availableIntervals ?? (recording.view === "full" ? recording.availableIntervals : undefined);
  if (!intervals || intervals.length === 0 || !accessible(recording) || !Number.isFinite(seconds) || seconds < 0) return null;
  const last = intervals[intervals.length - 1];
  const interval = intervals.find((item) => seconds >= item.playbackStartsAtSeconds && seconds < item.playbackEndsAtSeconds)
    ?? (seconds === last.playbackEndsAtSeconds && Math.abs(last.playbackEndsAtSeconds - recording.recordedSeconds) <= 0.001 ? last : undefined);
  if (!interval) return null;
  const progress = (seconds - interval.playbackStartsAtSeconds) / (interval.playbackEndsAtSeconds - interval.playbackStartsAtSeconds);
  return new Date(timestampValue(interval.startsAt) + progress * (timestampValue(interval.endsAt) - timestampValue(interval.startsAt))).toISOString();
}

export function dailyPlaybackPosition(
  recording: DailyRecording,
  receivedAt: string,
  availableIntervals?: readonly DailyAvailableInterval[],
): number | null {
  const intervals = availableIntervals ?? (recording.view === "full" ? recording.availableIntervals : undefined);
  if (!intervals || intervals.length === 0 || !accessible(recording) || !validTimestamp(receivedAt)) return null;
  const at = timestampValue(receivedAt);
  if (!Number.isFinite(at)) return null;
  const last = intervals[intervals.length - 1];
  const interval = intervals.find((item) => at >= timestampValue(item.startsAt) && (at < timestampValue(item.endsAt)
    || (at === timestampValue(item.startsAt) && timestampValue(item.startsAt) === timestampValue(item.endsAt))))
    ?? (recording.playableUntilAt !== null && at === timestampValue(last.endsAt) && at === timestampValue(recording.playableUntilAt) ? last : undefined);
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
  const hasPlayableMedia = recording.view === "full"
    ? recording.availableIntervals.length > 0
    : recording.playableUntilAt !== null && recording.recordedSeconds > 0;
  const exportable = !originalUnavailable && recording.exportAllowed && recording.status === "closed"
    && now >= Date.parse(recording.windowEndsAt) && recording.recordedSeconds > 0;
  const downloadReady = exportable && recording.exportState === "ready" && !exportCacheExpired
    && recording.downloadPath !== null;
  return {
    originalUnavailable,
    exportCacheExpired,
    playbackReady: !originalUnavailable && recording.playbackState === "ready" && recording.playbackProtocol === "hls" && recording.playbackPath !== null && hasPlayableMedia,
    downloadReady,
    exportProcessing: !originalUnavailable && recording.exportState === "processing",
    canPrepareExport: exportable && !downloadReady && recording.exportState !== "processing",
  };
}

export function dailyTimeState(
  recording: DailyRecording,
  receivedAt: string,
  now: number,
  intervals?: { availableIntervals?: readonly DailyAvailableInterval[]; gaps?: readonly DailyGap[] },
): "available" | "gap" | "processing" | "future" | "outside" | "unavailable" | "unknown" {
  if (!Number.isFinite(now)) throw new Error("A valid server time is required.");
  const at = Date.parse(receivedAt);
  if (!validTimestamp(receivedAt) || at < Date.parse(recording.windowStartsAt) || at >= Date.parse(recording.windowEndsAt)) return "outside";
  if (dailyRecordingAvailability(recording, now).originalUnavailable) return "unavailable";
  if (at > now) return "future";
  const availableIntervals = intervals?.availableIntervals ?? (recording.view === "full" ? recording.availableIntervals : []);
  const gaps = intervals?.gaps ?? (recording.view === "full" ? recording.gaps : []);
  if (availableIntervals.some((item) => at >= Date.parse(item.startsAt) && at < Date.parse(item.endsAt))) return "available";
  if (gaps.some((gap) => at >= Date.parse(gap.startsAt) && at < Date.parse(gap.endsAt))) return "gap";
  if (at < Date.parse(recording.coverageAsOfAt)) return "unknown";
  return "processing";
}
