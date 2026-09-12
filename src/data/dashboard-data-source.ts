import type {
  AlertSettings,
  DashboardData,
  EventCategory,
  NotificationRecipient,
  RecipientSettings,
  UserSession,
} from "../domain/dashboard";

export type DashboardDataRequestOptions = {
  signal?: AbortSignal;
};

export type DashboardDataUpdateListener = (data: DashboardData) => void;

export type DateRangeQuery = {
  eventCategory?: EventCategory;
  from: string;
  to: string;
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

export interface DashboardDataSource {
  createNotificationRecipient?(input: NotificationRecipientInput): Promise<NotificationRecipientResult>;
  createSession?(credentials: SessionCredentials): Promise<UserSession>;
  deleteSession?(): Promise<void>;
  getDashboardData(options?: DashboardDataRequestOptions): Promise<DashboardData>;
  markAllNotificationsRead?(): Promise<void>;
  markNotificationRead?(notificationId: string): Promise<void>;
  queryHistory?(query: DateRangeQuery): Promise<DashboardData["history"]>;
  queryRecordings?(query: DateRangeQuery): Promise<DashboardData["recordings"]>;
  replaceAlertSettings?(settings: AlertSettings): Promise<AlertSettings>;
  sendTestNotification?(recipientId: string, channels: Array<"email" | "sms">): Promise<void>;
  subscribe?(listener: DashboardDataUpdateListener): () => void;
  updateNotificationRecipient?(recipient: NotificationRecipient, settings: RecipientSettings): Promise<NotificationRecipientResult>;
}
