import type { DailyRecording, DailyRecordingFull, DailyRecordingSummary } from "../domain/daily-recording";
import { record, timestamp as validTimestamp, timestampValue } from "./contract-values";

export type { DailyRecording, DailyRecordingFull, DailyRecordingSummary } from "../domain/daily-recording";

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

export function dailyRecording(value: unknown, cameraId: string): DailyRecordingFull {
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

  // 항목마다 수천 개인 구간의 시각은 한 번만 해석해 검증에 재사용한다.
  const gapStarts: number[] = [];
  const gapEnds: number[] = [];
  const gaps = entries(item.gaps, (entry) => {
    const gap = object(entry);
    const startsAt = timestamp(gap.start_at);
    const endsAt = timestamp(gap.end_at);
    gapStarts.push(timestampValue(startsAt));
    gapEnds.push(timestampValue(endsAt));
    return { startsAt, endsAt, reasonCode: text(gap.reason_code) };
  });
  let previousGapEnd = start;
  for (let index = 0; index < gaps.length; index += 1) {
    if (gapStarts[index] < previousGapEnd || gapEnds[index] < gapStarts[index] || gapEnds[index] > coverageUntil) return fail();
    previousGapEnd = gapEnds[index];
  }

  const intervalStarts: number[] = [];
  const intervalEnds: number[] = [];
  const availableIntervals = entries(item.available_intervals, (entry) => {
    const interval = object(entry);
    const startsAt = timestamp(interval.start_at);
    const endsAt = timestamp(interval.end_at);
    intervalStarts.push(timestampValue(startsAt));
    intervalEnds.push(timestampValue(endsAt));
    return {
      startsAt, endsAt,
      playbackStartsAtSeconds: number(interval.playback_start_seconds), playbackEndsAtSeconds: number(interval.playback_end_seconds),
    };
  });
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
  const recordedSeconds = number(item.recorded_seconds);
  const playableUntilAt = nullableTimestamp(item.playable_until_at);
  if (recordedSeconds > 86_400 || Math.abs(previousPlaybackEnd - recordedSeconds) > 0.001
    || (availableIntervals.length === 0 ? playableUntilAt !== null
      : playableUntilAt === null || timestampValue(playableUntilAt) !== intervalEnds[intervalEnds.length - 1])) return fail();
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

  const cleanupState = item.cleanup_state === undefined || item.cleanup_state === null ? null : choice(item.cleanup_state, ["pending", "failed", "complete"]);
  const cleanupCompletedAt = item.cleanup_completed_at === undefined || item.cleanup_completed_at === null ? null : nullableTimestamp(item.cleanup_completed_at);
  const cleanupError = item.cleanup_error === undefined || item.cleanup_error === null ? null : object(item.cleanup_error);
  if (cleanupError !== null && (typeof cleanupError.code !== "string" || !/^[A-Z0-9_]{1,100}$/.test(cleanupError.code) || typeof cleanupError.message !== "string")) return fail();
  const deletedAt = item.deleted_at === undefined || item.deleted_at === null ? null : nullableTimestamp(item.deleted_at);
  if (item.space_reclaimed !== undefined && item.space_reclaimed !== null) return fail();
  const spaceReclaimed = null;

  return {
    source: "daily", view: "full", id, cameraId, recordingDate, timezone: "Asia/Seoul", windowStartsAt, windowEndsAt,
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
    deletedAt,
    cleanupState,
    cleanupCompletedAt,
    cleanupError: cleanupError === null ? null : { code: text(cleanupError.code), message: "파일 정리에 실패했습니다." },
    spaceReclaimed,
  };
}

