import { describe, expect, test, vi } from "vitest";

import type { DashboardData } from "../domain/dashboard";
import { alertSettingsFixture, recipientPageFixture, sessionFixture, notificationPageFixture, recordingPageFixture } from "../test/api-contract-fixtures";
import { mediaRecordingFixture, monitoringV2Fixture, monitoringV2StateFixture } from "../test/backend-contract-fixtures";

import { ApiError, createHttpDashboardDataSource } from "./http-dashboard-data-source";
import { monitoringV2Data, type ApiMonitoringSnapshotV2 } from "./monitoring-v2";

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }

function contract({ authenticated = true, snapshot = monitoringV2Fixture }: { authenticated?: boolean; snapshot?: ApiMonitoringSnapshotV2 } = {}) {
  const urls: URL[] = [];
  const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://dashboard.example");
    urls.push(url);
    if (url.pathname === "/api/v1/session") return Promise.resolve(authenticated ? json(sessionFixture) : json({ detail: "Unauthorized" }, 401));
    if (url.pathname === "/api/v2/monitoring/snapshot") return Promise.resolve(json(snapshot));
    if (url.pathname === "/api/v1/notifications") return Promise.resolve(json(notificationPageFixture));
    if (url.pathname === "/api/v1/recordings") return Promise.resolve(json({ ...recordingPageFixture, items: [mediaRecordingFixture] }));
    if (url.pathname === "/api/v1/settings/alerts") return Promise.resolve(json(alertSettingsFixture));
    if (url.pathname === "/api/v1/notification-recipients") return Promise.resolve(json(recipientPageFixture));
    throw new Error(`Unexpected path ${url.pathname}`);
  });
  return { urls, fetchImplementation };
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
  test("NO_DATA의 null 관측 시각을 정보 없음으로 표시한다", async () => {
    const api = contract({ snapshot: monitoringV2StateFixture("NO_DATA") });
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    const result = await source.getDashboardData();
    expect(result.lastMeasuredAt).toBe("정보 없음");
    expect(result.monitoring.v2?.measuredAt).toBeNull();
  });
  test.each(["collecting", "processing", "failed", "deleted", "expired", "unexpected"])("녹화 mediaStatus %s에 과거 영상 경로를 노출하지 않는다", async (mediaStatus) => {
    const api = contract();
    api.fetchImplementation.mockResolvedValueOnce(json({ ...recordingPageFixture, items: [{ ...mediaRecordingFixture, status: "available", mediaStatus }] }));
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    const result = await source.queryRecordings?.({ from: "2026-09-01T00:00", to: "2026-10-01T00:00" });
    expect(result?.[0]).toMatchObject({ mediaStatus, status: "unavailable", contentUrl: undefined, downloadUrl: undefined });
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
  test("assessment와 장비 snapshot이 없으면 상태와 결측값을 유지한다", () => {
    const result = monitoringV2Data({ ...monitoringV2Fixture, dataState: "NO_DATA", assessment: null }, "pit-01");
    expect(result.v2).toMatchObject({ capabilities: null, fillState: null, configRevision: null, sensors: [] });
    expect(result.summary.loadPercent).toBeNull();
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
    const fresh = { ...monitoringV2Fixture, dataState: "FRESH", summary: { ...monitoringV2Fixture.summary, loadPercent: 0 } };
    stream.emit("monitoring.snapshot", fresh);
    expect(updates.at(-1)?.monitoring.summary.loadPercent).toBe(0);
    stream.emit("error", {});
    expect(updates.at(-1)?.monitoring.summary.loadPercent).toBeNull();
    expect(updates.at(-1)?.monitoring.v2?.streamState).toBe("reconnecting");
    stream.emit("monitoring.snapshot", fresh);
    expect(updates.at(-1)?.monitoring.summary.loadPercent).toBe(0);
    expect(updates.at(-1)?.monitoring.v2?.streamState).toBe("connected");
    const count = updates.length;
    stream.emit("monitoring.snapshot", { ...fresh, pitId: "other" });
    expect(updates).toHaveLength(count);
    stream.emit("session.expired", {});
    expect(stream.closed).toBe(true);
    expect(onSessionExpired).toHaveBeenCalledOnce();
    unsubscribe?.();
  });
  test("녹화 null metadata와 부분 저장을 유지하고 category와 pit_id를 전송한다", async () => {
    const api = contract();
    const source = createHttpDashboardDataSource({ ...api, monitoringVersion: "v2", apiContract: "backend" });
    const result = await source.queryRecordings?.({ from: "2026-09-01T00:00", to: "2026-10-01T00:00", eventCategory: "alert" });
    expect(result?.[0]).toMatchObject({ width: null, height: null, frameRate: null, size: "정보 없음", duration: "정보 없음", retentionEndsAt: "정보 없음", coverage: "partial" });
    expect(api.urls[0].searchParams.get("category")).toBe("alert");
    expect(api.urls[0].searchParams.get("pit_id")).toBe("pit-01");
    expect(api.urls[0].searchParams.has("eventCategory")).toBe(false);
  });
});
