import type { DashboardData, DashboardStatus } from "../domain/dashboard";
import { clearAuthentication, hasAuthenticationSession, setAuthenticated } from "../app-routing";
import { dateTimeValue } from "../date-range";

import type { DashboardDataRequestOptions, DashboardDataSource, DateRangeQuery } from "./dashboard-data-source";

export type MockScenario = DashboardStatus | "empty-lists" | "live-update" | "operation-cycle" | "loading" | "request-error";

const mockScenarios = ["normal", "collection-required", "measurement-error", "disconnected", "no-data", "empty-lists", "live-update", "operation-cycle", "loading", "request-error"] as const satisfies readonly MockScenario[];

const loadHistoryTimes = [
  "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00",
  "17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00", "00:00",
  "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00", "08:00",
];

const baseDashboardData: DashboardData = {
  lastMeasuredAt: "10:24:18",
  session: null,
  monitoring: {
    status: "normal",
    videoMode: "sample",
    videoStatus: "available",
    videoStreamId: "camera-main",
    videoTimestamp: "2026-09-10 10:24:18",
    summary: { loadPercent: 72, collectionThreshold: 80, expectedArrivalAt: "9월 10일 14:30", operationState: "accumulating", preCollectionAlert: { enabled: true, threshold: 70 }, recentChange: "+4%", remainingTime: "4시간 6분", timeSinceCollection: "2시간 0분", averageCollectionCycle: "23시간 10분" },
    devices: [
      { label: "LiDAR 1", received: "10:24:18", latency: "120ms", status: "normal" },
      { label: "LiDAR 2", received: "10:24:18", latency: "135ms", status: "normal" },
      { label: "카메라", received: "10:24:16", latency: "180ms", status: "normal" },
      { label: "엣지 장비", received: "10:24:17", latency: "95ms", status: "normal" },
    ],
    alerts: [
      { detail: "대표 적재율 82%", id: "alert-1", level: "warning", time: "10:20", title: "수거 필요" },
      { detail: "LiDAR 2 일부 측정 불가", id: "alert-2", level: "error", time: "10:18", title: "측정 오류" },
      { detail: "임계율 도달 예상 4시간 전", id: "alert-3", level: "warning", time: "10:02", title: "수거 예정" },
      { detail: "카메라 프레임 수신 지연", id: "alert-4", level: "error", time: "09:58", title: "영상 지연" },
      { detail: "온도 센서 값 변동", id: "alert-5", level: "warning", time: "09:45", title: "안정성 경보" },
      { detail: "LiDAR 1 점군 밀도 저하", id: "alert-6", level: "warning", time: "09:40", title: "센서 감도 경고" },
      { detail: "엣지 장비 CPU 사용률 상승", id: "alert-7", level: "warning", time: "09:31", title: "자원 모니터링" },
    ],
    headerNotifications: [
      { id: "notification-1", title: "수거 필요", detail: "대표 적재율이 수거 임계율에 도달했습니다.", level: "warning", read: false, time: "10:20" },
      { id: "notification-2", title: "측정 오류", detail: "LiDAR 2 일부 측정값을 제외했습니다.", level: "error", read: false, time: "10:18" },
      { id: "notification-3", title: "수거 예정", detail: "수거 임계율 도달이 예상됩니다.", level: "warning", read: false, time: "10:02" },
      { id: "notification-4", title: "영상 지연", detail: "카메라 프레임 수신이 지연되었습니다.", level: "error", read: true, time: "09:58" },
    ],
    unreadNotificationCount: 3,
    loadHistory: loadHistoryTimes.map((time, index) => ({
      measuredAt: `2026-09-${index < 15 ? "09" : "10"}T${time}:00+09:00`,
      time,
      value: [44, 46, 48, 49, 51, 53, 54, 56, 58, 59, 61, 62, 64, 65, 66, 67, 68, 69, 69, 70, 70, 71, 71, 72][index],
    })),
    lidarProfiles: [
      { average: "1.8 m", color: "blue", label: "LiDAR 1", minimum: "1.2 m", maximum: "2.4 m", samples: [1.8, 1.9, 1.8, 2.1, 2.2, 2.0, 1.9, 2.1, 2.3, 2.0, 2.2].map((height, index, values) => ({ height, positionRatio: index / (values.length - 1) })) },
      { average: "1.7 m", color: "teal", label: "LiDAR 2", minimum: "1.0 m", maximum: "2.6 m", samples: [1.4, 1.5, 1.7, 1.9, 2.2, 2.4, 2.3, 2.6, 2.1, 2.0, 2.3].map((height, index, values) => ({ height, positionRatio: index / (values.length - 1) })) },
    ],
  },
  history: {
    startsAt: "2026-09-03T00:00",
    endsAt: "2026-09-10T00:00",
    events: [
      { id: "event-1", recordingId: "recording-1", time: "2026-09-09 12:33", type: "수거", tone: "complete", status: "완료", content: "정기 수거 작업 완료" },
      { id: "event-2", recordingId: "recording-1", time: "2026-09-09 12:00", type: "알림", tone: "warning", status: "발생", content: "대표 적재율 80% 도달" },
      { id: "event-3", recordingId: "recording-2", time: "2026-09-08 18:00", type: "오류", tone: "error", status: "발생", content: "LiDAR 2 측정값 제외" },
      { id: "event-4", recordingId: "recording-2", time: "2026-09-08 12:33", type: "수거", tone: "complete", status: "완료", content: "정기 수거 작업 완료" },
      { id: "event-5", recordingId: "recording-2", time: "2026-09-08 12:00", type: "알림", tone: "warning", status: "발생", content: "대표 적재율 80% 도달" },
      { id: "event-6", recordingId: "recording-3", time: "2026-09-07 12:33", type: "수거", tone: "complete", status: "완료", content: "정기 수거 작업 완료" },
      { id: "event-7", recordingId: "recording-3", time: "2026-09-07 12:00", type: "알림", tone: "warning", status: "발생", content: "대표 적재율 80% 도달" },
      { id: "event-8", recordingId: "recording-4", time: "2026-09-06 12:33", type: "수거", tone: "complete", status: "완료", content: "정기 수거 작업 완료" },
      { id: "event-9", recordingId: "recording-4", time: "2026-09-06 12:00", type: "알림", tone: "warning", status: "발생", content: "대표 적재율 80% 도달" },
    ],
    loadSamples: [
      ...Array.from({ length: 7 }, (_, day) => [
        { hour: day * 24, value: 40 },
        { hour: day * 24 + 6, value: 60 },
        { hour: day * 24 + 12, value: 80 },
        { hour: day * 24 + 12.55, value: 0 },
        { hour: day * 24 + 18, value: 20 },
      ]).flat(),
      { hour: 168, value: 40 },
    ],
    chartEvents: [
      ...Array.from({ length: 7 }, (_, day) => [
        { id: `chart-need-${day}`, hour: day * 24 + 12, value: 80, label: "수거 필요" as const, color: "#f58a07", time: `2026-09-${String(day + 3).padStart(2, "0")} 12:00`, detail: "대표 적재율 80% 도달" },
        { id: `chart-complete-${day}`, hour: day * 24 + 12.55, value: 0, label: "수거 완료" as const, color: "#0aa45b", time: `2026-09-${String(day + 3).padStart(2, "0")} 12:33`, detail: "정기 수거 작업 완료" },
      ]).flat(),
      { id: "chart-error-1", hour: 138, value: 20, label: "오류" as const, color: "#e83232", time: "2026-09-08 18:00", detail: "LiDAR 2 측정값 제외" },
    ],
    thresholds: [{ hour: 0, value: 80 }],
  },
  recordings: [
    ...["2026-09-09", "2026-09-08", "2026-09-07", "2026-09-06", "2026-09-05", "2026-09-04", "2026-09-03", "2026-09-02"].map((date, index) => ({
      codec: "H.264",
      date,
      detail: (["정기 수거 작업 완료", "대표 적재율 80% 도달", "LiDAR 2 측정값 제외", "정기 수거 작업 완료", "대표 적재율 80% 도달", "정기 수거 작업 완료", "카메라 프레임 수신 지연", "정기 수거 작업 완료"] as const)[index],
      duration: "24:00:00",
      end: `${date} 23:59:59`,
      format: "MP4",
      frameRate: 30,
      height: 480,
      id: `recording-${index + 1}`,
      retentionEndsAt: `2026-10-${date.slice(-2)} 23:59:59`,
      retentionStartsAt: `${date} 00:00:00`,
      sample: true,
      size: "1.8 GB",
      start: `${date} 00:00:00`,
      status: "available" as const,
      time: "00:00 - 23:59",
      tone: (["complete", "warning", "error", "complete", "warning", "complete", "error", "complete"] as const)[index],
      type: (["수거", "알림", "오류", "수거", "알림", "수거", "오류", "수거"] as const)[index],
      width: 640,
    })),
  ],
  admin: {
    alertSettings: {
      collectionThreshold: 80,
      enabledEventTypes: ["collection_required", "measurement_error", "device_error"],
      maximumRepeatCount: 3,
      preCollectionAlert: { enabled: true, threshold: 70 },
      recoveryNotificationEnabled: true,
      repeatIntervalMinutes: 30,
      sendDelayMinutes: 0,
      version: '"settings-v1"',
    },
    preCollectionAlert: { enabled: true, threshold: 70 },
    recipients: [
      { id: "recipient-1", version: '"recipient-v1"', name: "김현수", team: "생산관리팀", email: "kim@example.com", phone: "010-****-1234", channel: "이메일, 문자", enabled: true },
      { id: "recipient-2", version: '"recipient-v1"', name: "박영진", team: "설비보전팀", email: "park@example.com", phone: "010-****-5678", channel: "문자", enabled: true },
      { id: "recipient-3", version: '"recipient-v1"', name: "이정민", team: "품질관리팀", email: "lee@example.com", phone: "-", channel: "이메일", enabled: false },
      { id: "recipient-4", version: '"recipient-v1"', name: "최민석", team: "생산1팀", email: "choi@example.com", phone: "010-****-9012", channel: "이메일, 문자", enabled: true },
      { id: "recipient-5", version: '"recipient-v1"', name: "윤서연", team: "생산2팀", email: "yoon@example.com", phone: "010-****-3456", channel: "문자", enabled: true },
      { id: "recipient-6", version: '"recipient-v1"', name: "정우진", team: "안전환경팀", email: "jung@example.com", phone: "010-****-7890", channel: "이메일, 문자", enabled: true },
      { id: "recipient-7", version: '"recipient-v1"', name: "한지훈", team: "설비보전팀", email: "han@example.com", phone: "010-****-2468", channel: "이메일", enabled: true },
      { id: "recipient-8", version: '"recipient-v1"', name: "오수빈", team: "생산관리팀", email: "oh@example.com", phone: "010-****-1357", channel: "문자", enabled: false },
      { id: "recipient-9", version: '"recipient-v1"', name: "문지아", team: "안전환경팀", email: "moon@example.com", phone: "010-****-0246", channel: "이메일, 문자", enabled: true },
      { id: "recipient-10", version: '"recipient-v1"', name: "서준호", team: "생산1팀", email: "seo@example.com", phone: "010-****-8024", channel: "이메일", enabled: true },
      { id: "recipient-11", version: '"recipient-v1"', name: "강민지", team: "품질관리팀", email: "kang@example.com", phone: "010-****-9135", channel: "이메일, 문자", enabled: true },
    ],
    recipientSettings: {
      "kim@example.com": { collection: true, device: true, email: true, enabled: true, error: true, sms: true, useGlobal: true },
      "park@example.com": { collection: true, device: false, email: false, enabled: true, error: true, sms: true, useGlobal: false },
      "lee@example.com": { collection: false, device: false, email: true, enabled: false, error: true, sms: false, useGlobal: false },
      "choi@example.com": { collection: true, device: true, email: true, enabled: true, error: true, sms: true, useGlobal: true },
      "yoon@example.com": { collection: true, device: false, email: false, enabled: true, error: false, sms: true, useGlobal: false },
      "jung@example.com": { collection: true, device: true, email: true, enabled: true, error: true, sms: true, useGlobal: true },
      "han@example.com": { collection: false, device: true, email: true, enabled: true, error: true, sms: false, useGlobal: false },
      "oh@example.com": { collection: true, device: false, email: false, enabled: false, error: false, sms: true, useGlobal: false },
      "moon@example.com": { collection: true, device: true, email: true, enabled: true, error: true, sms: true, useGlobal: true },
      "seo@example.com": { collection: false, device: true, email: true, enabled: true, error: true, sms: false, useGlobal: false },
      "kang@example.com": { collection: true, device: true, email: true, enabled: true, error: true, sms: true, useGlobal: true },
    },
  },
};

