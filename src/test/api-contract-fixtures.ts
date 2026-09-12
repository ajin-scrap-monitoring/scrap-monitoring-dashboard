import type { components } from "../generated/api-contract.js";

export const sessionFixture = {
  csrfToken: "csrf-contract-example",
  expiresAt: "2026-09-11T10:24:20+09:00",
  user: { displayName: "계약 관리자", id: "user-contract", role: "administrator" },
} satisfies components["schemas"]["Session"];

export const monitoringFixture = {
  activeAlerts: [
    {
      detail: "대표 적재율이 사전 알림 기준에 도달했습니다.",
      id: "alert-contract-1",
      occurredAt: "2026-09-10T10:20:00+09:00",
      severity: "warning",
      title: "수거 예정",
      type: "pre_collection_alert",
    },
  ],
  devices: [
    { displayName: "LiDAR 1", id: "lidar-1", lastReceivedAt: "2026-09-10T10:24:18+09:00", latencyMilliseconds: 120, status: "normal", type: "lidar" },
    { displayName: "LiDAR 2", id: "lidar-2", lastReceivedAt: "2026-09-10T10:24:18+09:00", latencyMilliseconds: 135, status: "normal", type: "lidar" },
    { displayName: "카메라", id: "camera-main", lastReceivedAt: "2026-09-10T10:24:17+09:00", latencyMilliseconds: 180, status: "normal", type: "camera" },
    { displayName: "엣지 장비", id: "edge-main", lastReceivedAt: "2026-09-10T10:24:18+09:00", latencyMilliseconds: 95, status: "normal", type: "edge" },
  ],
  lidarProfiles: [
    {
      average: 1.8,
      lidarId: "lidar-1",
      maximum: 2.4,
      measuredAt: "2026-09-10T10:24:18+09:00",
      minimum: 1.2,
      samples: [
        { height: 1.2, positionRatio: 0, valid: true },
        { height: 2.4, positionRatio: 1, valid: true },
      ],
      unit: "m",
    },
    {
      average: 1.7,
      lidarId: "lidar-2",
      maximum: 2.6,
      measuredAt: "2026-09-10T10:24:18+09:00",
      minimum: 1,
      samples: [
        { height: 1, positionRatio: 0, valid: true },
        { height: 2.6, positionRatio: 1, valid: true },
      ],
      unit: "m",
    },
  ],
  measuredAt: "2026-09-10T10:24:18+09:00",
  operationState: "accumulating",
  recentLoad: Array.from({ length: 24 }, (_, index) => ({
    measuredAt: `2026-09-${index < 13 ? "09" : "10"}T${String((index + 11) % 24).padStart(2, "0")}:00:00+09:00`,
    valid: true,
    valuePercent: 49 + index,
  })),
  schemaVersion: "1",
  serverTime: "2026-09-10T10:24:20+09:00",
  snapshotId: "snapshot-contract-1",
  summary: {
    averageCollectionCycleSeconds: 83400,
    collectionThresholdPercent: 80,
    expectedThresholdAt: "2026-09-10T14:30:20+09:00",
    lastCollectionAt: "2026-09-10T08:24:20+09:00",
    loadChangeLastHourPercentagePoints: 4,
    loadPercent: 72,
    preCollectionAlert: { enabled: true, thresholdPercent: 70 },
  },
  systemStatus: "normal",
  video: { capturedAt: "2026-09-10T10:24:18+09:00", status: "available", streamId: "camera-main" },
} satisfies components["schemas"]["MonitoringSnapshot"];

