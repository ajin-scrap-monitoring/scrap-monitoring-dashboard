import type { components, paths } from "../generated/api-contract";
import type {
  AlertLevel,
  AlertSettings,
  DashboardData,
  DashboardStatus,
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
  DateRangeQuery,
  NotificationRecipientInput,
  SessionCredentials,
} from "./dashboard-data-source";

type ApiAlertSettings = components["schemas"]["AlertSettings"];
type ApiEvent = components["schemas"]["Event"];
type ApiEventPage = components["schemas"]["EventPage"];
type ApiLoadHistory = components["schemas"]["LoadHistory"];
type ApiMonitoringSnapshot = components["schemas"]["MonitoringSnapshot"];
type ApiNotificationPage = components["schemas"]["NotificationPage"];
type ApiRecipient = components["schemas"]["NotificationRecipient"];
type ApiRecipientPage = components["schemas"]["NotificationRecipientPage"];
type ApiRecording = components["schemas"]["Recording"];
type ApiRecordingPage = components["schemas"]["RecordingPage"];
type ApiSession = components["schemas"]["Session"];

type FetchImplementation = typeof fetch;
type EventSourceFactory = (url: string) => EventSource;
const APPLIED_EVENT_ID_LIMIT = 1024;
const HEADER_NOTIFICATION_LIMIT = 20;

const API_PATHS = {
  alertSettings: "/api/v1/settings/alerts",
  events: "/api/v1/events",
  loadHistory: "/api/v1/history/load",
  monitoringEvents: "/api/v1/monitoring/events",
  monitoringSnapshot: "/api/v1/monitoring/snapshot",
  notification: "/api/v1/notifications/{notificationId}",
  notificationRecipient: "/api/v1/notification-recipients/{recipientId}",
  notificationRecipients: "/api/v1/notification-recipients",
  notifications: "/api/v1/notifications",
  notificationsReadAll: "/api/v1/notifications/read-all",
  recording: "/api/v1/recordings/{recordingId}",
  recordings: "/api/v1/recordings",
  session: "/api/v1/session",
  testNotification: "/api/v1/notifications/test",
} as const satisfies Record<string, keyof paths>;

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

function wallClock(value: string, includeSeconds = false) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return value;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}${includeSeconds ? `:${match[6] ?? "00"}` : ""}`;
}

function timeOnly(value: string, includeSeconds = false) {
  return wallClock(value, includeSeconds).split(" ")[1] ?? value;
}

function expectedTime(value: string | null | undefined) {
  if (!value) return "예측 없음";
  const match = wallClock(value).match(/^\d{4}-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  return match ? `${Number(match[1])}월 ${Number(match[2])}일 ${match[3]}:${match[4]}` : value;
}

function durationText(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "정보 없음";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}시간 ${minutes}분`;
}

function clockDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function byteSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function sameOriginResourcePath(value: string | null) {
  if (value === null) return undefined;
  const resource = new URL(value, window.location.origin);
  if (!value.startsWith("/") || resource.origin !== window.location.origin) {
    throw new Error("Recording resource path must use the dashboard origin");
  }
  return `${resource.pathname}${resource.search}${resource.hash}`;
}

function timeOffset(value: string) {
  return value.match(/(?:Z|[+-]\d{2}:\d{2})$/i)?.[0] ?? "Z";
}

function rfc3339AtOffset(timestamp: number, offset: string) {
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  const offsetMinutes = match
    ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0;
  const suffix = match ? offset : "Z";
  return new Date(timestamp + offsetMinutes * 60_000).toISOString().replace(/\.\d{3}Z$/, suffix);
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

function historyMarkerPresentation(type: components["schemas"]["HistoryMarkerType"]) {
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
    enabledEventTypes: settings.eventTypes.filter((type): type is AlertSettings["enabledEventTypes"][number] =>
      type === "collection_required" || type === "measurement_error" || type === "device_error"),
    maximumRepeatCount: settings.maximumRepeatCount,
    preCollectionAlert: {
      enabled: settings.preCollectionAlert.enabled,
      threshold: settings.preCollectionAlert.thresholdPercent,
    },
    recoveryNotificationEnabled: settings.recoveryNotificationEnabled,
    repeatIntervalMinutes: settings.repeatIntervalMinutes,
    sendDelayMinutes: settings.sendDelayMinutes,
    version: settings.version,
  };
}

