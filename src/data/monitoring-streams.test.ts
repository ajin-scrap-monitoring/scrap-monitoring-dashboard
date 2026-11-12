import { afterEach, describe, expect, test, vi } from "vitest";

import type { DashboardData } from "../domain/dashboard";
import { notificationPageFixture, sessionFixture } from "../test/api-contract-fixtures";
import { activeAlertsFixture, cameraStatusFixture, collectionSummaryFixture, monitoringV2StateFixture } from "../test/backend-contract-fixtures";
import { createHttpDashboardDataSource } from "./http-dashboard-data-source";

class Stream {
  listeners = new Map<string, EventListener>();
  close = vi.fn();
  addEventListener(type: string, listener: EventListener) { this.listeners.set(type, listener); }
  emit(type: string, value: unknown) { this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(value) })); }
}
const snapshot = { ...monitoringV2StateFixture("FRESH", 72), operations: {
  effectiveState: "NORMAL" as const, lastKnownState: null, lastEvaluatedAt: null, lastAlertAt: null, notificationId: null,
} };
const pair = (overrides: Record<string, unknown> = {}) => ({ snapshot, activeAlerts: activeAlertsFixture({ evaluationState: "NORMAL", items: [] }), ...overrides });
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function harness() {
  const stream = new Stream();
  const urls: URL[] = [];
  let response = () => Promise.resolve(json(pair()));
  const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2",
    eventSourceFactory: () => stream as unknown as EventSource,
    fetchImplementation: vi.fn((input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://dashboard.example");
      urls.push(url);
      if (url.pathname === "/api/v1/session") return Promise.resolve(json(sessionFixture));
      if (url.pathname === "/api/v2/monitoring/snapshot") return Promise.resolve(json(snapshot));
      if (url.pathname === "/api/v1/notifications") return Promise.resolve(json(notificationPageFixture));
      if (url.pathname === "/api/v2/monitoring/snapshot-with-alerts") return response();
      if (url.pathname === "/api/v2/monitoring/collection-summary") return Promise.resolve(json(collectionSummaryFixture()));
      return Promise.resolve(new Response(null, { status: 503 }));
    }),
  });
  const updates: DashboardData[] = [];
  let unsubscribe: (() => void) | undefined;
  return { source, stream, urls, updates,
    async start() { await source.getDashboardData(); unsubscribe = source.subscribe!(data => updates.push(data)); },
    response(next: () => Promise<Response>) { response = next; },
    latest() { return updates.at(-1)!.monitoring; },
    stop() { unsubscribe?.(); },
  };
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
afterEach(() => vi.restoreAllMocks());