export const loadHistoryFixture = {
  bucketSeconds: 3600,
  collectionThresholds: [
    { effectiveAt: "2026-09-03T00:00:00+09:00", valuePercent: 80 },
    { effectiveAt: "2026-09-08T00:00:00+09:00", valuePercent: 85 },
  ],
  eventMarkers: [
    {
      category: "alert",
      detail: "대표 적재율 85% 도달",
      id: "event-contract-1",
      occurredAt: "2026-09-09T12:17:00+09:00",
      severity: "warning",
      title: "수거 필요",
      type: "collection_required",
      valuePercent: 85,
    },
    {
      category: "collection",
      detail: "정기 수거 작업 완료",
      id: "event-contract-2",
      occurredAt: "2026-09-09T12:42:00+09:00",
      severity: "info",
      title: "수거 완료",
      type: "collection_completed",
      valuePercent: 4,
    },
    {
      category: "error",
      detail: "LiDAR 2 일부 측정값 제외",
      id: "event-contract-3",
      occurredAt: "2026-09-08T18:00:00+09:00",
      severity: "error",
      title: "측정 오류",
      type: "measurement_error",
      valuePercent: 61,
    },
  ],
  from: "2026-09-03T00:00:00+09:00",
  samples: [
    { measuredAt: "2026-09-03T00:00:00+09:00", valid: true, valuePercent: 40 },
    { measuredAt: "2026-09-09T12:00:00+09:00", valid: true, valuePercent: 79 },
    { measuredAt: "2026-09-09T13:00:00+09:00", valid: true, valuePercent: 4 },
    { measuredAt: "2026-09-10T00:00:00+09:00", valid: true, valuePercent: 38 },
  ],
  to: "2026-09-10T00:00:00+09:00",
} satisfies components["schemas"]["LoadHistory"];

export const eventFixture = {
  category: "alert",
  detail: "대표 적재율 85% 도달",
  id: "event-contract-1",
  occurredAt: "2026-09-09T12:17:00+09:00",
  recordingId: "recording-contract-1",
  resolvedAt: "2026-09-09T12:42:00+09:00",
  severity: "warning",
  status: "resolved",
  title: "수거 필요",
  type: "collection_required",
} satisfies components["schemas"]["Event"];

export const eventPageFixture = {
  items: [eventFixture],
  page: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
} satisfies components["schemas"]["EventPage"];

export const notificationPageFixture = {
  items: [
    {
      detail: "대표 적재율이 사전 알림 기준에 도달했습니다.",
      id: "notification-contract-1",
      occurredAt: "2026-09-10T10:20:00+09:00",
      readAt: null,
      severity: "warning",
      title: "수거 예정",
      type: "pre_collection_alert",
    },
  ],
  page: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
  unreadCount: 1,
} satisfies components["schemas"]["NotificationPage"];

export const recordingFixture = {
  containerFormat: "mp4",
  contentPath: "/api/v1/recordings/recording-contract-1/content",
  detail: "대표 적재율이 수거 임계율에 도달했습니다.",
  downloadPath: "/api/v1/recordings/recording-contract-1/download",
  durationSeconds: 86400,
  endedAt: "2026-09-09T23:59:59+09:00",
  eventCategory: "alert",
  frameRate: 30,
  heightPixels: 480,
  id: "recording-contract-1",
  retainedFrom: "2026-09-09T00:00:00+09:00",
  retainedUntil: "2026-10-09T23:59:59+09:00",
  sizeBytes: 1932735283,
  startedAt: "2026-09-09T00:00:00+09:00",
  status: "available",
  thumbnailPath: "/api/v1/recordings/recording-contract-1/thumbnail",
  title: "수거 필요",
  videoCodec: "h264",
  widthPixels: 640,
} satisfies components["schemas"]["Recording"];

export const recordingPageFixture = {
  items: [recordingFixture],
  page: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
} satisfies components["schemas"]["RecordingPage"];

export const alertSettingsFixture = {
  collectionThresholdPercent: 80,
  eventTypes: ["collection_required", "measurement_error", "device_error"],
  maximumRepeatCount: 3,
  preCollectionAlert: { enabled: true, thresholdPercent: 70 },
  recoveryNotificationEnabled: true,
  repeatIntervalMinutes: 30,
  sendDelayMinutes: 0,
  version: '"settings-contract-v1"',
} satisfies components["schemas"]["AlertSettings"];

export const recipientFixture = {
  channels: ["email", "sms"],
  email: "operator@example.com",
  enabled: true,
  eventTypes: ["collection_required", "measurement_error", "device_error"],
  id: "recipient-contract-1",
  name: "계약 담당자",
  phone: "010-0000-0000",
  subscriptionMode: "global",
  team: "생산관리팀",
  version: '"recipient-contract-v1"',
} satisfies components["schemas"]["NotificationRecipient"];

export const recipientPageFixture = {
  items: [recipientFixture],
  page: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
} satisfies components["schemas"]["NotificationRecipientPage"];