function recipientSettings(recipient: ApiRecipient): RecipientSettings {
  return {
    collection: recipient.eventTypes.includes("collection_required"),
    device: recipient.eventTypes.includes("device_error"),
    email: recipient.channels.includes("email"),
    enabled: recipient.enabled,
    error: recipient.eventTypes.includes("measurement_error"),
    sms: recipient.channels.includes("sms"),
    useGlobal: recipient.subscriptionMode === "global",
  };
}

function mapRecipient(recipient: ApiRecipient): NotificationRecipient {
  return {
    channel: recipient.channels.map((channel) => channel === "email" ? "이메일" : "문자").join(", ") || "-",
    email: recipient.email,
    enabled: recipient.enabled,
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
  const channels: components["schemas"]["NotificationChannel"][] = [
    settings.email ? "email" : null,
    settings.sms ? "sms" : null,
  ].filter((value): value is components["schemas"]["NotificationChannel"] => value !== null);
  const eventTypes: components["schemas"]["ConfigurableAlertEventType"][] = [
    settings.collection ? "collection_required" : null,
    settings.error ? "measurement_error" : null,
    settings.device ? "device_error" : null,
  ].filter((value): value is components["schemas"]["ConfigurableAlertEventType"] => value !== null);
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
      height: sample.valid ? sample.height : null,
      positionRatio: sample.positionRatio,
    })) ?? [],
  };
}

function mapEvent(event: ApiEvent): HistoryEvent {
  return {
    content: event.detail || event.title,
    id: event.id,
    recordingId: event.recordingId,
    status: eventStatus(event.status),
    time: wallClock(event.occurredAt),
    tone: eventTone(event.category, event.status),
    type: eventCategoryLabel(event.category),
  };
}

function mapRecording(recording: ApiRecording): Recording {
  const date = wallClock(recording.startedAt, true).split(" ")[0];
  return {
    codec: recording.videoCodec.toUpperCase(),
    contentUrl: sameOriginResourcePath(recording.contentPath),
    date,
    detail: recording.detail || recording.title,
    downloadUrl: sameOriginResourcePath(recording.downloadPath),
    duration: clockDuration(recording.durationSeconds),
    end: wallClock(recording.endedAt, true),
    format: recording.containerFormat.toUpperCase(),
    frameRate: recording.frameRate,
    height: recording.heightPixels,
    id: recording.id,
    retentionEndsAt: wallClock(recording.retainedUntil, true),
    retentionStartsAt: wallClock(recording.retainedFrom, true),
    sample: false,
    size: byteSize(recording.sizeBytes),
    start: wallClock(recording.startedAt, true),
    status: recording.status,
    thumbnailUrl: sameOriginResourcePath(recording.thumbnailPath),
    time: `${timeOnly(recording.startedAt)} - ${timeOnly(recording.endedAt)}`,
    tone: eventTone(recording.eventCategory),
    type: eventCategoryLabel(recording.eventCategory),
    width: recording.widthPixels,
  };
}

function historyData(load: ApiLoadHistory, events: readonly ApiEvent[]): DashboardData["history"] {
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
    events: events.map(mapEvent),
    loadSamples: load.samples.filter((sample) => sample.valid && sample.valuePercent !== null).map((sample) => ({
      hour: hour(sample.measuredAt),
      value: sample.valuePercent ?? 0,
    })),
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
      read: notification.readAt !== null,
      time: timeOnly(notification.occurredAt),
      title: notification.title,
    })) ?? [],
    unreadNotificationCount: notifications?.unreadCount ?? 0,
  };
}

