import type { components, paths } from "../generated/api-contract";
import type { components as BackendComponents, paths as BackendPaths } from "../generated/backend-contract";
import type {
  AlertLevel,
  AlertSettings,
  DashboardData,
  DashboardStatus,
  DataAreaState,
  EventCategory,
  EventTone,
  HistoryEvent,
  NotificationRecipient,
  RecipientSettings,
  Recording,
  UserSession,
} from "../domain/dashboard";

import type {
  DashboardDataRequestOptions,
  DashboardDataSource,
  DashboardDataUpdateListener,
  DateRangeQuery,
  NotificationRecipientInput,
  SessionCredentials,
} from "./dashboard-data-source";
import { monitoringV2Data, type ApiMonitoringSnapshotV2 } from "./monitoring-v2";
import { updateLoadOneHourAgo } from "./load-one-hour-ago";
import { parseLoadHistoryV2, type LoadHistoryScope } from "./load-history-v2";
import type { DailyRecordingApi } from "./daily-recording-api";
import { configuredLiveVideoMode, configuredMonitoringVersion, mjpegPlaybackEnabled, runtimeFeatureSelection, v1MonitoringEnabled, v2MonitoringEnabled, whepPlaybackEnabled } from "../build-features";
import { timestamp } from "./contract-values";

type ApiAlertSettings = BackendComponents["schemas"]["AlertSettings"];
type ApiEventPage = BackendComponents["schemas"]["EventPage"];
type ApiEvent = ApiEventPage["items"][number];
type ApiLoadHistory = BackendComponents["schemas"]["LoadHistory"];
type ApiMonitoringSnapshot = BackendComponents["schemas"]["MonitoringSnapshot"];
type ApiNotificationPage = BackendComponents["schemas"]["NotificationPage"];
type ApiRecipient = BackendComponents["schemas"]["NotificationRecipient"];
type ApiRecipientPage = BackendComponents["schemas"]["NotificationRecipientPage"];
type ApiRecording = BackendComponents["schemas"]["Recording"];
type ApiRecordingPage = BackendComponents["schemas"]["RecordingPage"];
type ApiSession = BackendComponents["schemas"]["Session"];

type FetchImplementation = typeof fetch;
type EventSourceFactory = (url: string) => EventSource;
const APPLIED_EVENT_ID_LIMIT = 1024;
const HEADER_NOTIFICATION_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 10_000;
const MONITORING_REFRESH_MS = 60_000;
const missingValue = "정보 없음";
const notificationFailureMessage = "알림을 불러오지 못했습니다.";
const loadHistoryFailureMessage = "적재율 추이를 불러오지 못했습니다.";
const collectionHistoryFailureMessage = "최근 수거 완료 기록을 불러오지 못했습니다.";

const API_PATHS = {
  alertSettings: "/api/v1/settings/alerts",
  events: "/api/v1/events",
  notification: "/api/v1/notifications/{notificationId}",
  notificationRecipient: "/api/v1/notification-recipients/{recipientId}",
  notificationRecipients: "/api/v1/notification-recipients",
  notifications: "/api/v1/notifications",
  notificationsReadAll: "/api/v1/notifications/read-all",
  recording: "/api/v1/recordings/{recordingId}",
  recordings: "/api/v1/recordings",
  session: "/api/v1/session",
  testNotification: "/api/v1/notifications/test",
} as const satisfies Record<string, keyof paths & keyof BackendPaths>;

const V1_MONITORING_PATHS = {
  loadHistory: "/api/v1/history/load",
  events: "/api/v1/monitoring/events",
  snapshot: "/api/v1/monitoring/snapshot",
} as const satisfies Record<string, keyof paths & keyof BackendPaths>;

function pathWithId(path: string, parameter: string, value: string) {
  return path.replace(`{${parameter}}`, encodeURIComponent(value));
}

