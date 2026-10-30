import type { DailyRecording } from "./daily-recording";

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
  inputSource?: "EDGE_STATE" | "HEIGHT_SECTIONS" | "MIXED";
  valuePolicy?: "RAW_STATE" | "MEDIAN_MINUTE";
  simulated?: boolean;
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

export type ActiveHealthAlert = {
  componentKind: "EDGE" | "LIDAR" | "MEASUREMENT";
  componentName: string;
  componentId: string;
  state: string;
  evidenceSource: "EDGE_STATUS" | "STATUS_FRESHNESS" | "CURRENT_MEASUREMENT";
  reasonCodes: string[];
  simulated: boolean | null;
};

export type ActiveAlertCoverage = {
  componentKind: "EDGE" | "LIDAR" | "MEASUREMENT" | "CAMERA";
  componentName: string;
  componentId: string | null;
  state: "CHECKED" | "UNKNOWN" | "UNSUPPORTED";
  reasonCodes: string[];
};

export type ActiveAlert = {
  detail: string;
  id: string;
  level: AlertLevel;
  time: string;
  title: string;
  // 활성 알림 API가 서버 최초 확인 시각을 제공한 경우만 설정하며 null은 시작 정보 없음이다. 값은 표시용 시각 문자열이다.
  startedAt?: string | null;
  health?: ActiveHealthAlert;
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
  // null은 위치를 알 수 없는 표본이며 선을 끊는 표지로 보존한다.
  positionRatio: number | null;
};

export type LidarProfile = {
  average: string;
  color: "blue" | "teal";
  label: string;
  maximum: string;
  minimum: string;
  samples: LidarProfileSample[];
  simulated?: boolean;
  calibrationState?: "UNVERIFIED" | "VERIFIED" | "UNAVAILABLE" | "SIMULATION";
  reasonCodes?: string[];
};

export type MeasurementLayoutStatus = {
  state: "SIMULATION" | "PARTIAL" | "UNVERIFIED" | "UNAVAILABLE";
  bindingState: "MATCHED" | "MISMATCH" | "UNKNOWN";
  // null은 응답에 값이 없음이다.
  simulated: boolean | null;
  reasonCodes: string[];
  sensors: Array<{ sensorId: string; calibrationState: "SIMULATION" | "VERIFIED" | "UNAVAILABLE"; reasonCodes: string[] }>;
};

export type MonitoringSummary = {
  averageCollectionCycle: string;
  collectionThreshold: number;
  expectedArrivalAt: string;
  loadPercent: number | null;
  operationState: OperationState | null;
  preCollectionAlert: { enabled: boolean; threshold: number };
  loadOneHourAgo: { value: number; observedAt: string; dataState: "AVAILABLE" | "LIMITED" } | null;
  remainingTime: string;
  timeSinceCollection: string;
};

export type HistoryEvent = {
  id: string;
  content: string;
  title?: string;
  detail?: string;
  recordingId: string | null;
  status: string | null;
  time: string;
  tone: EventTone;
  type: "수거" | "알림" | "오류";
  extraFields?: ReadonlyArray<readonly [label: string, value: string]>;
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

export type EventReplayPart = {
  recordingId: string;
  recordingDate: string;
  playbackPath: string;
  fromAt: string;
  toAt: string;
  startSeconds: number;
  endSeconds: number;
  relativeStartSeconds: number;
  relativeEndSeconds: number;
  mapping: "LINEAR" | "POINT_TIMESTAMP";
};

export type EventRecordingWindow = {
  windowKind: "COLLECTION_CYCLE" | "EVENT_CONTEXT";
  windowState: "CLOSED" | "OPEN" | "UNKNOWN" | "POINT";
  eventType: string;
  stateAtOccurrence: string | null;
  simulated: boolean | null;
  pitAttribution: "RECORDED" | "CURRENT_ASSIGNMENT";
  reasonCodes: string[];
};

export type EventReplay = {
  state: "AVAILABLE" | "PARTIAL" | "PROCESSING" | "UNAVAILABLE";
  asOf: string;
  effectiveTo: string | null;
  requestedSeconds: number | null;
  coveredSeconds: number;
  playbackSeconds: number;
  parts: EventReplayPart[];
  unavailableIntervals: Array<{ startsAt: string; endsAt: string; kind: "GAP" | "UNCONFIRMED" | "FUTURE" | "MISSING" | "EXPIRED"; reasonCode: string }>;
  reasonCodes: string[];
  downloadReasonCode: string | null;
};

export type EventPlaybackSummary = {
  state: "AVAILABLE" | "PARTIAL" | "PROCESSING" | "UNAVAILABLE" | "UNKNOWN";
  // null은 길이를 알 수 없음이며 0초와 구분한다.
  playbackSeconds: number | null;
  reasonCodes: string[];
};

export type HistoryEventPage = {
  events: HistoryEvent[];
  // 조회 조건에 맞는 전체 건수와 서버 페이지 수이며 불러온 개수가 아니다.
  totalItems: number;
  totalPages: number;
  // 0부터 시작하는 표 페이지 번호이다.
  page: number;
};

export type RecordingListSnapshot = {
  items: Recording[];
  // 날짜 녹화 수와 이벤트 totalItems의 합이다.
  total: number;
  complete: boolean;
};

export type RecordingList = {
  // 시작 시각 역순의 앞쪽 rank개가 확정될 때까지만 서버 페이지를 순서대로 가져온다.
  ensure(rank: number, signal?: AbortSignal): Promise<RecordingListSnapshot>;
};

export type Recording = {
  source?: "daily" | "event";
  daily?: DailyRecording;
  eventWindow?: EventRecordingWindow;
  replay?: EventReplay;
  // 목록 응답의 재생 요약이다. 상세 응답의 replay를 받으면 replay가 우선한다.
  playbackSummary?: EventPlaybackSummary;
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
  type: "수거" | "알림" | "오류" | "날짜 녹화";
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

export type DataReception = {
  status: "waiting" | "connected" | "error";
  lastReceivedAt: string | null;
};

export type MonitoringV2 = {
  simulated?: boolean;
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
  reception: DataReception;
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
    // undefined는 아직 조회하지 않음, null은 조회 실패 또는 미지원이다.
    measurementLayout?: MeasurementLayoutStatus | null;
    loadHistory: LoadHistorySample[];
    status: DashboardStatus;
    v2?: MonitoringV2;
    activeAlertsState?: {
      evaluationState: "NORMAL" | "WARNING" | "CRITICAL" | "UNKNOWN" | "ERROR";
      reasonCodes: string[];
      coverage: ActiveAlertCoverage[];
    } | null;
    summary: MonitoringSummary;
    videoMode: "sample" | "webrtc" | "mjpeg";
    videoUrl?: string;
    videoStatus: "available" | "delayed" | "unavailable";
    videoStreamId: string;
    videoCapturedAt: string | null;
  };
  recordings: Recording[];
  recordingsSource?: "daily" | "event";
  recordingsState?: DataAreaState;
  // 녹화 화면의 첫 목록을 만든 목록 핸들이며 이후 페이지를 이어서 가져온다.
  recordingsList?: RecordingList;
  recordingsTotal?: number;
};