function dashboardDataFor(scenario: MockScenario): DashboardData {
  const data = structuredClone(baseDashboardData);
  data.monitoring.status = scenario === "collection-required" || scenario === "measurement-error" || scenario === "disconnected" || scenario === "no-data"
    ? scenario
    : "normal";

  switch (scenario) {
    case "collection-required":
      data.monitoring.alerts[0] = { detail: "대표 적재율 84%", id: "alert-1", level: "warning", time: "10:24", title: "수거 필요" };
      break;
    case "measurement-error":
      data.monitoring.devices[1] = { label: "LiDAR 2", received: "10:18:04", latency: "-", status: "unavailable" };
      break;
    case "disconnected":
      data.monitoring.devices = data.monitoring.devices.map((device) => ({ ...device, latency: "수신 없음", status: "unavailable" }));
      break;
    case "no-data":
      data.monitoring.alerts = [];
      data.monitoring.devices = [];
      data.monitoring.headerNotifications = [];
      data.monitoring.unreadNotificationCount = 0;
      data.monitoring.lidarProfiles = [];
      data.monitoring.loadHistory = [];
      data.history.chartEvents = [];
      data.history.events = [];
      data.history.loadSamples = [];
      data.recordings = [];
      data.admin.recipientSettings = {};
      data.admin.recipients = [];
      break;
    case "empty-lists":
      data.monitoring.alerts = [];
      data.monitoring.headerNotifications = [];
      data.monitoring.unreadNotificationCount = 0;
      data.history.chartEvents = [];
      data.history.events = [];
      data.recordings = [];
      data.admin.recipientSettings = {};
      data.admin.recipients = [];
      break;
    default:
      break;
  }

  return data;
}

