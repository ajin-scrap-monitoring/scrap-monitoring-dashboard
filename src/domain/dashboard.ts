export type AlertLevel = "info" | "warning" | "error";
export type EventTone = "complete" | "warning" | "error";
export type EventCategory = "collection" | "alert" | "error";
export type OperationState = "idle" | "accumulating" | "collecting";

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
  status: "normal" | "delayed" | "unavailable";
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

export type LoadHistorySample = {
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
  loadPercent: number;
  operationState: OperationState;
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

export type HistoryLoadSample = {
  hour: number;
  value: number;
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
  frameRate: number;
  height: number;
  id: string;
  size: string;
  start: string;
  status: "available" | "processing" | "expired" | "unavailable";
  thumbnailUrl?: string;
  time: string;
  tone: EventTone;
  type: "수거" | "알림" | "오류";
  width: number;
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

export type DashboardStatus = "normal" | "collection-required" | "measurement-error" | "disconnected" | "no-data";

export type DashboardData = {
  lastMeasuredAt: string;
  session: UserSession | null;
  admin: {
    alertSettings: AlertSettings;
    preCollectionAlert: { enabled: boolean; threshold: number };
    recipientSettings: Record<string, RecipientSettings>;
    recipients: NotificationRecipient[];
  };
  history: {
    startsAt: string;
    endsAt: string;
    chartEvents: HistoryChartEvent[];
    loadSamples: HistoryLoadSample[];
    thresholds: HistoryThresholdSample[];
    events: HistoryEvent[];
  };
  monitoring: {
    alerts: ActiveAlert[];
    devices: DeviceStatus[];
    headerNotifications: HeaderNotification[];
    unreadNotificationCount: number;
    lidarProfiles: LidarProfile[];
    loadHistory: LoadHistorySample[];
    status: DashboardStatus;
    summary: MonitoringSummary;
    videoMode: "sample" | "webrtc";
    videoStatus: "available" | "delayed" | "unavailable";
    videoStreamId: string;
    videoTimestamp: string;
  };
  recordings: Recording[];
};
