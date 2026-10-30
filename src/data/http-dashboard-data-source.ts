import type { components, paths } from "../generated/api-contract";
import type { components as BackendComponents, paths as BackendPaths } from "../generated/backend-contract";
import type {
  AlertLevel,
  DashboardData,
  DashboardStatus,
  DataAreaState,
  LidarProfile,
  MeasurementLayoutStatus,
  MonitoringSummary,
  Recording,
  RecordingList,
  UserSession,
} from "../domain/dashboard";

import type {
  DashboardDataRequestOptions,
  DashboardDataSource,
  DashboardDataUpdateListener,
  DailyRecordingDeletion,
  DateRangeQuery,
  HistoryEventQuery,
  NotificationRecipientInput,
  SessionCredentials,
} from "./dashboard-data-source";
import { monitoringV2Data, type ApiMonitoringSnapshotV2 } from "./monitoring-v2";
import { parseCollectionSummaryV2, type CollectionSummary } from "./collection-summary-v2";
import { parseFillForecastV2, type FillForecast } from "./fill-forecast-v2";
import { parseLidarProfilesV2 } from "./lidar-profiles-v2";
import { parseErrorBody, type ParsedErrorBody, type ValidationIssue } from "./error-body";
import { displayTimeOffset } from "../display-time";
import { parseMeasurementLayoutV2 } from "./measurement-layout-v2";
import { parseActiveAlertsV2, type ActiveFillAlerts } from "./active-alerts-v2";
import { updateLoadOneHourAgo } from "./load-one-hour-ago";
import { parseLoadHistoryV2, type LoadHistoryScope } from "./load-history-v2";
import { configuredLiveVideoMode, configuredMonitoringVersion, mjpegPlaybackEnabled, runtimeFeatureSelection, v1MonitoringEnabled, v2MonitoringEnabled, whepPlaybackEnabled } from "../build-features";
import { missingValue, pathWithId, rfc3339AtOffset, timeOnly, timestamp, wallClock } from "./contract-values";

// 관리자 화면 전용 요청과 변환은 해당 화면에서 처음 쓸 때 불러온다.
const loadAdminApi = () => import("./admin-api");

type ApiMonitoringSnapshot = BackendComponents["schemas"]["MonitoringSnapshot"];
type ApiNotificationPage = BackendComponents["schemas"]["NotificationPage"];
type ApiSession = BackendComponents["schemas"]["Session"];

type FetchImplementation = typeof fetch;
type EventSourceFactory = (url: string) => EventSource;
const APPLIED_EVENT_ID_LIMIT = 1024;
const HEADER_NOTIFICATION_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 10_000;
// 90일 적재율 이력은 약 11초가 걸리며 Backend의 처리 상한은 20초이다.
const LOAD_HISTORY_TIMEOUT_MS = 25_000;
const MONITORING_REFRESH_MS = 60_000;
const notificationFailureMessage = "알림을 불러오지 못했습니다.";
export const loadHistoryFailureMessage = "적재율 추이를 불러오지 못했습니다.";
const collectionHistoryFailureMessage = "최근 수거 기록을 불러오지 못했습니다.";

export const API_PATHS = {
  notification: "/api/v1/notifications/{notificationId}",
  notifications: "/api/v1/notifications",
  notificationsReadAll: "/api/v1/notifications/read-all",
  session: "/api/v1/session",
} as const satisfies Record<string, keyof paths & keyof BackendPaths>;

export const V1_MONITORING_PATHS = {
  loadHistory: "/api/v1/history/load",
  events: "/api/v1/monitoring/events",
  snapshot: "/api/v1/monitoring/snapshot",
} as const satisfies Record<string, keyof paths & keyof BackendPaths>;

export class ApiError extends Error {
  readonly code?: string;
  readonly issues?: ValidationIssue[];
  readonly status: number;