function liveUpdateDashboardData() {
  const data = dashboardDataFor("normal");
  data.lastMeasuredAt = "10:24:21";
  data.monitoring.videoTimestamp = "2026-09-10 10:24:21";
  data.monitoring.summary.loadPercent = 75;
  data.monitoring.summary.recentChange = "+5%";
  data.monitoring.loadHistory[data.monitoring.loadHistory.length - 1].value = 75;
  data.monitoring.alerts[0] = { detail: "대표 적재율 75%", id: "alert-1", level: "warning", time: "10:24", title: "수거 예정" };
  return data;
}

function operationCycleData(step: number) {
  const data = dashboardDataFor("normal");
  if (step === 0) {
    data.monitoring.status = "collection-required";
    data.monitoring.summary.loadPercent = 80;
    data.monitoring.alerts[0] = {
      detail: "대표 적재율 80%",
      id: "alert-1",
      level: "warning",
      time: "10:25",
      title: "수거 필요",
    };
  }
  if (step === 1) {
    data.monitoring.summary.loadPercent = 4;
    data.monitoring.summary.recentChange = "-76%";
    data.monitoring.alerts[0] = {
      detail: "수거 작업이 완료되었습니다.",
      id: "alert-1",
      level: "warning",
      time: "10:26",
      title: "수거 완료",
    };
  }
  if (step === 2) {
    data.monitoring.status = "measurement-error";
    data.monitoring.devices[1] = {
      label: "LiDAR 2",
      received: "10:27:01",
      latency: "-",
      status: "unavailable",
    };
  }
  if (step === 3) {
    data.monitoring.status = "disconnected";
    data.monitoring.devices = data.monitoring.devices.map((device) => ({
      ...device,
      latency: "수신 없음",
      status: "unavailable",
    }));
  }
  return data;
}

