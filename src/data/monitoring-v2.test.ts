import { describe, expect, test, vi } from "vitest";

import type { DashboardData } from "../domain/dashboard";
import type { components } from "../generated/backend-contract";
import { alertSettingsFixture, recipientPageFixture, sessionFixture, notificationPageFixture } from "../test/api-contract-fixtures";
import { activeAlertsFixture, activeCoverageFixture, activeHealthAlertFixture, collectionSummaryFixture, eventRecordingFixture, eventRecordingPageFixture, eventReplayFixture, fillForecastFixture, lidarProfilesFixture, monitoringV2Fixture, monitoringV2StateFixture } from "../test/backend-contract-fixtures";

import { ApiError, createHttpDashboardDataSource } from "./http-dashboard-data-source";
import { monitoringV2Data, type ApiMonitoringSnapshotV2 } from "./monitoring-v2";

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }

function inputUrl(input: RequestInfo | URL) {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://dashboard.example");
}

function contract({ authenticated = true, snapshot = monitoringV2Fixture, collectionSummary = collectionSummaryFixture(), fillForecast = fillForecastFixture(), profiles = lidarProfilesFixture(), activeAlerts = activeAlertsFixture({ evaluationState: "NORMAL", items: [] }), loadHistory }: { authenticated?: boolean; snapshot?: ApiMonitoringSnapshotV2; collectionSummary?: unknown; fillForecast?: unknown; profiles?: unknown; activeAlerts?: unknown; loadHistory?: (url: URL) => unknown } = {}) {
  const urls: URL[] = [];
  const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
    const url = inputUrl(input);
    urls.push(url);
    if (url.pathname === "/api/v1/session") return Promise.resolve(authenticated ? json(sessionFixture) : json({ detail: "Unauthorized" }, 401));
    if (url.pathname === "/api/v2/monitoring/snapshot") return Promise.resolve(json(snapshot));
    if (url.pathname === "/api/v2/monitoring/load-history" && loadHistory) return Promise.resolve(json(loadHistory(url)));
    if (url.pathname === "/api/v1/notifications") return Promise.resolve(json(notificationPageFixture));
    if (url.pathname === "/api/v2/monitoring/collection-summary") return Promise.resolve(json(collectionSummary));
    if (url.pathname === "/api/v2/monitoring/fill-forecast") return Promise.resolve(json(fillForecast));
    if (url.pathname === "/api/v2/monitoring/profiles") return Promise.resolve(json(profiles));
    if (url.pathname === "/api/v2/monitoring/active-alerts") return Promise.resolve(json(activeAlerts));
    if (url.pathname === "/api/v2/recordings/events") return Promise.resolve(json(eventRecordingPageFixture()));
    if (url.pathname === `/api/v2/recordings/events/${eventRecordingFixture().eventId}`) return Promise.resolve(json(eventReplayFixture()));
    if (url.pathname === "/api/v1/settings/alerts") return Promise.resolve(json(alertSettingsFixture));
    if (url.pathname === "/api/v1/notification-recipients") return Promise.resolve(json(recipientPageFixture));
    throw new Error(`Unexpected path ${url.pathname}`);
  });
  return { urls, fetchImplementation };
}

function historyWithBaseline(url: URL, snapshot: ApiMonitoringSnapshotV2, valuePercent: number | null = 68.5) {
  const from = Date.parse(url.searchParams.get("from")!);
  const to = Date.parse(url.searchParams.get("to")!);
  const first = Math.floor(from / 60_000) * 60_000;
  const baseline = to - 3_600_000 - 1000;
  return { schemaVersion: "2", pitId: snapshot.pitId, source: snapshot.source, from: new Date(from).toISOString(), to: new Date(to).toISOString(),
    bucketSeconds: 60, selectionPolicy: "LATEST_STATE_PER_BUCKET", samples: Array.from({ length: Math.ceil((to - first) / 60_000) }, (_, index) => {
      const start = Math.max(from, first + index * 60_000);
      const end = Math.min(to, first + (index + 1) * 60_000);
      const present = baseline >= start && baseline < end;
      const at = present ? new Date(baseline).toISOString() : null;
      return { bucketStartAt: new Date(start).toISOString(), bucketEndAt: new Date(end).toISOString(), generatedAt: at, observedAt: at,
        assessmentId: present ? "synthetic-past-load" : null, valuePercent: present ? valuePercent : null,
        valid: present && valuePercent !== null, dataState: present && valuePercent !== null ? "AVAILABLE" : "NO_DATA", reasonCodes: [] };
    }) };
}

class Stream {
  listeners = new Map<string, EventListener>();
  closed = false;
  addEventListener(type: string, callback: EventListener) { this.listeners.set(type, callback); }
  close() { this.closed = true; }
  emit(type: string, data: unknown) { this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data) })); }
  emitRaw(type: string, data: string) { this.listeners.get(type)?.(new MessageEvent(type, { data })); }
}

