import type { paths } from "../generated/api-contract";
import type { components as BackendComponents, paths as BackendPaths } from "../generated/backend-contract";
import type { DashboardData, DataAreaState, HistoryEventPage, Recording, RecordingList } from "../domain/dashboard";
import { displayTimeOffset } from "../display-time";
import type { DailyRecordingApi } from "./daily-recording-api";
import type { DailyRecordingDeletion, DateRangeQuery, HistoryEventQuery } from "./dashboard-data-source";
import { pathWithId, rfc3339AtOffset, wallClock } from "./contract-values";
import type { ValidationIssue } from "./error-body";
import { eventRecordingIdentifier } from "./recording-values";
import { listEveryPage } from "./list-every-page";
import { maximumHistoryDays } from "./load-history-v2";
import { createRecordingList, recordingsPerPage } from "./recording-list";
import { eventRecordingPage, mapEventRecording, eventReplay, eventExportStatus, type EventExportStatus } from "./event-recordings";
import { historyData, mapEvent, mapRecording } from "./history-recording-mapping";
import { parseDailyMediaInfo, parseClipMediaInfo, type DailyMediaInfoResult, type ClipMediaInfoResult } from "./media-info-cache";
import { parseThumbnailInfo, type ThumbnailInfo, type ThumbnailTarget, isCanonicalUuid } from "./recording-thumbnail";

const API_PATHS = {
  events: "/api/v1/events",
  recording: "/api/v1/recordings/{recordingId}",
  recordings: "/api/v1/recordings",
} as const satisfies Record<string, keyof paths & keyof BackendPaths>;

const V1_MONITORING_PATHS = {
  loadHistory: "/api/v1/history/load",
} as const;

type ApiLoadHistory = BackendComponents["schemas"]["LoadHistory"];
type ApiEventPage = BackendComponents["schemas"]["EventPage"];
type ApiRecording = BackendComponents["schemas"]["Recording"];

export type RecordingsStart = { items: Recording[]; list?: RecordingList; total?: number };

export function toDateTimeInput(value: string) {
  return wallClock(value).replace(" ", "T").slice(0, 16);
}

export function toRfc3339(value: string, offset: string) {
  if (/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    return `${value.length === 16 ? `${value}:00` : value}${offset}`;
  }
  return new Date(value).toISOString();
}

export function emptyHistory(to: string): DashboardData["history"] {
  const from = new Date(new Date(to).getTime() - 7 * 24 * 3_600_000).toISOString();
  return { chartEvents: [], endsAt: toDateTimeInput(to), events: [], loadSamples: [], startsAt: toDateTimeInput(from), thresholds: [] };
}

export function historyBeforeQuery(to: string): DashboardData["history"] {
  return { ...emptyHistory(to), loadState: { status: "loading" }, eventsState: { status: "loading" } };
}

export const historyErrorMessages: Record<string, string> = {
  HISTORY_RANGE_MUST_BE_WITHIN_90_DAYS: "조회 기간은 최대 90일이며 시작 시각이 종료 시각보다 앞서야 합니다. 기간을 조정해 다시 조회하세요.",
  HISTORY_TOO_MANY_POINTS: "조회 구간 수가 응답 한도를 넘습니다. 기간을 줄여 다시 조회하세요.",
  HISTORY_FUTURE_RANGE: "종료 시각이 현재보다 미래입니다. 종료 시각을 현재 이전으로 조정해 다시 조회하세요.",
  HISTORY_TIMEZONE_REQUIRED: "조회 시각에 시간대가 없어 서버가 거절했습니다. 시각을 다시 입력해 조회하세요.",
  HISTORY_TIME_OUT_OF_RANGE: "조회 시각이 서버가 처리할 수 있는 범위를 벗어났습니다. 시각을 조정해 다시 조회하세요.",
  HISTORY_QUERY_TIMEOUT: "서버의 조회 처리 시간이 초과되었습니다. 기간을 줄여 다시 조회하세요.",
  HISTORY_CLIENT_TIMEOUT: "응답이 지연되고 있습니다. 기간을 줄여 다시 조회하세요.",
};

const loadHistoryFailureMessage = "적재율 추이를 불러오지 못했습니다.";

type ApiErrorClass = new (status: number, message: string, code?: string, issues?: ValidationIssue[]) => Error & { status: number; code?: string };