  constructor(status: number, message: string, code?: string, issues?: ValidationIssue[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

function receivedSnapshot() {
  return { status: "connected" as const, lastReceivedAt: new Date().toISOString() };
}

function expectedTime(value: string | null | undefined) {
  if (!value) return "예측 없음";
  const match = wallClock(value).match(/^\d{4}-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  return match ? `${Number(match[1])}월 ${Number(match[2])}일 ${match[3]}:${match[4]}` : value;
}

function durationText(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return missingValue;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}시간 ${minutes}분`;
}

function sinceCollection(completedAt: string | null, serverTime: string) {
  if (completedAt === null) return missingValue;
  const elapsed = (Date.parse(serverTime) - Date.parse(completedAt)) / 1000;
  return Number.isFinite(elapsed) && elapsed >= 0 ? durationText(elapsed) : missingValue;
}

type CollectionInsights = {
  collection: CollectionSummary;
  forecast: FillForecast | null;
  profiles: LidarProfile[] | null;
  activeAlerts: ActiveFillAlerts | null;
  layout: MeasurementLayoutStatus | null;
};

function applyForecast(summary: MonitoringSummary, forecast: FillForecast | null, serverTime: string, measuring: boolean) {
  summary.expectedArrivalAt = missingValue;
  summary.remainingTime = missingValue;
  if (!forecast || !measuring || !timestamp(serverTime) || Date.parse(forecast.validUntil) <= Date.parse(serverTime)) return;
  if (forecast.state === "REACHED") {
    summary.expectedArrivalAt = "임계율 도달";
    summary.remainingTime = durationText(0);
  } else if (forecast.state === "AVAILABLE" && forecast.expectedThresholdAt) {
    summary.expectedArrivalAt = expectedTime(forecast.expectedThresholdAt);
    summary.remainingTime = durationText(Math.max(0, Math.floor((Date.parse(forecast.expectedThresholdAt) - Date.parse(serverTime)) / 1000)));
  }
}

function applyCollectionInsights(monitoring: DashboardData["monitoring"], insights: CollectionInsights | null, serverTime: string) {
  const measuring = monitoring.v2?.dataState === "FRESH";
  const { summary } = monitoring;
  applyForecast(summary, insights?.forecast ?? null, serverTime, measuring);
  const collection = insights?.collection ?? null;
  summary.timeSinceCollection = sinceCollection(collection?.lastActivityAt ?? null, serverTime);
  summary.averageCollectionCycle = !collection ? missingValue
    : collection.averageCycleSeconds === null ? "자료 부족" : durationText(collection.averageCycleSeconds);
  monitoring.lidarProfiles = measuring && insights?.profiles ? insights.profiles : [];
  monitoring.measurementLayout = insights ? insights.layout : undefined;
  const reported = insights?.activeAlerts ?? null;
  // evaluationState는 적재율 판정 상태이며 장비와 측정 항목의 표시 여부를 결정하지 않는다.
  const fillCurrent = measuring && reported?.evaluationState === monitoring.v2?.operations?.effectiveState;
  monitoring.alerts = reported?.items
    .filter((alert) => alert.health !== undefined || fillCurrent)
    .map((alert) => ({ ...alert, time: timeOnly(alert.time), ...(alert.startedAt !== undefined && { startedAt: alert.startedAt === null ? null : wallClock(alert.startedAt) }) })) ?? [];
  monitoring.activeAlertsState = reported && {
    evaluationState: fillCurrent ? reported.evaluationState : "UNKNOWN",
    reasonCodes: reported.reasonCodes,
    coverage: reported.coverage,
  };
}

function insightsSignature(monitoring: DashboardData["monitoring"]) {
  return JSON.stringify([monitoring.summary, monitoring.lidarProfiles, monitoring.alerts, monitoring.activeAlertsState, monitoring.measurementLayout]);
}

function alertLevel(severity: "info" | "warning" | "error"): AlertLevel {
  return severity;
}

function systemStatus(status: ApiMonitoringSnapshot["systemStatus"]): DashboardStatus {
  if (status === "collection_required") return "collection-required";
  if (status === "measurement_error") return "measurement-error";
  if (status === "disconnected") return "disconnected";
  if (status === "no_data") return "no-data";
  return "normal";
}

function mapSession(session: ApiSession): UserSession {
  return {
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    user: { ...session.user },
  };
}

function mapLidarProfile(snapshot: ApiMonitoringSnapshot, lidarId: "lidar-1" | "lidar-2") {
  const profile = snapshot.lidarProfiles.find((candidate) => candidate.lidarId === lidarId);
  return {
    average: profile ? `${profile.average.toFixed(1)} m` : "-",
    color: lidarId === "lidar-1" ? "blue" as const : "teal" as const,
    label: lidarId === "lidar-1" ? "LiDAR 1" : "LiDAR 2",
    maximum: profile ? `${profile.maximum.toFixed(1)} m` : "-",
    minimum: profile ? `${profile.minimum.toFixed(1)} m` : "-",
    samples: profile?.samples.map((sample) => ({
      height: sample.valid ? sample.height ?? null : null,
      positionRatio: sample.positionRatio,
    })) ?? [],
  };
}

function notificationData(notifications: ApiNotificationPage | null) {
  return {
    headerNotifications: notifications?.items.map((notification) => ({
      detail: notification.detail,
      id: notification.id,
      level: alertLevel(notification.severity),
      read: (notification.readAt ?? null) !== null,
      time: timeOnly(notification.occurredAt),
      title: notification.title,
    })) ?? [],
    unreadNotificationCount: notifications?.unreadCount ?? 0,
  };
}

function isAuthorizationError(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function areaError(error: unknown, message: string, stale = false): DataAreaState {
  const unsupported = error instanceof ApiError && (error.status === 404 || error.status === 405);
  return {
    status: "error",
    message: unsupported ? `${message} 현재 서버가 조회 경로를 지원하지 않습니다.` : message,
    stale,
    code: error instanceof ApiError ? error.code ?? (unsupported ? "UNSUPPORTED_ENDPOINT" : "HTTP_ERROR")
      : error instanceof TypeError ? "NETWORK_ERROR" : "INVALID_RESPONSE",
    ...(error instanceof ApiError ? { httpStatus: error.status } : {}),
  };
}

function validateNotifications(value: ApiNotificationPage) {
  if (!value || !Array.isArray(value.items) || !Number.isInteger(value.unreadCount) || value.unreadCount < 0
    || value.items.some((notification: ApiNotificationPage["items"][number]) => !notification || typeof notification.id !== "string"
      || typeof notification.title !== "string" || typeof notification.detail !== "string"
      || !["info", "warning", "error"].includes(notification.severity)
      || !timestamp(notification.occurredAt)
      || (notification.readAt != null && !timestamp(notification.readAt)))) {
    throw new Error("Unexpected notification contract.");
  }
  return value;
}

function monitoringData(snapshot: ApiMonitoringSnapshot, notifications: ApiNotificationPage | null): DashboardData["monitoring"] {
  const remainingSeconds = snapshot.summary.expectedThresholdAt
    ? Math.max(0, Math.floor((new Date(snapshot.summary.expectedThresholdAt).getTime() - new Date(snapshot.serverTime).getTime()) / 1000))
    : null;
  return {
    alarmState: null,
    alerts: snapshot.activeAlerts.map((alert) => ({
      detail: alert.detail,
      id: alert.id,
      level: alertLevel(alert.severity),
      time: timeOnly(alert.occurredAt),
      title: alert.title,
    })),
    devices: snapshot.devices.map((device) => ({
      label: device.displayName,
      latency: device.latencyMilliseconds === null || device.latencyMilliseconds === undefined ? "-" : `${device.latencyMilliseconds}ms`,
      received: device.lastReceivedAt ? timeOnly(device.lastReceivedAt, true) : "-",
      status: device.status,
    })),
    ...notificationData(notifications),
    lidarProfiles: [mapLidarProfile(snapshot, "lidar-1"), mapLidarProfile(snapshot, "lidar-2")],
    loadHistory: snapshot.recentLoad.map((sample) => ({
      measuredAt: sample.measuredAt,
      time: timeOnly(sample.measuredAt),
      value: sample.valid ? sample.valuePercent ?? null : null,
    })),
    status: systemStatus(snapshot.systemStatus),
    summary: {
      averageCollectionCycle: durationText(snapshot.summary.averageCollectionCycleSeconds),
      collectionThreshold: snapshot.summary.collectionThresholdPercent,
      expectedArrivalAt: expectedTime(snapshot.summary.expectedThresholdAt),
      loadPercent: snapshot.summary.loadPercent,
      operationState: snapshot.operationState,
      preCollectionAlert: {
        enabled: snapshot.summary.preCollectionAlert.enabled ?? true,
        threshold: snapshot.summary.preCollectionAlert.thresholdPercent,
      },
      loadOneHourAgo: null,
      remainingTime: durationText(remainingSeconds),
      timeSinceCollection: snapshot.summary.lastCollectionAt
        ? durationText(Math.max(0, (new Date(snapshot.serverTime).getTime() - new Date(snapshot.summary.lastCollectionAt).getTime()) / 1000))
        : missingValue,
    },
    videoMode: "webrtc",
    videoStatus: snapshot.video.status ?? "unavailable",
    videoStreamId: snapshot.video.streamId ?? "",
    videoCapturedAt: snapshot.video.capturedAt ?? null,
  };
}

// 목록 핸들은 함수를 가지므로 복제하지 않고 같은 핸들을 공유한다.
function cloneDashboardData(data: DashboardData): DashboardData {
  const { recordingsList, ...rest } = data;
  const copy = structuredClone(rest);
  return recordingsList ? { ...copy, recordingsList } : copy;
}

const readyState: DataAreaState = { status: "ready" };

const emptyAdminData: DashboardData["admin"] = {
  alertSettings: {
    collectionThreshold: 80,
    enabledEventTypes: [],
    maximumRepeatCount: 1,
    preCollectionAlert: { enabled: false, threshold: 70 },
    recoveryNotificationEnabled: false,
    repeatIntervalMinutes: 0,
    sendDelayMinutes: 0,
    version: "",
  },
  preCollectionAlert: { enabled: false, threshold: 70 },
  recipientSettings: {},
  recipients: [],
};

export function createHttpDashboardDataSource({
  eventSourceFactory = (url) => new EventSource(url, { withCredentials: true }),
  fetchImplementation = window.fetch.bind(window),
  locationSearch = () => window.location.search,
  onSessionExpired = () => window.location.assign("/login"),
  route = () => window.location.pathname,
  apiContract = runtimeFeatureSelection ? "proposal" : "backend",
  monitoringVersion = runtimeFeatureSelection ? "v1" : configuredMonitoringVersion,
  pitId = "pit-01",
  cameraId = "camera-main",
  liveVideoMode = runtimeFeatureSelection ? undefined : configuredLiveVideoMode,
}: {
  eventSourceFactory?: EventSourceFactory;
  fetchImplementation?: FetchImplementation;
  locationSearch?: () => string;
  onSessionExpired?: () => void;
  route?: () => string;
  apiContract?: "proposal" | "backend";
  monitoringVersion?: "v1" | "v2";
  pitId?: string;
  cameraId?: string;
  liveVideoMode?: "webrtc" | "mjpeg";
} = {}): DashboardDataSource {
  if ((!v1MonitoringEnabled && monitoringVersion === "v1") || (!v2MonitoringEnabled && monitoringVersion === "v2")) throw new Error("Monitoring version is not enabled in this build.");
  if (!runtimeFeatureSelection && apiContract !== "backend") throw new Error("Production requires the Backend contract.");
  const useV2Monitoring = v2MonitoringEnabled && (!v1MonitoringEnabled || monitoringVersion === "v2");
  const backendContract = !runtimeFeatureSelection || apiContract === "backend";
  const supportsDailyRecordings = backendContract && useV2Monitoring;
  const selectedLiveVideoMode = liveVideoMode ?? (useV2Monitoring ? "mjpeg" : "webrtc");
  if ((!mjpegPlaybackEnabled && selectedLiveVideoMode === "mjpeg") || (!whepPlaybackEnabled && selectedLiveVideoMode === "webrtc")) throw new Error("Live video mode is not enabled in this build.");
  if (useV2Monitoring && selectedLiveVideoMode !== "mjpeg") throw new Error("Monitoring v2 supports only MJPEG live video.");
  let csrfToken = "";
  let currentData: DashboardData | null = null;
  let hasAuthenticatedSession = false;
  let monitoringRevision = 0;
  let notificationRevision = 0;
  let notificationRefreshRequired = false;
  let collectionInsights: CollectionInsights | null = null;
  let collectionRequestedAt = -Infinity;
  let monitoringScope: LoadHistoryScope | null = null;
  let serverClock: { timestamp: number; receivedAt: number } | null = null;
  let notificationActionsController = new AbortController();
  const listeners = new Set<DashboardDataUpdateListener>();
  const resetNotificationActions = () => {
    notificationActionsController.abort();
    notificationActionsController = new AbortController();
  };
  const publishNotifications = () => {
    const data = currentData;
    if (data) listeners.forEach((listener) => listener(cloneDashboardData(data)));
  };
  const pitPath = (path: string) => backendContract
    ? `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ pit_id: pitId })}` : path;
  const snapshotPath = pitPath(useV2Monitoring ? "/api/v2/monitoring/snapshot" : V1_MONITORING_PATHS.snapshot);
  const eventsPath = pitPath(useV2Monitoring ? "/api/v2/monitoring/events" : V1_MONITORING_PATHS.events);
  const mapMonitoring = (snapshot: ApiMonitoringSnapshot | ApiMonitoringSnapshotV2, notifications: ApiNotificationPage | null) => {
    const monitoring = useV2Monitoring
      ? { ...monitoringV2Data(snapshot, pitId), ...notificationData(notifications) }
      : monitoringData(snapshot as ApiMonitoringSnapshot, notifications);
    if (backendContract && !useV2Monitoring) monitoring.videoCapturedAt = null;
    if (mjpegPlaybackEnabled && (!whepPlaybackEnabled || selectedLiveVideoMode === "mjpeg")) {
      monitoring.videoMode = "mjpeg";
      monitoring.videoUrl = `/media/cameras/${encodeURIComponent(cameraId)}/live`;
      monitoring.videoStatus = "available";
    }
    if (monitoring.v2) applyCollectionInsights(monitoring, collectionInsights, snapshot.serverTime);
    if (monitoring.v2) {
      monitoringScope = { pitId, siteId: monitoring.v2.siteId, edgeId: monitoring.v2.edgeId };
      serverClock = { timestamp: Date.parse(snapshot.serverTime), receivedAt: performance.now() };
    }
    return monitoring;
  };

  const request = async <T>(path: string, { timeoutMs = REQUEST_TIMEOUT_MS, ...init }: RequestInit & { timeoutMs?: number } = {}): Promise<T> => {
    const controller = new AbortController();
    let authorizationStatus: number | undefined;
    let rejectDeadline: (error: Error) => void = () => undefined;
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    const abort = () => {
      const error = authorizationStatus ? new ApiError(authorizationStatus, "API authorization failed.")
        : new DOMException("API request aborted.", "AbortError");
      controller.abort(error);
      rejectDeadline(error);
    };
    init.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(() => {
      const error = new ApiError(authorizationStatus ?? 504, "API request timed out.", "REQUEST_TIMEOUT");
      controller.abort(error);
      rejectDeadline(error);
    }, timeoutMs);
    const operation = async () => {
      const checkAbort = () => {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (init.signal?.aborted) throw new DOMException("API request aborted.", "AbortError");
      };
      checkAbort();
      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      if (csrfToken && init.method && init.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
      const response = await fetchImplementation(path, { ...init, signal: controller.signal, credentials: "include", headers });
      checkAbort();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) authorizationStatus = response.status;
        if (response.status === 401 && hasAuthenticatedSession && path !== API_PATHS.session) {
          csrfToken = "";
          hasAuthenticatedSession = false;
          notificationActionsController.abort();
          onSessionExpired();
        }
        let body: ParsedErrorBody = {};
        try { body = parseErrorBody(await response.json()); }
        catch { /* Empty or non-JSON error response. */ }
        checkAbort();
        throw new ApiError(response.status, body.message ?? `API request failed with ${response.status}`, body.code, body.issues);
      }
      const responseText = await response.text();
      checkAbort();
      if (!responseText) return undefined as T;
      return JSON.parse(responseText) as T;
    };
    try { return await Promise.race([operation(), deadline]); }
    finally {
      window.clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
  };

  const getSession = async (signal?: AbortSignal) => {
    try {
      const session = await request<ApiSession>(API_PATHS.session, { signal });
      if (signal?.aborted) throw new DOMException("Session request aborted.", "AbortError");
      csrfToken = session.csrfToken ?? "";
      hasAuthenticatedSession = true;
      return mapSession(session);
    } catch (error) {
      if (signal?.aborted) throw new DOMException("Session request aborted.", "AbortError");
      if (error instanceof ApiError && error.status === 401) {
        csrfToken = "";
        hasAuthenticatedSession = false;
        return null;
      }
      throw error;
    }
  };

  const getNotifications = async (session: UserSession | null, signal?: AbortSignal) => session
    ? validateNotifications(await request<ApiNotificationPage>(`${API_PATHS.notifications}?page=1&pageSize=20`, { signal }))
    : null;

  const optionalArea = async <T>(operation: Promise<T>, fallback: T, message: string, signal?: AbortSignal, stale = false) => {
    try { return { value: await operation, state: { status: "ready" } as DataAreaState }; }
    catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError") || isAuthorizationError(error)) throw error;
      return { value: fallback, state: areaError(error, message, stale) };
    }
  };

  const applyNotificationFailure = (error: unknown) => {
    if (!currentData) return;
    notificationRefreshRequired = true;
    currentData.monitoring.notificationState = areaError(error, notificationFailureMessage, currentData.monitoring.unreadNotificationCount !== null);
  };

  const publishAuthorizationError = (error: ApiError) => {
    if (!currentData) return;
    currentData.authError = { status: error.status === 401 ? 401 : 403,
      message: error.status === 401 ? "로그인이 만료되었습니다." : "조회 권한이 없습니다." };
    publishNotifications();
  };

  const getCollectionSummary = async (signal?: AbortSignal) => {
    collectionRequestedAt = performance.now();
    const optional = <T,>(operation: Promise<T>) => operation.catch((error: unknown) => {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError") || isAuthorizationError(error)) throw error;
      return null;
    });
    const [collection, forecast, profiles, activeAlerts, layout] = await Promise.all([
      request<unknown>(pitPath("/api/v2/monitoring/collection-summary"), { signal }).then((value) => parseCollectionSummaryV2(value, pitId)),
      optional(request<unknown>(pitPath("/api/v2/monitoring/fill-forecast"), { signal }).then((value) => parseFillForecastV2(value, pitId))),
      optional(request<unknown>(pitPath("/api/v2/monitoring/profiles"), { signal }).then((value) => parseLidarProfilesV2(value, pitId))),
      optional(request<unknown>(pitPath("/api/v2/monitoring/active-alerts?scope=ALL"), { signal }).then((value) => parseActiveAlertsV2(value, pitId))),
      optional(request<unknown>(pitPath("/api/v2/monitoring/layout"), { signal }).then((value) => parseMeasurementLayoutV2(value, pitId))),
    ]);
    return { collection, forecast, profiles, activeAlerts, layout };
  };

  const requestV2LoadHistory = async (from: string, to: string, signal?: AbortSignal) => {
    if (!monitoringScope) throw new Error("Monitoring source is not initialized.");
    const scope = { ...monitoringScope };
    const parameters = new URLSearchParams({ pit_id: pitId, from, to });
    const response = await request<unknown>(`/api/v2/monitoring/load-history?${parameters}`, { signal, timeoutMs: LOAD_HISTORY_TIMEOUT_MS })
      .catch((error: unknown) => {
        throw error instanceof ApiError && error.code === "REQUEST_TIMEOUT" ? new ApiError(error.status, error.message, "HISTORY_CLIENT_TIMEOUT") : error;
      });
    const result = parseLoadHistoryV2(response, scope);
    if (monitoringScope.siteId !== scope.siteId || monitoringScope.edgeId !== scope.edgeId) throw new Error("Monitoring source changed during history request.");
    if (Date.parse(result.from) !== Date.parse(from) || Date.parse(result.to) !== Date.parse(to)) throw new Error("Unexpected load history range.");
    return { ...result, monitoringSamples: result.monitoringSamples.map((sample) => ({ ...sample,
      measuredAt: rfc3339AtOffset(Date.parse(sample.measuredAt), displayTimeOffset, true),
      time: timeOnly(rfc3339AtOffset(Date.parse(sample.measuredAt), displayTimeOffset)),
    })) };
  };

  const recentHistory = (to: string, signal?: AbortSignal) => requestV2LoadHistory(
    rfc3339AtOffset(Date.parse(to) - 24 * 3_600_000, displayTimeOffset), to, signal);

  // 이력 이벤트 표와 녹화 조회는 해당 화면에서 처음 쓸 때 불러온 모듈이 처리한다.
  let recordingsApiPromise: Promise<ReturnType<typeof import("./http-recordings-api").createRecordingsApi>> | null = null;
  const recordingsApi = () => {
    recordingsApiPromise ??= import("./http-recordings-api").then(({ createRecordingsApi }) => createRecordingsApi({
      ApiError, backendContract, cameraId,
      collectionThreshold: () => currentData?.monitoring.summary.collectionThreshold,
      isAuthenticated: () => hasAuthenticatedSession && Boolean(csrfToken),
      optionalArea, pitId, request, requestV2LoadHistory,
      serverNow: () => {
        if (!serverClock) throw new Error("A valid server time is required for daily recordings.");
        return serverClock.timestamp + Math.max(0, performance.now() - serverClock.receivedAt);
      },
      supportsDailyRecordings, useV2Monitoring,
    })).catch((error: unknown) => { recordingsApiPromise = null; throw error; });
    return recordingsApiPromise;
  };
  const queryHistory = async (query: DateRangeQuery, signal?: AbortSignal) => (await recordingsApi()).queryHistory(query, signal);
  const queryHistoryEvents = async (query: HistoryEventQuery, signal?: AbortSignal) => (await recordingsApi()).queryHistoryEvents(query, signal);
  const queryRecordings = async (query: DateRangeQuery, signal?: AbortSignal) => (await recordingsApi()).queryRecordings(query, signal);
  const getRecording = async (recordingId: string, signal?: AbortSignal, recordingSource: "daily" | "event" = "event") =>
    (await recordingsApi()).getRecording(recordingId, signal, recordingSource);
  // 목록 핸들은 동기적으로 만들어야 하므로 첫 ensure에서 모듈을 불러와 실제 핸들을 만든다.
  const openRecordingList = (query: DateRangeQuery): RecordingList => {
    let inner: Promise<RecordingList> | null = null;
    return { ensure: async (rank, signal) => (await (inner ??= recordingsApi().then((api) => api.openRecordingList(query)))).ensure(rank, signal) };
  };

  const adminContext = () => ({ pitPath, request });

  const finishNotificationAction = async (ids: Set<string>, session: UserSession | null | undefined, signal: AbortSignal, readAllRevision?: number) => {
    const isCurrentSession = () => currentData?.session === session && hasAuthenticatedSession && !signal.aborted;
    if (!currentData || !session || !isCurrentSession()) return;
    for (const notification of currentData.monitoring.headerNotifications) {
      if (ids.has(notification.id) && !notification.read) {
        notification.read = true;
        if (currentData.monitoring.unreadNotificationCount !== null) {
          currentData.monitoring.unreadNotificationCount = Math.max(0, currentData.monitoring.unreadNotificationCount - 1);
        }
      }
    }
    if (readAllRevision === notificationRevision) currentData.monitoring.unreadNotificationCount = 0;
    notificationRevision += 1;
    notificationRefreshRequired = true;
    publishNotifications();
    while (currentData && isCurrentSession()) {
      const expectedRevision = notificationRevision;
      let notifications: ApiNotificationPage | null;
      try { notifications = await getNotifications(session, signal); }
      catch (error) {
        if (signal.aborted) throw error;
        if (isAuthorizationError(error)) { publishAuthorizationError(error); throw error; }
        applyNotificationFailure(error);
        publishNotifications();
        return;
      }
      if (!currentData || !isCurrentSession() || !notifications) return;
      if (notificationRevision !== expectedRevision) continue;
      currentData.monitoring = { ...currentData.monitoring, ...notificationData(notifications), notificationState: { status: "ready" } };
      notificationRevision += 1;
      notificationRefreshRequired = false;
      publishNotifications();
      return;
    }
  };

  const source: DashboardDataSource = {
    monitoringVersion,
    supportsDailyRecordings,
    supportsEventRecordingRangeLimit: backendContract,
    createNotificationRecipient: async (input: NotificationRecipientInput) => (await loadAdminApi()).createRecipient(adminContext(), input),
    createSession: async (credentials: SessionCredentials) => {
      const body = { ...credentials } satisfies BackendComponents["schemas"]["LoginRequest"] & components["schemas"]["LoginRequest"];
      const session = await request<ApiSession>(API_PATHS.session, { method: "POST", body: JSON.stringify(body) });
      resetNotificationActions();
      csrfToken = session.csrfToken ?? "";
      hasAuthenticatedSession = true;
      return mapSession(session);
    },
    deleteSession: async () => {
      await request<void>(API_PATHS.session, { method: "DELETE" });
      notificationActionsController.abort();
      csrfToken = "";
      hasAuthenticatedSession = false;
    },
    getDashboardData: async (options: DashboardDataRequestOptions = {}) => {
      resetNotificationActions();
      const session = await getSession(options.signal);
      const path = route();
      const monitoringDetails = !["/history", "/recordings", "/admin"].includes(path);
      if (session === null && (useV2Monitoring || (backendContract && path === "/recordings"))) {
        onSessionExpired();
        throw new ApiError(401, "로그인이 필요합니다.");
      }
      const snapshot = await request<ApiMonitoringSnapshot | ApiMonitoringSnapshotV2>(snapshotPath, { signal: options.signal });
      const monitoring = mapMonitoring(snapshot, null);
      const reception = receivedSnapshot();
      const previous = session?.user.id === currentData?.session?.user.id ? currentData : null;
      const previousLoad = previous?.monitoring.v2?.siteId === monitoring.v2?.siteId
        && previous?.monitoring.v2?.edgeId === monitoring.v2?.edgeId ? previous?.monitoring : undefined;
      const previousHistoryThresholds = useV2Monitoring ? [{ hour: 0, value: monitoring.summary.collectionThreshold }] : [];
      const [notificationResult, historyResult, recordingsResult, adminResult, completionResult, recentHistoryResult] = await Promise.all([
        optionalArea(getNotifications(session, options.signal), null, notificationFailureMessage, options.signal, previous?.monitoring.unreadNotificationCount != null),
        path === "/history"
          ? recordingsApi().then((api) => api.initialHistoryForRoute(snapshot.serverTime, displayTimeOffset, monitoring.summary.collectionThreshold))
          : Promise.resolve({ chartEvents: [], endsAt: snapshot.serverTime, events: [], loadSamples: [], startsAt: snapshot.serverTime, thresholds: previousHistoryThresholds } as DashboardData["history"]),
        path === "/recordings"
          ? recordingsApi().then((api) => api.initialRecordingsForRoute(snapshot.serverTime, locationSearch(), displayTimeOffset, previous && previous.recordingsSource ? { recordings: previous.recordings, source: previous.recordingsSource } : null, options.signal))
          : Promise.resolve({ recordings: [] as Recording[], recordingsList: undefined as RecordingList | undefined, recordingsTotal: undefined as number | undefined, recordingsSource: "event" as const, recordingsState: readyState, historyEndsAt: undefined as string | undefined }),
        path === "/admin" && session?.user.role === "administrator"
          ? loadAdminApi().then((api) => api.fetchAdminInitial(adminContext(), options.signal))
          : Promise.resolve(emptyAdminData),
        optionalArea(useV2Monitoring && backendContract && monitoringDetails ? getCollectionSummary(options.signal) : Promise.resolve(null),
          previous ? collectionInsights : null, collectionHistoryFailureMessage, options.signal, previous !== null),
        optionalArea(useV2Monitoring && monitoringDetails ? recentHistory(snapshot.serverTime, options.signal) : Promise.resolve(null), null,
          loadHistoryFailureMessage, options.signal, Boolean(previousLoad?.loadHistory.length)),
      ]);
      Object.assign(monitoring, notificationResult.state.status === "ready"
        ? notificationData(notificationResult.value)
        : { headerNotifications: previous?.monitoring.headerNotifications ?? [], unreadNotificationCount: previous?.monitoring.unreadNotificationCount ?? null });
      monitoring.notificationState = notificationResult.state;
      monitoring.completedCollectionState = completionResult.state;
      if (useV2Monitoring) {
        monitoring.loadHistory = recentHistoryResult.value?.monitoringSamples ?? previousLoad?.loadHistory ?? [];
        monitoring.loadHistoryState = { ...recentHistoryResult.state, from: recentHistoryResult.value?.from, to: recentHistoryResult.value?.to };
      }
      if (options.signal?.aborted) throw new DOMException("Dashboard request aborted.", "AbortError");
      collectionInsights = completionResult.value;
      notificationRefreshRequired = notificationResult.state.status === "error";
      if (monitoring.v2) applyCollectionInsights(monitoring, collectionInsights, snapshot.serverTime);
      updateLoadOneHourAgo(monitoring);
      const nextData: DashboardData = {
        reception,
        admin: adminResult,
        history: recordingsResult.historyEndsAt ? { ...historyResult, endsAt: recordingsResult.historyEndsAt } : historyResult,
        lastMeasuredAt: timeOnly(snapshot.measuredAt, true),
        monitoring,
        recordings: recordingsResult.recordings,
        ...(recordingsResult.recordingsList && { recordingsList: recordingsResult.recordingsList, recordingsTotal: recordingsResult.recordingsTotal }),
        recordingsSource: recordingsResult.recordingsSource,
        recordingsState: recordingsResult.recordingsState,
        session,
      };
      currentData = nextData;
      return cloneDashboardData(nextData);
    },
    getRecording,
    ...(supportsDailyRecordings ? {
      deleteDailyRecording: async (recordingId: string, signal?: AbortSignal): Promise<DailyRecordingDeletion> => (await recordingsApi()).deleteDailyRecording(recordingId, signal),
      prepareDailyRecordingExport: async (recordingId: string, signal?: AbortSignal) => (await recordingsApi()).prepareDailyRecordingExport(recordingId, signal),
    } : {}),
    getRecordingCoverage: async (recordingId, signal) => (await recordingsApi()).getRecordingCoverage(recordingId, signal),
    markAllNotificationsRead: async () => {
      const session = currentData?.session;
      const { signal } = notificationActionsController;
      const ids = new Set(currentData?.monitoring.headerNotifications.map((notification) => notification.id));
      const revision = notificationRevision;
      await request<void>(API_PATHS.notificationsReadAll, { method: "POST", signal });
      await finishNotificationAction(ids, session, signal, revision);
    },
    markNotificationRead: async (notificationId) => {
      const session = currentData?.session;
      const { signal } = notificationActionsController;
      await request(pathWithId(API_PATHS.notification, "notificationId", notificationId), { method: "PATCH", body: JSON.stringify({ read: true }), signal });
      await finishNotificationAction(new Set([notificationId]), session, signal);
    },
    queryHistory,
    queryHistoryEvents,
    queryRecordings,
    openRecordingList,
    replaceAlertSettings: async (settings) => (await loadAdminApi()).replaceAlertSettings(adminContext(), settings),
    sendTestNotification: async (recipientId, channels) => {
      const session = currentData?.session;
      const { signal } = notificationActionsController;
      await (await loadAdminApi()).sendTestNotification(adminContext(), recipientId, channels, signal);
      try { await finishNotificationAction(new Set(), session, signal); }
      catch { /* The accepted request is independent of notification refresh or cancellation. */ }
    },
    subscribe: (listener) => {
      const monitoringDetails = !["/history", "/recordings", "/admin"].includes(route());
      const eventSource = eventSourceFactory(eventsPath);
      listeners.add(listener);
      const appliedEventIds = new Set<string>();
      let active = true;
      let checkingSession = false;
      let refreshingNotifications = false;
      let notificationsRefreshQueued = false;
      let refreshingCollection = false;
      let refreshingLoadHistory = false;
      let synchronizedNotificationId = currentData?.monitoring.v2?.operations?.notificationId ?? null;
      const sessionController = new AbortController();
      const notificationActionScope = notificationActionsController;
      const expireSession = () => {
        if (!active) return;
        active = false;
        sessionController.abort();
        notificationActionScope.abort();
        csrfToken = "";
        hasAuthenticatedSession = false;
        window.clearInterval(historyTimer);
        eventSource.close();
        onSessionExpired();
      };
      const failAuthorization = (error: ApiError) => {
        if (!active || !currentData) return;
        currentData.authError = { status: error.status === 401 ? 401 : 403,
          message: error.status === 401 ? "로그인이 만료되었습니다." : "조회 권한이 없습니다." };
        listener(cloneDashboardData(currentData));
        active = false;
        sessionController.abort();
        notificationActionScope.abort();
        window.clearInterval(historyTimer);
        eventSource.close();
      };
      const refreshRecentLoadHistory = async () => {
        if (!active || !currentData?.monitoring.v2 || !serverClock || refreshingLoadHistory) return;
        refreshingLoadHistory = true;
        const to = rfc3339AtOffset(serverClock.timestamp + performance.now() - serverClock.receivedAt, displayTimeOffset);
        try {
          const load = await recentHistory(to, sessionController.signal);
          if (!active || !currentData) return;
          currentData.monitoring.loadHistory = load.monitoringSamples;
          currentData.monitoring.loadHistoryState = { status: "ready", from: load.from, to: load.to };
          updateLoadOneHourAgo(currentData.monitoring);
          listener(cloneDashboardData(currentData));
        } catch (error) {
          if (isAuthorizationError(error)) { failAuthorization(error); return; }
          if (!active || sessionController.signal.aborted || !currentData) return;
          currentData.monitoring.loadHistoryState = {
            ...areaError(error, loadHistoryFailureMessage, currentData.monitoring.loadHistory.length > 0),
            from: currentData.monitoring.loadHistoryState?.from, to: currentData.monitoring.loadHistoryState?.to,
          };
          updateLoadOneHourAgo(currentData.monitoring);
          listener(cloneDashboardData(currentData));
        } finally { refreshingLoadHistory = false; }
      };
      const historyTimer = useV2Monitoring && monitoringDetails ? window.setInterval(() => {
        void refreshRecentLoadHistory();
        if (backendContract) refreshCompletedCollection();
      }, MONITORING_REFRESH_MS) : undefined;
      const isDuplicate = (event: Event) => {
        if (useV2Monitoring) return false;
        if (!(event instanceof MessageEvent) || !event.lastEventId) return false;
        if (appliedEventIds.has(event.lastEventId)) return true;
        appliedEventIds.add(event.lastEventId);
        if (appliedEventIds.size > APPLIED_EVENT_ID_LIMIT) {
          const oldestEventId = appliedEventIds.values().next().value;
          if (oldestEventId !== undefined) appliedEventIds.delete(oldestEventId);
        }
        return false;
      };
      const refreshV2Notifications = () => {
        notificationsRefreshQueued = true;
        if (refreshingNotifications) return;
        refreshingNotifications = true;
        void (async () => {
          while (active && currentData && notificationsRefreshQueued) {
            notificationsRefreshQueued = false;
            const expectedRevision = notificationRevision;
            const expectedNotificationId = currentData.monitoring.v2?.operations?.notificationId ?? null;
            try {
              const notifications = await getNotifications(currentData.session, sessionController.signal);
              if (!active || !currentData || !notifications) return;
              if (notificationRevision !== expectedRevision) {
                notificationsRefreshQueued = true;
                continue;
              }
              currentData.monitoring = { ...currentData.monitoring, ...notificationData(notifications), notificationState: { status: "ready" } };
              notificationRevision += 1;
              notificationRefreshRequired = false;
              synchronizedNotificationId = expectedNotificationId;
              if ((currentData.monitoring.v2?.operations?.notificationId ?? null) === synchronizedNotificationId) notificationsRefreshQueued = false;
              listener(cloneDashboardData(currentData));
            } catch (error) {
              if (isAuthorizationError(error)) {
                failAuthorization(error);
                return;
              }
              if (sessionController.signal.aborted) return;
              if (active && currentData) {
                applyNotificationFailure(error);
                listener(cloneDashboardData(currentData));
              }
            }
          }
        })().finally(() => { refreshingNotifications = false; });
      };
      const refreshCompletedCollection = () => {
        if (!monitoringDetails || refreshingCollection || performance.now() - collectionRequestedAt < MONITORING_REFRESH_MS) return;
        refreshingCollection = true;
        void (async () => {
          if (active && currentData?.monitoring.v2) {
            try {
              const summary = await getCollectionSummary(sessionController.signal);
              if (!active || !currentData?.monitoring.v2) return;
              collectionInsights = summary;
              const before = insightsSignature(currentData.monitoring);
              applyCollectionInsights(currentData.monitoring, summary, currentData.monitoring.v2.serverTime);
              if (before !== insightsSignature(currentData.monitoring) || currentData.monitoring.completedCollectionState?.status === "error") {
                currentData.monitoring.completedCollectionState = { status: "ready" };
                listener(cloneDashboardData(currentData));
              }
            } catch (error) {
              if (isAuthorizationError(error)) {
                failAuthorization(error);
                return;
              }
              if (sessionController.signal.aborted) return;
              if (active && currentData?.monitoring.v2) {
                currentData.monitoring.completedCollectionState = areaError(error, collectionHistoryFailureMessage, collectionInsights !== null);
                listener(cloneDashboardData(currentData));
              }
            }
          }
        })().finally(() => { refreshingCollection = false; });
      };
      eventSource.addEventListener("monitoring.snapshot", (event) => {
        if (!active || !currentData || !(event instanceof MessageEvent) || isDuplicate(event)) return;
        if (typeof event.data !== "string") return;
        let snapshot: ApiMonitoringSnapshot | ApiMonitoringSnapshotV2;
        let monitoring: DashboardData["monitoring"];
        let measuredAt: string | null;
        try {
          snapshot = JSON.parse(event.data) as typeof snapshot;
          monitoring = mapMonitoring(snapshot, null);
          measuredAt = timeOnly(snapshot.measuredAt, true);
        } catch { return; }
        monitoringRevision += 1;
        if (monitoring.v2) monitoring.v2.streamState = "connected";
        const headerNotifications = currentData.monitoring.headerNotifications;
        const unreadNotificationCount = currentData.monitoring.unreadNotificationCount;
        const sourceChanged = monitoring.v2 && currentData.monitoring.v2
          && (monitoring.v2.siteId !== currentData.monitoring.v2.siteId || monitoring.v2.edgeId !== currentData.monitoring.v2.edgeId);
        currentData = {
          ...currentData,
          reception: receivedSnapshot(),
          lastMeasuredAt: measuredAt,
          monitoring: { ...monitoring, headerNotifications, unreadNotificationCount,
            notificationState: currentData.monitoring.notificationState,
            completedCollectionState: currentData.monitoring.completedCollectionState,
            ...(useV2Monitoring ? { loadHistory: sourceChanged ? [] : currentData.monitoring.loadHistory,
              loadHistoryState: sourceChanged ? { status: "loading" } : currentData.monitoring.loadHistoryState } : {}),
          },
        };
        updateLoadOneHourAgo(currentData.monitoring);
        listener(cloneDashboardData(currentData));
        const notificationId = monitoring.v2?.operations?.notificationId;
        if (notificationRefreshRequired || (notificationId && notificationId !== synchronizedNotificationId)) refreshV2Notifications();
        if (useV2Monitoring && monitoring.v2 && backendContract) refreshCompletedCollection();
        if (useV2Monitoring && monitoringDetails && sourceChanged) void refreshRecentLoadHistory();
      });
      eventSource.addEventListener("error", () => {
        if (!active) return;
        if (currentData) currentData.reception = { ...currentData.reception, status: "error" };
        if (currentData?.monitoring.v2) {
          currentData.monitoring.status = "disconnected";
          if (currentData.monitoring.alarmState) currentData.monitoring.alarmState = "UNKNOWN";
          currentData.monitoring.summary.loadPercent = null;
          currentData.monitoring.v2.streamState = "reconnecting";
          currentData.monitoring.devices = currentData.monitoring.devices.map((device) => ({
            ...device, status: "unknown", statusLabel: "UNKNOWN",
          }));
          updateLoadOneHourAgo(currentData.monitoring);
        }
        if (currentData) listener(cloneDashboardData(currentData));
        if (!backendContract || !hasAuthenticatedSession || checkingSession) return;
        checkingSession = true;
        void getSession(sessionController.signal)
          .then((session) => { if (active && session === null) expireSession(); })
          .catch((error: unknown) => { if (isAuthorizationError(error)) failAuthorization(error); })
          .finally(() => { checkingSession = false; });
      });
      if (v1MonitoringEnabled) eventSource.addEventListener("notification.created", (event) => {
        if (!active || !currentData || !(event instanceof MessageEvent) || isDuplicate(event)) return;
        if (typeof event.data !== "string") return;
        let notification: BackendComponents["schemas"]["Notification"];
        try {
          notification = JSON.parse(event.data) as typeof notification;
          validateNotifications({ items: [notification], unreadCount: 0, page: { page: 1, pageSize: 1, totalItems: 1, totalPages: 1 } });
        } catch { return; }
        if (currentData.monitoring.headerNotifications.some((item) => item.id === notification.id)) return;
        notificationRevision += 1;
        const read = (notification.readAt ?? null) !== null;
        currentData.monitoring.headerNotifications.unshift({
          detail: notification.detail,
          id: notification.id,
          level: alertLevel(notification.severity),
          read,
          time: timeOnly(notification.occurredAt),
          title: notification.title,
        });
        currentData.monitoring.headerNotifications.splice(HEADER_NOTIFICATION_LIMIT);
        if (!read && currentData.monitoring.unreadNotificationCount !== null) currentData.monitoring.unreadNotificationCount += 1;
        listener(cloneDashboardData(currentData));
      });
      eventSource.addEventListener("session.expired", (event) => {
        if (!active || isDuplicate(event)) return;
        expireSession();
      });
      if (v1MonitoringEnabled) eventSource.addEventListener("stream.resync-required", (event) => {
        if (!active || !currentData || isDuplicate(event)) return;
        const expectedMonitoringRevision = monitoringRevision;
        const expectedNotificationRevision = notificationRevision;
        const session = currentData.session;
        void Promise.all([
          request<ApiMonitoringSnapshot | ApiMonitoringSnapshotV2>(snapshotPath, { signal: sessionController.signal }),
          optionalArea(getNotifications(session, sessionController.signal), null, notificationFailureMessage, sessionController.signal,
            currentData.monitoring.unreadNotificationCount !== null),
        ])
          .then(([snapshot, notificationResult]) => {
            if (!active || !currentData) return;
            let changed = false;
            if (expectedMonitoringRevision === monitoringRevision) {
                      currentData = {
                ...currentData,
                reception: receivedSnapshot(),
                lastMeasuredAt: timeOnly(snapshot.measuredAt, true),
                monitoring: {
                  ...mapMonitoring(snapshot, null),
                  headerNotifications: currentData.monitoring.headerNotifications,
                  unreadNotificationCount: currentData.monitoring.unreadNotificationCount,
                  notificationState: currentData.monitoring.notificationState,
                  completedCollectionState: currentData.monitoring.completedCollectionState,
                  ...(useV2Monitoring ? { loadHistory: currentData.monitoring.loadHistory, loadHistoryState: currentData.monitoring.loadHistoryState } : {}),
                },
              };
              monitoringRevision += 1;
              updateLoadOneHourAgo(currentData.monitoring);
              changed = true;
            }
            if (expectedNotificationRevision === notificationRevision) {
              if (notificationResult.state.status === "error") {
                currentData.monitoring.notificationState = notificationResult.state;
                notificationRefreshRequired = true;
              } else if (notificationResult.value) {
                currentData.monitoring = { ...currentData.monitoring, ...notificationData(notificationResult.value), notificationState: { status: "ready" } };
                notificationRevision += 1;
                notificationRefreshRequired = false;
              }
              changed = true;
            }
            if (changed) listener(cloneDashboardData(currentData));
          })
          .catch((error: unknown) => { if (isAuthorizationError(error)) failAuthorization(error); });
      });
      return () => {
        active = false;
        listeners.delete(listener);
        if (listeners.size === 0) notificationActionScope.abort();
        sessionController.abort();
        window.clearInterval(historyTimer);
        eventSource.close();
      };
    },
    updateNotificationRecipient: async (recipient, settings) => (await loadAdminApi()).updateRecipient(adminContext(), recipient, settings),
  };

  return source;
}
