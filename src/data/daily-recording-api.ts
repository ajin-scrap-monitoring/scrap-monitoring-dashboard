import type { components, paths } from "../generated/backend-contract";
import type { Recording } from "../domain/dashboard";
import type { DateRangeQuery } from "./dashboard-data-source";
import { record, missingValue, pathWithId, timestamp, wallClock } from "./contract-values";
import {
  dailyAvailableIntervalPage,
  dailyGapPage,
  dailyMetadataPage,
  dailyRecording,
  dailyRecordingAvailability,
  dailyRecordingIdentifier,
  dailyRecordingMetadata,
  type DailyIntervalPage,
  type DailyRecording,
} from "./daily-recordings";
import { byteSize, clockDuration } from "./recording-values";

export type DailyIntervalQuery = {
  cursor?: string;
  limit?: number;
};

type DailyApiError = Error & { status: number; code?: string };
export type DailyRecordingApiOptions = {
  ApiError: new (status: number, message: string, code?: string) => DailyApiError;
  cameraId: string;
  isAuthenticated: () => boolean;
  request: <T>(path: string, init: RequestInit) => Promise<T>;
  serverNow: () => number;
};

const dailyPaths = {
  summaryList: "/api/v2/recordings/daily/summary",
  detailSummary: "/api/v2/recordings/daily/{recording_id}/summary",
  gaps: "/api/v2/recordings/daily/{recording_id}/gaps",
  availableIntervals: "/api/v2/recordings/daily/{recording_id}/available-intervals",
  delete: "/api/v2/recordings/daily/{recording_id}",
  exports: "/api/v2/recordings/daily/{recording_id}/exports",
} as const satisfies Record<string, keyof paths>;