function monitoringData(snapshot: ApiMonitoringSnapshot, notifications: ApiNotificationPage | null): DashboardData["monitoring"] {
  const remainingSeconds = snapshot.summary.expectedThresholdAt
    ? Math.max(0, Math.floor((new Date(snapshot.summary.expectedThresholdAt).getTime() - new Date(snapshot.serverTime).getTime()) / 1000))
    : null;
  return {
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
      value: sample.valid ? sample.valuePercent : null,
    })),
    status: systemStatus(snapshot.systemStatus),
    summary: {
      averageCollectionCycle: durationText(snapshot.summary.averageCollectionCycleSeconds),
      collectionThreshold: snapshot.summary.collectionThresholdPercent,
      expectedArrivalAt: expectedTime(snapshot.summary.expectedThresholdAt),
      loadPercent: snapshot.summary.loadPercent,
      operationState: snapshot.operationState,
      preCollectionAlert: {
        enabled: snapshot.summary.preCollectionAlert.enabled,
        threshold: snapshot.summary.preCollectionAlert.thresholdPercent,
      },
      recentChange: `${snapshot.summary.loadChangeLastHourPercentagePoints >= 0 ? "+" : ""}${snapshot.summary.loadChangeLastHourPercentagePoints}%`,
      remainingTime: durationText(remainingSeconds),
      timeSinceCollection: snapshot.summary.lastCollectionAt
        ? durationText(Math.max(0, (new Date(snapshot.serverTime).getTime() - new Date(snapshot.summary.lastCollectionAt).getTime()) / 1000))
        : "정보 없음",
    },
    videoMode: "webrtc",
    videoStatus: snapshot.video.status,
    videoStreamId: snapshot.video.streamId,
    videoTimestamp: wallClock(snapshot.video.capturedAt, true),
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
  eventSourceFactory = (url) => new EventSource(url),
  fetchImplementation = window.fetch.bind(window),
  locationSearch = () => window.location.search,
  onSessionExpired = () => window.location.assign("/login"),
  route = () => window.location.pathname,
}: {
  eventSourceFactory?: EventSourceFactory;
  fetchImplementation?: FetchImplementation;
  locationSearch?: () => string;
  onSessionExpired?: () => void;
  route?: () => string;
} = {}): DashboardDataSource {
  let csrfToken = "";
  let currentData: DashboardData | null = null;
  let displayTimeOffset = "Z";
  let hasAuthenticatedSession = false;
  let monitoringRevision = 0;
  let notificationRevision = 0;

  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (csrfToken && init.method && init.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
    const response = await fetchImplementation(path, { ...init, credentials: "include", headers });
    if (!response.ok) {
      let detail: { code?: string; detail?: string; title?: string } = {};
      try { detail = await response.json() as typeof detail; } catch { /* Empty or non-JSON error response. */ }
      if (response.status === 401 && hasAuthenticatedSession && path !== API_PATHS.session) {
        csrfToken = "";
        hasAuthenticatedSession = false;
        onSessionExpired();
      }
      throw new ApiError(response.status, detail.detail ?? detail.title ?? `API request failed with ${response.status}`, detail.code);
    }
    const responseText = await response.text();
    if (!responseText) return undefined as T;
    return JSON.parse(responseText) as T;
  };

  const getSession = async (signal?: AbortSignal) => {
    try {
      const session = await request<ApiSession>(API_PATHS.session, { signal });
      csrfToken = session.csrfToken ?? "";
      hasAuthenticatedSession = true;
      return mapSession(session);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        csrfToken = "";
        hasAuthenticatedSession = false;
        return null;
      }
      throw error;
    }
  };

  const getNotifications = async (session: UserSession | null, signal?: AbortSignal) => session
    ? request<ApiNotificationPage>(`${API_PATHS.notifications}?page=1&pageSize=20`, { signal })
    : null;

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
    if (query.eventCategory) parameters.set("eventCategory", query.eventCategory);
    return parameters;
  };

  const queryHistory = async (query: DateRangeQuery, signal?: AbortSignal) => {
    const parameters = queryParameters(query);
    const [load, events] = await Promise.all([
      request<ApiLoadHistory>(`${API_PATHS.loadHistory}?${parameters}`, { signal }),
      listEveryPage<ApiEventPage, ApiEvent>(`${API_PATHS.events}?${parameters}`, signal),
    ]);
    return historyData(load, events);
  };

  const queryRecordings = async (query: DateRangeQuery, signal?: AbortSignal) => {
    const recordings = await listEveryPage<ApiRecordingPage, ApiRecording>(`${API_PATHS.recordings}?${queryParameters(query)}`, signal);
    return recordings.map(mapRecording);
  };

  const getRecording = async (recordingId: string, signal?: AbortSignal) => {
    try {
      const path = pathWithId(API_PATHS.recording, "recordingId", recordingId);
      return mapRecording(await request<ApiRecording>(path, { signal }));
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
    ? mapAlertSettings(await request<ApiAlertSettings>(API_PATHS.alertSettings, { signal }))
    : emptyAlertSettings();

  const source: DashboardDataSource = {
    createNotificationRecipient: async (input: NotificationRecipientInput) => {
      const body = {
        ...recipientPreferences(input.settings),
        email: input.recipient.email,
        name: input.recipient.name,
        phone: input.recipient.phone === "-" ? null : input.recipient.phone,
        team: input.recipient.team,
      } satisfies components["schemas"]["NotificationRecipientCreate"];
      return mapRecipientResult(await request<ApiRecipient>(API_PATHS.notificationRecipients, { method: "POST", body: JSON.stringify(body) }));
    },
    createSession: async (credentials: SessionCredentials) => {
      const body = { ...credentials } satisfies components["schemas"]["LoginRequest"];
      const session = await request<ApiSession>(API_PATHS.session, { method: "POST", body: JSON.stringify(body) });
      csrfToken = session.csrfToken ?? "";
      hasAuthenticatedSession = true;
      return mapSession(session);
    },
    deleteSession: async () => {
      await request<void>(API_PATHS.session, { method: "DELETE" });
      csrfToken = "";
      hasAuthenticatedSession = false;
    },
    getDashboardData: async (options: DashboardDataRequestOptions = {}) => {
      const [session, snapshot] = await Promise.all([
        getSession(options.signal),
        request<ApiMonitoringSnapshot>(API_PATHS.monitoringSnapshot, { signal: options.signal }),
      ]);
      const notifications = await getNotifications(session, options.signal);
      const end = snapshot.serverTime;
      displayTimeOffset = timeOffset(snapshot.serverTime);
      const start = rfc3339AtOffset(new Date(end).getTime() - 7 * 24 * 3_600_000, displayTimeOffset);
      const path = route();
      const requestedRecordingId = path === "/recordings" ? new URLSearchParams(locationSearch()).get("recordingId") : null;
      const [history, recordings, settings, recipients] = await Promise.all([
        path === "/history" ? queryHistory({ from: start, to: end }, options.signal) : emptyHistory(end),
        path === "/recordings"
          ? requestedRecordingId
            ? getRecording(requestedRecordingId, options.signal).then((recording) => recording ? [recording] : [])
            : queryRecordings({ from: start, to: end }, options.signal)
          : [],
        path === "/admin" ? getAlertSettings(session, options.signal) : emptyAlertSettings(),
        path === "/admin" ? getRecipients(session, options.signal) : { recipients: [], settings: {} },
      ]);
      const monitoring = monitoringData(snapshot, notifications);
      currentData = {
        admin: {
          alertSettings: settings,
          preCollectionAlert: settings.preCollectionAlert,
          recipientSettings: recipients.settings,
          recipients: recipients.recipients,
        },
        history,
        lastMeasuredAt: timeOnly(snapshot.measuredAt, true),
        monitoring,
        recordings,
        session,
      };
      return structuredClone(currentData);
    },
    markAllNotificationsRead: async () => {
      await request<void>(API_PATHS.notificationsReadAll, { method: "POST" });
      if (currentData) {
        notificationRevision += 1;
        currentData.monitoring.headerNotifications.forEach((notification) => { notification.read = true; });
        currentData.monitoring.unreadNotificationCount = 0;
      }
    },
    markNotificationRead: async (notificationId) => {
      await request(pathWithId(API_PATHS.notification, "notificationId", notificationId), { method: "PATCH", body: JSON.stringify({ read: true }) });
      const notification = currentData?.monitoring.headerNotifications.find((item) => item.id === notificationId);
      if (currentData && notification && !notification.read) {
        notificationRevision += 1;
        notification.read = true;
        currentData.monitoring.unreadNotificationCount = Math.max(0, currentData.monitoring.unreadNotificationCount - 1);
      }
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
      } satisfies components["schemas"]["AlertSettingsUpdate"];
      return mapAlertSettings(await request<ApiAlertSettings>(API_PATHS.alertSettings, {
        body: JSON.stringify(body),
        headers: { "If-Match": settings.version },
        method: "PUT",
      }));
    },
    sendTestNotification: async (recipientId, channels) => {
      const body = { channels, recipientId } satisfies components["schemas"]["TestNotificationRequest"];
      await request<void>(API_PATHS.testNotification, { body: JSON.stringify(body), method: "POST" });
    },
    subscribe: (listener) => {
      const eventSource = eventSourceFactory(API_PATHS.monitoringEvents);
      const appliedEventIds = new Set<string>();
      let active = true;
      const isDuplicate = (event: Event) => {
        if (!(event instanceof MessageEvent) || !event.lastEventId) return false;
        if (appliedEventIds.has(event.lastEventId)) return true;
        appliedEventIds.add(event.lastEventId);
        if (appliedEventIds.size > APPLIED_EVENT_ID_LIMIT) {
          const oldestEventId = appliedEventIds.values().next().value;
          if (oldestEventId !== undefined) appliedEventIds.delete(oldestEventId);
        }
        return false;
      };
      eventSource.addEventListener("monitoring.snapshot", (event) => {
        if (!active || !currentData || !(event instanceof MessageEvent) || isDuplicate(event)) return;
        if (typeof event.data !== "string") return;
        monitoringRevision += 1;
        const snapshot = JSON.parse(event.data) as ApiMonitoringSnapshot;
        displayTimeOffset = timeOffset(snapshot.serverTime);
        const headerNotifications = currentData.monitoring.headerNotifications;
        const unreadNotificationCount = currentData.monitoring.unreadNotificationCount;
        currentData = {
          ...currentData,
          lastMeasuredAt: timeOnly(snapshot.measuredAt, true),
          monitoring: { ...monitoringData(snapshot, null), headerNotifications, unreadNotificationCount },
        };
        listener(structuredClone(currentData));
      });
      eventSource.addEventListener("notification.created", (event) => {
        if (!active || !currentData || !(event instanceof MessageEvent) || isDuplicate(event)) return;
        if (typeof event.data !== "string") return;
        const notification = JSON.parse(event.data) as components["schemas"]["Notification"];
        if (currentData.monitoring.headerNotifications.some((item) => item.id === notification.id)) return;
        notificationRevision += 1;
        const read = notification.readAt !== null;
        currentData.monitoring.headerNotifications.unshift({
          detail: notification.detail,
          id: notification.id,
          level: alertLevel(notification.severity),
          read,
          time: timeOnly(notification.occurredAt),
          title: notification.title,
        });
        currentData.monitoring.headerNotifications.splice(HEADER_NOTIFICATION_LIMIT);
        if (!read) currentData.monitoring.unreadNotificationCount += 1;
        listener(structuredClone(currentData));
      });
      eventSource.addEventListener("session.expired", (event) => {
        if (!active || isDuplicate(event)) return;
        active = false;
        csrfToken = "";
        hasAuthenticatedSession = false;
        eventSource.close();
        onSessionExpired();
      });
      eventSource.addEventListener("stream.resync-required", (event) => {
        if (!active || !currentData || isDuplicate(event)) return;
        const expectedMonitoringRevision = monitoringRevision;
        const expectedNotificationRevision = notificationRevision;
        const session = currentData.session;
        void Promise.all([
          request<ApiMonitoringSnapshot>(API_PATHS.monitoringSnapshot),
          getNotifications(session),
        ])
          .then(([snapshot, notifications]) => {
            if (!active || !currentData) return;
            let changed = false;
            if (expectedMonitoringRevision === monitoringRevision) {
              displayTimeOffset = timeOffset(snapshot.serverTime);
              currentData = {
                ...currentData,
                lastMeasuredAt: timeOnly(snapshot.measuredAt, true),
                monitoring: {
                  ...monitoringData(snapshot, null),
                  headerNotifications: currentData.monitoring.headerNotifications,
                  unreadNotificationCount: currentData.monitoring.unreadNotificationCount,
                },
              };
              monitoringRevision += 1;
              changed = true;
            }
            if (notifications && expectedNotificationRevision === notificationRevision) {
              currentData.monitoring = { ...currentData.monitoring, ...notificationData(notifications) };
              notificationRevision += 1;
              changed = true;
            }
            if (changed) listener(structuredClone(currentData));
          })
          .catch(() => undefined);
      });
      return () => {
        active = false;
        eventSource.close();
      };
    },
    updateNotificationRecipient: async (recipient, settings) => {
      const body = recipientPreferences(settings) satisfies components["schemas"]["NotificationRecipientPatch"];
      return mapRecipientResult(await request<ApiRecipient>(pathWithId(API_PATHS.notificationRecipient, "recipientId", recipient.id), {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/merge-patch+json", "If-Match": recipient.version },
        method: "PATCH",
      }));
    },
  };

  return source;
}