export class ApiError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function wallClock(value: string | null, includeSeconds = false) {
  if (value === null) return missingValue;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return value;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}${includeSeconds ? `:${match[6] ?? "00"}` : ""}`;
}

function timeOnly(value: string | null, includeSeconds = false) {
  if (value === null) return missingValue;
  return wallClock(value, includeSeconds).split(" ")[1] ?? value;
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

function clockDuration(seconds: number | null) {
  if (seconds === null) return missingValue;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function byteSize(bytes: number | null) {
  if (bytes === null) return missingValue;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function sameOriginResourcePath(value: string | null | undefined) {
  if (value == null) return undefined;
  const resource = new URL(value, window.location.origin);
  if (!value.startsWith("/") || resource.origin !== window.location.origin) {
    throw new Error("Recording resource path must use the dashboard origin");
  }
  return `${resource.pathname}${resource.search}${resource.hash}`;
}

function timeOffset(value: string) {
  return value.match(/(?:Z|[+-]\d{2}:\d{2})$/i)?.[0] ?? "Z";
}

function rfc3339AtOffset(timestamp: number, offset: string, preserveMilliseconds = false) {
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  const offsetMinutes = match
    ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0;
  const suffix = match ? offset : "Z";
  const iso = new Date(timestamp + offsetMinutes * 60_000).toISOString();
  return preserveMilliseconds ? iso.replace(/Z$/, suffix) : iso.replace(/\.\d{3}Z$/, suffix);
}

function toDateTimeInput(value: string) {
  return wallClock(value).replace(" ", "T").slice(0, 16);
}

function toRfc3339(value: string, offset: string) {
  if (/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    return `${value.length === 16 ? `${value}:00` : value}${offset}`;
  }
  return new Date(value).toISOString();
}

function eventCategoryLabel(category: EventCategory) {
  return category === "collection" ? "수거" as const : category === "alert" ? "알림" as const : "오류" as const;
}

function eventTone(category: EventCategory, status?: ApiEvent["status"]): EventTone {
  if (category === "error") return "error";
  if (category === "collection" || status === "completed") return "complete";
  return "warning";
}

function historyMarkerPresentation(type: ApiLoadHistory["eventMarkers"][number]["type"]) {
  if (type === "collection_required") return { color: "#f58a07", label: "수거 필요" as const };
  if (type === "collection_completed") return { color: "#0aa45b", label: "수거 완료" as const };
  return { color: "#e83232", label: "오류" as const };
}

function alertLevel(severity: "info" | "warning" | "error"): AlertLevel {
  return severity;
}

function eventStatus(status: ApiEvent["status"]) {
  if (status === "completed") return "완료";
  if (status === "resolved") return "해제";
  return "발생";
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

function mapAlertSettings(settings: ApiAlertSettings): AlertSettings {
  return {
    collectionThreshold: settings.collectionThresholdPercent,
    enabledEventTypes: (settings.eventTypes ?? ["collection_required", "measurement_error", "device_error"]).filter((type): type is AlertSettings["enabledEventTypes"][number] =>
      type === "collection_required" || type === "measurement_error" || type === "device_error"),
    maximumRepeatCount: settings.maximumRepeatCount ?? 3,
    preCollectionAlert: {
      enabled: settings.preCollectionAlert.enabled ?? true,
      threshold: settings.preCollectionAlert.thresholdPercent,
    },
    recoveryNotificationEnabled: settings.recoveryNotificationEnabled ?? true,
    repeatIntervalMinutes: settings.repeatIntervalMinutes ?? 30,
    sendDelayMinutes: settings.sendDelayMinutes ?? 0,
    version: settings.version,
  };
}

function recipientSettings(recipient: ApiRecipient): RecipientSettings {
  return {
    collection: recipient.eventTypes.includes("collection_required"),
    device: recipient.eventTypes.includes("device_error"),
    email: recipient.channels.includes("email"),
    enabled: recipient.enabled ?? true,
    error: recipient.eventTypes.includes("measurement_error"),
    sms: recipient.channels.includes("sms"),
    useGlobal: (recipient.subscriptionMode ?? "global") === "global",
  };
}

function mapRecipient(recipient: ApiRecipient): NotificationRecipient {
  return {
    channel: recipient.channels.map((channel) => channel === "email" ? "이메일" : "문자").join(", ") || "-",
    email: recipient.email,
    enabled: recipient.enabled ?? true,
    id: recipient.id,
    name: recipient.name,
    phone: recipient.phone ?? "-",
    team: recipient.team,
    version: recipient.version,
  };
}

function mapRecipientResult(recipient: ApiRecipient) {
  return {
    recipient: mapRecipient(recipient),
    settings: recipientSettings(recipient),
  };
}

function recipientPreferences(settings: RecipientSettings) {
  const channels: ApiRecipient["channels"][number][] = [
    settings.email ? "email" : null,
    settings.sms ? "sms" : null,
  ].filter((value): value is ApiRecipient["channels"][number] => value !== null);
  const eventTypes: ApiRecipient["eventTypes"][number][] = [
    settings.collection ? "collection_required" : null,
    settings.error ? "measurement_error" : null,
    settings.device ? "device_error" : null,
  ].filter((value): value is ApiRecipient["eventTypes"][number] => value !== null);
  return {
    channels,
    enabled: settings.enabled,
    eventTypes,
    subscriptionMode: settings.useGlobal ? "global" as const : "custom" as const,
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

function mapEvent(event: ApiEvent, backendRecords = false): HistoryEvent {
  return {
    content: event.detail || event.title,
    title: event.title,
    detail: event.detail,
    id: event.id,
    recordingId: event.recordingId ?? null,
    status: backendRecords ? event.type === "collection_completed" && event.status === "completed" ? "완료" : null : eventStatus(event.status),
    time: wallClock(event.occurredAt),
    tone: backendRecords && event.category !== "collection" ? event.severity === "error" ? "error" : "warning" : eventTone(event.category, event.status),
    type: eventCategoryLabel(event.category),
  };
}

function mapRecording(recording: ApiRecording, offset?: string): Recording {
  const atOffset = (value: string | null) => value === null || offset === undefined ? value : rfc3339AtOffset(Date.parse(value), offset, true);
  const startedAt = atOffset(recording.startedAt);
  const endedAt = atOffset(recording.endedAt);
  const date = wallClock(startedAt, true).split(" ")[0];
  const status = recording.status ?? "unavailable";
  const available = status === "available" && (recording.mediaStatus == null || recording.mediaStatus === "ready");
  return {
    source: "event",
    codec: recording.videoCodec?.toUpperCase() || missingValue,
    contentUrl: available ? sameOriginResourcePath(recording.contentPath) : undefined,
    date,
    detail: recording.detail || recording.title,
    downloadUrl: available ? sameOriginResourcePath(recording.downloadPath) : undefined,
    duration: clockDuration(recording.durationSeconds),
    end: wallClock(endedAt, true),
    format: recording.containerFormat?.toUpperCase() || missingValue,
    frameRate: recording.frameRate ?? null,
    height: recording.heightPixels ?? null,
    id: recording.id,
    retentionEndsAt: wallClock(atOffset(recording.retainedUntil), true),
    retentionStartsAt: wallClock(atOffset(recording.retainedFrom), true),
    sample: false,
    size: byteSize(recording.sizeBytes),
    start: wallClock(startedAt, true),
    status: status === "available" && !available ? "unavailable" : status,
    thumbnailUrl: sameOriginResourcePath(recording.thumbnailPath),
    time: `${timeOnly(startedAt)} - ${timeOnly(endedAt)}`,
    tone: eventTone(recording.eventCategory),
    type: eventCategoryLabel(recording.eventCategory),
    width: recording.widthPixels ?? null,
    mediaStatus: recording.mediaStatus,
    coverage: recording.coverage,
    gaps: recording.gaps?.map((gap) => ({ start: wallClock(atOffset(gap.start_at), true), end: wallClock(atOffset(gap.end_at), true) })),
    errorCode: recording.errorCode,
  };
}

function historyData(load: ApiLoadHistory, events: readonly ApiEvent[], backendRecords = false): DashboardData["history"] {
  const origin = new Date(load.from).getTime();
  const hour = (value: string) => (new Date(value).getTime() - origin) / 3_600_000;
  return {
    chartEvents: load.eventMarkers.map((event) => ({
      ...historyMarkerPresentation(event.type),
      detail: event.detail,
      hour: hour(event.occurredAt),
      id: event.id,
      time: wallClock(event.occurredAt),
      value: event.valuePercent,
    })),
    endsAt: toDateTimeInput(load.to),
    events: events.map(event => mapEvent(event, backendRecords)),
    loadSamples: load.samples.map((sample) => ({ hour: hour(sample.measuredAt),
      value: sample.valid && typeof sample.valuePercent === "number" && Number.isFinite(sample.valuePercent) ? sample.valuePercent : null })),
    startsAt: toDateTimeInput(load.from),
    thresholds: load.collectionThresholds.map((sample) => ({ hour: hour(sample.effectiveAt), value: sample.valuePercent })),
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

function emptyHistory(to: string): DashboardData["history"] {
  const offset = timeOffset(to);
  const from = rfc3339AtOffset(new Date(to).getTime() - 7 * 24 * 3_600_000, offset);
  return { chartEvents: [], endsAt: toDateTimeInput(to), events: [], loadSamples: [], startsAt: toDateTimeInput(from), thresholds: [] };
}

function emptyAlertSettings(): AlertSettings {
  return {
    collectionThreshold: 80,
    enabledEventTypes: [],
    maximumRepeatCount: 1,
    preCollectionAlert: { enabled: false, threshold: 70 },
    recoveryNotificationEnabled: false,
    repeatIntervalMinutes: 0,
    sendDelayMinutes: 0,
    version: "",
  };
}

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
  let displayTimeOffset = "Z";
  let hasAuthenticatedSession = false;
  let monitoringRevision = 0;
  let notificationRevision = 0;
  let notificationRefreshRequired = false;
  let completedCollectionAt: string | null = null;
  let collectionRequestedAt = -Infinity;
  let monitoringScope: LoadHistoryScope | null = null;
  let serverClock: { timestamp: number; receivedAt: number } | null = null;
  let dailyApiPromise: Promise<DailyRecordingApi> | null = null;
  let notificationActionsController = new AbortController();
  const listeners = new Set<DashboardDataUpdateListener>();
  const resetNotificationActions = () => {
    notificationActionsController.abort();
    notificationActionsController = new AbortController();
  };
  const publishNotifications = () => {
    const data = currentData;
    if (data) listeners.forEach((listener) => listener(structuredClone(data)));
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
    if (monitoring.v2) monitoring.summary.timeSinceCollection = sinceCollection(completedCollectionAt, snapshot.serverTime);
    if (monitoring.v2) {
      monitoringScope = { pitId, siteId: monitoring.v2.siteId, edgeId: monitoring.v2.edgeId };
      serverClock = { timestamp: Date.parse(snapshot.serverTime), receivedAt: performance.now() };
    }
    return monitoring;
  };

  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
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
    }, REQUEST_TIMEOUT_MS);
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
        let detail: { code?: string; detail?: string; title?: string; error?: { code?: string; message?: string } } = {};
        try {
          const payload: unknown = await response.json();
          if (payload && typeof payload === "object") detail = payload;
        } catch { /* Empty or non-JSON error response. */ }
        checkAbort();
        const code = detail.code ?? detail.error?.code ?? (detail.detail === "MONITORING_SOURCE_NOT_CONFIGURED" ? detail.detail : undefined);
        throw new ApiError(response.status, typeof detail.detail === "string" ? detail.detail : detail.error?.message ?? detail.title ?? `API request failed with ${response.status}`, code);
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

  const getCompletedCollectionAt = async (signal?: AbortSignal) => {
    collectionRequestedAt = performance.now();
    const result = await request<unknown>(pitPath(`${API_PATHS.events}?category=collection&page=1&pageSize=1`), { signal });
    if (!result || typeof result !== "object" || !("items" in result) || !Array.isArray(result.items) || result.items.length > 1) throw new Error("Unexpected collection history contract.");
    const row: unknown = result.items[0];
    if (row === undefined) return null;
    if (!row || typeof row !== "object" || !("type" in row) || row.type !== "collection_completed"
      || !("category" in row) || row.category !== "collection" || !("status" in row) || row.status !== "completed"
      || !("occurredAt" in row) || typeof row.occurredAt !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(row.occurredAt) || !Number.isFinite(Date.parse(row.occurredAt))) {
      throw new Error("Unexpected collection history contract.");
    }
    return row.occurredAt;
  };

  const listEveryPage = async <TPage extends { readonly items: readonly unknown[]; readonly page: { readonly totalPages: number } }, TItem>(
    path: string,
    signal?: AbortSignal,
  ) => {
    const items: TItem[] = [];
    let page = 1;
    while (true) {
      const separator = path.includes("?") ? "&" : "?";
      const result = await request<TPage>(`${path}${separator}page=${page}&pageSize=100`, { signal });
      items.push(...result.items as readonly TItem[]);
      if (page >= result.page.totalPages) break;
      page += 1;
    }
    return items;
  };

  const queryParameters = (query: DateRangeQuery) => {
    const parameters = new URLSearchParams({ from: toRfc3339(query.from, displayTimeOffset), to: toRfc3339(query.to, displayTimeOffset) });
    if (backendContract) parameters.set("pit_id", pitId);
    if (query.eventCategory) parameters.set(backendContract ? "category" : "eventCategory", query.eventCategory);
    return parameters;
  };

  const requestV2LoadHistory = async (from: string, to: string, signal?: AbortSignal) => {
    if (!monitoringScope) throw new Error("Monitoring source is not initialized.");
    const scope = { ...monitoringScope };
    const parameters = new URLSearchParams({ pit_id: pitId, from, to });
    const result = parseLoadHistoryV2(await request<unknown>(`/api/v2/monitoring/load-history?${parameters}`, { signal }), scope);
    if (monitoringScope.siteId !== scope.siteId || monitoringScope.edgeId !== scope.edgeId) throw new Error("Monitoring source changed during history request.");
    if (Date.parse(result.from) !== Date.parse(from) || Date.parse(result.to) !== Date.parse(to)) throw new Error("Unexpected load history range.");
    return { ...result, monitoringSamples: result.monitoringSamples.map((sample) => ({ ...sample,
      measuredAt: rfc3339AtOffset(Date.parse(sample.measuredAt), displayTimeOffset, true),
      time: timeOnly(rfc3339AtOffset(Date.parse(sample.measuredAt), displayTimeOffset)),
    })) };
  };

  const recentHistory = (to: string, signal?: AbortSignal) => requestV2LoadHistory(
    rfc3339AtOffset(Date.parse(to) - 24 * 3_600_000, displayTimeOffset), to, signal);

  const queryHistory = async (query: DateRangeQuery, signal?: AbortSignal) => {
    const parameters = queryParameters(query);
    if (!useV2Monitoring) {
      const [load, events] = await Promise.all([
        request<ApiLoadHistory>(`${V1_MONITORING_PATHS.loadHistory}?${parameters}`, { signal }),
        listEveryPage<ApiEventPage, ApiEvent>(`${API_PATHS.events}?${parameters}`, signal),
      ]);
      return historyData(load, events, backendContract);
    }
    const from = toRfc3339(query.from, displayTimeOffset);
    const to = toRfc3339(query.to, displayTimeOffset);
    const unsupported = Date.parse(to) - Date.parse(from) > 7 * 24 * 3_600_000;
    const [loadResult, eventsResult] = await Promise.all([
      unsupported ? Promise.resolve({ value: null, state: { status: "unsupported" as const, message: "v2 적재율 추이는 최대 7일까지 조회할 수 있습니다." } })
        : optionalArea(requestV2LoadHistory(from, to, signal), null, loadHistoryFailureMessage, signal),
      optionalArea(listEveryPage<ApiEventPage, ApiEvent>(`${API_PATHS.events}?${parameters}`, signal), [], "운영 이력을 불러오지 못했습니다.", signal),
    ]);
    const load = loadResult.value;
    const history = emptyHistory(to);
    return {
      ...history,
      startsAt: toDateTimeInput(from), endsAt: toDateTimeInput(to),
      loadSamples: load?.historySamples ?? [],
      events: eventsResult.value.map((event) => mapEvent(event, backendContract)),
      thresholds: currentData ? [{ hour: 0, value: currentData.monitoring.summary.collectionThreshold }] : [],
      loadState: { ...loadResult.state, from, to, thresholdKind: "current" as const },
      eventsState: eventsResult.state,
    };
  };

  const queryRecordings = async (query: DateRangeQuery, signal?: AbortSignal) => {
    if (query.recordingSource === "daily") {
      return (await getDailyApi()).queryRecordings(query, signal);
    }
    const recordings = await listEveryPage<ApiRecordingPage, ApiRecording>(`${API_PATHS.recordings}?${queryParameters(query)}`, signal);
    return recordings.map(recording => mapRecording(recording, displayTimeOffset));
  };

  const getDailyApi = () => {
    if (!supportsDailyRecordings) throw new ApiError(404, "현재 연결은 날짜 녹화를 지원하지 않습니다.", "UNSUPPORTED_ENDPOINT");
    dailyApiPromise ??= import("./daily-recording-api").then(({ createDailyRecordingApi }) => createDailyRecordingApi({
      ApiError, cameraId, request,
      isAuthenticated: () => hasAuthenticatedSession && Boolean(csrfToken),
      serverNow: () => {
        if (!serverClock) throw new Error("A valid server time is required for daily recordings.");
        return serverClock.timestamp + Math.max(0, performance.now() - serverClock.receivedAt);
      },
    })).catch((error: unknown) => { dailyApiPromise = null; throw error; });
    return dailyApiPromise;
  };

  const getRecording = async (recordingId: string, signal?: AbortSignal, recordingSource: "daily" | "event" = "event") => {
    if (recordingSource === "daily") {
      try { return await (await getDailyApi()).getRecording(recordingId, signal); }
      catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
    }
    try {
      const path = pathWithId(API_PATHS.recording, "recordingId", recordingId);
      return mapRecording(await request<ApiRecording>(path, { signal }), displayTimeOffset);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  };

  const getRecipients = async (session: UserSession | null, signal?: AbortSignal) => {
    if (session?.user.role !== "administrator") return { recipients: [], settings: {} as Record<string, RecipientSettings> };
    const apiRecipients = await listEveryPage<ApiRecipientPage, ApiRecipient>(API_PATHS.notificationRecipients, signal);
    return {
      recipients: apiRecipients.map(mapRecipient),
      settings: Object.fromEntries(apiRecipients.map((recipient) => [recipient.email, recipientSettings(recipient)])),
    };
  };

  const getAlertSettings = async (session: UserSession | null, signal?: AbortSignal) => session?.user.role === "administrator"
    ? mapAlertSettings(await request<ApiAlertSettings>(pitPath(API_PATHS.alertSettings), { signal }))
    : emptyAlertSettings();

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
    createNotificationRecipient: async (input: NotificationRecipientInput) => {
      const body = {
        ...recipientPreferences(input.settings),
        email: input.recipient.email,
        name: input.recipient.name,
        phone: input.recipient.phone === "-" ? null : input.recipient.phone,
        team: input.recipient.team,
      } satisfies BackendComponents["schemas"]["NotificationRecipientCreate"] & components["schemas"]["NotificationRecipientCreate"];
      return mapRecipientResult(await request<ApiRecipient>(API_PATHS.notificationRecipients, { method: "POST", body: JSON.stringify(body) }));
    },
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
      displayTimeOffset = timeOffset(snapshot.serverTime);
      const end = backendContract && (!useV2Monitoring || path === "/recordings")
        ? rfc3339AtOffset(Math.ceil(new Date(snapshot.serverTime).getTime() / 60_000) * 60_000, displayTimeOffset)
        : useV2Monitoring ? rfc3339AtOffset(path === "/history"
          ? Math.floor(Date.parse(snapshot.serverTime) / 60_000) * 60_000 : Date.parse(snapshot.serverTime), displayTimeOffset) : snapshot.serverTime;
      const start = rfc3339AtOffset(new Date(end).getTime() - 7 * 24 * 3_600_000, displayTimeOffset);
      const requestedRecordingId = path === "/recordings" ? new URLSearchParams(locationSearch()).get("recordingId") : null;
      const recordingsSource = supportsDailyRecordings && !requestedRecordingId
        && new URLSearchParams(locationSearch()).get("recordingSource") !== "event" ? "daily" : "event";
      const recordingQueryEnd = recordingsSource === "daily" ? snapshot.serverTime : end;
      const recordingQueryStart = recordingsSource === "daily"
        ? rfc3339AtOffset(Date.parse(snapshot.serverTime) - 7 * 86_400_000, displayTimeOffset) : start;
      const previousRecordings = previous?.recordingsSource === recordingsSource ? previous.recordings : [];
      const [notificationResult, historyResult, recordingsResult, settings, recipients, completionResult, recentHistoryResult] = await Promise.all([
        optionalArea(getNotifications(session, options.signal), null, notificationFailureMessage, options.signal, previous?.monitoring.unreadNotificationCount != null),
        optionalArea(path === "/history" ? queryHistory({ from: start, to: end }, options.signal) : Promise.resolve(emptyHistory(end)),
          previous?.history ?? emptyHistory(end), "이력을 불러오지 못했습니다.", options.signal, previous !== null),
        optionalArea(path === "/recordings"
          ? requestedRecordingId
            ? getRecording(requestedRecordingId, options.signal).then((recording) => recording ? [recording] : [])
            : queryRecordings({ from: recordingQueryStart, to: recordingQueryEnd, recordingSource: recordingsSource }, options.signal)
          : Promise.resolve([]), previousRecordings, "녹화 목록을 불러오지 못했습니다.", options.signal, previousRecordings.length > 0),
        path === "/admin" ? getAlertSettings(session, options.signal) : emptyAlertSettings(),
        path === "/admin" ? getRecipients(session, options.signal) : { recipients: [], settings: {} },
        optionalArea(useV2Monitoring && backendContract && monitoringDetails ? getCompletedCollectionAt(options.signal) : Promise.resolve(null),
          previous ? completedCollectionAt : null, collectionHistoryFailureMessage, options.signal, previous !== null),
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
      completedCollectionAt = completionResult.value;
      notificationRefreshRequired = notificationResult.state.status === "error";
      if (monitoring.v2) monitoring.summary.timeSinceCollection = sinceCollection(completedCollectionAt, snapshot.serverTime);
      updateLoadOneHourAgo(monitoring);
      currentData = {
        reception,
        admin: {
          alertSettings: settings,
          preCollectionAlert: settings.preCollectionAlert,
          recipientSettings: recipients.settings,
          recipients: recipients.recipients,
        },
        history: historyResult.state.status === "error"
          ? { ...historyResult.value, loadState: historyResult.state, eventsState: historyResult.state }
          : useV2Monitoring ? { ...historyResult.value, thresholds: [{ hour: 0, value: monitoring.summary.collectionThreshold }] } : historyResult.value,
        lastMeasuredAt: timeOnly(snapshot.measuredAt, true),
        monitoring,
        recordings: recordingsResult.value,
        recordingsSource,
        recordingsState: recordingsResult.state,
        session,
      };
      return structuredClone(currentData);
    },
    getRecording,
    ...(supportsDailyRecordings ? { prepareDailyRecordingExport: async (recordingId: string, signal?: AbortSignal) => {
      return (await getDailyApi()).prepareExport(recordingId, signal);
    } } : {}),
    getRecordingCoverage: async (recordingId, signal) => {
      const { clipIdentifier, parseClipCoverage } = await import("./recording-coverage");
      if (!clipIdentifier.test(recordingId)) throw new Error("Recording coverage requires a media clip identifier.");
      return parseClipCoverage(await request<unknown>(`/api/v1/media/clips/${encodeURIComponent(recordingId)}`, { signal }), recordingId, cameraId);
    },
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
    queryRecordings,
    replaceAlertSettings: async (settings) => {
      const body = {
        collectionThresholdPercent: settings.collectionThreshold,
        eventTypes: settings.enabledEventTypes,
        maximumRepeatCount: settings.maximumRepeatCount,
        preCollectionAlert: { enabled: settings.preCollectionAlert.enabled, thresholdPercent: settings.preCollectionAlert.threshold },
        recoveryNotificationEnabled: settings.recoveryNotificationEnabled,
        repeatIntervalMinutes: settings.repeatIntervalMinutes,
        sendDelayMinutes: settings.sendDelayMinutes,
      } satisfies BackendComponents["schemas"]["AlertSettingsUpdate"] & components["schemas"]["AlertSettingsUpdate"];
      return mapAlertSettings(await request<ApiAlertSettings>(pitPath(API_PATHS.alertSettings), {
        body: JSON.stringify(body),
        headers: { "If-Match": settings.version },
        method: "PUT",
      }));
    },
    sendTestNotification: async (recipientId, channels) => {
      const body = { channels, recipientId } satisfies BackendComponents["schemas"]["TestNotificationRequest"] & components["schemas"]["TestNotificationRequest"];
      const session = currentData?.session;
      const { signal } = notificationActionsController;
      await request<void>(API_PATHS.testNotification, { body: JSON.stringify(body), method: "POST", signal });
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
        listener(structuredClone(currentData));
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
          listener(structuredClone(currentData));
        } catch (error) {
          if (isAuthorizationError(error)) { failAuthorization(error); return; }
          if (!active || sessionController.signal.aborted || !currentData) return;
          currentData.monitoring.loadHistoryState = {
            ...areaError(error, loadHistoryFailureMessage, currentData.monitoring.loadHistory.length > 0),
            from: currentData.monitoring.loadHistoryState?.from, to: currentData.monitoring.loadHistoryState?.to,
          };
          updateLoadOneHourAgo(currentData.monitoring);
          listener(structuredClone(currentData));
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
              listener(structuredClone(currentData));
            } catch (error) {
              if (isAuthorizationError(error)) {
                failAuthorization(error);
                return;
              }
              if (sessionController.signal.aborted) return;
              if (active && currentData) {
                applyNotificationFailure(error);
                listener(structuredClone(currentData));
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
              const completedAt = await getCompletedCollectionAt(sessionController.signal);
              if (!active || !currentData?.monitoring.v2) return;
              completedCollectionAt = completedAt;
              const elapsed = sinceCollection(completedAt, currentData.monitoring.v2.serverTime);
              if (currentData.monitoring.summary.timeSinceCollection !== elapsed || currentData.monitoring.completedCollectionState?.status === "error") {
                currentData.monitoring.summary.timeSinceCollection = elapsed;
                currentData.monitoring.completedCollectionState = { status: "ready" };
                listener(structuredClone(currentData));
              }
            } catch (error) {
              if (isAuthorizationError(error)) {
                failAuthorization(error);
                return;
              }
              if (sessionController.signal.aborted) return;
              if (active && currentData?.monitoring.v2) {
                currentData.monitoring.completedCollectionState = areaError(error, collectionHistoryFailureMessage, completedCollectionAt !== null);
                listener(structuredClone(currentData));
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
        let offset: string;
        let measuredAt: string | null;
        try {
          snapshot = JSON.parse(event.data) as typeof snapshot;
          monitoring = mapMonitoring(snapshot, null);
          offset = timeOffset(snapshot.serverTime);
          measuredAt = timeOnly(snapshot.measuredAt, true);
        } catch { return; }
        monitoringRevision += 1;
        if (monitoring.v2) monitoring.v2.streamState = "connected";
        displayTimeOffset = offset;
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
        listener(structuredClone(currentData));
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
        if (currentData) listener(structuredClone(currentData));
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
        listener(structuredClone(currentData));
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
              displayTimeOffset = timeOffset(snapshot.serverTime);
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
            if (changed) listener(structuredClone(currentData));
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
    updateNotificationRecipient: async (recipient, settings) => {
      const body = recipientPreferences(settings) satisfies BackendComponents["schemas"]["NotificationRecipientPatch"] & components["schemas"]["NotificationRecipientPatch"];
      return mapRecipientResult(await request<ApiRecipient>(pathWithId(API_PATHS.notificationRecipient, "recipientId", recipient.id), {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/merge-patch+json", "If-Match": recipient.version },
        method: "PATCH",
      }));
    },
  };

  return source;
}