export function mapDailyRecording(daily: DailyRecording, now: number): Recording {
  const availability = dailyRecordingAvailability(daily, now);
  return {
    source: "daily", daily, id: daily.id, date: daily.recordingDate, type: "날짜 녹화",
    detail: `${daily.recordingDate} 날짜 녹화`, sample: false,
    start: wallClock(daily.windowStartsAt, true), end: wallClock(daily.windowEndsAt, true),
    time: "00:00 - 24:00", duration: clockDuration(daily.recordedSeconds),
    contentUrl: availability.playbackReady ? daily.playbackPath ?? undefined : undefined,
    downloadUrl: availability.downloadReady ? daily.downloadPath ?? undefined : undefined,
    status: availability.originalUnavailable ? "expired" : availability.playbackReady ? "available"
      : daily.status === "recording" || daily.status === "finalizing" || (daily.status !== "failed" && daily.playbackState === "pending") ? "processing" : "unavailable",
    tone: daily.status === "failed" || daily.exportState === "failed" ? "error" : daily.hasGaps ? "warning" : "complete",
    codec: missingValue, format: missingValue, frameRate: null, height: null, width: null,
    retentionStartsAt: missingValue,
    retentionEndsAt: daily.status === "deleted" ? "삭제됨"
      : daily.status === "expired" ? "만료됨"
      : daily.expiresAt === null ? missingValue : wallClock(daily.expiresAt, true),
    size: byteSize(daily.sizeBytes), mediaStatus: daily.status, coverage: daily.coverage,
    ...(daily.view === "full" ? {
      gaps: daily.gaps.map(gap => ({ start: wallClock(gap.startsAt, true), end: wallClock(gap.endsAt, true) })),
    } : {}),
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
  const getDailyMetadata = async (recordingId: string, signal?: AbortSignal) => {
    if (!dailyRecordingIdentifier.test(recordingId)) throw new Error("Daily recording requires a UUID identifier.");
    const daily = dailyRecordingMetadata(
      await dailyRequest<components["schemas"]["DailyRecordingMetadata"]>(pathWithId(dailyPaths.detailSummary, recordingId), { signal }),
      cameraId,
    );
    if (daily.id.toLowerCase() !== recordingId.toLowerCase()) throw new Error("Unexpected daily recording identity.");
    return daily;
  };
  const requestIntervalPage = async <Interval>(
    template: typeof dailyPaths.gaps | typeof dailyPaths.availableIntervals,
    parse: (value: unknown, recordingId: string) => DailyIntervalPage<Interval>,
    recordingId: string,
    options: DailyIntervalQuery = {},
    signal?: AbortSignal,
  ): Promise<DailyIntervalPage<Interval>> => {
    if (!dailyRecordingIdentifier.test(recordingId)) throw new Error("Daily recording requires a UUID identifier.");
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Unexpected daily interval page size.");
    const parameters = new URLSearchParams({ limit: String(limit) });
    if (options.cursor !== undefined) {
      if (options.cursor.length === 0 || options.cursor.length > 4096) throw new Error("Unexpected daily interval cursor.");
      parameters.set("cursor", options.cursor);
    }
    const page = parse(
      await dailyRequest<unknown>(`${pathWithId(template, recordingId)}?${parameters}`, { signal }),
      recordingId,
    );
    if (page.items.length > limit) throw new Error("Unexpected daily interval page size.");
    return page;
  };
  return {
    queryRecordings: async (query: DateRangeQuery, signal?: AbortSignal) => {
      const parameters = dailyDateParameters(query);
      const recordings: Recording[] = [];
      const ids = new Set<string>();
      const cursors = new Set<string>();
      while (true) {
        const page = dailyMetadataPage(
          await dailyRequest<components["schemas"]["DailyMetadataPage"]>(`${dailyPaths.summaryList}?${parameters}`, { signal }),
          cameraId,
        );
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
    getRecording: async (recordingId: string, signal?: AbortSignal) => mapDailyRecording(await getDailyMetadata(recordingId, signal), serverNow()),
    getGaps: (recordingId: string, options?: DailyIntervalQuery, signal?: AbortSignal) => requestIntervalPage(dailyPaths.gaps, dailyGapPage, recordingId, options, signal),
    getAvailableIntervals: (recordingId: string, options?: DailyIntervalQuery, signal?: AbortSignal) => requestIntervalPage(
      dailyPaths.availableIntervals,
      dailyAvailableIntervalPage,
      recordingId,
      options,
      signal,
    ),
    deleteRecording: async (recordingId: string, signal?: AbortSignal) => {
      if (!isAuthenticated()) throw new ApiError(401, "날짜 녹화 삭제에는 로그인이 필요합니다.");
      if (!dailyRecordingIdentifier.test(recordingId)) throw new Error("Daily recording requires a UUID identifier.");
      await dailyRequest<undefined>(pathWithId(dailyPaths.delete, recordingId), { method: "DELETE", signal });
    },
    prepareExport: async (recordingId: string, signal?: AbortSignal) => {
      if (!isAuthenticated()) throw new ApiError(401, "다운로드 준비에는 로그인이 필요합니다.");
      const latest = await getDailyMetadata(recordingId, signal);
      const availability = dailyRecordingAvailability(latest, serverNow());
      if (availability.downloadReady || availability.exportProcessing) return mapDailyRecording(latest, serverNow());
      if (!availability.canPrepareExport) throw new ApiError(409, "마감된 지난 날짜의 녹화만 다운로드를 준비할 수 있습니다.", "DAILY_EXPORT_UNAVAILABLE");
      const response = await dailyRequest<components["schemas"]["DailyRecording"] | components["schemas"]["DailyRecordingMetadata"]>(
        pathWithId(dailyPaths.exports, recordingId),
        { method: "POST", signal },
      );
      const daily = record(response) && "revision" in response
        ? dailyRecordingMetadata(response, cameraId)
        : dailyRecording(response, cameraId);
      if (daily.id.toLowerCase() !== recordingId.toLowerCase()) throw new Error("Unexpected daily recording export identity.");
      return mapDailyRecording(daily, serverNow());
    },
  };
}

export type DailyRecordingApi = ReturnType<typeof createDailyRecordingApi>;