function waitForMockLoading(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = window.setTimeout(finish, 1200);
    const abort = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("합성 데이터 요청이 취소되었습니다.", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function createMockDashboardDataSource(scenario: MockScenario = "normal"): DashboardDataSource {
  let currentData = dashboardDataFor(scenario);
  const withSession = () => {
    currentData.session = hasAuthenticationSession() ? {
      expiresAt: "2026-09-11T10:24:18+09:00",
      user: { displayName: "관리자", id: "user-admin", role: "administrator" },
    } : null;
    return structuredClone(currentData);
  };
  const eventMatches = (type: "수거" | "알림" | "오류", category?: DateRangeQuery["eventCategory"]) => !category
    || (category === "collection" && type === "수거")
    || (category === "alert" && type === "알림")
    || (category === "error" && type === "오류");
  const inRange = (time: string, query: DateRangeQuery) => {
    const value = dateTimeValue(time);
    return value >= dateTimeValue(query.from) && value <= dateTimeValue(query.to);
  };

  return {
    createNotificationRecipient: ({ recipient, settings }) => {
      const created = {
        ...recipient,
        channel: settings.email && settings.sms ? "이메일, 문자" : settings.email ? "이메일" : "문자",
        id: `recipient-${currentData.admin.recipients.length + 1}`,
        version: '"recipient-v1"',
      };
      currentData.admin.recipients.push(created);
      currentData.admin.recipientSettings[created.email] = structuredClone(settings);
      return Promise.resolve({ recipient: structuredClone(created), settings: structuredClone(settings) });
    },
    createSession: () => {
      setAuthenticated();
      return Promise.resolve({
        expiresAt: "2026-09-11T10:24:18+09:00",
        user: { displayName: "관리자", id: "user-admin", role: "administrator" },
      });
    },
    deleteSession: () => {
      clearAuthentication();
      return Promise.resolve();
    },
    getDashboardData: async (options: DashboardDataRequestOptions = {}) => {
      if (scenario === "request-error") throw new Error("합성 데이터 요청 오류");
      if (scenario === "loading") await waitForMockLoading(options.signal);
      return withSession();
    },
    markAllNotificationsRead: () => {
      currentData.monitoring.headerNotifications.forEach((notification) => { notification.read = true; });
      currentData.monitoring.unreadNotificationCount = 0;
      return Promise.resolve();
    },
    markNotificationRead: (notificationId) => {
      const notification = currentData.monitoring.headerNotifications.find((item) => item.id === notificationId);
      if (notification && !notification.read) {
        notification.read = true;
        currentData.monitoring.unreadNotificationCount = Math.max(0, currentData.monitoring.unreadNotificationCount - 1);
      }
      return Promise.resolve();
    },
    queryHistory: (query) => {
      const history = structuredClone(currentData.history);
      history.events = history.events.filter((event) => inRange(event.time, query) && eventMatches(event.type, query.eventCategory));
      history.chartEvents = history.chartEvents.filter((event) => {
        const type = event.label === "수거 완료" ? "수거" : event.label === "수거 필요" ? "알림" : "오류";
        return inRange(event.time, query) && eventMatches(type, query.eventCategory);
      });
      return Promise.resolve(history);
    },
    queryRecordings: (query) => Promise.resolve(currentData.recordings.filter((recording) =>
      eventMatches(recording.type, query.eventCategory)
      && dateTimeValue(recording.start) <= dateTimeValue(query.to)
      && dateTimeValue(recording.end) >= dateTimeValue(query.from))),
    replaceAlertSettings: (settings) => {
      currentData.admin.alertSettings = { ...structuredClone(settings), version: `"settings-v${Number(settings.version.replace(/\D/g, "") || "1") + 1}"` };
      currentData.admin.preCollectionAlert = structuredClone(currentData.admin.alertSettings.preCollectionAlert);
      return Promise.resolve(structuredClone(currentData.admin.alertSettings));
    },
    sendTestNotification: () => Promise.resolve(),
    subscribe: scenario === "live-update" ? (listener) => {
      const timeout = window.setTimeout(() => {
        currentData = liveUpdateDashboardData();
        listener(withSession());
      }, 1200);
      return () => window.clearTimeout(timeout);
    } : scenario === "operation-cycle" ? (listener) => {
      const timers = [0, 1, 2, 3, 4].map((step) => window.setTimeout(
        () => {
          currentData = step === 4 ? dashboardDataFor("normal") : operationCycleData(step);
          listener(withSession());
        },
        (step + 1) * 500,
      ));
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    } : undefined,
    updateNotificationRecipient: (recipient, settings) => {
      const index = currentData.admin.recipients.findIndex((item) => item.id === recipient.id);
      const updated = { ...recipient, enabled: settings.enabled, version: `"recipient-v${Number(recipient.version.replace(/\D/g, "") || "1") + 1}"` };
      if (index >= 0) currentData.admin.recipients[index] = updated;
      currentData.admin.recipientSettings[recipient.email] = structuredClone(settings);
      return Promise.resolve({ recipient: structuredClone(updated), settings: structuredClone(settings) });
    },
  };
}

export function resolveMockScenario(value: string | null): MockScenario {
  return mockScenarios.find((scenario) => scenario === value) ?? "normal";
}
