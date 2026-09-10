export type AlertLevel = "warning" | "error";
export type EventTone = "complete" | "warning" | "error";

export type DeviceStatus = {
  label: string;
  received: string;
  latency: string;
  status: "normal" | "unavailable";
};

export type ActiveAlert = {
  detail: string;
  level: AlertLevel;
  time: string;
  title: string;
};

export type HeaderNotification = ActiveAlert & {
  id: number;
  read: boolean;
};

export type LoadHistorySample = {
  time: string;
  value: number;
};

export type LidarProfile = {
  average: string;
  color: "blue" | "teal";
  label: string;
  maximum: string;
  minimum: string;
  values: number[];
};

export type MonitoringSummary = {
  averageCollectionCycle: string;
  collectionThreshold: number;
  expectedArrivalAt: string;
  loadPercent: number;
  recentChange: string;
  timeSinceCollection: string;
};

export type HistoryEvent = {
  content: string;
  detail: string;
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
  label: "수거 필요" | "수거 완료" | "오류";
  time: string;
};

export type Recording = {
  date: string;
  detail: string;
  duration: string;
  end: string;
  start: string;
  time: string;
  tone: EventTone;
  type: "수거" | "알림" | "오류";
};

export type NotificationRecipient = {
  channel: string;
  email: string;
  enabled: boolean;
  name: string;
  phone: string;
  team: string;
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

export type DashboardStatus = "normal" | "collection-required" | "measurement-error" | "disconnected" | "no-data";

export type DashboardData = {
  lastMeasuredAt: string;
  admin: {
    recipientSettings: Record<string, RecipientSettings>;
    recipients: NotificationRecipient[];
  };
  history: {
    chartEvents: HistoryChartEvent[];
    loadSamples: HistoryLoadSample[];
    events: HistoryEvent[];
  };
  monitoring: {
    alerts: ActiveAlert[];
    devices: DeviceStatus[];
    headerNotifications: HeaderNotification[];
    lidarProfiles: LidarProfile[];
    loadHistory: LoadHistorySample[];
    status: DashboardStatus;
    summary: MonitoringSummary;
    videoTimestamp: string;
  };
  recordings: Recording[];
};