type RecordingsApiContext = {
  ApiError: ApiErrorClass;
  backendContract: boolean;
  cameraId: string;
  collectionThreshold: () => number | undefined;
  isAuthenticated: () => boolean;
  monitoringScope?: () => { pitId?: string; siteId?: string; edgeId?: string } | null;
  optionalArea: <T>(operation: Promise<T>, fallback: T, message: string, signal?: AbortSignal, stale?: boolean) => Promise<{ value: T; state: DataAreaState }>;
  pitId: string;
  request: <T>(path: string, init?: RequestInit & { timeoutMs?: number }) => Promise<T>;
  requestV2LoadHistory: (from: string, to: string, signal?: AbortSignal) => Promise<{ historySamples: DashboardData["history"]["loadSamples"] }>;
  serverNow: () => number;
  supportsDailyRecordings: boolean;
  useV2Monitoring: boolean;
};

const HISTORY_CACHE_TTL_MS = 60_000;
const MAX_HISTORY_CACHE_ENTRIES = 4;

// 이력 이벤트 표와 녹화 목록 및 단건 조회이다. 이력과 녹화 화면에서 처음 쓸 때 불러온다.
export function createRecordingsApi({
  ApiError,
  backendContract,
  cameraId,
  collectionThreshold,
  isAuthenticated,
  monitoringScope,
  optionalArea,
  pitId,
  request,
  requestV2LoadHistory,
  serverNow,
  supportsDailyRecordings,
  useV2Monitoring,
}: RecordingsApiContext) {
  let dailyApiPromise: Promise<DailyRecordingApi> | null = null;
  const historyCache = new Map<string, { samples: DashboardData["history"]["loadSamples"]; timestamp: number }>();

  const getCachedHistory = (key: string): DashboardData["history"]["loadSamples"] | null => {
    const entry = historyCache.get(key);
    if (!entry) return null;
    if (performance.now() - entry.timestamp > HISTORY_CACHE_TTL_MS) {
      historyCache.delete(key);
      return null;
    }
    historyCache.delete(key);
    historyCache.set(key, entry);
    return entry.samples;
  };

  const setCachedHistory = (key: string, samples: DashboardData["history"]["loadSamples"]) => {
    if (historyCache.has(key)) {
      historyCache.delete(key);
    } else if (historyCache.size >= MAX_HISTORY_CACHE_ENTRIES) {
      const oldestKey = historyCache.keys().next().value;
      if (oldestKey !== undefined) historyCache.delete(oldestKey);
    }
    historyCache.set(key, { samples, timestamp: performance.now() });
  };
  const getDailyApi = () => {
    if (!supportsDailyRecordings) throw new ApiError(404, "현재 연결은 날짜 녹화를 지원하지 않습니다.", "UNSUPPORTED_ENDPOINT");
    dailyApiPromise ??= import("./daily-recording-api").then(({ createDailyRecordingApi }) => createDailyRecordingApi({
      ApiError, cameraId, request,
      isAuthenticated,
      serverNow,
    })).catch((error: unknown) => { dailyApiPromise = null; throw error; });
    return dailyApiPromise;
  };

  const queryParameters = (query: DateRangeQuery) => {
    const parameters = new URLSearchParams({ from: toRfc3339(query.from, displayTimeOffset), to: toRfc3339(query.to, displayTimeOffset) });
    if (backendContract) parameters.set("pit_id", pitId);
    if (query.eventCategory) parameters.set(backendContract ? "category" : "eventCategory", query.eventCategory);
    return parameters;
  };

  const queryHistory = async (query: DateRangeQuery, signal?: AbortSignal) => {
    const parameters = queryParameters(query);
    // 이벤트 표는 queryHistoryEvents가 서버 페이지 단위로 조회하므로 여기서는 적재율 이력만 조회한다.
    if (!useV2Monitoring) {
      const load = await request<ApiLoadHistory>(`${V1_MONITORING_PATHS.loadHistory}?${parameters}`, { signal });
      return historyData(load, [], backendContract);
    }
    const from = toRfc3339(query.from, displayTimeOffset);
    const to = toRfc3339(query.to, displayTimeOffset);
    const overRange = Date.parse(to) - Date.parse(from) > maximumHistoryDays * 24 * 3_600_000;

    const scope = monitoringScope?.();
    const cacheKey = `${pitId}:${scope?.siteId ?? ""}:${scope?.edgeId ?? ""}:${from}:${to}`;

    let cachedSamples: DashboardData["history"]["loadSamples"] | null = null;
    if (!overRange) {
      cachedSamples = getCachedHistory(cacheKey);
    }

    let load: { historySamples: DashboardData["history"]["loadSamples"] } | null;
    let loadState: DataAreaState;

    if (cachedSamples !== null) {
      load = { historySamples: cachedSamples };
      loadState = { status: "ready" };
    } else {
      const loadResult = await optionalArea(overRange ? Promise.reject(new ApiError(422, "HISTORY_RANGE_MUST_BE_WITHIN_90_DAYS", "HISTORY_RANGE_MUST_BE_WITHIN_90_DAYS"))
        : requestV2LoadHistory(from, to, signal).then((result) => {
            setCachedHistory(cacheKey, result.historySamples);
            return result;
          }).catch((error: unknown) => {
            if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && historyErrorMessages[error.code]) {
              throw new ApiError((error as { status?: number }).status ?? 500, historyErrorMessages[error.code], error.code);
            }
            throw error;
          }), null, loadHistoryFailureMessage, signal);
      load = loadResult.value;
      loadState = loadResult.state;
    }

    const threshold = collectionThreshold();
    const stateMessage = loadState.code && historyErrorMessages[loadState.code]
      ? historyErrorMessages[loadState.code]
      : loadState.message;
    return {
      ...emptyHistory(to),
      startsAt: toDateTimeInput(from), endsAt: toDateTimeInput(to),
      loadSamples: load?.historySamples ?? [],
      events: [],
      thresholds: threshold === undefined ? [] : [{ hour: 0, value: threshold }],
      loadState: { ...loadState, message: stateMessage, from, to, thresholdKind: "current" as const },
    };
  };

  const queryHistoryEvents = async (query: HistoryEventQuery, signal?: AbortSignal): Promise<HistoryEventPage> => {
    const parameters = queryParameters(query);
    if (backendContract) parameters.set("collection_scope", "all");
    parameters.set("page", String(query.page + 1));
    parameters.set("pageSize", String(query.pageSize));
    const result = await request<ApiEventPage>(`${API_PATHS.events}?${parameters}`, { signal });
    return {
      events: result.items.map((event) => mapEvent(event, backendContract)),
      totalItems: result.page.totalItems,
      totalPages: result.page.totalPages,
      page: query.page,
    };
  };

  const openRecordingList = (query: DateRangeQuery): RecordingList => {
    const source = query.recordingSource;
    const wantDaily = supportsDailyRecordings && (source === "daily" || source === "all");
    const wantEvents = source !== "daily";
    const startOf = (recording: Recording) => Date.parse(recording.daily?.windowStartsAt
      ?? toRfc3339(recording.start.replace(" ", "T"), displayTimeOffset));
    if (!backendContract) {
      // v1 녹화 목록은 서버 페이지 정렬 계약이 없어 전체를 한 번에 가져온다.
      return createRecordingList({ loadDaily: (signal) => queryRecordings(query, signal), startOf });
    }
    return createRecordingList({
      startOf,
      ...(wantDaily && { loadDaily: async (signal?: AbortSignal) => (await getDailyApi()).queryRecordings({ ...query, recordingSource: "daily" }, signal) }),
      ...(wantEvents && { loadEvents: async ({ page, pageSize, snapshotToken, from: tokenFrom, to: tokenTo }, signal?: AbortSignal) => {
        const range = queryParameters(query);
        const from = tokenFrom ?? range.get("from") ?? "";
        const to = tokenTo ?? range.get("to") ?? "";
        if (Date.parse(to) - Date.parse(from) > 90 * 86_400_000) throw new ApiError(422, "이벤트 녹화는 최대 90일 범위까지 조회할 수 있습니다.", "RECORDING_RANGE_TOO_LARGE");
        const parameters = new URLSearchParams({ pit_id: pitId, include_playback: "true" });
        if (query.eventCategory) parameters.set("category", query.eventCategory);
        parameters.set("page", String(page));
        parameters.set("pageSize", String(pageSize));
        if (snapshotToken) {
          parameters.set("snapshot_token", snapshotToken);
          if (from) parameters.set("from", from);
          if (to) parameters.set("to", to);
        } else {
          parameters.set("stable", "true");
          if (from) parameters.set("from", from);
          if (to) parameters.set("to", to);
        }
        const result = eventRecordingPage(await request<unknown>(`/api/v2/recordings/events?${parameters}`, { signal }));
        return {
          totalItems: result.totalItems,
          items: result.items.map((item) => mapEventRecording(item, undefined, null, result.asOf, displayTimeOffset)),
          snapshotToken: result.snapshotToken,
          snapshotExpiresAt: result.snapshotExpiresAt,
          from: result.from,
          to: result.to,
          asOf: result.asOf,
        };
      } }),
    });
  };

  const queryRecordings = async (query: DateRangeQuery, signal?: AbortSignal): Promise<DashboardData["recordings"]> => {
    if (query.recordingSource === "daily") {
      return (await getDailyApi()).queryRecordings(query, signal);
    }
    // 전체 목록이 필요한 호출은 목록 핸들로 모든 서버 페이지를 가져온다.
    if (backendContract) return (await openRecordingList(query).ensure(Number.MAX_SAFE_INTEGER, signal)).items;
    const recordings = await listEveryPage<ApiRecording>(request, `${API_PATHS.recordings}?${queryParameters(query)}`, signal);
    return recordings.map(recording => mapRecording(recording, displayTimeOffset));
  };

  const openFirstRecordings = async (query: DateRangeQuery, signal?: AbortSignal): Promise<RecordingsStart> => {
    const list = openRecordingList(query);
    const first = await list.ensure(recordingsPerPage, signal);
    return { items: first.items, list, total: first.total };
  };

  const getEventRecording = async (eventId: string, signal?: AbortSignal) => {
    if (!eventRecordingIdentifier.test(eventId)) return null;
    const parameters = new URLSearchParams({ pit_id: pitId });
    const { item, replay } = eventReplay(await request<unknown>(`/api/v2/recordings/events/${encodeURIComponent(eventId)}?${parameters}`, { signal }), eventId);
    let retentionEndsAt: string | null = null;
    if (supportsDailyRecordings) {
      const ids = [...new Set(replay.parts.map((part) => part.recordingId))];
      // 보관 만료일만 필요하므로 구간 배열이 큰 날짜 상세 대신 해당 날짜의 요약 목록에서 찾는다.
      const dates = [...new Set(replay.parts.map((part) => part.recordingDate))];
      const summaries = new Map<string, Recording[] | null>(await Promise.all(dates.map(async (date): Promise<[string, Recording[] | null]> => {
        try { return [date, await (await getDailyApi()).queryRecordings({ from: date, to: date, recordingSource: "daily" }, signal)]; }
        catch (error) { if (signal?.aborted) throw error; return [date, null]; }
      })));
      const expirations = ids.map((id) => {
        const date = replay.parts.find((part) => part.recordingId === id)?.recordingDate;
        const recording = date === undefined ? undefined : summaries.get(date)?.find((item) => item.id.toLowerCase() === id.toLowerCase());
        return recording?.daily?.expiresAt ?? null;
      });
      const known = expirations.filter((value): value is string => value !== null);
      if (known.length === ids.length && known.length > 0) retentionEndsAt = known.reduce((earliest, value) => Date.parse(value) < Date.parse(earliest) ? value : earliest);
    }
    return mapEventRecording(item, replay, retentionEndsAt, undefined, displayTimeOffset);
  };

  const getRecording = async (recordingId: string, signal?: AbortSignal, recordingSource: "daily" | "event" = "event") => {
    if (recordingSource === "daily") {
      try { return await (await getDailyApi()).getRecording(recordingId, signal); }
      catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
    }
    if (backendContract) {
      try { return await getEventRecording(recordingId, signal); }
      catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
    }
    try {
      const path = pathWithId(API_PATHS.recording, "recordingId", recordingId);
      const response = await request<ApiRecording>(path, { signal });
      return mapRecording(response, displayTimeOffset);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  };

  const deleteDailyRecording = async (recordingId: string, signal?: AbortSignal): Promise<DailyRecordingDeletion> => {
    const api = await getDailyApi();
    try {
      await api.deleteRecording(recordingId, signal);
      return { outcome: "deleted" };
    } catch (error) {
      if (signal?.aborted || !(error instanceof ApiError) || ![404, 410, 500, 502, 503, 504].includes(error.status)) throw error;
      // 삭제가 반영됐지만 폴더 정리 오류로 5xx를 받은 경우가 있어 상태를 다시 확인한다.
      let remaining: Recording | null = null;
      try { remaining = await api.getRecording(recordingId, signal); }
      catch (lookup) { if (!(lookup instanceof ApiError && (lookup.status === 404 || lookup.status === 410))) throw error; }
      if (remaining === null || remaining.daily?.status === "deleted") return { outcome: "reflected" };
      throw error;
    }
  };

  const prepareDailyRecordingExport = async (recordingId: string, signal?: AbortSignal) => {
    return (await getDailyApi()).prepareExport(recordingId, signal);
  };

  const findEventRecordingExport = async (
    eventId: string,
    options: { beforeSeconds: number; afterSeconds: number },
    signal?: AbortSignal,
  ): Promise<EventExportStatus | null> => {
    const parameters = new URLSearchParams({ before_seconds: String(options.beforeSeconds), after_seconds: String(options.afterSeconds) });
    const response = await request<unknown>(`/api/v2/recordings/events/${encodeURIComponent(eventId)}/exports?${parameters}`, { signal });
    if (response === null) return null;
    const status = eventExportStatus(response);
    if (status.eventId !== eventId) throw new Error("Unexpected event export event identifier.");
    return status;
  };

  const prepareEventRecordingExport = async (
    eventId: string,
    options: { requestId: string; beforeSeconds?: number; afterSeconds?: number; retryFailed?: boolean },
    signal?: AbortSignal,
  ): Promise<EventExportStatus> => {
    const body = JSON.stringify({
      requestId: options.requestId,
      beforeSeconds: options.beforeSeconds ?? 30,
      afterSeconds: options.afterSeconds ?? 30,
      retryFailed: options.retryFailed ?? false,
    });
    const response = await request<unknown>(`/api/v2/recordings/events/${encodeURIComponent(eventId)}/exports`, {
      method: "POST",
      body,
      signal,
    });
    return eventExportStatus(response);
  };

  const getEventRecordingExportStatus = async (
    statusPath: string,
    signal?: AbortSignal,
  ): Promise<EventExportStatus> => {
    const response = await request<unknown>(statusPath, { signal });
    return eventExportStatus(response);
  };

  const getDailyRecordingMediaInfo = async (
    recordingId: string,
    signal?: AbortSignal,
  ): Promise<DailyMediaInfoResult> => {
    const response = await request<unknown>(`/api/v2/recordings/daily/${encodeURIComponent(recordingId)}/media-info`, {
      signal,
      timeoutMs: 30000,
    });
    return parseDailyMediaInfo(response, recordingId);
  };

  const getClipMediaInfo = async (
    clipId: string,
    signal?: AbortSignal,
  ): Promise<ClipMediaInfoResult> => {
    const response = await request<unknown>(`/api/v1/media/clips/${encodeURIComponent(clipId)}/media-info`, {
      signal,
      timeoutMs: 30000,
    });
    return parseClipMediaInfo(response, clipId);
  };

  const getRecordingCoverage = async (recordingId: string, signal?: AbortSignal) => {
    const { clipIdentifier, parseClipCoverage } = await import("./recording-coverage");
    if (!clipIdentifier.test(recordingId)) throw new Error("Recording coverage requires a media clip identifier.");
    return parseClipCoverage(await request<unknown>(`/api/v1/media/clips/${encodeURIComponent(recordingId)}`, { signal }), recordingId, cameraId);
  };

  const getThumbnailInfo = async (
    target: ThumbnailTarget,
    signal?: AbortSignal,
  ): Promise<ThumbnailInfo> => {
    if (!isCanonicalUuid(target.id)) throw new Error("Canonical UUID is required for thumbnail info.");
    const path = target.kind === "clip"
      ? `/api/v1/media/clips/${encodeURIComponent(target.id)}/thumbnail-info`
      : `/api/v2/recordings/daily/${encodeURIComponent(target.id)}/thumbnail-info`;
    const response = await request<unknown>(path, { signal });
    return parseThumbnailInfo(response, target);
  };

  const prepareThumbnail = async (
    target: ThumbnailTarget,
    options?: { retryFailed?: boolean; signal?: AbortSignal },
  ): Promise<ThumbnailInfo> => {
    if (!isCanonicalUuid(target.id)) throw new Error("Canonical UUID is required for thumbnail preparation.");
    const path = target.kind === "clip"
      ? `/api/v1/media/clips/${encodeURIComponent(target.id)}/thumbnail`
      : `/api/v2/recordings/daily/${encodeURIComponent(target.id)}/thumbnail`;
    const body = options?.retryFailed ? JSON.stringify({ retry_failed: true }) : JSON.stringify({});
    const response = await request<unknown>(path, {
      method: "POST",
      body,
      signal: options?.signal,
    });
    return parseThumbnailInfo(response, target);
  };

  const initialHistory = (end: string): DashboardData["history"] => historyBeforeQuery(end);

  const initialHistoryForRoute = (serverTime: string, displayTimeOffset: string, collectionThreshold?: number): DashboardData["history"] => {
    const end = useV2Monitoring
      ? rfc3339AtOffset(Math.floor(Date.parse(serverTime) / 60_000) * 60_000, displayTimeOffset)
      : serverTime;
    const history = historyBeforeQuery(end);
    const withThresholds = useV2Monitoring && collectionThreshold !== undefined ? { ...history, thresholds: [{ hour: 0, value: collectionThreshold }] } : history;
    return withThresholds.loadState?.status === "error"
      ? { ...withThresholds, eventsState: withThresholds.loadState }
      : withThresholds;
  };

  const initialRecordings = async (
    query: DateRangeQuery,
    requestedRecordingId: string | null,
    previousRecordings: Recording[],
    signal?: AbortSignal,
  ): Promise<{ value: RecordingsStart; state: DataAreaState }> => {
    return optionalArea(
      requestedRecordingId
        ? getRecording(requestedRecordingId, signal).then((recording): RecordingsStart => ({ items: recording ? [recording] : [] }))
        : openFirstRecordings(query, signal),
      { items: previousRecordings },
      "녹화 목록을 불러오지 못했습니다.",
      signal,
      previousRecordings.length > 0,
    );
  };

  const initialRecordingsForRoute = async (
    serverTime: string,
    locationSearch: string,
    displayTimeOffset: string,
    previous?: { recordings: Recording[]; source: "daily" | "event" } | null,
    signal?: AbortSignal,
  ): Promise<{ recordings: Recording[]; recordingsList?: RecordingList; recordingsTotal?: number; recordingsSource: "daily" | "event"; recordingsState: DataAreaState; historyEndsAt: string }> => {
    const end = backendContract
      ? rfc3339AtOffset(Math.ceil(new Date(serverTime).getTime() / 60_000) * 60_000, displayTimeOffset)
      : serverTime;
    const start = rfc3339AtOffset(new Date(end).getTime() - 7 * 24 * 3_600_000, displayTimeOffset);
    const search = new URLSearchParams(locationSearch);
    const requestedRecordingId = search.get("recordingId");
    const recordingsSource = supportsDailyRecordings && !requestedRecordingId && search.get("recordingSource") !== "event" ? "daily" : "event";
    const recordingQueryEnd = recordingsSource === "daily" ? serverTime : end;
    const recordingQueryStart = recordingsSource === "daily" ? rfc3339AtOffset(Date.parse(serverTime) - 7 * 86_400_000, displayTimeOffset) : start;
    const previousRecordings = previous?.source === recordingsSource ? previous.recordings : [];
    const result = await initialRecordings({ from: recordingQueryStart, to: recordingQueryEnd, recordingSource: recordingsSource }, requestedRecordingId, previousRecordings, signal);
    return {
      recordings: result.value.items,
      ...(result.value.list && { recordingsList: result.value.list, recordingsTotal: result.value.total }),
      recordingsSource,
      recordingsState: result.state,
      historyEndsAt: toDateTimeInput(end),
    };
  };

  return {
    deleteDailyRecording,
    getRecording,
    getRecordingCoverage,
    getDailyRecordingMediaInfo,
    getClipMediaInfo,
    getThumbnailInfo,
    prepareThumbnail,
    getEventRecordingExportStatus,
    findEventRecordingExport,
    initialHistory,
    initialHistoryForRoute,
    initialRecordings,
    initialRecordingsForRoute,
    openFirstRecordings,
    openRecordingList,
    prepareDailyRecordingExport,
    prepareEventRecordingExport,
    queryHistory,
    queryHistoryEvents,
    queryRecordings,
  };
}
