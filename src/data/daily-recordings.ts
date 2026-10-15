// Media internal metadata is not a browser API; public paths require a Backend contract.
export type DailyRecording = {
  source: "daily";
  id: string;
  cameraId: string;
  recordingDate: string;
  timezone: "Asia/Seoul";
  windowStartsAt: string;
  windowEndsAt: string;
  status: "recording" | "finalizing" | "closed" | "failed" | "expired" | "deleted";
  coverage: "complete" | "partial" | "none" | null;
  hasGaps: boolean;
  coverageAsOfAt: string;
  playableUntilAt: string | null;
  recordedSeconds: number;
  gaps: { startsAt: string; endsAt: string; reasonCode: string }[];
  availableIntervals: { startsAt: string; endsAt: string; playbackStartsAtSeconds: number; playbackEndsAtSeconds: number }[];
  playbackState: "pending" | "ready" | "unavailable";
  playbackProtocol: "hls";
  internalPlaybackPath: string | null;
  exportAllowed: boolean;
  exportState: "not_requested" | "processing" | "ready" | "failed";
  internalDownloadPath: string | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  exportExpiresAt: string | null;
  error: { code: string; message: string } | null;
};

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

function validTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
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

function internalPath(value: unknown, expected: string): string | null {
  return value === null ? null : value === expected ? expected : fail();
}

export function dailyRecording(value: unknown, cameraId: string): DailyRecording {
  const item = object(value);
  const id = text(item.recording_id);
  if (!/^[a-zA-Z0-9-]+$/.test(id) || item.camera_id !== cameraId || !cameraId) return fail();
  const recordingDate = date(item.recording_date);
  const windowStartsAt = timestamp(item.window_start_at);
  const windowEndsAt = timestamp(item.window_end_at);
  const start = Date.parse(windowStartsAt);
  const end = Date.parse(windowEndsAt);
  const coverageAsOfAt = timestamp(item.coverage_as_of_at);
  const coverageUntil = Date.parse(coverageAsOfAt);
  if (item.timezone !== "Asia/Seoul" || start !== Date.parse(`${recordingDate}T00:00:00.000+09:00`)
    || end - start !== 86_400_000 || coverageUntil < start || coverageUntil > end) return fail();

  const gaps = entries(item.gaps, (entry) => {
    const gap = object(entry);
    return { startsAt: timestamp(gap.start_at), endsAt: timestamp(gap.end_at), reasonCode: text(gap.reason_code) };
  });
  let previousGapEnd = start;
  for (const gap of gaps) {
    const gapStart = Date.parse(gap.startsAt);
    const gapEnd = Date.parse(gap.endsAt);
    if (gapStart < previousGapEnd || gapEnd <= gapStart || gapEnd > coverageUntil) return fail();
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
    const intervalStart = Date.parse(interval.startsAt);
    const intervalEnd = Date.parse(interval.endsAt);
    if (intervalStart < previousEnd || intervalEnd <= intervalStart || intervalEnd > coverageUntil
      || interval.playbackStartsAtSeconds !== previousPlaybackEnd
      || interval.playbackEndsAtSeconds <= interval.playbackStartsAtSeconds) return fail();
    previousEnd = intervalEnd;
    previousPlaybackEnd = interval.playbackEndsAtSeconds;
  }
  let gapIndex = 0;
  for (const interval of availableIntervals) {
    while (gapIndex < gaps.length && Date.parse(gaps[gapIndex].endsAt) <= Date.parse(interval.startsAt)) gapIndex += 1;
    if (gapIndex < gaps.length && Date.parse(gaps[gapIndex].startsAt) < Date.parse(interval.endsAt)) return fail();
  }
  const recordedSeconds = number(item.recorded_seconds);
  const playableUntilAt = nullableTimestamp(item.playable_until_at);
  if (Math.abs(previousPlaybackEnd - recordedSeconds) > 0.001
    || (availableIntervals.length === 0 ? playableUntilAt !== null : playableUntilAt !== availableIntervals.at(-1)?.endsAt)) return fail();
  const hasGaps = boolean(item.has_gaps);
  if (hasGaps !== (gaps.length > 0)) return fail();
  const error = item.error === null ? null : object(item.error);
  const sizeBytes = item.size_bytes === null ? null : number(item.size_bytes);
  if (sizeBytes !== null && !Number.isSafeInteger(sizeBytes)) return fail();

  return {
    source: "daily", id, cameraId, recordingDate, timezone: "Asia/Seoul", windowStartsAt, windowEndsAt,
    status: choice(item.status, ["recording", "finalizing", "closed", "failed", "expired", "deleted"]),
    coverage: item.coverage === null ? null : choice(item.coverage, ["complete", "partial", "none"]),
    hasGaps, coverageAsOfAt, playableUntilAt, recordedSeconds, gaps, availableIntervals,
    playbackState: choice(item.playback_state, ["pending", "ready", "unavailable"]),
    playbackProtocol: choice(item.playback_protocol, ["hls"]),
    internalPlaybackPath: internalPath(item.playback_path, `/api/v2/daily-recordings/${id}/hls/index.m3u8`),
    exportAllowed: boolean(item.export_allowed),
    exportState: choice(item.export_state, ["not_requested", "processing", "ready", "failed"]),
    internalDownloadPath: internalPath(item.download_path, `/api/v2/daily-recordings/${id}/content`),
    sizeBytes, expiresAt: nullableTimestamp(item.expires_at), exportExpiresAt: nullableTimestamp(item.export_expires_at),
    error: error === null ? null : { code: text(error.code), message: typeof error.message === "string" ? error.message : fail() },
  };
}

