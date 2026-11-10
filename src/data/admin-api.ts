import type { components as BackendComponents } from "../generated/backend-contract";
import type { components } from "../generated/api-contract";
import type { AlertSettings, EmailDeliveryReceipt, NotificationRecipient, RecipientSettings } from "../domain/dashboard";
import type { NotificationRecipientInput } from "./dashboard-data-source";
import type { paths } from "../generated/api-contract";
import type { paths as BackendPaths } from "../generated/backend-contract";
import { listEveryPage } from "./list-every-page";
import { pathWithId, record, timestamp } from "./contract-values";

const API_PATHS = {
  alertSettings: "/api/v1/settings/alerts",
  notificationRecipient: "/api/v1/notification-recipients/{recipientId}",
  notificationRecipients: "/api/v1/notification-recipients",
  testNotification: "/api/v1/notifications/test",
} as const satisfies Record<string, keyof paths & keyof BackendPaths>;

const EMAIL_DELIVERY_PATH = "/api/v1/notifications/email-deliveries/{delivery_id}" as const satisfies keyof BackendPaths;

// 관리자 화면 전용 요청과 변환이다. 관리자 화면에서 처음 쓸 때 불러온다.
type AdminContext = {
  pitPath: (path: string) => string;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};

type ApiAlertSettings = BackendComponents["schemas"]["AlertSettings"];
type ApiRecipient = BackendComponents["schemas"]["NotificationRecipient"];

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

export function recipientSettings(recipient: ApiRecipient): RecipientSettings {
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
    channel: recipient.channels.includes("email") ? "이메일" : "-",
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

export async function fetchRecipients({ request }: AdminContext, signal?: AbortSignal) {
  const apiRecipients = await listEveryPage<ApiRecipient>(request, API_PATHS.notificationRecipients, signal);
  return {
    recipients: apiRecipients.map(mapRecipient),
    settings: Object.fromEntries(apiRecipients.map((recipient) => [recipient.email, recipientSettings(recipient)])),
  };
}

export async function fetchAlertSettings({ pitPath, request }: AdminContext, signal?: AbortSignal) {
  return mapAlertSettings(await request<ApiAlertSettings>(pitPath(API_PATHS.alertSettings), { signal }));
}

export async function createRecipient({ request }: AdminContext, input: NotificationRecipientInput) {
  const body = {
    ...recipientPreferences(input.settings),
    email: input.recipient.email,
    name: input.recipient.name,
    phone: input.recipient.phone === "-" ? null : input.recipient.phone,
    team: input.recipient.team,
  } satisfies BackendComponents["schemas"]["NotificationRecipientCreate"] & components["schemas"]["NotificationRecipientCreate"];
  return mapRecipientResult(await request<ApiRecipient>(API_PATHS.notificationRecipients, { method: "POST", body: JSON.stringify(body) }));
}

export async function replaceAlertSettings({ pitPath, request }: AdminContext, settings: AlertSettings) {
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
}

export async function updateRecipient({ request }: AdminContext, recipient: NotificationRecipient, settings: RecipientSettings) {
  const body = recipientPreferences(settings) satisfies BackendComponents["schemas"]["NotificationRecipientPatch"] & components["schemas"]["NotificationRecipientPatch"];
  return mapRecipientResult(await request<ApiRecipient>(pathWithId(API_PATHS.notificationRecipient, "recipientId", recipient.id), {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/merge-patch+json", "If-Match": recipient.version },
    method: "PATCH",
  }));
}

const VALID_EMAIL_DELIVERY_STATUSES = new Set(["QUEUED", "SENDING", "SENT", "FAILED", "UNCERTAIN", "CANCELLED"]);
const VALID_PHASES = new Set(["ALERT", "RECOVERY", "TEST"]);

function isValidUtcIso(value: unknown): value is string {
  return typeof value === "string" && timestamp(value) && /(?:Z|\+00:00)$/i.test(value);
}

function isValidUtcIsoOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  return typeof value === "string" && timestamp(value) && /(?:Z|\+00:00)$/i.test(value);
}

