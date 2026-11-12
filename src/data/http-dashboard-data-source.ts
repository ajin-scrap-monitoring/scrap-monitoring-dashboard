import type { components, paths } from "../generated/api-contract";
import type { components as BackendComponents, paths as BackendPaths } from "../generated/backend-contract";
import type {
  AlertLevel,
  DashboardData,
  DashboardStatus,
  DataAreaState,
  LidarProfile,
  LoadHistorySample,
  MeasurementLayoutStatus,
  MonitoringSummary,
  Recording,
  RecordingList,
  UserSession,
} from "../domain/dashboard";

import type {
  DailyRecordingDeletion,
  DashboardDataRequestOptions,
  DashboardDataSource,
  DashboardDataUpdateListener,
  DashboardRoute,
  DashboardRouteData,
  DateRangeQuery,
  HistoryEventQuery,
  MonitoringDetailsActivation,
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
import { parseCameraStatusV2, type CameraStatusV2 } from "./camera-status-v2";
import { updateLoadOneHourAgo } from "./load-one-hour-ago";
import { parseLoadHistoryV2, type LoadHistoryScope } from "./load-history-v2";
import { configuredLiveVideoMode, configuredMonitoringVersion, mjpegPlaybackEnabled, runtimeFeatureSelection, v1MonitoringEnabled, v2MonitoringEnabled, whepPlaybackEnabled } from "../build-features";
import { record, missingValue, pathWithId, rfc3339AtOffset, timeOnly, timestamp, wallClock } from "./contract-values";

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
const LIDAR_PROFILE_REFRESH_MS = 1000;
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

type SnapshotAlerts = { snapshot: NonNullable<DashboardData["monitoring"]["v2"]>; alerts: ActiveFillAlerts };

function applyCollectionInsights(
  monitoring: DashboardData["monitoring"],
  insights: CollectionInsights | null,
  serverTime: string,
  paired: SnapshotAlerts | null,
  profiles: LidarProfile[] | null = null,
) {
  const measuring = monitoring.v2?.dataState === "FRESH";
  const { summary } = monitoring;
  applyForecast(summary, insights?.forecast ?? null, serverTime, measuring);
  const collection = insights?.collection ?? null;
  summary.timeSinceCollection = sinceCollection(collection?.lastActivityAt ?? null, serverTime);
  summary.averageCollectionCycle = !collection ? missingValue
    : collection.averageCycleSeconds === null ? "자료 부족" : durationText(collection.averageCycleSeconds);
  monitoring.lidarProfiles = profiles ? profiles : [];
  monitoring.measurementLayout = insights ? insights.layout : undefined;
  const sameScope = paired && paired.snapshot.siteId === monitoring.v2?.siteId && paired.snapshot.edgeId === monitoring.v2?.edgeId;
  const reported = sameScope ? paired.alerts : null;
  const snapshotEffectiveState = paired?.snapshot.operations?.effectiveState ?? "UNKNOWN";
  const isMismatch = reported !== null && snapshotEffectiveState !== reported.evaluationState;
  monitoring.alerts = reported?.items.map((alert) => ({
    ...alert,
    time: timeOnly(alert.time),
    ...(alert.startedAt !== undefined && { startedAt: alert.startedAt === null ? null : wallClock(alert.startedAt) }),
  })) ?? [];
  monitoring.activeAlertsState = reported && {
    evaluationState: reported.evaluationState,
    reasonCodes: reported.reasonCodes,
    coverage: reported.coverage,
    basis: reported.basis,
    mismatch: isMismatch ? {
      snapshotState: snapshotEffectiveState,
      alertState: reported.evaluationState,
      measuredAt: reported.basis.measuredAt,
      lastEvaluatedAt: reported.basis.lastEvaluatedAt,
      reasonCodes: reported.basis.reasonCodes,
    } : null,
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
  onSessionExpired = () => window.location.assign("/login"),
  apiContract = runtimeFeatureSelection ? "proposal" : "backend",
  monitoringVersion = runtimeFeatureSelection ? "v1" : configuredMonitoringVersion,
  pitId = "pit-01",
  cameraId = "camera-main",
  liveVideoMode = runtimeFeatureSelection ? undefined : configuredLiveVideoMode,
}: {
  eventSourceFactory?: EventSourceFactory;
  fetchImplementation?: FetchImplementation;
  onSessionExpired?: () => void;
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
  let lidarProfilesState: LidarProfile[] | null = null;
  let lidarProfilesController: AbortController | null = null;
  let lidarProfilesTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotAlerts: SnapshotAlerts | null = null;
  let snapshotAlertsAreaState: DataAreaState = { status: "loading" };
  let closeMonitoringStream: (() => void) | null = null;
  let snapshotAlertsSequence = 0;
  let snapshotAlertsInFlight: number | null = null;
  let lastForcedAlertsAt = -Infinity;
  let lastCameraStatus: { status: CameraStatusV2; receivedAt: number } | null = null;
  const cameraListeners = new Set<(status: CameraStatusV2, receivedAt: number) => void>();
  let collectionRequestedAt = -Infinity;
  let lastCollectionSuccessAt = -Infinity;
  let lastLoadHistorySuccessAt = -Infinity;
  let monitoringDetailsRefCount = 0;
  let monitoringDetailsTimer: number | undefined;
  let monitoringDetailsController: AbortController | null = null;
  let refreshingCollection = false;
  let refreshingLoadHistory = false;
  let lastSuccessfulRecordings: { userId?: string; source: "daily" | "event"; recordings: Recording[] } | null = null;
  let dataVersion = 0;
  let getDashboardDataVersion = 0;
  let lastSnapshotServerTime: string | null = null;
  let monitoringScope: LoadHistoryScope | null = null;
  let serverClock: { timestamp: number; receivedAt: number; rawServerTime: string } | null = null;
  let notificationActionsController = new AbortController();
  const listeners = new Set<DashboardDataUpdateListener>();
  const resetNotificationActions = () => {
    notificationActionsController.abort();
    notificationActionsController = new AbortController();
  };
  const publishNotifications = () => {
    const data = currentData;
    if (data) {
      dataVersion += 1;
      listeners.forEach((listener) => listener(cloneDashboardData(data)));
    }
  };

  type LastNormalLoad = {
    loadPercent: number;
    measuredAt: string;
    measuredAtEpoch: number;
    startedAt: number;
  };

  type LastNormalCurve = {
    profile: LidarProfile;
    measuredAt: string;
    measuredAtEpoch: number;
    startedAt: number;
  };

  type LastNormalAverage = {
    average: string;
    measuredAt: string;
    measuredAtEpoch: number;
    startedAt: number;
  };

  let lastNormalLoad: LastNormalLoad | null = null;
  let loadHoldTimer: ReturnType<typeof setTimeout> | undefined;

  const lastNormalCurves = new Map<string, LastNormalCurve>();
  const lastNormalAverages = new Map<string, LastNormalAverage>();
  const profileHoldTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const clearHoldState = () => {
    if (loadHoldTimer !== undefined) {
      clearTimeout(loadHoldTimer);
      loadHoldTimer = undefined;
    }
    lastNormalLoad = null;

    for (const timer of profileHoldTimers.values()) {
      clearTimeout(timer);
    }
    profileHoldTimers.clear();
    lastNormalCurves.clear();
    lastNormalAverages.clear();

    if (currentData?.monitoring) {
      let changed = false;
      if (currentData.monitoring.summary.loadHold) {
        currentData.monitoring.summary.loadPercent = null;
        currentData.monitoring.summary.loadHold = undefined;
        changed = true;
      }
      if (currentData.monitoring.lidarProfiles) {
        for (const profile of currentData.monitoring.lidarProfiles) {
          if (profile.curveHeld) {
            profile.samples = [];
            profile.curveHeld = undefined;
            changed = true;
          }
          if (profile.averageHeld) {
            profile.average = "-";
            profile.averageHeld = undefined;
            changed = true;
          }
        }
      }
      if (changed) publishNotifications();
    }
  };

  const applyLoadHold = (monitoring: DashboardData["monitoring"], snapshot: ApiMonitoringSnapshotV2) => {
    const isFresh = snapshot.dataState === "FRESH";
    const rawLoad = snapshot.summary.loadPercent;
    const hasValidLoad = typeof rawLoad === "number" && Number.isFinite(rawLoad) && rawLoad >= 0 && rawLoad <= 100;
    const measuredAt = snapshot.measuredAt;

    if (isFresh && hasValidLoad) {
      if (measuredAt !== null) {
        const measuredAtEpoch = Date.parse(measuredAt);
        if (lastNormalLoad && measuredAtEpoch < lastNormalLoad.measuredAtEpoch) {
          monitoring.summary.loadPercent = lastNormalLoad.loadPercent;
          monitoring.summary.loadHold = undefined;
          return;
        }
        if (lastNormalLoad && lastNormalLoad.measuredAt === measuredAt) {
          lastNormalLoad.loadPercent = rawLoad;
        } else {
          lastNormalLoad = {
            loadPercent: rawLoad,
            measuredAt,
            measuredAtEpoch,
            startedAt: performance.now(),
          };
        }
      }
      if (loadHoldTimer !== undefined) {
        clearTimeout(loadHoldTimer);
        loadHoldTimer = undefined;
      }
      monitoring.summary.loadPercent = rawLoad;
      monitoring.summary.loadHold = undefined;
      return;
    }

    const isWarmingUnknown = snapshot.dataState === "UNKNOWN"
      && snapshot.summary.filterState === "WARMING"
      && Array.isArray(snapshot.reasonCodes)
      && snapshot.reasonCodes.includes("FILTER_WARMING");

    const now = performance.now();
    if (isWarmingUnknown && lastNormalLoad && now - lastNormalLoad.startedAt < 3000) {
      monitoring.summary.loadPercent = lastNormalLoad.loadPercent;
      monitoring.summary.loadHold = { observedAt: lastNormalLoad.measuredAt };
      if (loadHoldTimer !== undefined) clearTimeout(loadHoldTimer);
      const remaining = Math.max(0, lastNormalLoad.startedAt + 3000 - now);
      loadHoldTimer = setTimeout(() => {
        loadHoldTimer = undefined;
        if (currentData?.monitoring?.summary?.loadHold) {
          currentData.monitoring.summary.loadPercent = null;
          currentData.monitoring.summary.loadHold = undefined;
          publishNotifications();
        }
      }, remaining);
      return;
    }

    if (loadHoldTimer !== undefined) {
      clearTimeout(loadHoldTimer);
      loadHoldTimer = undefined;
    }
    if (!isWarmingUnknown) lastNormalLoad = null;
    monitoring.summary.loadPercent = null;
    monitoring.summary.loadHold = undefined;
  };

  const pitPath = (path: string) => backendContract
    ? `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ pit_id: pitId })}` : path;
  const snapshotPath = pitPath(useV2Monitoring ? "/api/v2/monitoring/snapshot" : V1_MONITORING_PATHS.snapshot);
  const eventsPath = pitPath(useV2Monitoring ? "/api/v2/monitoring/events?include_camera_status=true" : V1_MONITORING_PATHS.events);
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
    if (monitoring.v2) {
      applyLoadHold(monitoring, snapshot as ApiMonitoringSnapshotV2);
      applyCollectionInsights(monitoring, collectionInsights, snapshot.serverTime, snapshotAlerts, lidarProfilesState);
      monitoring.activeAlertsAreaState = snapshotAlertsAreaState;
    }
    if (monitoring.v2) {
      monitoringScope = { pitId, siteId: monitoring.v2.siteId, edgeId: monitoring.v2.edgeId };
      serverClock = { timestamp: Date.parse(snapshot.serverTime), receivedAt: performance.now(), rawServerTime: snapshot.serverTime };
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
    clearHoldState();
    if (!currentData) return;
    currentData.authError = { status: error.status === 401 ? 401 : 403,
      message: error.status === 401 ? "로그인이 만료되었습니다." : "조회 권한이 없습니다." };
    publishNotifications();
  };

  const refreshSnapshotAlerts = async (signal?: AbortSignal) => {
    const sequence = ++snapshotAlertsSequence;
    snapshotAlertsInFlight = sequence;
    const scope = monitoringScope && { ...monitoringScope };
    try {
      const value = await request<unknown>(pitPath("/api/v2/monitoring/snapshot-with-alerts?scope=ALL"), { signal });
      if (!record(value)) throw new Error("Unexpected snapshot-with-alerts contract.");
      const snapshot = monitoringV2Data(value.snapshot, pitId).v2!;
      const alerts = parseActiveAlertsV2(value.activeAlerts, pitId);
      if (!scope || snapshot.siteId !== scope.siteId || snapshot.edgeId !== scope.edgeId
        || snapshot.siteId !== monitoringScope?.siteId || snapshot.edgeId !== monitoringScope?.edgeId
        || snapshot.snapshotId !== alerts.basis.snapshotId || !record(value.activeAlerts)
        || Date.parse(snapshot.serverTime) !== Date.parse(String(value.activeAlerts.computedAt))) {
        throw new Error("Unexpected snapshot-with-alerts basis or source.");
      }
      if (signal?.aborted || sequence !== snapshotAlertsSequence || monitoringDetailsRefCount === 0) return;
      snapshotAlerts = { snapshot, alerts };
      snapshotAlertsAreaState = readyState;
    } catch (error) {
      if (signal?.aborted || sequence !== snapshotAlertsSequence || monitoringDetailsRefCount === 0) return;
      snapshotAlerts = null;
      snapshotAlertsAreaState = areaError(error, "활성 알림을 불러오지 못했습니다.", false);
      if (isAuthorizationError(error)) { publishAuthorizationError(error); return; }
    } finally {
      if (snapshotAlertsInFlight === sequence) snapshotAlertsInFlight = null;
    }
    if (signal?.aborted || sequence !== snapshotAlertsSequence || !currentData?.monitoring.v2) return;
    currentData.monitoring.activeAlertsAreaState = snapshotAlertsAreaState;
    applyCollectionInsights(currentData.monitoring, collectionInsights, currentData.monitoring.v2.serverTime, snapshotAlerts, lidarProfilesState);
    publishNotifications();
  };

  const refreshChangedSnapshotAlerts = (signal?: AbortSignal) => {
    if (!snapshotAlerts || snapshotAlertsInFlight !== null || performance.now() - lastForcedAlertsAt < 5000
      || currentData?.monitoring.v2?.operations?.effectiveState === snapshotAlerts.snapshot.operations?.effectiveState) return;
    lastForcedAlertsAt = performance.now();
    void refreshSnapshotAlerts(signal);
  };

  const getCollectionSummary = async (signal?: AbortSignal): Promise<CollectionInsights> => {
    collectionRequestedAt = performance.now();
    const optional = <T,>(operation: Promise<T>) => operation.catch((error: unknown) => {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError") || isAuthorizationError(error)) throw error;
      return null;
    });
    // 활성 알림은 자기 영역 상태로 따로 반영하므로 현황 본문 표시 조건(이 Promise)에 넣지 않는다.
    void refreshSnapshotAlerts(signal);
    const [collection, forecast, layout] = await Promise.all([
      request<unknown>(pitPath("/api/v2/monitoring/collection-summary"), { signal }).then((value) => parseCollectionSummaryV2(value, pitId)),
      optional(request<unknown>(pitPath("/api/v2/monitoring/fill-forecast"), { signal }).then((value) => parseFillForecastV2(value, pitId))),
      optional(request<unknown>(pitPath("/api/v2/monitoring/layout"), { signal }).then((value) => parseMeasurementLayoutV2(value, pitId))),
    ]);
    return { collection, forecast, layout };
  };

  const lidarProfilesActive = () => backendContract && useV2Monitoring && monitoringDetailsRefCount > 0
    && (typeof document === "undefined" || document.visibilityState !== "hidden");

  const HOLD_MS = 3000;
  const timerKey = (sensorId: string, kind: "curve" | "average") => `${sensorId}:${kind}`;
  const clearProfileTimer = (sensorId: string, kind: "curve" | "average") => {
    const key = timerKey(sensorId, kind);
    const timer = profileHoldTimers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    profileHoldTimers.delete(key);
  };
  const sensorOf = (profile: LidarProfile) => profile.sensorId ?? (profile.label === "LiDAR 1" ? "lidar-a" : "lidar-b");

  // 유지 시간이 끝나면 해당 센서의 유지 항목만 기존 빈 표시로 바꾸고 다른 센서와 유효한 현재 값은 건드리지 않는다.
  const expireProfileHold = (sensorId: string, kind: "curve" | "average") => {
    profileHoldTimers.delete(timerKey(sensorId, kind));
    const target = lidarProfilesState?.find((profile) => sensorOf(profile) === sensorId);
    if (!target) return;
    if (kind === "curve" && target.curveHeld) {
      Object.assign(target, { samples: [], average: "-", minimum: "-", maximum: "-", curveHeld: undefined, averageHeld: undefined });
      clearProfileTimer(sensorId, "average");
    } else if (kind === "average" && target.averageHeld) {
      Object.assign(target, { average: "-", averageHeld: undefined });
    } else return;
    if (!currentData?.monitoring) return;
    currentData.monitoring.lidarProfiles = lidarProfilesState ?? [];
    publishNotifications();
  };
  const scheduleProfileExpiry = (sensorId: string, kind: "curve" | "average", startedAt: number, now: number) => {
    clearProfileTimer(sensorId, kind);
    profileHoldTimers.set(timerKey(sensorId, kind), setTimeout(() => expireProfileHold(sensorId, kind), Math.max(0, startedAt + HOLD_MS - now)));
  };
  const forgetSensorHold = (sensorId: string) => {
    lastNormalCurves.delete(sensorId);
    lastNormalAverages.delete(sensorId);
    clearProfileTimer(sensorId, "curve");
    clearProfileTimer(sensorId, "average");
  };

  // 새 응답을 센서별 표시로 정한다. 유효 곡선과 대표값은 즉시 교체하고, 대표값은 준비 중 사유일 때만 마지막 정상값을 유지한다.
  const resolveProfile = (profile: LidarProfile, now: number): LidarProfile => {
    const sensorId = sensorOf(profile);
    const hasValidPoints = profile.samples.some((sample) => sample.height !== null && sample.positionRatio !== null);
    if (!hasValidPoints) {
      forgetSensorHold(sensorId);
      return { ...profile, samples: [], curveHeld: undefined, averageHeld: undefined };
    }
    clearProfileTimer(sensorId, "curve");
    const epoch = profile.measuredAt ? Date.parse(profile.measuredAt) : Number.NaN;
    const previousCurve = lastNormalCurves.get(sensorId);
    if (previousCurve && Number.isFinite(epoch) && epoch < previousCurve.measuredAtEpoch) {
      return { ...previousCurve.profile, curveHeld: undefined, averageHeld: undefined };
    }
    if (profile.measuredAt && Number.isFinite(epoch)) {
      lastNormalCurves.set(sensorId, previousCurve && previousCurve.measuredAt === profile.measuredAt
        ? { ...previousCurve, profile }
        : { profile, measuredAt: profile.measuredAt, measuredAtEpoch: epoch, startedAt: now });
    }
    if (profile.average !== "-") {
      clearProfileTimer(sensorId, "average");
      if (profile.measuredAt && Number.isFinite(epoch)) {
        const previousAverage = lastNormalAverages.get(sensorId);
        lastNormalAverages.set(sensorId, previousAverage && previousAverage.measuredAt === profile.measuredAt
          ? { ...previousAverage, average: profile.average }
          : { average: profile.average, measuredAt: profile.measuredAt, measuredAtEpoch: epoch, startedAt: now });
      }
      return { ...profile, curveHeld: undefined, averageHeld: undefined };
    }
    const previousAverage = lastNormalAverages.get(sensorId);
    const reasonCodes = profile.reasonCodes ?? [];
    const hasMissing = reasonCodes.includes("HEIGHT_TEMPORAL_MISSING");
    const warming = !hasMissing && reasonCodes.includes("HEIGHT_TEMPORAL_WARMING");
    if (warming && previousAverage && now - previousAverage.startedAt < HOLD_MS) {
      scheduleProfileExpiry(sensorId, "average", previousAverage.startedAt, now);
      return { ...profile, average: previousAverage.average, curveHeld: undefined, averageHeld: true };
    }
    lastNormalAverages.delete(sensorId);
    clearProfileTimer(sensorId, "average");
    return { ...profile, curveHeld: undefined, averageHeld: undefined };
  };

  // 조회 실패(인증 오류 제외)에서만 센서별 마지막 유효 곡선을 시작점부터 3초까지 유지한다.
  const holdProfileAfterFailure = (slot: { sensorId: string; label: string; color: "blue" | "teal" }, now: number): LidarProfile => {
    const previousCurve = lastNormalCurves.get(slot.sensorId);
    if (!previousCurve || now - previousCurve.startedAt >= HOLD_MS) {
      forgetSensorHold(slot.sensorId);
      return { average: "-", color: slot.color, label: slot.label, maximum: "-", minimum: "-", samples: [], sensorId: slot.sensorId, measuredAt: null };
    }
    scheduleProfileExpiry(slot.sensorId, "curve", previousCurve.startedAt, now);
    const previousAverage = lastNormalAverages.get(slot.sensorId);
    const averageHeld = Boolean(previousAverage && now - previousAverage.startedAt < HOLD_MS);
    if (averageHeld && previousAverage) scheduleProfileExpiry(slot.sensorId, "average", previousAverage.startedAt, now);
    else clearProfileTimer(slot.sensorId, "average");
    return { ...previousCurve.profile, average: averageHeld && previousAverage ? previousAverage.average : "-", curveHeld: true, averageHeld: averageHeld || undefined };
  };

  const profileSlots = [
    { sensorId: "lidar-a", label: "LiDAR 1", color: "blue" as const },
    { sensorId: "lidar-b", label: "LiDAR 2", color: "teal" as const },
  ];

  const applyLidarProfiles = (profiles: LidarProfile[] | null, isFailure = false) => {
    const now = performance.now();
    if (profiles !== null) {
      lidarProfilesState = profiles.map((profile) => resolveProfile(profile, now));
    } else if (isFailure) {
      const held = profileSlots.map((slot) => holdProfileAfterFailure(slot, now));
      lidarProfilesState = held.some((profile) => profile.curveHeld) ? held : [];
    } else {
      for (const slot of profileSlots) forgetSensorHold(slot.sensorId);
      lidarProfilesState = null;
    }

    if (!currentData?.monitoring) return;
    const before = insightsSignature(currentData.monitoring);
    currentData.monitoring.lidarProfiles = lidarProfilesState ? lidarProfilesState : [];
    if (before !== insightsSignature(currentData.monitoring)) publishNotifications();
  };

  // 단면 조회는 한 번에 하나만 보내고 응답 뒤 다음 요청을 예약한다. 루프를 멈추면 진행 중 요청을 abort하고 그 응답은 적용하지 않는다.
  const requestLidarProfiles = async (controller: AbortController) => {
    const startedAt = performance.now();
    const current = () => controller === lidarProfilesController && !controller.signal.aborted;
    let response: unknown;
    let requestSucceeded = false;
    try {
      response = await request<unknown>(pitPath("/api/v2/monitoring/profiles"), { signal: controller.signal });
      requestSucceeded = true;
    } catch (error) {
      if (!current()) return;
      if (isAuthorizationError(error)) {
        publishAuthorizationError(error);
        return;
      }
      const isTransientFailure = error instanceof TypeError
        || (error instanceof ApiError && (error.code === "REQUEST_TIMEOUT" || error.status >= 500));
      applyLidarProfiles(null, isTransientFailure);
    }
    if (requestSucceeded) {
      let profiles: ReturnType<typeof parseLidarProfilesV2> | null = null;
      try {
        profiles = parseLidarProfilesV2(response, pitId);
      } catch {
        // 해석 오류는 무효 응답으로 처리한다.
      }
      if (!current()) return;
      applyLidarProfiles(profiles, false);
    }
    if (!current() || !lidarProfilesActive()) return;
    lidarProfilesTimer = setTimeout(() => {
      lidarProfilesTimer = undefined;
      if (current() && lidarProfilesActive()) void requestLidarProfiles(controller);
    }, Math.max(0, LIDAR_PROFILE_REFRESH_MS - (performance.now() - startedAt)));
  };

  const stopLidarProfilesLoop = () => {
    if (lidarProfilesTimer !== undefined) clearTimeout(lidarProfilesTimer);
    lidarProfilesTimer = undefined;
    lidarProfilesController?.abort();
    lidarProfilesController = null;
  };

  // 멈춰 있던 동안의 단면은 최신 관측이 아니므로 새 루프의 첫 응답 전까지 비운다.
  const startLidarProfilesLoop = (): Promise<void> => {
    stopLidarProfilesLoop();
    if (!lidarProfilesActive()) return Promise.resolve();
    applyLidarProfiles(null, false);
    const controller = new AbortController();
    lidarProfilesController = controller;
    return requestLidarProfiles(controller);
  };

  const requestV2LoadHistory = async (from: string, to: string, signal?: AbortSignal) => {
    if (!monitoringScope) throw new Error("Monitoring source is not initialized.");
    const scope = { ...monitoringScope };
    const parameters = new URLSearchParams({ pit_id: pitId, from, to, view: "chart" });
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

  const refreshRecentLoadHistory = async (signal?: AbortSignal) => {
    if (!currentData?.monitoring.v2 || !serverClock || refreshingLoadHistory) return;
    refreshingLoadHistory = true;
    const to = rfc3339AtOffset(serverClock.timestamp + performance.now() - serverClock.receivedAt, displayTimeOffset);
    try {
      const load = await recentHistory(to, signal);
      if (signal?.aborted || !currentData) return;
      lastLoadHistorySuccessAt = performance.now();
      currentData.monitoring.loadHistory = load.monitoringSamples;
      currentData.monitoring.loadHistoryState = { status: "ready", from: load.from, to: load.to };
      updateLoadOneHourAgo(currentData.monitoring);
      publishNotifications();
    } catch (error) {
      if (isAuthorizationError(error)) { publishAuthorizationError(error); return; }
      if (signal?.aborted || !currentData) return;
      currentData.monitoring.loadHistoryState = {
        ...areaError(error, loadHistoryFailureMessage, currentData.monitoring.loadHistory.length > 0),
        from: currentData.monitoring.loadHistoryState?.from, to: currentData.monitoring.loadHistoryState?.to,
      };
      updateLoadOneHourAgo(currentData.monitoring);
      publishNotifications();
    } finally { refreshingLoadHistory = false; }
  };

  const refreshCompletedCollection = async (signal?: AbortSignal) => {
    if (refreshingCollection || performance.now() - collectionRequestedAt < MONITORING_REFRESH_MS) return;
    refreshingCollection = true;
    try {
      if (currentData?.monitoring.v2) {
        const summary = await getCollectionSummary(signal);
        if (signal?.aborted || !currentData?.monitoring.v2) return;
        lastCollectionSuccessAt = performance.now();
        collectionInsights = summary;
        const before = insightsSignature(currentData.monitoring);
        applyCollectionInsights(currentData.monitoring, summary, currentData.monitoring.v2.serverTime, snapshotAlerts, lidarProfilesState);
        if (before !== insightsSignature(currentData.monitoring) || currentData.monitoring.completedCollectionState?.status === "error") {
          currentData.monitoring.completedCollectionState = readyState;
          publishNotifications();
        }
      }
    } catch (error) {
      if (isAuthorizationError(error)) {
        publishAuthorizationError(error);
        return;
      }
      if (signal?.aborted) return;
      if (currentData?.monitoring.v2) {
        currentData.monitoring.completedCollectionState = areaError(error, collectionHistoryFailureMessage, collectionInsights !== null);
        publishNotifications();
      }
    } finally { refreshingCollection = false; }
  };

  // 이력 이벤트 표와 녹화 조회는 해당 화면에서 처음 쓸 때 불러온 모듈이 처리한다.
  let recordingsApiPromise: Promise<ReturnType<typeof import("./http-recordings-api").createRecordingsApi>> | null = null;
  const recordingsApi = () => {
    recordingsApiPromise ??= import("./http-recordings-api").then(({ createRecordingsApi }) => createRecordingsApi({
      ApiError, backendContract, cameraId,
      collectionThreshold: () => currentData?.monitoring.summary.collectionThreshold,
      isAuthenticated: () => hasAuthenticatedSession && Boolean(csrfToken),
      monitoringScope: () => monitoringScope,
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

  const startMonitoringDetailsTimer = () => {
    if (typeof window === "undefined" || monitoringDetailsTimer !== undefined) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    monitoringDetailsTimer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refreshRecentLoadHistory(monitoringDetailsController?.signal);
      if (backendContract) void refreshCompletedCollection(monitoringDetailsController?.signal);
    }, MONITORING_REFRESH_MS);
  };

  const stopMonitoringDetailsTimer = () => {
    if (monitoringDetailsTimer !== undefined) {
      window.clearInterval(monitoringDetailsTimer);
      monitoringDetailsTimer = undefined;
    }
  };

  const monitoringDetailsReferenceTime = (): string | null => {
    if (serverClock && lastLoadHistorySuccessAt === -Infinity) return serverClock.rawServerTime;
    if (serverClock) return rfc3339AtOffset(serverClock.timestamp + performance.now() - serverClock.receivedAt, displayTimeOffset);
    return lastSnapshotServerTime;
  };

  const failLoadHistoryWithoutServerTime = (previousSamples: LoadHistorySample[]) => {
    if (!currentData?.monitoring) return;
    if (previousSamples.length > 0) currentData.monitoring.loadHistory = previousSamples;
    currentData.monitoring.loadHistoryState = {
      ...areaError(new Error("A server time is required for load history."), loadHistoryFailureMessage, previousSamples.length > 0),
      from: currentData.monitoring.loadHistoryState?.from,
      to: currentData.monitoring.loadHistoryState?.to,
    };
    updateLoadOneHourAgo(currentData.monitoring);
    publishNotifications();
  };

  const queryMonitoringDetailsOnResume = (signal: AbortSignal) => {
    const now = performance.now();
    if (backendContract && now - lastCollectionSuccessAt >= MONITORING_REFRESH_MS) {
      void refreshCompletedCollection(signal);
    }
    if (now - lastLoadHistorySuccessAt >= MONITORING_REFRESH_MS) {
      const previousSamples = currentData?.monitoring.loadHistory ?? [];
      if (currentData?.monitoring) {
        currentData.monitoring.loadHistory = [];
        currentData.monitoring.loadHistoryState = { status: "loading" };
        updateLoadOneHourAgo(currentData.monitoring);
        publishNotifications();
      }
      void (async () => {
        const to = monitoringDetailsReferenceTime();
        if (to === null) {
          failLoadHistoryWithoutServerTime(previousSamples);
          return;
        }
        try {
          const load = await recentHistory(to, signal);
          if (signal.aborted) return;
          lastLoadHistorySuccessAt = performance.now();
          if (currentData?.monitoring) {
            currentData.monitoring.loadHistory = load.monitoringSamples;
            currentData.monitoring.loadHistoryState = { status: "ready", from: load.from, to: load.to };
            updateLoadOneHourAgo(currentData.monitoring);
            publishNotifications();
          }
        } catch (error) {
          if (signal.aborted) return;
          if (isAuthorizationError(error)) {
            publishAuthorizationError(error);
            return;
          }
          if (currentData?.monitoring) {
            if (previousSamples.length > 0) {
              currentData.monitoring.loadHistory = previousSamples;
            }
            currentData.monitoring.loadHistoryState = {
              ...areaError(error, loadHistoryFailureMessage, previousSamples.length > 0),
              from: currentData.monitoring.loadHistoryState?.from,
              to: currentData.monitoring.loadHistoryState?.to,
            };
            updateLoadOneHourAgo(currentData.monitoring);
            publishNotifications();
          }
        }
      })();
    }
  };

  const handleMonitoringDetailsVisibility = () => {
    if (typeof document === "undefined" || monitoringDetailsRefCount === 0) return;
    if (document.visibilityState === "hidden") {
      clearHoldState();
      stopMonitoringDetailsTimer();
      stopLidarProfilesLoop();
    } else {
      if (monitoringDetailsController) {
        queryMonitoringDetailsOnResume(monitoringDetailsController.signal);
        void startLidarProfilesLoop();
      }
      startMonitoringDetailsTimer();
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
      clearHoldState();
      notificationActionsController.abort();
      csrfToken = "";
      hasAuthenticatedSession = false;
      closeMonitoringStream?.();
      lastCameraStatus = null;
    },
    getDashboardData: async (options: DashboardDataRequestOptions = {}) => {
      resetNotificationActions();
      const session = await getSession(options.signal);
      if (session === null && useV2Monitoring) {
        onSessionExpired();
        throw new ApiError(401, "로그인이 필요합니다.");
      }
      const snapshot = await request<ApiMonitoringSnapshot | ApiMonitoringSnapshotV2>(snapshotPath, { signal: options.signal });
      lastSnapshotServerTime = snapshot.serverTime;
      const monitoring = mapMonitoring(snapshot, null);
      const reception = receivedSnapshot();
      const previous = session?.user.id === currentData?.session?.user.id ? currentData : null;
      const previousLoad = previous?.monitoring.v2?.siteId === monitoring.v2?.siteId
        && previous?.monitoring.v2?.edgeId === monitoring.v2?.edgeId ? previous?.monitoring : undefined;
      if (!previousLoad) {
        lastLoadHistorySuccessAt = -Infinity;
      }

      monitoring.notificationState = { status: "loading" };
      if (previous) {
        monitoring.headerNotifications = previous.monitoring.headerNotifications;
        monitoring.unreadNotificationCount = previous.monitoring.unreadNotificationCount;
        monitoring.completedCollectionState = previous.monitoring.completedCollectionState;
        monitoring.loadHistory = previousLoad?.loadHistory ?? [];
        monitoring.loadHistoryState = previousLoad?.loadHistoryState;
      } else {
        monitoring.headerNotifications = [];
        monitoring.unreadNotificationCount = null;
      }
      if (monitoring.v2 && collectionInsights) {
        applyCollectionInsights(monitoring, collectionInsights, snapshot.serverTime, snapshotAlerts, lidarProfilesState);
      }
      updateLoadOneHourAgo(monitoring);

      const previousHistoryThresholds = useV2Monitoring ? [{ hour: 0, value: monitoring.summary.collectionThreshold }] : [];
      const defaultHistory: DashboardData["history"] = {
        chartEvents: [],
        endsAt: snapshot.serverTime,
        events: [],
        loadSamples: [],
        startsAt: snapshot.serverTime,
        thresholds: previousHistoryThresholds,
      };

      const nextData: DashboardData = {
        reception,
        admin: emptyAdminData,
        history: defaultHistory,
        lastMeasuredAt: timeOnly(snapshot.measuredAt, true),
        monitoring,
        recordings: [],
        recordingsSource: "event",
        recordingsState: readyState,
        session,
      };
      currentData = nextData;
      getDashboardDataVersion = dataVersion;

      const expectedRevision = notificationRevision;
      const notificationFetchController = new AbortController();
      const onAbort = () => notificationFetchController.abort();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      void (async () => {
        try {
          const notifications = await getNotifications(session, notificationFetchController.signal);
          if (notificationFetchController.signal.aborted || options.signal?.aborted) return;
          if (!currentData || currentData.session?.user.id !== session?.user.id) return;
          if (notificationRevision !== expectedRevision) return;
          currentData.monitoring = {
            ...currentData.monitoring,
            ...notificationData(notifications),
            notificationState: readyState,
          };
          notificationRevision += 1;
          notificationRefreshRequired = false;
          publishNotifications();
        } catch (error) {
          if (notificationFetchController.signal.aborted || options.signal?.aborted) return;
          if (!currentData || currentData.session?.user.id !== session?.user.id) return;
          if (isAuthorizationError(error)) {
            publishAuthorizationError(error);
            return;
          }
          applyNotificationFailure(error);
          publishNotifications();
        } finally {
          options.signal?.removeEventListener("abort", onAbort);
        }
      })();

      if (options.signal?.aborted) throw new DOMException("Dashboard request aborted.", "AbortError");
      return cloneDashboardData(nextData);
    },
    loadRouteData: async (route: DashboardRoute, options: { search: string; signal?: AbortSignal; revalidateSession?: boolean }): Promise<DashboardRouteData> => {
      if (options.signal?.aborted) throw new DOMException("Request aborted.", "AbortError");
      let session = currentData !== null ? currentData.session : await getSession(options.signal);
      if (options.revalidateSession) {
        session = await getSession(options.signal);
        if (session === null) {
          onSessionExpired();
          throw new ApiError(401, "로그인이 필요합니다.");
        }
        csrfToken = session.csrfToken ?? "";
        hasAuthenticatedSession = true;
        if (currentData && JSON.stringify(currentData.session) !== JSON.stringify(session)) {
          currentData.session = session;
          publishNotifications();
        }
      }
      if (session === null && backendContract && route === "recordings") {
        onSessionExpired();
        throw new ApiError(401, "로그인이 필요합니다.");
      }
      const serverNowIso = (useV2Monitoring && serverClock)
        ? rfc3339AtOffset(serverClock.timestamp + Math.max(0, performance.now() - serverClock.receivedAt), displayTimeOffset)
        : lastSnapshotServerTime;
      if (!serverNowIso) {
        throw new Error("A valid server time is required to load route data.");
      }

      if (route === "history") {
        const api = await recordingsApi();
        if (options.signal?.aborted) throw new DOMException("Request aborted.", "AbortError");
        const threshold = currentData?.monitoring.summary.collectionThreshold;
        const history = api.initialHistoryForRoute(serverNowIso, displayTimeOffset, threshold);
        if (options.signal?.aborted) throw new DOMException("Request aborted.", "AbortError");
        return { history };
      }

      if (route === "recordings") {
        const api = await recordingsApi();
        if (options.signal?.aborted) throw new DOMException("Request aborted.", "AbortError");
        const fallback = (lastSuccessfulRecordings && lastSuccessfulRecordings.userId === session?.user.id)
          ? { recordings: lastSuccessfulRecordings.recordings, source: lastSuccessfulRecordings.source }
          : null;
        const result = await api.initialRecordingsForRoute(serverNowIso, options.search, displayTimeOffset, fallback, options.signal);
        if (options.signal?.aborted) throw new DOMException("Request aborted.", "AbortError");
        if (result.recordingsState.status === "ready") {
          lastSuccessfulRecordings = { userId: session?.user.id, source: result.recordingsSource, recordings: result.recordings };
        }
        const historyEndsAt = result.historyEndsAt;
        const threshold = currentData?.monitoring.summary.collectionThreshold;
        const thresholds = useV2Monitoring && threshold !== undefined ? [{ hour: 0, value: threshold }] : [];
        const history = historyEndsAt ? {
          chartEvents: [],
          endsAt: historyEndsAt,
          events: [],
          loadSamples: [],
          startsAt: serverNowIso,
          thresholds,
        } : undefined;
        return {
          recordings: result.recordings,
          ...(result.recordingsList && { recordingsList: result.recordingsList, recordingsTotal: result.recordingsTotal }),
          recordingsSource: result.recordingsSource,
          recordingsState: result.recordingsState,
          ...(history && { history }),
        };
      }

      if (route === "admin") {
        if (session?.user.role === "administrator") {
          const api = await loadAdminApi();
          if (options.signal?.aborted) throw new DOMException("Request aborted.", "AbortError");
          const admin = await api.fetchAdminInitial(adminContext(), options.signal);
          if (options.signal?.aborted) throw new DOMException("Request aborted.", "AbortError");
          return { admin };
        }
        return { admin: emptyAdminData };
      }

      return {};
    },
    isMonitoringDetailsReady: (): boolean => {
      if (!useV2Monitoring || !backendContract) return true;
      return performance.now() - lastCollectionSuccessAt < MONITORING_REFRESH_MS;
    },
    activateMonitoringDetails: (): MonitoringDetailsActivation => {
      if (!useV2Monitoring) {
        return { ready: Promise.resolve(), release: () => {} };
      }
      monitoringDetailsRefCount += 1;
      if (monitoringDetailsRefCount === 1) {
        monitoringDetailsController = new AbortController();
        startMonitoringDetailsTimer();
        if (typeof document !== "undefined") {
          document.addEventListener("visibilitychange", handleMonitoringDetailsVisibility);
        }
      }
      const signal = monitoringDetailsController!.signal;

      let collectionReady: Promise<void>;
      if (backendContract) {
        const elapsed = performance.now() - lastCollectionSuccessAt;
        if (elapsed < MONITORING_REFRESH_MS) {
          collectionReady = Promise.resolve();
        } else {
          collectionReady = (async () => {
            try {
              const summary = await getCollectionSummary(signal);
              if (signal.aborted) return;
              lastCollectionSuccessAt = performance.now();
              collectionInsights = summary;
              if (currentData?.monitoring) {
                applyCollectionInsights(currentData.monitoring, summary, currentData.monitoring.v2?.serverTime ?? "", snapshotAlerts, lidarProfilesState);
                currentData.monitoring.completedCollectionState = readyState;
                publishNotifications();
              }
            } catch (error) {
              if (signal.aborted) return;
              if (isAuthorizationError(error)) {
                publishAuthorizationError(error);
              } else if (currentData?.monitoring) {
                currentData.monitoring.completedCollectionState = areaError(error, collectionHistoryFailureMessage, collectionInsights !== null);
                publishNotifications();
              }
            }
          })();
        }
      } else {
        collectionReady = Promise.resolve();
      }

      const profileReady = lidarProfilesController ? Promise.resolve() : startLidarProfilesLoop();

      const ready = Promise.all([collectionReady, profileReady]).then(() => undefined);

      const loadHistoryElapsed = performance.now() - lastLoadHistorySuccessAt;
      if (loadHistoryElapsed >= MONITORING_REFRESH_MS) {
        const previousSamples = currentData?.monitoring.loadHistory ?? [];
        if (currentData?.monitoring) {
          currentData.monitoring.loadHistory = [];
          currentData.monitoring.loadHistoryState = { status: "loading" };
          updateLoadOneHourAgo(currentData.monitoring);
          publishNotifications();
        }
        void (async () => {
          const to = monitoringDetailsReferenceTime();
          if (to === null) {
            failLoadHistoryWithoutServerTime(previousSamples);
            return;
          }
          try {
            const load = await recentHistory(to, signal);
            if (signal.aborted) return;
            lastLoadHistorySuccessAt = performance.now();
            if (currentData?.monitoring) {
              currentData.monitoring.loadHistory = load.monitoringSamples;
              currentData.monitoring.loadHistoryState = { status: "ready", from: load.from, to: load.to };
              updateLoadOneHourAgo(currentData.monitoring);
              publishNotifications();
            }
          } catch (error) {
            if (signal.aborted) return;
            if (isAuthorizationError(error)) {
              publishAuthorizationError(error);
              return;
            }
            if (currentData?.monitoring) {
              if (previousSamples.length > 0) {
                currentData.monitoring.loadHistory = previousSamples;
              }
              currentData.monitoring.loadHistoryState = {
                ...areaError(error, loadHistoryFailureMessage, previousSamples.length > 0),
                from: currentData.monitoring.loadHistoryState?.from,
                to: currentData.monitoring.loadHistoryState?.to,
              };
              updateLoadOneHourAgo(currentData.monitoring);
              publishNotifications();
            }
          }
        })();
      }

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        monitoringDetailsRefCount -= 1;
        if (monitoringDetailsRefCount === 0) {
          clearHoldState();
          stopMonitoringDetailsTimer();
          stopLidarProfilesLoop();
          if (typeof document !== "undefined") {
            document.removeEventListener("visibilitychange", handleMonitoringDetailsVisibility);
          }
          monitoringDetailsController?.abort();
          monitoringDetailsController = null;
          snapshotAlertsSequence += 1;
          snapshotAlertsInFlight = null;
        }
      };

      return { ready, release };
    },
    getRecording,
    ...(supportsDailyRecordings ? {
      deleteDailyRecording: async (recordingId: string, signal?: AbortSignal): Promise<DailyRecordingDeletion> => (await recordingsApi()).deleteDailyRecording(recordingId, signal),
      prepareDailyRecordingExport: async (recordingId: string, signal?: AbortSignal) => (await recordingsApi()).prepareDailyRecordingExport(recordingId, signal),
    } : {}),
    findEventRecordingExport: async (eventId, options, signal) => (await recordingsApi()).findEventRecordingExport(eventId, options, signal),
    prepareEventRecordingExport: async (eventId, options, signal) => (await recordingsApi()).prepareEventRecordingExport(eventId, options, signal),
    getEventRecordingExportStatus: async (statusPath, signal) => (await recordingsApi()).getEventRecordingExportStatus(statusPath, signal),
    getDailyRecordingMediaInfo: async (recordingId, signal) => (await recordingsApi()).getDailyRecordingMediaInfo(recordingId, signal),
    getClipMediaInfo: async (clipId, signal) => (await recordingsApi()).getClipMediaInfo(clipId, signal),
    ...(useV2Monitoring ? {
      getThumbnailInfo: async (target, signal) => (await recordingsApi()).getThumbnailInfo(target, signal),
      prepareThumbnail: async (target, options) => (await recordingsApi()).prepareThumbnail(target, options),
      subscribeCameraStatus: (listener: (status: CameraStatusV2, receivedAt: number) => void) => {
        cameraListeners.add(listener);
        if (lastCameraStatus) listener(lastCameraStatus.status, lastCameraStatus.receivedAt);
        return () => { cameraListeners.delete(listener); };
      },
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
      const deliveryId = await (await loadAdminApi()).sendTestNotification(adminContext(), recipientId, channels, signal);
      try { await finishNotificationAction(new Set(), session, signal); }
      catch { /* The accepted request is independent of notification refresh or cancellation. */ }
      return deliveryId;
    },
    getEmailDelivery: async (id, signal) => {
      return (await loadAdminApi()).getEmailDelivery(adminContext(), id, signal);
    },
    subscribe: (listener) => {
      const eventSource = eventSourceFactory(eventsPath);
      listeners.add(listener);
      if (dataVersion > getDashboardDataVersion && currentData) {
        listener(cloneDashboardData(currentData));
      }
      const appliedEventIds = new Set<string>();
      let active = true;
      let checkingSession = false;
      let refreshingNotifications = false;
      let notificationsRefreshQueued = false;
      let synchronizedNotificationId = currentData?.monitoring.v2?.operations?.notificationId ?? null;
      const sessionController = new AbortController();
      const notificationActionScope = notificationActionsController;
      closeMonitoringStream = () => {
        active = false;
        sessionController.abort();
        notificationActionScope.abort();
        eventSource.close();
      };
      const expireSession = () => {
        if (!active) return;
        active = false;
        clearHoldState();
        sessionController.abort();
        notificationActionScope.abort();
        csrfToken = "";
        hasAuthenticatedSession = false;
        lastCameraStatus = null;
        eventSource.close();
        onSessionExpired();
      };
      const failAuthorization = (error: ApiError) => {
        if (!active || !currentData) return;
        clearHoldState();
        currentData.authError = { status: error.status === 401 ? 401 : 403,
          message: error.status === 401 ? "로그인이 만료되었습니다." : "조회 권한이 없습니다." };
        listener(cloneDashboardData(currentData));
        active = false;
        sessionController.abort();
        notificationActionScope.abort();
        eventSource.close();
      };
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
      if (useV2Monitoring) eventSource.addEventListener("monitoring.camera-status", (event) => {
        if (!active || !hasAuthenticatedSession || !(event instanceof MessageEvent) || typeof event.data !== "string") return;
        let status: CameraStatusV2;
        try { status = parseCameraStatusV2(JSON.parse(event.data), pitId); }
        catch { return; }
        lastCameraStatus = { status, receivedAt: performance.now() };
        cameraListeners.forEach((subscriber) => subscriber(status, lastCameraStatus!.receivedAt));
      });
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
        if (sourceChanged) lastLoadHistorySuccessAt = -Infinity;
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
        const detailsVisible = typeof document === "undefined" || document.visibilityState !== "hidden";
        if (detailsVisible && useV2Monitoring && monitoring.v2 && backendContract && monitoringDetailsRefCount > 0 && monitoringDetailsController) {
          // 60초가 지난 상세를 먼저 갱신한다. 이 갱신이 결합 조회를 시작하면 판정 변경 재조회는 생략된다.
          void refreshCompletedCollection(monitoringDetailsController.signal);
          refreshChangedSnapshotAlerts(monitoringDetailsController.signal);
        }
        if (detailsVisible && useV2Monitoring && monitoringDetailsRefCount > 0 && sourceChanged && monitoringDetailsController) {
          void refreshRecentLoadHistory(monitoringDetailsController.signal);
        }
      });
      eventSource.addEventListener("error", () => {
        if (!active) return;
        if (loadHoldTimer !== undefined) {
          clearTimeout(loadHoldTimer);
          loadHoldTimer = undefined;
        }
        lastNormalLoad = null;
        if (currentData) currentData.reception = { ...currentData.reception, status: "error" };
        if (currentData?.monitoring.v2) {
          currentData.monitoring.status = "disconnected";
          if (currentData.monitoring.alarmState) currentData.monitoring.alarmState = "UNKNOWN";
          currentData.monitoring.summary.loadPercent = null;
          currentData.monitoring.summary.loadHold = undefined;
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
        eventSource.close();
      };
    },
    updateNotificationRecipient: async (recipient, settings) => (await loadAdminApi()).updateRecipient(adminContext(), recipient, settings),
  };

  return source;
}
