import type { DashboardData, DashboardStatus } from "../domain/dashboard";

import type { DashboardDataRequestOptions, DashboardDataSource } from "./dashboard-data-source";

export type MockScenario = DashboardStatus | "empty-lists" | "live-update" | "operation-cycle" | "loading" | "request-error";

const mockScenarios = ["normal", "collection-required", "measurement-error", "disconnected", "no-data", "empty-lists", "live-update", "operation-cycle", "loading", "request-error"] as const satisfies readonly MockScenario[];

const loadHistoryTimes = [
  "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00",
  "17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00", "00:00",
  "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00", "08:00",
];

const baseDashboardData: DashboardData = {
  lastMeasuredAt: "10:24:18",
  monitoring: {
    status: "normal",
    videoTimestamp: "2026-09-10 10:24:18",
    summary: { loadPercent: 72, collectionThreshold: 80, expectedArrivalAt: "9월 10일 14:30", recentChange: "+4%", timeSinceCollection: "2시간 0분", averageCollectionCycle: "23시간 10분" },
    devices: [
      { label: "LiDAR 1", received: "10:24:18", latency: "120ms", status: "normal" },
      { label: "LiDAR 2", received: "10:24:18", latency: "135ms", status: "normal" },
      { label: "카메라", received: "10:24:16", latency: "180ms", status: "normal" },
      { label: "엣지 장비", received: "10:24:17", latency: "95ms", status: "normal" },
    ],
    alerts: [
      { detail: "대표 적재율 82%", level: "warning", time: "10:20", title: "수거 필요" },
      { detail: "LiDAR 2 일부 측정 불가", level: "error", time: "10:18", title: "측정 오류" },
      { detail: "임계율 도달 예상 4시간 전", level: "warning", time: "10:02", title: "수거 예정" },
      { detail: "카메라 프레임 수신 지연", level: "error", time: "09:58", title: "영상 지연" },
      { detail: "온도 센서 값 변동", level: "warning", time: "09:45", title: "안정성 경보" },
      { detail: "LiDAR 1 점군 밀도 저하", level: "warning", time: "09:40", title: "센서 감도 경고" },
      { detail: "엣지 장비 CPU 사용률 상승", level: "warning", time: "09:31", title: "자원 모니터링" },
    ],
    headerNotifications: [
      { id: 1, title: "수거 필요", detail: "대표 적재율이 수거 임계율에 도달했습니다.", level: "warning", read: false, time: "10:20" },
      { id: 2, title: "측정 오류", detail: "LiDAR 2 일부 측정값을 제외했습니다.", level: "error", read: false, time: "10:18" },
      { id: 3, title: "수거 예정", detail: "수거 임계율 도달이 예상됩니다.", level: "warning", read: false, time: "10:02" },
      { id: 4, title: "영상 지연", detail: "카메라 프레임 수신이 지연되었습니다.", level: "error", read: true, time: "09:58" },
    ],
    loadHistory: loadHistoryTimes.map((time, index) => ({
      time,
      value: [44, 46, 48, 49, 51, 53, 54, 56, 58, 59, 61, 62, 64, 65, 66, 67, 68, 69, 69, 70, 70, 71, 71, 72][index],
    })),
    lidarProfiles: [
      { average: "1.8 m", color: "blue", label: "LiDAR 1", minimum: "1.2 m", maximum: "2.4 m", values: [1.8, 1.9, 1.8, 2.1, 2.2, 2.0, 1.9, 2.1, 2.3, 2.0, 2.2] },
      { average: "1.7 m", color: "teal", label: "LiDAR 2", minimum: "1.0 m", maximum: "2.6 m", values: [1.4, 1.5, 1.7, 1.9, 2.2, 2.4, 2.3, 2.6, 2.1, 2.0, 2.3] },
    ],
  },
  history: {
    events: [
      { time: "2026-09-09 12:33", type: "수거", tone: "complete", content: "수거 완료", detail: "정기 수거 작업 완료" },
      { time: "2026-09-09 12:00", type: "알림", tone: "warning", content: "수거 필요", detail: "대표 적재율 80% 도달" },
      { time: "2026-09-08 18:00", type: "오류", tone: "error", content: "센서 데이터 이상", detail: "LiDAR 2 측정값 제외" },
      { time: "2026-09-08 12:33", type: "수거", tone: "complete", content: "수거 완료", detail: "정기 수거 작업 완료" },
      { time: "2026-09-08 12:00", type: "알림", tone: "warning", content: "수거 필요", detail: "대표 적재율 80% 도달" },
      { time: "2026-09-07 12:33", type: "수거", tone: "complete", content: "수거 완료", detail: "정기 수거 작업 완료" },
      { time: "2026-09-07 12:00", type: "알림", tone: "warning", content: "수거 필요", detail: "대표 적재율 80% 도달" },
      { time: "2026-09-06 12:33", type: "수거", tone: "complete", content: "수거 완료", detail: "정기 수거 작업 완료" },
      { time: "2026-09-06 12:00", type: "알림", tone: "warning", content: "수거 필요", detail: "대표 적재율 80% 도달" },
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
        { hour: day * 24 + 12, label: "수거 필요" as const, color: "#f58a07", time: `2026-09-${String(day + 3).padStart(2, "0")} 12:00`, detail: "대표 적재율 80% 도달" },
        { hour: day * 24 + 12.55, label: "수거 완료" as const, color: "#0aa45b", time: `2026-09-${String(day + 3).padStart(2, "0")} 12:33`, detail: "정기 수거 작업 완료" },
      ]).flat(),
      { hour: 138, label: "오류" as const, color: "#e83232", time: "2026-09-08 18:00", detail: "LiDAR 2 측정값 제외" },
    ],
  },
  recordings: [
    ...["2026-09-09", "2026-09-08", "2026-09-07", "2026-09-06", "2026-09-05", "2026-09-04", "2026-09-03", "2026-09-02"].map((date, index) => ({ date, start: `${date} 00:00:00`, time: "00:00 - 23:59", type: (["수거", "알림", "오류", "수거", "알림", "수거", "오류", "수거"] as const)[index], tone: (["complete", "warning", "error", "complete", "warning", "complete", "error", "complete"] as const)[index], duration: "24:00:00", detail: (["정기 수거 작업 완료", "대표 적재율 80% 도달", "LiDAR 2 측정값 제외", "정기 수거 작업 완료", "대표 적재율 80% 도달", "정기 수거 작업 완료", "카메라 프레임 수신 지연", "정기 수거 작업 완료"] as const)[index], end: `${date} 23:59:59` })),
  ],
  admin: {
    recipients: [
      { name: "김현수", team: "생산관리팀", email: "kim@example.com", phone: "010-****-1234", channel: "이메일, 문자", enabled: true },
      { name: "박영진", team: "설비보전팀", email: "park@example.com", phone: "010-****-5678", channel: "문자", enabled: true },
      { name: "이정민", team: "품질관리팀", email: "lee@example.com", phone: "-", channel: "이메일", enabled: false },
      { name: "최민석", team: "생산1팀", email: "choi@example.com", phone: "010-****-9012", channel: "이메일, 문자", enabled: true },
      { name: "윤서연", team: "생산2팀", email: "yoon@example.com", phone: "010-****-3456", channel: "문자", enabled: true },
      { name: "정우진", team: "안전환경팀", email: "jung@example.com", phone: "010-****-7890", channel: "이메일, 문자", enabled: true },
      { name: "한지훈", team: "설비보전팀", email: "han@example.com", phone: "010-****-2468", channel: "이메일", enabled: true },
      { name: "오수빈", team: "생산관리팀", email: "oh@example.com", phone: "010-****-1357", channel: "문자", enabled: false },
      { name: "문지아", team: "안전환경팀", email: "moon@example.com", phone: "010-****-0246", channel: "이메일, 문자", enabled: true },
      { name: "서준호", team: "생산1팀", email: "seo@example.com", phone: "010-****-8024", channel: "이메일", enabled: true },
      { name: "강민지", team: "품질관리팀", email: "kang@example.com", phone: "010-****-9135", channel: "이메일, 문자", enabled: true },
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
      data.monitoring.alerts[0] = { detail: "대표 적재율 84%", level: "warning", time: "10:24", title: "수거 필요" };
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
  data.monitoring.alerts[0] = { detail: "대표 적재율 75%", level: "warning", time: "10:24", title: "수거 예정" };
  return data;
}

function operationCycleData(step: number) {
  const data = dashboardDataFor("normal");
  if (step === 0) {
    data.monitoring.status = "collection-required";
    data.monitoring.summary.loadPercent = 80;
    data.monitoring.alerts[0] = {
      detail: "대표 적재율 80%",
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
  return {
    getDashboardData: async (options: DashboardDataRequestOptions = {}) => {
      if (scenario === "request-error") throw new Error("합성 데이터 요청 오류");
      if (scenario === "loading") await waitForMockLoading(options.signal);
      return dashboardDataFor(scenario);
    },
    subscribe: scenario === "live-update" ? (listener) => {
      const timeout = window.setTimeout(() => listener(liveUpdateDashboardData()), 1200);
      return () => window.clearTimeout(timeout);
    } : scenario === "operation-cycle" ? (listener) => {
      const timers = [0, 1, 2, 3, 4].map((step) => window.setTimeout(
        () => listener(step === 4 ? dashboardDataFor("normal") : operationCycleData(step)),
        (step + 1) * 500,
      ));
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    } : undefined,
  };
}

export function resolveMockScenario(value: string | null): MockScenario {
  return mockScenarios.find((scenario) => scenario === value) ?? "normal";
}
