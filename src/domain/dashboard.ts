export type AlertLevel = "info" | "warning" | "error";
export type EventTone = "complete" | "warning" | "error";
export type EventCategory = "collection" | "alert" | "error";
export type OperationState = "idle" | "accumulating" | "collecting";
export type AlarmState = "NORMAL" | "WARNING" | "CRITICAL" | "UNKNOWN" | "ERROR";

export type DataAreaState = {
  status: "ready" | "loading" | "error" | "unsupported";
  message?: string;
  stale?: boolean;
  code?: string;
  httpStatus?: number;
  from?: string;
  to?: string;
  thresholdKind?: "current";
};

export type LoadHistoryMetadata = {
  assessmentId?: string | null;
  bucketStartAt?: string;
  bucketEndAt?: string;
  generatedAt?: string | null;
  observedAt?: string | null;
  dataState?: "AVAILABLE" | "LIMITED" | "UNAVAILABLE" | "STALE" | "UNKNOWN" | "NO_DATA";
  reasonCodes?: string[];
};

export type AlertEvidence = {
  eventId: string;
  notificationId: string;
  assessmentId: string;
  loadPercent: number | null;
  observedAt: string;
  triggeredAt: string;
  readAt: string | null;
};

export type AlertEvidencePage = {
  items: AlertEvidence[];
  offset: number;
  limit: number;
  totalItems: number;
};

export type UserSession = {
  csrfToken?: string;
  expiresAt: string;
  user: {
    displayName: string;
    id: string;
    role: "viewer" | "administrator";
  };
};

export type DeviceStatus = {
  label: string;
  received: string;
  latency: string;
  status: "normal" | "delayed" | "unavailable" | "unknown";
  statusLabel?: string;
  receivedLabel?: string;
};

export type ActiveAlert = {
  detail: string;
  id: string;
  level: AlertLevel;
  time: string;
  title: string;
};

export type HeaderNotification = ActiveAlert & {
  read: boolean;
};

export type LoadHistorySample = LoadHistoryMetadata & {
  measuredAt: string;
  time: string;
  value: number | null;
};

export type LidarProfileSample = {
  height: number | null;
  positionRatio: number;
};

export type LidarProfile = {
  average: string;
  color: "blue" | "teal";
  label: string;
  maximum: string;
  minimum: string;
  samples: LidarProfileSample[];
};

export type MonitoringSummary = {
  averageCollectionCycle: string;
  collectionThreshold: number;
  expectedArrivalAt: string;
  loadPercent: number | null;
  operationState: OperationState | null;
  preCollectionAlert: { enabled: boolean; threshold: number };
  recentChange: string;
  remainingTime: string;
  timeSinceCollection: string;
};

export type HistoryEvent = {
  id: string;
  content: string;
  recordingId: string | null;
  status: string;
  time: string;
  tone: EventTone;
  type: "수거" | "알림" | "오류";
};

export type HistoryLoadSample = LoadHistoryMetadata & {
  hour: number;
  value: number | null;
};

export type HistoryChartEvent = {
  color: string;
  detail: string;
  hour: number;
  id: string;
  label: "수거 필요" | "수거 완료" | "오류";
  time: string;
  value: number;
};

export type HistoryThresholdSample = {
  hour: number;
  value: number;
};

export type Recording = {
  codec: string;
  contentUrl?: string;
  retentionStartsAt: string;
  retentionEndsAt: string;
  sample: boolean;
  date: string;
  detail: string;
  downloadUrl?: string;
  duration: string;
  end: string;
  format: string;
  frameRate: number | null;
  height: number | null;
  id: string;
  size: string;
  start: string;
  status: "available" | "processing" | "expired" | "unavailable";
  thumbnailUrl?: string;
  time: string;
  tone: EventTone;
  type: "수거" | "알림" | "오류";
  width: number | null;
  mediaStatus?: string | null;
  coverage?: string | null;
  gaps?: Array<{ start: string; end: string }>;
  errorCode?: string | null;
};