describe("결합 snapshot과 활성 알림", () => {
  test("active-alerts 요청 없이 결합 요청으로 같은 ID와 시각의 근거를 쓴다", async () => {
    const h = harness();
    await h.start();
    const activation = h.source.activateMonitoringDetails!();
    await activation.ready;
    expect(h.latest().activeAlertsAreaState?.status).toBe("ready");
    expect(h.latest().activeAlertsState?.basis?.snapshotId).toBe(snapshot.snapshotId);
    expect(h.urls.filter(url => url.pathname.endsWith("/active-alerts"))).toHaveLength(0);
    expect(h.urls.filter(url => url.pathname.endsWith("/snapshot-with-alerts"))).toHaveLength(1);
    expect(Object.fromEntries(h.urls.find(url => url.pathname.endsWith("/snapshot-with-alerts"))!.searchParams)).toEqual({ pit_id: "pit-01", scope: "ALL" });
    activation.release(); h.stop();
  });

  test("결합 응답이 늦어도 현황 상세 ready를 기다리게 하지 않고 활성 알림만 확인 중으로 둔다", async () => {
    const h = harness();
    const pending = deferred<Response>();
    h.response(() => pending.promise);
    await h.start();
    const activation = h.source.activateMonitoringDetails!();
    await activation.ready;
    expect(h.latest().completedCollectionState?.status).toBe("ready");
    expect(h.latest().activeAlertsAreaState?.status).toBe("loading");
    expect(h.latest().activeAlertsState).toBeNull();
    pending.resolve(json(pair()));
    await settle();
    expect(h.latest().activeAlertsAreaState?.status).toBe("ready");
    expect(h.latest().activeAlertsState?.basis?.snapshotId).toBe(snapshot.snapshotId);
    activation.release(); h.stop();
  });

  test.each(["id", "time", "pit", "source"])("결합 근거의 %s 불일치는 활성 알림 오류다", async (kind) => {
    const h = harness();
    const value = pair();
    if (kind === "id") value.activeAlerts.basis.snapshotId = "other";
    if (kind === "time") value.activeAlerts.computedAt = "2026-10-13T00:01:00Z";
    if (kind === "pit") value.snapshot = { ...snapshot, pitId: "other" };
    if (kind === "source") value.snapshot = { ...snapshot, source: { ...snapshot.source, edge_id: "other" } };
    h.response(() => Promise.resolve(json(value)));
    await h.start();
    const activation = h.source.activateMonitoringDetails!(); await activation.ready;
    expect(h.latest().activeAlertsState).toBeNull();
    expect(h.latest().activeAlertsAreaState?.status).toBe("error");
    expect(h.latest().alerts).toEqual([]);
    activation.release(); h.stop();
  });

  test("진행 중인 결합 조회가 있으면 새 결합 조회를 시작하지 않고 release 뒤 응답은 적용하지 않는다", async () => {
    const h = harness(); await h.start();
    const first = deferred<Response>();
    h.response(() => first.promise);
    const a = h.source.activateMonitoringDetails!();
    const b = h.source.activateMonitoringDetails!();
    await b.ready;
    first.resolve(json(pair({ activeAlerts: activeAlertsFixture({ evaluationState: "WARNING", items: [] }) })));
    await a.ready; await settle();
    expect(h.urls.filter(url => url.pathname.endsWith("/snapshot-with-alerts"))).toHaveLength(1);
    expect(h.latest().activeAlertsState?.evaluationState).toBe("WARNING");
    a.release(); b.release(); h.stop();

    const late = harness(); await late.start();
    const pending = deferred<Response>(); late.response(() => pending.promise);
    const c = late.source.activateMonitoringDetails!(); c.release();
    await c.ready; const count = late.updates.length;
    pending.resolve(json(pair())); await settle();
    expect(late.updates).toHaveLength(count);
    late.stop();
  });

  test("대상이 바뀌면 이전 대상의 진행 중 결합 조회를 기다리지 않고 새 조회를 시작하며 이전 응답은 적용하지 않는다", async () => {
    const h = harness(); await h.start();
    const old = deferred<Response>();
    h.response(() => old.promise);
    const activation = h.source.activateMonitoringDetails!(); await activation.ready;
    const alertRequests = () => h.urls.filter(url => url.pathname.endsWith("/snapshot-with-alerts")).length;
    expect(alertRequests()).toBe(1);
    const target = { ...snapshot.source, edge_id: "reassigned-edge" };
    const moved = { ...snapshot, source: target, assessment: snapshot.assessment && { ...snapshot.assessment, edge_id: target.edge_id },
      deviceStatus: { ...snapshot.deviceStatus, edge_id: target.edge_id } };
    h.response(() => Promise.resolve(json(pair({ snapshot: moved, activeAlerts: activeAlertsFixture({ evaluationState: "WARNING", items: [] }) }))));
    h.stream.emit("monitoring.snapshot", moved);
    await settle();
    expect(alertRequests()).toBe(2);
    expect(h.latest().activeAlertsState?.evaluationState).toBe("WARNING");
    old.resolve(json(pair()));
    await settle();
    expect(h.latest().activeAlertsState?.evaluationState).toBe("WARNING");
    activation.release(); h.stop();
  });

  test("SSE 판정 변경은 결합 조회만 한 번 요청하고 5초 제한과 같은 ID의 새 응답을 적용한다", async () => {
    let now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
    const h = harness(); await h.start();
    const activation = h.source.activateMonitoringDetails!(); await activation.ready;
    const counts = () => h.urls.filter(url => !url.pathname.endsWith("/snapshot-with-alerts")).length;
    const before = counts(); const initial = h.urls.length;
    const pending = deferred<Response>(); h.response(() => pending.promise);
    const changed = { ...snapshot, snapshotId: "new-sse", operations: { ...snapshot.operations, effectiveState: "CRITICAL" } };
    h.stream.emit("monitoring.snapshot", changed);
    h.stream.emit("monitoring.snapshot", changed);
    expect(h.urls.length - initial).toBe(1);
    expect(counts()).toBe(before);
    expect(h.latest().activeAlertsState?.mismatch).toBeNull();
    pending.resolve(json(pair({ activeAlerts: activeAlertsFixture({ evaluationState: "WARNING", items: [] }) })));
    await settle();
    expect(h.latest().activeAlertsState?.evaluationState).toBe("WARNING");
    expect(h.latest().activeAlertsState?.mismatch?.snapshotState).toBe("NORMAL");
    expect(h.latest().v2?.snapshotId).toBe("new-sse");
    now += 4999; h.stream.emit("monitoring.snapshot", changed);
    expect(h.urls.length - initial).toBe(1);
    h.response(() => Promise.resolve(json(pair())));
    now += 1; h.stream.emit("monitoring.snapshot", changed); await settle();
    expect(h.urls.length - initial).toBe(2);
    expect(h.latest().activeAlertsState?.evaluationState).toBe("NORMAL");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    now += 5000; h.stream.emit("monitoring.snapshot", changed);
    expect(h.urls.length - initial).toBe(2);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    activation.release(); h.stream.emit("monitoring.snapshot", changed);
    expect(h.urls.length - initial).toBe(2);
    h.stop();
  });

  test("60초가 지난 뒤의 SSE snapshot은 현황 상세를 갱신하고 판정 변경 재조회를 중복하지 않는다", async () => {
    let now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
    const h = harness(); await h.start();
    const activation = h.source.activateMonitoringDetails!(); await activation.ready;
    const count = (path: string) => h.urls.filter(url => url.pathname.endsWith(path)).length;
    h.stream.emit("monitoring.snapshot", snapshot); await settle();
    expect(count("/collection-summary")).toBe(1);
    expect(count("/snapshot-with-alerts")).toBe(1);
    now += 60_000;
    const changed = { ...snapshot, snapshotId: "new-sse", operations: { ...snapshot.operations, effectiveState: "CRITICAL" } };
    h.stream.emit("monitoring.snapshot", changed); await settle();
    expect(count("/collection-summary")).toBe(2);
    expect(count("/snapshot-with-alerts")).toBe(2);
    activation.release(); h.stop();
  });
});