describe("Backend v2 모니터링", () => {
  test("알려진 센서의 표시명은 LiDAR 번호로 통일하고 원래 ID와 입력 순서는 보존한다", () => {
    const snapshot = monitoringV2StateFixture("UNAVAILABLE");
    const ids = ["lidar-b", "lidar-extra", "lidar-a"];
    const sensors = ids.map(sensor_id => ({ sensor_id, data_state: "FRESH", last_scan_at: snapshot.serverTime, reason_codes: [] }));
    const result = monitoringV2Data({ ...snapshot, deviceStatus: { ...snapshot.deviceStatus,
      connection_state: "REPORTING", snapshot: { sensors },
    } }, "pit-01");
    expect(result.devices.map(device => device.label)).toEqual(["LiDAR 2", "lidar-extra", "LiDAR 1", "카메라", "엣지 장비"]);
    expect(result.devices.slice(0, 3).every(device => device.status === "normal" && device.statusLabel === "FRESH")).toBe(true);
    expect(result.v2?.sensors.map(sensor => sensor.id)).toEqual(ids);
    expect(sensors.map(sensor => sensor.sensor_id)).toEqual(ids);
  });

  test.each([
    ["HEALTHY", "normal"], ["STARTING", "delayed"], ["DEGRADED", "delayed"],
    ["RETRYING", "delayed"], ["FATAL", "unavailable"], ["UNKNOWN", "unknown"],
  ])("카메라 service %s를 측정 판단과 독립적인 장비 상태 %s로 연결한다", (state, status) => {
    const snapshot = monitoringV2StateFixture("UNAVAILABLE");
    const result = monitoringV2Data({ ...snapshot, deviceStatus: { ...snapshot.deviceStatus,
      connection_state: "REPORTING", effective_state: "MEASUREMENT_UNAVAILABLE", snapshot: {
        sensors: [{ sensor_id: "lidar-a", data_state: "FRESH", last_scan_at: snapshot.serverTime, reason_codes: [] }],
        services: [{ service: "camera-edge", state, last_progress_at: snapshot.serverTime, reason_codes: [] }],
      },
    } }, "pit-01");
    expect(result.devices.find(device => device.label === "카메라")).toMatchObject({ status, statusLabel: state, latency: "정보 없음" });
    expect(result.devices[0]).toMatchObject({ status: "normal", statusLabel: "FRESH" });
    expect(result.summary.loadPercent).toBeNull();
    expect(result.v2?.services?.[0].state).toBe(state);
  });

  test("장비 보고가 중단되면 보존된 센서와 카메라 service를 현재 정상 상태로 표시하지 않는다", () => {
    const snapshot = monitoringV2StateFixture("UNAVAILABLE");
    const sensors = [{ sensor_id: "lidar-a", data_state: "FRESH", last_scan_at: "2026-10-12T23:49:59Z", reason_codes: [] }];
    const services = [{ service: "camera-edge", state: "HEALTHY", last_progress_at: "2026-10-12T23:49:59Z", reason_codes: [] }];
    const result = monitoringV2Data({ ...snapshot, deviceStatus: { ...snapshot.deviceStatus,
      last_received_at: "2026-10-12T23:50:00Z", snapshot: { sensors, services },
    } }, "pit-01");
    expect(result.devices[0]).toMatchObject({ status: "unknown", statusLabel: "UNKNOWN" });
    expect(result.devices.find(device => device.label === "카메라")).toMatchObject({ status: "unknown", statusLabel: "UNKNOWN" });
    expect(result.v2?.sensors[0]).toMatchObject({ state: "FRESH", lastScanAt: sensors[0].last_scan_at });
    expect(result.v2?.services?.[0]).toMatchObject({ state: "HEALTHY", lastProgressAt: services[0].last_progress_at });
  });

  test.each([undefined, [], [{ service: "other-service", state: "HEALTHY", last_progress_at: null, reason_codes: [] }]])("카메라 service가 없으면 %j에서 정상 상태를 추정하지 않는다", services => {
    const snapshot = monitoringV2StateFixture("UNAVAILABLE");
    const result = monitoringV2Data({ ...snapshot, deviceStatus: { ...snapshot.deviceStatus,
      connection_state: "REPORTING", snapshot: { sensors: [], services },
    } }, "pit-01");
    expect(result.devices.find(device => device.label === "카메라")).toMatchObject({ status: "unknown" });
  });

  test("과거 적재율은 현재 snapshot 및 연결 상태와 독립적이며 source 변경에서 값을 지운다", async () => {
    const snapshot = monitoringV2StateFixture("FRESH", 72.5);
    const api = contract({ snapshot, loadHistory: url => historyWithBaseline(url, snapshot) });
    const stream = new Stream();
    const source = createHttpDashboardDataSource({ ...api, apiContract: "backend", monitoringVersion: "v2", eventSourceFactory: () => stream as unknown as EventSource });
    const data = await source.getDashboardData();
    expect(data.monitoring.summary.loadOneHourAgo?.value).toBe(68.5);
    const updates: DashboardData[] = [];
    const unsubscribe = source.subscribe?.(value => updates.push(value));
    try {
      stream.emit("monitoring.snapshot", monitoringV2StateFixture("FRESH", 0));
      expect(updates.at(-1)?.monitoring.summary.loadOneHourAgo?.value).toBe(68.5);
      stream.emitRaw("error", "");
      expect(updates.at(-1)?.monitoring.summary.loadOneHourAgo?.value).toBe(68.5);
      stream.emit("monitoring.snapshot", snapshot);
      expect(updates.at(-1)?.monitoring.summary.loadOneHourAgo?.value).toBe(68.5);
      stream.emit("monitoring.snapshot", { ...snapshot, source: { ...snapshot.source, edge_id: "different-edge" } });
      expect(updates.at(-1)?.monitoring.summary.loadOneHourAgo).toBeNull();
      await vi.waitFor(() => expect(updates.at(-1)?.monitoring.loadHistoryState?.status).toBe("error"));
      expect(updates.at(-1)?.monitoring.summary.loadOneHourAgo).toBeNull();
      expect(api.urls.some(url => url.pathname === "/api/v1/monitoring/snapshot")).toBe(false);
    } finally { unsubscribe?.(); }
  });

  test("약 1분 이력 갱신은 과거 적재율의 기준 시각을 진행하며 조회 실패의 캐시로 값을 유지하지 않는다", async () => {
    vi.useFakeTimers();
    const snapshot = monitoringV2StateFixture("FRESH", 72.5);
    let value: number | null = 68.5;
    let failHistory = false;
    const api = contract({ snapshot, loadHistory: url => historyWithBaseline(url, snapshot, value) });
    const fetchImplementation = (input: RequestInfo | URL) => inputUrl(input).pathname === "/api/v2/monitoring/load-history" && failHistory
      ? Promise.resolve(json({ detail: "Synthetic load failure" }, 503)) : api.fetchImplementation(input);
    const stream = new Stream();
    const source = createHttpDashboardDataSource({ fetchImplementation, apiContract: "backend", monitoringVersion: "v2", eventSourceFactory: () => stream as unknown as EventSource });
    let unsubscribe: (() => void) | undefined;
    try {
      expect((await source.getDashboardData()).monitoring.summary.loadOneHourAgo?.value).toBe(68.5);
      const updates: DashboardData[] = [];
      unsubscribe = source.subscribe?.(data => updates.push(data));
      value = 64.5;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(updates.at(-1)?.monitoring.summary.loadOneHourAgo?.value).toBe(64.5);
      failHistory = true;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(updates.at(-1)?.monitoring.summary.loadOneHourAgo).toBeNull();
      expect(updates.at(-1)?.monitoring.loadHistory.length).toBeGreaterThan(0);
      failHistory = false;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(updates.at(-1)?.monitoring.summary.loadOneHourAgo?.value).toBe(64.5);
    } finally { unsubscribe?.(); vi.useRealTimers(); }
  });

  test("snapshot의 장비 진단 값을 보존하고 통신 지연으로 사용하지 않는다", () => {
    const snapshot = monitoringV2StateFixture("FRESH", 0);
    const result = monitoringV2Data({ ...snapshot, deviceStatus: { ...snapshot.deviceStatus, snapshot: {
      sensors: [], clock: { state: "SYNCHRONIZED", offset_ms: 17 }, services: [{ service: "test-service", state: "HEALTHY", last_progress_at: "2026-10-13T00:00:00Z", reason_codes: [] }],
    } } }, "pit-01");
    expect(result.v2?.clock).toEqual({ state: "SYNCHRONIZED", offsetMs: 17 });
    expect(result.v2?.services?.[0]).toMatchObject({ name: "test-service", lastProgressAt: "2026-10-13T00:00:00Z" });
    expect(result.devices.every(device => device.latency === "정보 없음")).toBe(true);
  });

  test.each([{ clock: { state: "SYNCHRONIZED", offset_ms: Number.NaN } }, { services: [{ service: "test", state: "HEALTHY", last_progress_at: "bad-time", reason_codes: [] }] }])("잘못된 장비 진단 계약을 거부한다 %j", invalid => {
    const snapshot = monitoringV2StateFixture("FRESH", 0);
    expect(() => monitoringV2Data({ ...snapshot, deviceStatus: { ...snapshot.deviceStatus, snapshot: { sensors: [], ...invalid } } }, "pit-01")).toThrow();
  });

  test("브라우저 수신 시각은 측정 및 Backend 수신 시각과 분리하고 연결 오류와 같은 snapshot 재수신을 반영한다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = "2026-10-15T12:00:00.000Z";
    vi.setSystemTime(new Date(now));
    const snapshot = { ...monitoringV2StateFixture("UNAVAILABLE"), measuredAt: null };
    const api = contract({ snapshot });
    const stream = new Stream();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend", eventSourceFactory: () => stream as unknown as EventSource });
    let unsubscribe: (() => void) | undefined;
    try {
      const initial = await source.getDashboardData();
      expect(initial.reception).toEqual({ status: "connected", lastReceivedAt: now });
      expect(initial.monitoring.v2?.measuredAt).toBeNull();
      const listener = vi.fn<(data: DashboardData) => void>();
      unsubscribe = source.subscribe?.(listener);
      stream.emitRaw("error", "");
      expect(listener.mock.lastCall?.[0].reception).toEqual({ status: "error", lastReceivedAt: now });
      vi.setSystemTime(new Date("2026-10-15T12:01:00.000Z"));
      stream.emitRaw("monitoring.snapshot", "invalid JSON");
      expect(listener.mock.lastCall?.[0].reception).toEqual({ status: "error", lastReceivedAt: now });
      stream.emit("monitoring.snapshot", snapshot);
      const receivedAt = "2026-10-15T12:01:00.000Z";
      expect(listener.mock.lastCall?.[0].reception).toEqual({ status: "connected", lastReceivedAt: receivedAt });
      expect(listener.mock.lastCall?.[0].monitoring.status).toBe("unavailable");
      vi.setSystemTime(new Date("2026-10-15T12:02:00.000Z"));
      await source.queryRecordings?.({ from: "2026-10-01T00:00:00Z", to: "2026-10-15T00:00:00Z" });
      expect(listener.mock.lastCall?.[0].reception).toEqual({ status: "connected", lastReceivedAt: receivedAt });
    } finally {
      unsubscribe?.();
      vi.useRealTimers();
    }
  });
  test("NO_DATA의 null 관측 시각을 정보 없음으로 표시한다", async () => {
    const api = contract({ snapshot: monitoringV2StateFixture("NO_DATA") });
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    const result = await source.getDashboardData();
    expect(result.lastMeasuredAt).toBe("정보 없음");
    expect(result.monitoring.v2?.measuredAt).toBeNull();
  });
  test.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY, null])("유효하지 않은 적재율 %s를 0으로 보충하지 않는다", (value) => {
    expect(monitoringV2Data({ ...monitoringV2Fixture, dataState: "FRESH", summary: { ...monitoringV2Fixture.summary, loadPercent: value } }, "pit-01").summary.loadPercent).toBeNull();
  });
  test.each([
    { schemaVersion: "3" }, { dataState: "OTHER" }, { serverTime: undefined }, { serverTime: "invalid" },
    { summary: undefined }, { source: { ...monitoringV2Fixture.source, pit_id: "other" } },
    { reasonCodes: "not-an-array" }, { deviceStatus: undefined },
  ])("누락되거나 다른 계약의 snapshot을 거부한다: %j", (invalid) => {
    expect(() => monitoringV2Data({ ...monitoringV2Fixture, ...invalid }, "pit-01")).toThrow();
  });
  test("수거 요약의 최근 수거 시각과 서버 시각으로 경과를 계산하고 v1 모니터링 값을 조회하지 않는다", async () => {
    const api = contract({ collectionSummary: collectionSummaryFixture({ lastCollectionActivityAt: "2026-10-12T22:00:10Z", averageSettledCollectionCycleSeconds: 90_000, settledCycleCount: 2, settledCollectionsInWindow: 3, settledCycleReasonCodes: [] }) });
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    const result = await source.getDashboardData();
    expect(result.monitoring.summary.timeSinceCollection).toBe("2시간 0분");
    expect(result.monitoring.summary.averageCollectionCycle).toBe("25시간 0분");
    const request = api.urls.find((url) => url.pathname === "/api/v2/monitoring/collection-summary");
    expect(request?.searchParams.get("pit_id")).toBe("pit-01");
    expect(api.urls.some((url) => url.pathname === "/api/v1/events")).toBe(false);
    expect(api.urls.some((url) => url.pathname === "/api/v1/monitoring/snapshot")).toBe(false);
  });
  describe("LiDAR 높이 곡선", () => {
    const monitoringOf = async (profiles: unknown, snapshot = monitoringV2StateFixture("FRESH", 72)) => {
      const api = contract({ profiles, snapshot });
      const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
      return (await source.getDashboardData()).monitoring;
    };
    test("sensorId로 LiDAR 1과 2를 연결하고 cm를 m로 한 번만 변환한다", async () => {
      const [first, second] = (await monitoringOf(lidarProfilesFixture())).lidarProfiles;
      expect(first).toMatchObject({ label: "LiDAR 1", average: "3.00 m", minimum: "1.00 m", maximum: "5.00 m" });
      expect(first.samples.map((sample) => sample.height)).toEqual([1, 3, 2, 5, 4]);
      expect(second).toMatchObject({ label: "LiDAR 2", average: "2.50 m" });
    });
    test("높이 또는 위치가 null이거나 valid=false인 점은 선을 끊는 null로 둔다", async () => {
      const fixture = lidarProfilesFixture();
      Object.assign(fixture.profiles[1].samples[1], { valid: false, height: 300 });
      Object.assign(fixture.profiles[1].samples[2], { positionRatio: null });
      const [first, second] = (await monitoringOf(fixture)).lidarProfiles;
      expect(first.samples.map((sample) => sample.height)).toEqual([1, null, null, 5, 4]);
      expect(second.samples.map((sample) => sample.height)).toEqual([1, null, 5]);
    });
    test("시간 중앙값 정책의 대표 높이는 filteredAverage이며 없으면 평균으로 대체하지 않는다", async () => {
      const fixture = lidarProfilesFixture();
      Object.assign(fixture.profiles[1], { summaryValuePolicy: "SCAN_MEAN_TEMPORAL_MEDIAN", filteredAverage: null });
      expect((await monitoringOf(fixture)).lidarProfiles[0].average).toBe("-");
      fixture.profiles[1].filteredAverage = 320 as unknown as null;
      expect((await monitoringOf(fixture)).lidarProfiles[0].average).toBe("3.20 m");
    });
    test("센서가 없으면 해당 slot은 빈 곡선이며 FRESH가 아니거나 계약 오류이면 숨긴다", async () => {
      const missing = lidarProfilesFixture();
      missing.profiles.pop();
      expect((await monitoringOf(missing)).lidarProfiles[0].samples).toEqual([]);
      expect((await monitoringOf(lidarProfilesFixture(), monitoringV2StateFixture("STALE", 72))).lidarProfiles).toEqual([]);
      expect((await monitoringOf({ profiles: "invalid" })).lidarProfiles).toEqual([]);
    });
    test("시뮬레이션과 보정 상태를 보존한다", async () => {
      const fixture = lidarProfilesFixture();
      Object.assign(fixture.profiles[1], { simulated: true, calibrationState: "UNVERIFIED", reasonCodes: ["HEIGHT_REFERENCE_UNVERIFIED"] });
      expect((await monitoringOf(fixture)).lidarProfiles[0]).toMatchObject({ simulated: true, calibrationState: "UNVERIFIED", reasonCodes: ["HEIGHT_REFERENCE_UNVERIFIED"] });
    });
  });
  describe("현재 활성 경보", () => {
    const operations = (effectiveState: "NORMAL" | "WARNING" | "CRITICAL" | "UNKNOWN" | "ERROR") => ({
      ...monitoringV2StateFixture("FRESH", 91.5),
      operations: { effectiveState, lastKnownState: null, lastEvaluatedAt: null, lastAlertAt: null, notificationId: null },
    });
    const monitoringOf = async (activeAlerts: unknown, snapshot: ApiMonitoringSnapshotV2) => {
      const api = contract({ activeAlerts, snapshot });
      const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
      return (await source.getDashboardData()).monitoring;
    };
    test("CRITICAL 항목을 서버 제목과 적재율로 표시한다", async () => {
      const monitoring = await monitoringOf(activeAlertsFixture(), operations("CRITICAL"));
      expect(monitoring.alerts).toHaveLength(1);
      expect(monitoring.alerts[0]).toMatchObject({ id: "fill-critical:pit-01", level: "error", title: "수거 필요", detail: "적재율 91.5%" });
      expect(monitoring.alerts[0].time).toMatch(/^\d{2}:\d{2}$/);
      expect(monitoring.activeAlertsState?.evaluationState).toBe("CRITICAL");
    });
    test("snapshot의 경보 평가와 다르면 이전 적재율 항목을 표시하지 않고 판정 불가로 구분한다", async () => {
      const monitoring = await monitoringOf(activeAlertsFixture(), operations("NORMAL"));
      expect(monitoring.alerts).toEqual([]);
      expect(monitoring.activeAlertsState).toEqual({ evaluationState: "UNKNOWN", reasonCodes: [], coverage: [] });
    });
    test.each(["NORMAL", "WARNING", "UNKNOWN", "ERROR"] as const)("%s의 빈 목록은 평가 상태와 함께 보존한다", async (evaluationState) => {
      const monitoring = await monitoringOf(activeAlertsFixture({ evaluationState, items: [], reasonCodes: ["ALERT_NOTE"] }), operations(evaluationState));
      expect(monitoring.alerts).toEqual([]);
      expect(monitoring.activeAlertsState).toEqual({ evaluationState, reasonCodes: ["ALERT_NOTE"], coverage: [] });
    });
    test("요청은 scope=ALL과 pit_id를 사용한다", async () => {
      const api = contract({ activeAlerts: activeAlertsFixture() });
      const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
      await source.getDashboardData();
      const url = api.urls.find((candidate) => candidate.pathname === "/api/v2/monitoring/active-alerts");
      expect(Object.fromEntries(url!.searchParams)).toEqual({ scope: "ALL", pit_id: "pit-01" });
    });
    describe("장비와 측정 항목", () => {
      const health = (overrides: Record<string, unknown> = {}) => activeHealthAlertFixture(overrides);
      test("적재율 항목과 장비 항목을 합집합으로 표시하고 서버 최초 확인 시각을 표시용으로 변환한다", async () => {
        const monitoring = await monitoringOf(activeAlertsFixture({ items: [activeAlertsFixture().items[0], health(), health({ id: "m", type: "measurement_error", componentKind: "MEASUREMENT", componentId: "pit-01", state: "UNAVAILABLE", evidenceSource: "CURRENT_MEASUREMENT", measuredAt: null, startedAt: null, startBasis: "UNKNOWN", simulated: true })] }), operations("CRITICAL"));
        expect(monitoring.alerts.map((alert) => alert.id)).toEqual(["fill-critical:pit-01", "health:edge:pit-01:edge-01", "m"]);
        expect(monitoring.alerts[0]).toMatchObject({ startedAt: null });
        expect(monitoring.alerts[0].health).toBeUndefined();
        expect(monitoring.alerts[1]).toMatchObject({ level: "warning", title: "Edge 장치 상태 이상", startedAt: "2026-10-13 08:47", time: "09:00",
          health: { componentKind: "EDGE", componentName: "엣지 장비", state: "DEGRADED", evidenceSource: "EDGE_STATUS", simulated: null } });
        expect(monitoring.alerts[2]).toMatchObject({ startedAt: null, health: { componentKind: "MEASUREMENT", simulated: true } });
      });
      test("startBasis가 UNKNOWN이면 startedAt이 있어도 시작 정보로 쓰지 않고 evaluatedAt으로 채우지 않는다", async () => {
        const monitoring = await monitoringOf(activeAlertsFixture({ evaluationState: "NORMAL", items: [health({ startBasis: "UNKNOWN", startedAt: "2026-10-12T23:47:42Z" }), health({ id: "n", startedAt: null, startBasis: "SERVER_EVALUATION" })] }), operations("NORMAL"));
        expect(monitoring.alerts.map((alert) => alert.startedAt)).toEqual([null, null]);
      });
      test.each(["UNKNOWN", "ERROR"] as const)("적재율 평가가 %s여도 장비 항목과 coverage는 유지한다", async (evaluationState) => {
        const monitoring = await monitoringOf(activeAlertsFixture({ evaluationState, items: [health()], coverage: activeCoverageFixture() }), operations(evaluationState));
        expect(monitoring.alerts.map((alert) => alert.id)).toEqual(["health:edge:pit-01:edge-01"]);
        expect(monitoring.activeAlertsState).toMatchObject({ evaluationState });
        expect(monitoring.activeAlertsState?.coverage.map((entry) => `${entry.componentKind}:${entry.state}`)).toEqual(["CAMERA:UNSUPPORTED", "EDGE:CHECKED", "LIDAR:CHECKED", "LIDAR:UNKNOWN", "MEASUREMENT:CHECKED"]);
        expect(monitoring.activeAlertsState?.coverage[3]).toMatchObject({ componentName: "LiDAR 2", reasonCodes: ["LIDAR_STATUS_NOT_REPORTED"] });
      });
      test("측정이 FRESH가 아니어도 장비 항목은 표시하고 적재율 항목은 숨긴다", async () => {
        const stale = { ...monitoringV2StateFixture("STALE", 91.5), operations: { effectiveState: "CRITICAL" as const, lastKnownState: null, lastEvaluatedAt: null, lastAlertAt: null, notificationId: null } };
        const monitoring = await monitoringOf(activeAlertsFixture({ items: [activeAlertsFixture().items[0], health()] }), stale);
        expect(monitoring.alerts.map((alert) => alert.id)).toEqual(["health:edge:pit-01:edge-01"]);
        expect(monitoring.activeAlertsState?.evaluationState).toBe("UNKNOWN");
      });
      test.each([
        ["알 수 없는 type", { type: "camera_error" }],
        ["알 수 없는 componentKind", { componentKind: "CAMERA" }],
        ["알 수 없는 evidenceSource", { evidenceSource: "GUESS" }],
        ["잘못된 startBasis", { startBasis: "PHYSICAL_FAILURE" }],
      ])("%s는 계약 오류로 처리한다", async (_name, overrides) => {
        const monitoring = await monitoringOf(activeAlertsFixture({ items: [health(overrides)] }), operations("CRITICAL"));
        expect(monitoring.activeAlertsState).toBeNull();
      });
    });
    test("계약 오류나 다른 scope는 정보 없음으로 처리한다", async () => {
      expect((await monitoringOf(activeAlertsFixture({ scope: "FILL_OPERATIONS" }), operations("CRITICAL"))).activeAlertsState).toBeNull();
      expect((await monitoringOf({ items: [] }, operations("CRITICAL"))).alerts).toEqual([]);
    });
  });
  describe("예상 도달", () => {
    const summaryOf = async (fillForecast: unknown, snapshot = monitoringV2StateFixture("FRESH", 72)) => {
      const api = contract({ fillForecast, snapshot });
      const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
      return (await source.getDashboardData()).monitoring.summary;
    };
    const available = { state: "AVAILABLE", expectedThresholdAt: "2026-10-13T02:30:00Z", remainingSeconds: 9000, reasonCodes: [] };
    test("AVAILABLE는 서버 시각 기준 남은 시간을 표시한다", async () => {
      const summary = await summaryOf(fillForecastFixture({ ...available, validUntil: "2026-10-13T00:05:00Z" }));
      expect(summary.remainingTime).toBe("2시간 29분");
      expect(summary.expectedArrivalAt).toMatch(/^10월 13일 \d{2}:30$/);
    });
    test("REACHED는 임계율 도달과 유효한 0을 보존한다", async () => {
      const summary = await summaryOf(fillForecastFixture({ state: "REACHED", expectedThresholdAt: null, remainingSeconds: 0, reasonCodes: [] }));
      expect(summary).toMatchObject({ expectedArrivalAt: "임계율 도달", remainingTime: "0시간 0분" });
    });
    test.each([
      ["UNAVAILABLE", fillForecastFixture()],
      ["유효 기한 만료", fillForecastFixture({ ...available, validUntil: "2026-10-12T23:59:59Z" })],
      ["잘못된 계약", { items: [] }],
    ])("%s이면 예측 시각을 만들지 않는다", async (_name, fillForecast) => {
      expect(await summaryOf(fillForecast)).toMatchObject({ expectedArrivalAt: "정보 없음", remainingTime: "정보 없음" });
    });
    test("측정이 FRESH가 아니면 이전 예측을 숨긴다", async () => {
      const summary = await summaryOf(fillForecastFixture({ ...available, validUntil: "2026-10-13T00:05:00Z" }), monitoringV2StateFixture("STALE", 72));
      expect(summary).toMatchObject({ expectedArrivalAt: "정보 없음", remainingTime: "정보 없음" });
    });
  });
  test("수거 기록이 없으면 경과는 정보 없음, 평균 주기는 자료 부족으로 구분한다", async () => {
    const api = contract();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    const { summary } = (await source.getDashboardData()).monitoring;
    expect(summary.timeSinceCollection).toBe("정보 없음");
    expect(summary.averageCollectionCycle).toBe("자료 부족");
  });
  test.each([
    [collectionSummaryFixture({ pitId: "other-pit" })],
    [collectionSummaryFixture({ lastCollectionActivityAt: "invalid" })],
    [collectionSummaryFixture({ lastCollectionActivityAt: "2026-10-12T22:00:10" })],
    [collectionSummaryFixture({ averageSettledCollectionCycleSeconds: -1, settledCycleCount: 1 })],
    [collectionSummaryFixture({ averageSettledCollectionCycleSeconds: 60, settledCycleCount: 0 })],
    [{ items: [] }],
  ])("잘못된 수거 요약 계약 %j는 해당 지표만 정보 없음으로 처리한다", async (collectionSummary) => {
    const api = contract({ collectionSummary, snapshot: monitoringV2StateFixture("FRESH", 72.5) });
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    const data = await source.getDashboardData();
    expect(data.monitoring.summary.timeSinceCollection).toBe("정보 없음");
    expect(data.monitoring.summary.loadPercent).toBe(72.5);
  });
  test("완료 시각이 서버보다 미래이면 음수 또는 0 경과 시간으로 보충하지 않는다", async () => {
    const api = contract({ collectionSummary: collectionSummaryFixture({ lastCollectionActivityAt: "2026-10-14T00:00:00Z" }) });
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    expect((await source.getDashboardData()).monitoring.summary.timeSinceCollection).toBe("정보 없음");
  });
  test("새 v2 경보 ID는 알림함을 다시 조회하며 같은 ID는 중복 조회하지 않는다", async () => {
    const api = contract();
    const stream = new Stream();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend", eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn();
    const unsubscribe = source.subscribe?.(listener);
    const updated = { ...monitoringV2Fixture, snapshotId: "alert-new", operations: {
      effectiveState: "CRITICAL" as const, lastKnownState: "CRITICAL" as const, lastEvaluatedAt: null, lastAlertAt: null, notificationId: "notif-opaque-new",
    } };
    stream.emit("monitoring.snapshot", updated);
    await vi.waitFor(() => expect(api.urls.filter((url) => url.pathname === "/api/v1/notifications")).toHaveLength(2));
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    stream.emit("monitoring.snapshot", updated);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.urls.filter((url) => url.pathname === "/api/v1/notifications")).toHaveLength(2);
    expect(stream.closed).toBe(false);
    unsubscribe?.();
  });
  test("구독 종료는 지연된 새 경보 조회를 취소하고 상태를 갱신하지 않는다", async () => {
    const api = contract();
    const stream = new Stream();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend", eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    let resolveNotification: (response: Response) => void = () => undefined;
    let notificationSignal: AbortSignal | null | undefined;
    api.fetchImplementation.mockImplementationOnce((_input, init?: RequestInit) => {
      notificationSignal = init?.signal;
      return new Promise<Response>((resolve) => { resolveNotification = resolve; });
    });
    const listener = vi.fn();
    const unsubscribe = source.subscribe?.(listener);
    stream.emit("monitoring.snapshot", { ...monitoringV2Fixture, operations: {
      effectiveState: "CRITICAL", lastKnownState: "CRITICAL", lastEvaluatedAt: null, lastAlertAt: null, notificationId: "notif-new",
    } });
    unsubscribe?.();
    expect(notificationSignal?.aborted).toBe(true);
    resolveNotification(json(notificationPageFixture));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listener).toHaveBeenCalledOnce();
    expect(stream.closed).toBe(true);
  });
  test("늦은 모두 읽음 응답은 요청 뒤에 발생한 새 경보를 읽음으로 바꾸지 않는다", async () => {
    const api = contract();
    const stream = new Stream();
    let notifications: components["schemas"]["NotificationPage"] = structuredClone(notificationPageFixture);
    let notificationRequests = 0;
    let acknowledgeRead: (response: Response) => void = () => undefined;
    const fetchImplementation: typeof fetch = (input) => {
      const path = inputUrl(input).pathname;
      if (path === "/api/v1/notifications/read-all") {
        notifications = { ...notifications, unreadCount: 0, items: notifications.items.map((item) => ({ ...item, readAt: monitoringV2Fixture.serverTime })) };
        return new Promise((resolve) => { acknowledgeRead = resolve; });
      }
      if (path === "/api/v1/notifications") {
        notificationRequests += 1;
        return Promise.resolve(json(notifications));
      }
      return api.fetchImplementation(input);
    };
    const source = createHttpDashboardDataSource({ fetchImplementation, monitoringVersion: "v2", apiContract: "backend", eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn<(data: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);
    const reading = source.markAllNotificationsRead?.();
    notifications = { ...notifications, unreadCount: 1, items: [{ ...notificationPageFixture.items[0], id: "notif-after-read", readAt: null }, ...notifications.items] };
    const updated = { ...monitoringV2Fixture, operations: {
      effectiveState: "CRITICAL" as const, lastKnownState: "CRITICAL" as const, lastEvaluatedAt: null, lastAlertAt: null, notificationId: "notif-after-read",
    } };
    stream.emit("monitoring.snapshot", updated);
    await vi.waitFor(() => expect(listener.mock.lastCall?.[0].monitoring.headerNotifications[0]).toMatchObject({ id: "notif-after-read", read: false }));
    acknowledgeRead(new Response(null, { status: 204 }));
    await reading;
    stream.emit("monitoring.snapshot", updated);
    expect(notificationRequests).toBe(3);
    expect(listener.mock.lastCall?.[0].monitoring.unreadNotificationCount).toBe(1);
    expect(listener.mock.lastCall?.[0].monitoring.headerNotifications[0]).toMatchObject({ id: "notif-after-read", read: false });
    unsubscribe?.();
  });
  test("모두 읽음 성공 뒤의 재조회 실패는 읽음을 되돌리지 않고 같은 snapshot에서 다시 조회한다", async () => {
    const api = contract();
    const stream = new Stream();
    let notifications: components["schemas"]["NotificationPage"] = structuredClone(notificationPageFixture);
    let notificationRequests = 0;
    const fetchImplementation: typeof fetch = (input) => {
      const path = inputUrl(input).pathname;
      if (path === "/api/v1/notifications/read-all") {
        notifications = { ...notifications, unreadCount: 0, items: notifications.items.map((item) => ({ ...item, readAt: monitoringV2Fixture.serverTime })) };
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (path === "/api/v1/notifications") return Promise.resolve(++notificationRequests === 2 ? json({ detail: "Unavailable" }, 503) : json(notifications));
      return api.fetchImplementation(input);
    };
    const source = createHttpDashboardDataSource({ fetchImplementation, monitoringVersion: "v2", apiContract: "backend", eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn<(data: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);
    await source.markAllNotificationsRead?.();
    expect(notificationRequests).toBe(2);
    expect(listener.mock.lastCall?.[0].monitoring.unreadNotificationCount).toBe(0);
    expect(listener.mock.lastCall?.[0].monitoring.headerNotifications[0].read).toBe(true);
    stream.emit("monitoring.snapshot", monitoringV2Fixture);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(4));
    expect(notificationRequests).toBe(3);
    expect(listener.mock.lastCall?.[0].monitoring.unreadNotificationCount).toBe(0);
    unsubscribe?.();
  });
  test("늦은 개별 읽음 결과는 새 경보 재조회 뒤에도 화면에 전달한다", async () => {
    const api = contract();
    const stream = new Stream();
    let notifications: components["schemas"]["NotificationPage"] = structuredClone(notificationPageFixture);
    let acknowledgeRead: (response: Response) => void = () => undefined;
    const fetchImplementation: typeof fetch = (input, init) => {
      const path = inputUrl(input).pathname;
      if (init?.method === "PATCH") return new Promise((resolve) => { acknowledgeRead = resolve; });
      if (path === "/api/v1/notifications") return Promise.resolve(json(notifications));
      return api.fetchImplementation(input);
    };
    const source = createHttpDashboardDataSource({ fetchImplementation, monitoringVersion: "v2", apiContract: "backend", eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn<(data: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);
    const reading = source.markNotificationRead?.(notificationPageFixture.items[0].id);
    notifications = { ...notifications, unreadCount: 2, items: [{ ...notificationPageFixture.items[0], id: "notif-after-single-read", readAt: null }, ...notifications.items] };
    stream.emit("monitoring.snapshot", { ...monitoringV2Fixture, operations: {
      effectiveState: "CRITICAL", lastKnownState: "CRITICAL", lastEvaluatedAt: null, lastAlertAt: null, notificationId: "notif-after-single-read",
    } });
    await vi.waitFor(() => expect(listener.mock.lastCall?.[0].monitoring.unreadNotificationCount).toBe(2));
    notifications = { ...notifications, unreadCount: 1, items: notifications.items.map((item) => item.id === notificationPageFixture.items[0].id ? { ...item, readAt: monitoringV2Fixture.serverTime } : item) };
    acknowledgeRead(json(notifications.items[1]));
    await reading;
    expect(listener.mock.lastCall?.[0].monitoring.unreadNotificationCount).toBe(1);
    expect(listener.mock.lastCall?.[0].monitoring.headerNotifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "notif-after-single-read", read: false }),
      expect.objectContaining({ id: notificationPageFixture.items[0].id, read: true }),
    ]));
    unsubscribe?.();
  });
  test("실패한 경보 재조회 뒤에도 대기 중인 새 경보의 재조회는 실행한다", async () => {
    const api = contract();
    const stream = new Stream();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend", eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    let rejectNotification: (error: Error) => void = () => undefined;
    api.fetchImplementation.mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectNotification = reject; }));
    const listener = vi.fn<(data: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);
    const operations = { effectiveState: "CRITICAL" as const, lastKnownState: "CRITICAL" as const, lastEvaluatedAt: null, lastAlertAt: null, notificationId: "notif-A" };
    stream.emit("monitoring.snapshot", { ...monitoringV2Fixture, operations });
    stream.emit("monitoring.snapshot", { ...monitoringV2Fixture, operations: { ...operations, notificationId: "notif-B" } });
    rejectNotification(new TypeError("Network request failed"));
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(4));
    expect(listener.mock.calls[2][0].monitoring.notificationState?.status).toBe("error");
    expect(api.fetchImplementation.mock.calls.filter(([input]) => inputUrl(input).pathname === "/api/v1/notifications")).toHaveLength(3);
    expect(listener.mock.lastCall?.[0].monitoring.v2?.operations?.notificationId).toBe("notif-B");
    unsubscribe?.();
  });
  test("실패한 완료 기록 재조회는 다음 1분 주기에 복구하고 snapshot으로 중복하지 않는다", async () => {
    vi.useFakeTimers();
    try {
      const api = contract({ collectionSummary: collectionSummaryFixture({ lastCollectionActivityAt: "2026-10-12T22:00:10Z", averageSettledCollectionCycleSeconds: 90_000, settledCycleCount: 2, settledCollectionsInWindow: 3, settledCycleReasonCodes: [] }) });
      const stream = new Stream();
      let pending = false;
      let rejectCollection: (error: Error) => void = () => undefined;
      const source = createHttpDashboardDataSource({ fetchImplementation: input => pending && inputUrl(input).pathname === "/api/v2/monitoring/collection-summary"
        ? new Promise<Response>((_resolve, reject) => { rejectCollection = reject; }) : api.fetchImplementation(input),
        monitoringVersion: "v2", apiContract: "backend", eventSourceFactory: () => stream as unknown as EventSource });
      await source.getDashboardData();
      const listener = vi.fn<(data: DashboardData) => void>();
      const unsubscribe = source.subscribe?.(listener);
      pending = true;
      await vi.advanceTimersByTimeAsync(60_000);
      stream.emit("monitoring.snapshot", monitoringV2Fixture);
      stream.emit("monitoring.snapshot", { ...monitoringV2Fixture, snapshotId: "completion-update" });
      rejectCollection(new TypeError("Network request failed"));
      await vi.advanceTimersByTimeAsync(0);
      expect(listener.mock.lastCall?.[0].monitoring.completedCollectionState?.status).toBe("error");
      pending = false;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(api.fetchImplementation.mock.calls.filter(([input]) => inputUrl(input).pathname === "/api/v2/monitoring/collection-summary")).toHaveLength(2);
      expect(listener.mock.lastCall?.[0].monitoring.completedCollectionState?.status).toBe("ready");
      expect(listener.mock.lastCall?.[0].monitoring.summary.timeSinceCollection).toBe("2시간 0분");
      unsubscribe?.();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  test("구독 종료는 모두 읽음 이후의 재조회를 취소하고 이전 데이터를 갱신하지 않는다", async () => {
    const api = contract();
    const stream = new Stream();
    let notificationRequests = 0;
    let resolveNotifications: (response: Response) => void = () => undefined;
    let actionSignal: AbortSignal | null | undefined;
    const fetchImplementation: typeof fetch = (input, init) => {
      const path = inputUrl(input).pathname;
      if (path === "/api/v1/notifications/read-all") return Promise.resolve(new Response(null, { status: 204 }));
      if (path === "/api/v1/notifications" && ++notificationRequests > 1) {
        actionSignal = init?.signal;
        return new Promise((resolve) => { resolveNotifications = resolve; });
      }
      return api.fetchImplementation(input);
    };
    const source = createHttpDashboardDataSource({ fetchImplementation, monitoringVersion: "v2", apiContract: "backend", eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn();
    const unsubscribe = source.subscribe?.(listener);
    const reading = source.markAllNotificationsRead?.();
    const rejection = expect(reading).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(actionSignal).toBeDefined());
    const callsBeforeUnsubscribe = listener.mock.calls.length;
    unsubscribe?.();
    resolveNotifications(json({ ...notificationPageFixture, unreadCount: 0, items: [] }));
    await rejection;
    expect(actionSignal?.aborted).toBe(true);
    expect(listener).toHaveBeenCalledTimes(callsBeforeUnsubscribe);
  });
  test("assessment와 장비 snapshot이 없으면 상태와 결측값을 유지한다", () => {
    const result = monitoringV2Data({ ...monitoringV2Fixture, dataState: "NO_DATA", assessment: null }, "pit-01");
    expect(result.v2).toMatchObject({ capabilities: null, fillState: null, configRevision: null, sensors: [] });
    expect(result.summary.loadPercent).toBeNull();
    expect(result.devices.map((device) => device.label)).toEqual(["LiDAR 1", "LiDAR 2", "카메라", "엣지 장비"]);
    expect(result.devices.every((device) => device.status === "unknown")).toBe(true);
  });
  test.each(["NORMAL", "WARNING", "CRITICAL", "UNKNOWN", "ERROR"] as const)("경보 평가 %s를 물리적 작업 상태로 변환하지 않는다", (effectiveState) => {
    const operations = { effectiveState, lastKnownState: "CRITICAL" as const, lastEvaluatedAt: null, lastAlertAt: null, notificationId: "notif-opaque" };
    const result = monitoringV2Data({ ...monitoringV2Fixture, operations }, "pit-01");
    expect(result.v2).toMatchObject({ operations, recoveryThreshold: 80 });
    expect(result.alarmState).toBe(effectiveState);
    expect(result.summary.operationState).toBeNull();
    expect(result.alerts).toEqual([]);
  });
  test.each([null, undefined])("경보 평가 %s는 비활성화 또는 미제공 상태로 보존한다", (operations) => {
    expect(monitoringV2Data({ ...monitoringV2Fixture, operations }, "pit-01").v2?.operations).toBeNull();
  });
  test.each([
    { operations: {} }, { operations: { effectiveState: "COLLECTING" } },
    { summary: { ...monitoringV2Fixture.summary, recoveryThresholdPercent: undefined } },
    { summary: { ...monitoringV2Fixture.summary, recoveryThresholdPercent: 101 } },
  ])("새 경보 계약의 잘못된 입력 %j를 거부한다", (invalid) => {
    expect(() => monitoringV2Data({ ...monitoringV2Fixture, ...invalid }, "pit-01")).toThrow();
  });
  test("잘못된 SSE JSON과 필수 구조가 없는 event는 화면에 적용하지 않는다", async () => {
    const api = contract();
    const stream = new Stream();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend", eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn();
    const unsubscribe = source.subscribe?.(listener);
    expect(() => stream.emitRaw("monitoring.snapshot", "{broken")).not.toThrow();
    expect(() => stream.emit("monitoring.snapshot", { ...monitoringV2Fixture, serverTime: undefined })).not.toThrow();
    expect(() => stream.emit("monitoring.snapshot", { ...monitoringV2Fixture, reasonCodes: "wrong" })).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
    stream.emit("monitoring.snapshot", monitoringV2Fixture);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe?.();
  });
  test("재연결 session 조회는 중복하지 않으며 네트워크 오류를 만료로 처리하지 않는다", async () => {
    const api = contract();
    const stream = new Stream();
    const onSessionExpired = vi.fn();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend", eventSourceFactory: () => stream as unknown as EventSource, onSessionExpired });
    await source.getDashboardData();
    const unsubscribe = source.subscribe?.(vi.fn());
    let rejectSession: (error: Error) => void = () => undefined;
    api.fetchImplementation.mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectSession = reject; }));
    const previous = api.fetchImplementation.mock.calls.length;
    stream.emit("error", {});
    stream.emit("error", {});
    expect(api.fetchImplementation).toHaveBeenCalledTimes(previous + 1);
    rejectSession(new Error("network unavailable"));
    await vi.waitFor(() => expect(onSessionExpired).not.toHaveBeenCalled());
    expect(stream.closed).toBe(false);
    unsubscribe?.();
  });
  test("구독 종료 뒤 session 401과 snapshot은 로그인이나 상태 변경을 발생시키지 않는다", async () => {
    const api = contract();
    const stream = new Stream();
    const onSessionExpired = vi.fn();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend", eventSourceFactory: () => stream as unknown as EventSource, onSessionExpired });
    await source.getDashboardData();
    const listener = vi.fn();
    const unsubscribe = source.subscribe?.(listener);
    let resolveSession: (response: Response) => void = () => undefined;
    api.fetchImplementation.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveSession = resolve; }));
    stream.emit("error", {});
    unsubscribe?.();
    const count = listener.mock.calls.length;
    resolveSession(json({ detail: "Unauthorized" }, 401));
    await new Promise((resolve) => setTimeout(resolve, 0));
    stream.emit("monitoring.snapshot", monitoringV2Fixture);
    stream.emit("session.expired", {});
    expect(listener).toHaveBeenCalledTimes(count);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(stream.closed).toBe(true);
  });
  test.each([0, 72.5, 100])("FRESH의 %s%%를 그대로 유지한다", (value) => {
    const data = monitoringV2Data({ ...monitoringV2Fixture, dataState: "FRESH", summary: { ...monitoringV2Fixture.summary, loadPercent: value } }, "pit-01");
    expect(data.summary.loadPercent).toBe(value);
    expect(data.summary.operationState).toBeNull();
    expect(data.loadHistory).toEqual([]);
    expect(data.lidarProfiles).toEqual([]);
  });
  test.each(["STALE", "UNKNOWN", "UNAVAILABLE", "NO_DATA"] as const)("%s에서 과거 수치를 표시하지 않는다", (dataState) => {
    const data = monitoringV2Data({ ...monitoringV2Fixture, dataState, summary: { ...monitoringV2Fixture.summary, loadPercent: 72 } }, "pit-01");
    expect(data.summary.loadPercent).toBeNull();
    expect(data.v2?.reasonCodes).toEqual(["FILL_METHOD_NOT_IMPLEMENTED"]);
  });
  test("다른 pit의 snapshot을 거부한다", () => {
    expect(() => monitoringV2Data(monitoringV2Fixture, "pit-other")).toThrow("pit assignment");
  });
  test("session이 없으면 로그인으로 이동하고 snapshot을 요청하지 않는다", async () => {
    const api = contract({ authenticated: false });
    const onSessionExpired = vi.fn();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend", onSessionExpired });
    await expect(source.getDashboardData()).rejects.toBeInstanceOf(ApiError);
    expect(onSessionExpired).toHaveBeenCalledOnce();
    expect(api.urls.map((url) => url.pathname)).toEqual(["/api/v1/session"]);
  });
  test("Backend v1 녹화 조회도 session이 없으면 로그인으로 이동한다", async () => {
    const api = contract({ authenticated: false });
    const onSessionExpired = vi.fn();
    const source = createHttpDashboardDataSource({ ...api, apiContract: "backend", monitoringVersion: "v1", route: () => "/recordings", onSessionExpired });
    await expect(source.getDashboardData()).rejects.toBeInstanceOf(ApiError);
    expect(onSessionExpired).toHaveBeenCalledOnce();
    expect(api.urls.map((url) => url.pathname)).toEqual(["/api/v1/session"]);
  });
  test("SSE 연결 실패 중 만료된 session을 확인하면 stream을 닫고 로그인으로 이동한다", async () => {
    const api = contract();
    const stream = new Stream();
    const onSessionExpired = vi.fn();
    const source = createHttpDashboardDataSource({ ...api, apiContract: "backend", monitoringVersion: "v2", eventSourceFactory: () => stream as unknown as EventSource, onSessionExpired });
    await source.getDashboardData();
    const unsubscribe = source.subscribe?.(vi.fn());
    api.fetchImplementation.mockResolvedValueOnce(json({ detail: "Unauthorized" }, 401));
    stream.emit("error", {});
    await vi.waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
    expect(stream.closed).toBe(true);
    expect(api.urls.map((url) => url.pathname)).toContain("/api/v1/session");
    unsubscribe?.();
  });
  test("관리자 조회와 저장은 설정한 단일 pit을 사용한다", async () => {
    const api = contract({ snapshot: { ...monitoringV2Fixture, pitId: "pit-other", source: { ...monitoringV2Fixture.source, pit_id: "pit-other" } } });
    const source = createHttpDashboardDataSource({ ...api, apiContract: "backend", monitoringVersion: "v2", pitId: "pit-other", route: () => "/admin" });
    const data = await source.getDashboardData();
    await source.replaceAlertSettings?.(data.admin.alertSettings);
    const settings = api.urls.filter((url) => url.pathname === "/api/v1/settings/alerts");
    expect(settings).toHaveLength(2);
    expect(settings.every((url) => url.searchParams.get("pit_id") === "pit-other")).toBe(true);
  });
  test("v2의 영상 모드는 MJPEG이며 지원하지 않는 WHEP 조합을 거부한다", async () => {
    const api = contract();
    const source = createHttpDashboardDataSource({ ...api, apiContract: "backend", monitoringVersion: "v2" });
    expect((await source.getDashboardData()).monitoring).toMatchObject({ videoMode: "mjpeg", videoUrl: "/media/cameras/camera-main/live" });
    expect(() => createHttpDashboardDataSource({ monitoringVersion: "v2", liveVideoMode: "webrtc" })).toThrow("only MJPEG");
  });
  test("SSE에 event ID 없이 상태를 적용하고 연결 중단과 복구를 처리한다", async () => {
    const api = contract();
    const stream = new Stream();
    const factory = vi.fn(() => stream as unknown as EventSource);
    const onSessionExpired = vi.fn();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend", liveVideoMode: "mjpeg", eventSourceFactory: factory, onSessionExpired });
    const initial = await source.getDashboardData();
    expect(initial.monitoring.v2?.dataState).toBe("UNAVAILABLE");
    expect(initial.monitoring.videoUrl).toBe("/media/cameras/camera-main/live");
    const updates: DashboardData[] = [];
    const unsubscribe = source.subscribe?.((value) => updates.push(value));
    expect(factory).toHaveBeenCalledWith("/api/v2/monitoring/events?pit_id=pit-01");
    const fresh = { ...monitoringV2StateFixture("FRESH", 0), operations: {
      effectiveState: "NORMAL" as const, lastKnownState: "NORMAL" as const, lastEvaluatedAt: null, lastAlertAt: null, notificationId: null,
    } };
    stream.emit("monitoring.snapshot", fresh);
    expect(updates.at(-1)?.monitoring.summary.loadPercent).toBe(0);
    expect(updates.at(-1)?.monitoring.alarmState).toBe("NORMAL");
    stream.emit("error", {});
    expect(updates.at(-1)?.monitoring.summary.loadPercent).toBeNull();
    expect(updates.at(-1)?.monitoring.alarmState).toBe("UNKNOWN");
    expect(updates.at(-1)?.monitoring.v2?.streamState).toBe("reconnecting");
    stream.emit("monitoring.snapshot", fresh);
    expect(updates.at(-1)?.monitoring.summary.loadPercent).toBe(0);
    expect(updates.at(-1)?.monitoring.alarmState).toBe("NORMAL");
    expect(updates.at(-1)?.monitoring.v2?.streamState).toBe("connected");
    const count = updates.length;
    stream.emit("monitoring.snapshot", { ...fresh, pitId: "other" });
    expect(updates).toHaveLength(count);
    stream.emit("session.expired", {});
    expect(stream.closed).toBe(true);
    expect(onSessionExpired).toHaveBeenCalledOnce();
    unsubscribe?.();
  });
  test("이벤트 녹화 목록은 v2 경로로 category와 pit_id를 전송하고 구간 상태를 보존한다", async () => {
    const api = contract();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    const result = await source.queryRecordings?.({ from: "2026-10-05T00:00", to: "2026-10-12T00:00", eventCategory: "alert" });
    expect(result?.[0]).toMatchObject({ source: "event", id: eventRecordingFixture().eventId, type: "알림", width: null, height: null, frameRate: null, codec: "정보 없음", size: "정보 없음", eventWindow: { windowState: "POINT" } });
    expect(result?.[0].replay).toBeUndefined();
    expect(api.urls[0].pathname).toBe("/api/v2/recordings/events");
    expect(api.urls[0].searchParams.get("category")).toBe("alert");
    expect(api.urls[0].searchParams.get("pit_id")).toBe("pit-01");
    expect(api.urls[0].searchParams.get("pageSize")).toBe("20");
  });
  test("이벤트 녹화는 90일을 넘는 범위를 요청하지 않는다", async () => {
    const api = contract();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    await expect(source.queryRecordings?.({ from: "2026-06-01T00:00", to: "2026-10-01T00:00" })).rejects.toMatchObject({ code: "RECORDING_RANGE_TOO_LARGE" });
    expect(api.urls.some((url) => url.pathname === "/api/v2/recordings/events")).toBe(false);
  });
  test("이벤트 녹화 상세는 parts를 재생 구간으로 변환하고 다운로드 경로를 만들지 않는다", async () => {
    const api = contract();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    const result = await source.getRecording?.(eventRecordingFixture().eventId);
    expect(result).toMatchObject({ status: "available", coverage: "complete", duration: "1:00", codec: "정보 없음", retentionEndsAt: "정보 없음" });
    expect(result?.downloadUrl).toBeUndefined();
    expect(result?.contentUrl).toBeUndefined();
    expect(result?.replay?.parts).toHaveLength(1);
    expect(result?.replay?.downloadReasonCode).toBe("EVENT_RANGE_EXPORT_UNSUPPORTED");
  });
  test("이벤트 녹화 상세의 일부 확보와 재생 불가 상태를 구분한다", async () => {
    const api = contract();
    const partial = eventReplayFixture({ state: "PARTIAL", unavailableIntervals: [{ fromAt: "2026-10-12T01:00:00Z", toAt: "2026-10-12T01:00:10Z", kind: "GAP", reasonCode: "RECORDING_GAP" }] });
    api.fetchImplementation.mockImplementation((input) => {
      const url = inputUrl(input);
      if (url.pathname.startsWith("/api/v2/recordings/events/")) return Promise.resolve(json(partial));
      return Promise.resolve(json(sessionFixture));
    });
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    const result = await source.getRecording?.(eventRecordingFixture().eventId);
    expect(result).toMatchObject({ status: "available", coverage: "partial" });
    expect(result?.replay?.unavailableIntervals).toHaveLength(1);
  });
  test.each([
    ["part가 없는 UNAVAILABLE", eventReplayFixture({ state: "UNAVAILABLE", parts: [], playbackSeconds: 0, coveredSeconds: 0 }), "unavailable"],
    ["part가 없는 PROCESSING", eventReplayFixture({ state: "PROCESSING", parts: [], playbackSeconds: 0, coveredSeconds: 0 }), "processing"],
  ])("이벤트 녹화 %s는 재생 가능으로 표시하지 않는다", async (_name, body, status) => {
    const api = contract();
    api.fetchImplementation.mockImplementation(() => Promise.resolve(json(body)));
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    expect(await source.getRecording?.(eventRecordingFixture().eventId)).toMatchObject({ status });
  });
  test.each([
    ["다른 eventId", eventReplayFixture({}, { eventId: "other" })],
    ["변조된 재생 경로", eventReplayFixture({ parts: [{ ...eventReplayFixture().parts[0], playbackPath: "https://evil.example/index.m3u8" }] })],
    ["재생 길이 불일치", eventReplayFixture({ playbackSeconds: 90 })],
    ["알 수 없는 state", eventReplayFixture({ state: "READY" })],
    ["다운로드 경로 노출", eventReplayFixture({ downloadPath: "/x" })],
  ])("이벤트 녹화 상세의 %s는 거부한다", async (_name, body) => {
    const api = contract();
    api.fetchImplementation.mockImplementation(() => Promise.resolve(json(body)));
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    await expect(source.getRecording?.(eventRecordingFixture().eventId)).rejects.toThrow();
  });
});