export function dailyRecordingPage(value: unknown, cameraId: string): { items: DailyRecording[]; nextCursor: string | null } {
  const page = object(value);
  return {
    items: entries(page.items, (entry) => dailyRecording(entry, cameraId)),
    nextCursor: page.next_cursor === null ? null : text(page.next_cursor),
  };
}

function accessible(recording: DailyRecording) { return recording.status !== "deleted" && recording.status !== "expired"; }

export function dailyPlaybackTimestamp(recording: DailyRecording, seconds: number): string | null {
  if (!accessible(recording) || !Number.isFinite(seconds) || seconds < 0) return null;
  const interval = recording.availableIntervals.find((item) => seconds >= item.playbackStartsAtSeconds && seconds < item.playbackEndsAtSeconds)
    ?? (seconds === recording.availableIntervals.at(-1)?.playbackEndsAtSeconds ? recording.availableIntervals.at(-1) : undefined);
  if (!interval) return null;
  const progress = (seconds - interval.playbackStartsAtSeconds) / (interval.playbackEndsAtSeconds - interval.playbackStartsAtSeconds);
  return new Date(Date.parse(interval.startsAt) + progress * (Date.parse(interval.endsAt) - Date.parse(interval.startsAt))).toISOString();
}

export function dailyPlaybackPosition(recording: DailyRecording, receivedAt: string): number | null {
  if (!accessible(recording) || !validTimestamp(receivedAt)) return null;
  const at = Date.parse(receivedAt);
  if (!Number.isFinite(at)) return null;
  const interval = recording.availableIntervals.find((item) => at >= Date.parse(item.startsAt) && at < Date.parse(item.endsAt))
    ?? (receivedAt === recording.availableIntervals.at(-1)?.endsAt ? recording.availableIntervals.at(-1) : undefined);
  if (!interval) return null;
  const progress = (at - Date.parse(interval.startsAt)) / (Date.parse(interval.endsAt) - Date.parse(interval.startsAt));
  return interval.playbackStartsAtSeconds + progress * (interval.playbackEndsAtSeconds - interval.playbackStartsAtSeconds);
}

export function dailyRecordingAvailability(recording: DailyRecording, now: number) {
  if (!Number.isFinite(now)) throw new Error("A valid server time is required.");
  const originalUnavailable = !accessible(recording) || (recording.expiresAt !== null && Date.parse(recording.expiresAt) <= now);
  const exportCacheExpired = recording.exportExpiresAt !== null && Date.parse(recording.exportExpiresAt) <= now;
  const exportable = !originalUnavailable && recording.exportAllowed && recording.status === "closed"
    && now >= Date.parse(recording.windowEndsAt) && recording.recordedSeconds > 0;
  const downloadReady = exportable && recording.exportState === "ready" && !exportCacheExpired
    && recording.internalDownloadPath !== null;
  return {
    originalUnavailable,
    exportCacheExpired,
    playbackReady: !originalUnavailable && recording.playbackState === "ready" && recording.internalPlaybackPath !== null && recording.availableIntervals.length > 0,
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
