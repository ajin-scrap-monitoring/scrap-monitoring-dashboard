import type { components, paths } from "../generated/backend-contract";
import type { Recording } from "../domain/dashboard";
import type { DateRangeQuery } from "./dashboard-data-source";
import { dailyRecording, dailyRecordingAvailability, dailyRecordingIdentifier, dailyRecordingPage, type DailyRecording } from "./daily-recordings";
import { timestamp } from "./contract-values";

type DailyApiError = Error & { status: number; code?: string };
type DailyRecordingApiOptions = {
  ApiError: new (status: number, message: string, code?: string) => DailyApiError;
  cameraId: string;
  isAuthenticated: () => boolean;
  request: <T>(path: string, init: RequestInit) => Promise<T>;
  serverNow: () => number;
};

const dailyPaths = {
  list: "/api/v2/recordings/daily",
  detail: "/api/v2/recordings/daily/{recording_id}",
  exports: "/api/v2/recordings/daily/{recording_id}/exports",
} as const satisfies Record<string, keyof paths>;

const missingValue = "정보 없음";

function pathWithId(path: string, id: string) {
  return path.replace("{recording_id}", encodeURIComponent(id));
}

function koreanWallClock(value: string) {
  return new Date(Date.parse(value) + 9 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
}

function clockDuration(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), Math.floor(seconds % 60)]
    .map(value => String(value).padStart(2, "0")).join(":");
}

function byteSize(bytes: number | null) {
  if (bytes === null) return missingValue;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function mapDailyRecording(daily: DailyRecording, now: number): Recording {
  const availability = dailyRecordingAvailability(daily, now);
  return {
    source: "daily", daily, id: daily.id, date: daily.recordingDate, type: "날짜 녹화",
    detail: `${daily.recordingDate} 날짜 녹화`, sample: false,
    start: koreanWallClock(daily.windowStartsAt), end: koreanWallClock(daily.windowEndsAt),
    time: "00:00 - 24:00", duration: clockDuration(daily.recordedSeconds),
    contentUrl: availability.playbackReady ? daily.playbackPath ?? undefined : undefined,
    downloadUrl: availability.downloadReady ? daily.downloadPath ?? undefined : undefined,
    status: availability.originalUnavailable ? "expired" : availability.playbackReady ? "available"
      : daily.status === "recording" || daily.status === "finalizing" || (daily.status !== "failed" && daily.playbackState === "pending") ? "processing" : "unavailable",
    tone: daily.status === "failed" || daily.exportState === "failed" ? "error" : daily.hasGaps ? "warning" : "complete",
    codec: missingValue, format: missingValue, frameRate: null, height: null, width: null,
    retentionStartsAt: missingValue, retentionEndsAt: daily.expiresAt === null ? missingValue : koreanWallClock(daily.expiresAt),
    size: byteSize(daily.sizeBytes), mediaStatus: daily.status, coverage: daily.coverage,
    gaps: daily.gaps.map(gap => ({ start: koreanWallClock(gap.startsAt), end: koreanWallClock(gap.endsAt) })),
    errorCode: daily.error?.code ?? null,
  };
}

function koreanCalendarDate(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && value.includes("T")
    && !timestamp(`${value.length === 16 ? `${value}:00` : value}+09:00`)) throw new Error("A valid Korean recording date is required.");
  const date = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    ? timestamp(value) ? new Date(Date.parse(value) + 9 * 3_600_000).toISOString().slice(0, 10) : ""
    : /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(value) ? value.slice(0, 10) : "";
  if (!date || !timestamp(`${date}T00:00:00+09:00`)) throw new Error("A valid Korean recording date is required.");
  return date;
}

function dailyDateParameters(query: DateRangeQuery) {
  if (query.eventCategory) throw new Error("Daily recordings do not have an event category.");
  const from = koreanCalendarDate(query.from);
  const inclusiveTo = koreanCalendarDate(query.to);
  if (from > inclusiveTo) throw new Error("Recording dates are reversed.");
  const to = new Date(Date.parse(`${inclusiveTo}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("A valid Korean recording date is required.");
  return new URLSearchParams({ from_date: from, to_date: to, limit: "100" });
}

export function createDailyRecordingApi({ ApiError, cameraId, isAuthenticated, request, serverNow }: DailyRecordingApiOptions) {
  const dailyRequest = async <T>(path: string, init: RequestInit): Promise<T> => {
    try { return await request<T>(path, init); }
    catch (error) {
      if (error instanceof ApiError) throw new ApiError(error.status, "날짜 녹화 요청을 처리하지 못했습니다.", error.code);
      throw error;
    }
  };
  const getDailyRecording = async (recordingId: string, signal?: AbortSignal) => {
    if (!dailyRecordingIdentifier.test(recordingId)) throw new Error("Daily recording requires a UUID identifier.");
    const daily = dailyRecording(await dailyRequest<components["schemas"]["DailyRecording"]>(pathWithId(dailyPaths.detail, recordingId), { signal }), cameraId);
    if (daily.id.toLowerCase() !== recordingId.toLowerCase()) throw new Error("Unexpected daily recording identity.");
    return daily;
  };
  return {
    queryRecordings: async (query: DateRangeQuery, signal?: AbortSignal) => {
      const parameters = dailyDateParameters(query);
      const recordings: Recording[] = [];
      const ids = new Set<string>();
      const cursors = new Set<string>();
      while (true) {
        const page = dailyRecordingPage(await dailyRequest<components["schemas"]["DailyPage"]>(`${dailyPaths.list}?${parameters}`, { signal }), cameraId);
        if (page.items.length > 100) throw new Error("Unexpected daily recording page size.");
        for (const daily of page.items) {
          if (ids.has(daily.id.toLowerCase()) || daily.recordingDate < parameters.get("from_date")! || daily.recordingDate >= parameters.get("to_date")!) {
            throw new Error("Unexpected daily recording page identity or range.");
          }
          ids.add(daily.id.toLowerCase());
          recordings.push(mapDailyRecording(daily, serverNow()));
        }
        if (page.nextCursor === null) break;
        if (cursors.has(page.nextCursor) || cursors.size >= 1000) throw new Error("Unexpected repeated daily recording cursor.");
        cursors.add(page.nextCursor);
        parameters.set("cursor", page.nextCursor);
      }
      return recordings;
    },
    getRecording: async (recordingId: string, signal?: AbortSignal) => mapDailyRecording(await getDailyRecording(recordingId, signal), serverNow()),
    prepareExport: async (recordingId: string, signal?: AbortSignal) => {
      if (!isAuthenticated()) throw new ApiError(401, "다운로드 준비에는 로그인이 필요합니다.");
      const latest = await getDailyRecording(recordingId, signal);
      const availability = dailyRecordingAvailability(latest, serverNow());
      if (availability.downloadReady || availability.exportProcessing) return mapDailyRecording(latest, serverNow());
      if (!availability.canPrepareExport) throw new ApiError(409, "마감된 지난 날짜의 녹화만 다운로드를 준비할 수 있습니다.", "DAILY_EXPORT_UNAVAILABLE");
      const daily = dailyRecording(await dailyRequest<components["schemas"]["DailyRecording"]>(pathWithId(dailyPaths.exports, recordingId), { method: "POST", signal }), cameraId);
      if (daily.id.toLowerCase() !== recordingId.toLowerCase()) throw new Error("Unexpected daily recording export identity.");
      return mapDailyRecording(daily, serverNow());
    },
  };
}

export type DailyRecordingApi = ReturnType<typeof createDailyRecordingApi>;