describe("카메라 SSE data source", () => {
  test("검증한 마지막 상태와 단조 수신 시각을 재진입 구독자에게 즉시 전달하고 GET을 보내지 않는다", async () => {
    const h = harness(); await h.start();
    const listener = vi.fn(); const off = h.source.subscribeCameraStatus!(listener);
    h.stream.emit("monitoring.camera-status", cameraStatusFixture());
    expect(listener).toHaveBeenCalledTimes(1);
    const receivedAt = listener.mock.calls[0][1] as number;
    expect(receivedAt).toBeGreaterThanOrEqual(0);
    h.stream.emit("monitoring.camera-status", cameraStatusFixture({ pitId: "other" }));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    const replay = vi.fn(); const offReplay = h.source.subscribeCameraStatus!(replay);
    expect(replay).toHaveBeenCalledExactlyOnceWith(listener.mock.calls[0][0], receivedAt);
    h.stream.emit("monitoring.camera-status", cameraStatusFixture());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledTimes(2);
    h.stream.emit("error", {}); await settle();
    expect(h.urls.some(url => url.pathname.endsWith("/camera-status"))).toBe(false);
    h.stream.emit("session.expired", {});
    h.stream.emit("monitoring.camera-status", cameraStatusFixture());
    expect(replay).toHaveBeenCalledTimes(2);
    expect(h.stream.close).toHaveBeenCalled();
    offReplay(); h.stop();
  });

  test("로그아웃은 SSE를 닫고 이후 카메라 이벤트를 적용하지 않는다", async () => {
    const h = harness(); await h.start();
    const listener = vi.fn(); const off = h.source.subscribeCameraStatus!(listener);
    h.stream.emit("monitoring.camera-status", cameraStatusFixture());
    await h.source.deleteSession!();
    h.stream.emit("monitoring.camera-status", cameraStatusFixture());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(h.stream.close).toHaveBeenCalled();
    off(); h.stop();
  });
});
