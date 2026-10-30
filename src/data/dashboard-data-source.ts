import type {
  AlertSettings,
  DashboardData,
  EventCategory,
  HistoryEventPage,
  NotificationRecipient,
  RecipientSettings,
  RecordingCoverageDetail,
  RecordingList,
  UserSession,
} from "../domain/dashboard";

export type DashboardDataRequestOptions = {
  signal?: AbortSignal;
};

export type DashboardDataUpdateListener = (data: DashboardData) => void;

export type DateRangeQuery = {
  recordingSource?: "daily" | "event" | "all";
  eventCategory?: EventCategory;
  from: string;
  to: string;
};

export type HistoryEventQuery = DateRangeQuery & {
  // 0부터 시작하는 표 페이지 번호와 페이지 크기이다.
  page: number;
  pageSize: number;
};

export type SessionCredentials = {
  password: string;
  persistent: boolean;
  username: string;
};

export type NotificationRecipientInput = {
  recipient: Omit<NotificationRecipient, "id" | "version" | "channel">;
  settings: RecipientSettings;
};

export type NotificationRecipientResult = {
  recipient: NotificationRecipient;
  settings: RecipientSettings;
};

export type DailyRecordingDeletion = {
  /** deleted: 204 응답, reflected: 오류 응답 뒤 재조회로 삭제 반영을 확인함(공간 정리 여부는 확인 불가) */
  outcome: "deleted" | "reflected";
};

export interface DashboardDataSource {
  monitoringVersion?: "v1" | "v2";
  supportsDailyRecordings?: boolean;
  supportsEventRecordingRangeLimit?: boolean;
  createNotificationRecipient?(input: NotificationRecipientInput): Promise<NotificationRecipientResult>;
  createSession?(credentials: SessionCredentials): Promise<UserSession>;
  deleteSession?(): Promise<void>;
  getDashboardData(options?: DashboardDataRequestOptions): Promise<DashboardData>;
  getRecording?(recordingId: string, signal?: AbortSignal, source?: "daily" | "event"): Promise<DashboardData["recordings"][number] | null>;
  deleteDailyRecording?(recordingId: string, signal?: AbortSignal): Promise<DailyRecordingDeletion>;
  prepareDailyRecordingExport?(recordingId: string, signal?: AbortSignal): Promise<DashboardData["recordings"][number]>;
  getRecordingCoverage?(recordingId: string, signal?: AbortSignal): Promise<RecordingCoverageDetail>;
  markAllNotificationsRead?(): Promise<void>;
  markNotificationRead?(notificationId: string): Promise<void>;
  queryHistory?(query: DateRangeQuery, signal?: AbortSignal): Promise<DashboardData["history"]>;
  /** 이벤트 표의 한 페이지만 서버에서 조회한다. 제공하면 queryHistory의 events는 사용하지 않는다. */
  queryHistoryEvents?(query: HistoryEventQuery, signal?: AbortSignal): Promise<HistoryEventPage>;
  /** 녹화 목록을 페이지 단위로 이어서 가져오는 핸들을 만든다. */
  openRecordingList?(query: DateRangeQuery): RecordingList;
  queryRecordings?(query: DateRangeQuery, signal?: AbortSignal): Promise<DashboardData["recordings"]>;
  replaceAlertSettings?(settings: AlertSettings): Promise<AlertSettings>;
  sendTestNotification?(recipientId: string, channels: Array<"email" | "sms">): Promise<void>;
  subscribe?(listener: DashboardDataUpdateListener): () => void;
  updateNotificationRecipient?(recipient: NotificationRecipient, settings: RecipientSettings): Promise<NotificationRecipientResult>;
}