export type RecordingCoverageDetail = {
  requestedStart: string;
  requestedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  coverage: "complete" | "partial" | "none" | null;
  gaps: Array<{ start: string; end: string }>;
  errorCode: string | null;
};

export type NotificationRecipient = {
  channel: string;
  email: string;
  enabled: boolean;
  id: string;
  name: string;
  phone: string;
  team: string;
  version: string;
};

export type RecipientSettings = {
  collection: boolean;
  device: boolean;
  email: boolean;
  enabled: boolean;
  error: boolean;
  sms: boolean;
  useGlobal: boolean;
};

export type AlertSettings = {
  collectionThreshold: number;
  enabledEventTypes: Array<"collection_required" | "measurement_error" | "device_error">;
  maximumRepeatCount: number;
  preCollectionAlert: { enabled: boolean; threshold: number };
  recoveryNotificationEnabled: boolean;
  repeatIntervalMinutes: number;
  sendDelayMinutes: number;
  version: string;
};

export type DashboardStatus = "normal" | "collection-required" | "measurement-error" | "disconnected" | "no-data" | "fresh" | "stale" | "unavailable" | "unknown";

export type MonitoringV2 = {
  serverTime: string;
  dataState: "FRESH" | "STALE" | "UNAVAILABLE" | "UNKNOWN" | "NO_DATA";
  snapshotId: string;
  pitId: string;
  siteId: string;
  edgeId: string;
  measuredAt: string | null;
  assessmentReceivedAt: string | null;
  reasonCodes: string[];
  warningThreshold: number;
  recoveryThreshold: number;
  operations: {
    effectiveState: AlarmState;
    lastKnownState: "NORMAL" | "WARNING" | "CRITICAL" | null;
    lastEvaluatedAt: string | null;
    lastAlertAt: string | null;
    notificationId: string | null;
  } | null;
  fillState: string | null;
  decisionState: string | null;
  configRevision: string | null;
  capabilities: Record<"fill" | "occlusion" | "collection" | "vision", "NOT_IMPLEMENTED" | "NOT_VALIDATED" | "ENABLED"> | null;
  connectionState: "REPORTING" | "UNKNOWN";
  effectiveState: string;
  deviceReceivedAt: string | null;
  deviceReasons: string[];
  sensors: Array<{ id: string; state: string; lastScanAt: string | null; reasonCodes: string[] }>;
  streamState: "connecting" | "connected" | "reconnecting";
  pitName?: string | null;
  services?: Array<{ name: string; state: string; lastProgressAt: string | null; reasonCodes: string[] }>;
  clock?: { state: string; offsetMs: number | null } | null;
};

export type DashboardData = {
  authError?: { status: 401 | 403; message: string };
  lastMeasuredAt: string;
  session: UserSession | null;
  admin: {
    alertSettings: AlertSettings;
    preCollectionAlert: { enabled: boolean; threshold: number };
    recipientSettings: Record<string, RecipientSettings>;
    recipients: NotificationRecipient[];
  };
  history: {
    loadState?: DataAreaState;
    eventsState?: DataAreaState;
    startsAt: string;
    endsAt: string;
    chartEvents: HistoryChartEvent[];
    loadSamples: HistoryLoadSample[];
    thresholds: HistoryThresholdSample[];
    events: HistoryEvent[];
  };
  monitoring: {
    alarmState: AlarmState | null;
    alerts: ActiveAlert[];
    devices: DeviceStatus[];
    headerNotifications: HeaderNotification[];
    unreadNotificationCount: number | null;
    notificationState?: DataAreaState;
    completedCollectionState?: DataAreaState;
    loadHistoryState?: DataAreaState;
    lidarProfiles: LidarProfile[];
    loadHistory: LoadHistorySample[];
    status: DashboardStatus;
    v2?: MonitoringV2;
    summary: MonitoringSummary;
    videoMode: "sample" | "webrtc" | "mjpeg";
    videoUrl?: string;
    videoStatus: "available" | "delayed" | "unavailable";
    videoStreamId: string;
    videoTimestamp: string;
  };
  recordings: Recording[];
  recordingsState?: DataAreaState;
};