export function parseEmailDeliveryReceipt(value: unknown): EmailDeliveryReceipt {
  if (!record(value)) {
    throw new Error("Invalid EmailDeliveryReceipt: must be an object");
  }
  const { attempted_at, attempts, completed_at, due_at, error_code, id, phase, pit_id, recipient_id, status } = value;

  if (typeof id !== "string" || !id) {
    throw new Error("Invalid EmailDeliveryReceipt: id must be a non-empty string");
  }
  if (typeof status !== "string" || !VALID_EMAIL_DELIVERY_STATUSES.has(status)) {
    throw new Error(`Invalid EmailDeliveryReceipt: unknown status '${String(status)}'`);
  }
  if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 0) {
    throw new Error("Invalid EmailDeliveryReceipt: attempts must be a non-negative integer");
  }
  if (error_code !== null && typeof error_code !== "string") {
    throw new Error("Invalid EmailDeliveryReceipt: error_code must be string or null");
  }
  if (!isValidUtcIso(due_at)) {
    throw new Error("Invalid EmailDeliveryReceipt: due_at must be valid UTC ISO timestamp");
  }
  if (!isValidUtcIsoOrNull(attempted_at)) {
    throw new Error("Invalid EmailDeliveryReceipt: attempted_at must be valid UTC ISO timestamp or null");
  }
  if (!isValidUtcIsoOrNull(completed_at)) {
    throw new Error("Invalid EmailDeliveryReceipt: completed_at must be valid UTC ISO timestamp or null");
  }
  if (typeof phase !== "string" || !VALID_PHASES.has(phase)) {
    throw new Error(`Invalid EmailDeliveryReceipt: unknown phase '${String(phase)}'`);
  }
  if (typeof pit_id !== "string" || !pit_id) {
    throw new Error("Invalid EmailDeliveryReceipt: pit_id must be a non-empty string");
  }
  if (typeof recipient_id !== "string" || !recipient_id) {
    throw new Error("Invalid EmailDeliveryReceipt: recipient_id must be a non-empty string");
  }

  return {
    attemptedAt: attempted_at,
    attempts,
    completedAt: completed_at,
    dueAt: due_at,
    errorCode: error_code,
    id,
    phase: phase as EmailDeliveryReceipt["phase"],
    pitId: pit_id,
    recipientId: recipient_id,
    status: status as EmailDeliveryReceipt["status"],
  };
}

export async function sendTestNotification(
  { request }: AdminContext,
  recipientId: string,
  channels: readonly ("email")[],
  signal?: AbortSignal,
): Promise<string | null> {
  const body = { channels, recipientId } satisfies BackendComponents["schemas"]["TestNotificationRequest"] & components["schemas"]["TestNotificationRequest"];
  const raw = await request<unknown>(API_PATHS.testNotification, { body: JSON.stringify(body), method: "POST", signal });
  if (record(raw) && typeof raw.emailDeliveryId === "string" && /^[A-Za-z0-9-]{36}$/.test(raw.emailDeliveryId)) {
    return raw.emailDeliveryId;
  }
  return null;
}

export async function getEmailDelivery(
  { request }: AdminContext,
  id: string,
  signal?: AbortSignal,
): Promise<EmailDeliveryReceipt> {
  const path = pathWithId(EMAIL_DELIVERY_PATH, "delivery_id", id);
  const raw = await request<unknown>(path, { signal });
  return parseEmailDeliveryReceipt(raw);
}

export async function fetchAdminInitial(context: AdminContext, signal?: AbortSignal) {
  const [settings, recipients] = await Promise.all([
    fetchAlertSettings(context, signal),
    fetchRecipients(context, signal),
  ]);
  return {
    alertSettings: settings,
    preCollectionAlert: settings.preCollectionAlert,
    recipientSettings: recipients.settings,
    recipients: [...recipients.recipients],
  };
}

export function emptyAlertSettings(): AlertSettings {
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