export function dailyRecordingSummary(value: unknown, cameraId: string): DailyRecordingSummary {
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

  if ("gaps" in item || "available_intervals" in item) return fail();
  const gapCount = number(item.gap_count);
  const availableIntervalCount = number(item.available_interval_count);
  if (!Number.isSafeInteger(gapCount) || !Number.isSafeInteger(availableIntervalCount)) return fail();
  const hasGaps = boolean(item.has_gaps);
  if (hasGaps !== (gapCount > 0)) return fail();

  const recordedSeconds = number(item.recorded_seconds);
  const playableUntilAt = nullableTimestamp(item.playable_until_at);
  if (recordedSeconds > 86_400
    || (availableIntervalCount === 0 ? playableUntilAt !== null : playableUntilAt === null)) return fail();

  const error = item.error === null ? null : object(item.error);
  if (error !== null && (typeof error.code !== "string" || !/^[A-Z0-9_]{1,100}$/.test(error.code) || typeof error.message !== "string")) return fail();
  const sizeBytes = item.size_bytes === null ? null : number(item.size_bytes);
  if (sizeBytes !== null && !Number.isSafeInteger(sizeBytes)) return fail();
  const playbackState = choice(item.playback_state, ["pending", "ready", "unavailable"]);
  const exportState = choice(item.export_state, ["not_requested", "processing", "ready", "failed"]);
  const playbackPath = publicPath(item.playback_path, `/media/daily-recordings/${id}/hls/index.m3u8`);
  const downloadPath = publicPath(item.download_path, `/media/daily-recordings/${id}/content?download=true`);
  if ((playbackPath !== null && playbackState !== "ready") || (downloadPath !== null && exportState !== "ready")) return fail();

  const cleanupState = item.cleanup_state === undefined || item.cleanup_state === null ? null : choice(item.cleanup_state, ["pending", "failed", "complete"]);
  const cleanupCompletedAt = item.cleanup_completed_at === undefined || item.cleanup_completed_at === null ? null : nullableTimestamp(item.cleanup_completed_at);
  const cleanupError = item.cleanup_error === undefined || item.cleanup_error === null ? null : object(item.cleanup_error);
  if (cleanupError !== null && (typeof cleanupError.code !== "string" || !/^[A-Z0-9_]{1,100}$/.test(cleanupError.code) || typeof cleanupError.message !== "string")) return fail();
  const deletedAt = item.deleted_at === undefined || item.deleted_at === null ? null : nullableTimestamp(item.deleted_at);
  if (item.space_reclaimed !== undefined && item.space_reclaimed !== null) return fail();
  const spaceReclaimed = null;

  return {
    source: "daily", view: "summary", id, cameraId, recordingDate, timezone: "Asia/Seoul", windowStartsAt, windowEndsAt,
    status: choice(item.status, ["recording", "finalizing", "closed", "failed", "expired", "deleted"]),
    coverage: item.coverage === null ? null : choice(item.coverage, ["complete", "partial", "none"]),
    hasGaps, coverageAsOfAt, playableUntilAt, recordedSeconds, gapCount, availableIntervalCount,
    playbackState,
    playbackProtocol: item.playback_protocol === null ? null : choice(item.playback_protocol, ["hls"]),
    playbackPath,
    exportAllowed: boolean(item.export_allowed),
    exportState,
    downloadPath,
    sizeBytes, expiresAt: nullableTimestamp(item.expires_at), exportExpiresAt: nullableTimestamp(item.export_expires_at),
    error: error === null ? null : { code: text(error.code), message: "녹화 처리에 실패했습니다." },
    deletedAt,
    cleanupState,
    cleanupCompletedAt,
    cleanupError: cleanupError === null ? null : { code: text(cleanupError.code), message: "파일 정리에 실패했습니다." },
    spaceReclaimed,
  };
}

export function dailyRecordingPage(value: unknown, cameraId: string): { items: DailyRecording[]; nextCursor: string | null } {
  const page = object(value);
  const view = page.view === undefined || page.view === "full" ? "full" : page.view === "summary" ? "summary" : fail();
  return {
    items: entries(page.items, (entry) => view === "summary" ? dailyRecordingSummary(entry, cameraId) : dailyRecording(entry, cameraId)),
    nextCursor: page.next_cursor === null ? null : typeof page.next_cursor === "string" && page.next_cursor.length <= 4096 ? text(page.next_cursor) : fail(),
  };
}

function accessible(recording: DailyRecording) { return recording.status !== "deleted" && recording.status !== "expired"; }

export function dailyPlaybackTimestamp(recording: DailyRecordingFull, seconds: number): string | null {
  if (!accessible(recording) || !Number.isFinite(seconds) || seconds < 0) return null;
  const interval = recording.availableIntervals.find((item) => seconds >= item.playbackStartsAtSeconds && seconds < item.playbackEndsAtSeconds)
    ?? (seconds === recording.availableIntervals.at(-1)?.playbackEndsAtSeconds ? recording.availableIntervals.at(-1) : undefined);
  if (!interval) return null;
  const progress = (seconds - interval.playbackStartsAtSeconds) / (interval.playbackEndsAtSeconds - interval.playbackStartsAtSeconds);
  return new Date(timestampValue(interval.startsAt) + progress * (timestampValue(interval.endsAt) - timestampValue(interval.startsAt))).toISOString();
}

export function dailyPlaybackPosition(recording: DailyRecordingFull, receivedAt: string): number | null {
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
  // 요약 항목은 구간 배열 대신 서버가 센 확보 구간 개수를 쓴다. 재생과 다운로드 실행은 화면이 상세 조회 뒤에만 허용한다.
  const availableIntervalCount = recording.view === "full" ? recording.availableIntervals.length : recording.availableIntervalCount;
  const exportable = !originalUnavailable && recording.exportAllowed && recording.status === "closed"
    && now >= Date.parse(recording.windowEndsAt) && recording.recordedSeconds > 0;
  const downloadReady = exportable && recording.exportState === "ready" && !exportCacheExpired
    && recording.downloadPath !== null;
  return {
    originalUnavailable,
    exportCacheExpired,
    playbackReady: !originalUnavailable && recording.playbackState === "ready" && recording.playbackProtocol === "hls" && recording.playbackPath !== null && availableIntervalCount > 0,
    downloadReady,
    exportProcessing: !originalUnavailable && recording.exportState === "processing",
    canPrepareExport: exportable && !downloadReady && recording.exportState !== "processing",
  };
}

export function dailyTimeState(recording: DailyRecordingFull, receivedAt: string, now: number): "available" | "gap" | "processing" | "future" | "outside" | "unavailable" | "unknown" {
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
