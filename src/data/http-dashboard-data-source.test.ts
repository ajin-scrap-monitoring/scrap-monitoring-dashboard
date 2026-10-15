import { afterEach, describe, expect, test, vi } from "vitest";

import {
  alertSettingsFixture,
  eventPageFixture,
  loadHistoryFixture,
  monitoringFixture,
  notificationPageFixture,
  recipientFixture,
  recipientPageFixture,
  recordingPageFixture,
  sessionFixture,
} from "../test/api-contract-fixtures";

import { ApiError, createHttpDashboardDataSource } from "./http-dashboard-data-source";
import type { DashboardData } from "../domain/dashboard";
import { monitoringV2StateFixture } from "../test/backend-contract-fixtures";
import { dailyRecordingFixture, dailyRecordingId } from "../test/daily-recording-fixtures";

type RecordedRequest = { init?: RequestInit; url: URL };

test("현재 분의 녹화 조회 종료를 올림하고 현황 전용 추이는 조회하지 않는다", async () => {
  const requests: URL[] = [];
  const serverTime = "2026-10-15T12:34:50+09:00";
  const snapshot = { ...monitoringV2StateFixture("FRESH", 0), serverTime };
  const source = createHttpDashboardDataSource({
    apiContract: "backend", monitoringVersion: "v2", route: () => "/recordings", locationSearch: () => "?recordingSource=event",
    fetchImplementation: input => {
      const url = inputUrl(input);
      requests.push(url);
      if (url.pathname === "/api/v1/session") return jsonResponse(sessionFixture);
      if (url.pathname === "/api/v2/monitoring/snapshot") return jsonResponse(snapshot);
      if (url.pathname === "/api/v1/notifications") return jsonResponse(notificationPageFixture);
      if (url.pathname === "/api/v1/recordings") return jsonResponse({ ...recordingPageFixture, items: [{ ...recordingPageFixture.items[0], startedAt: "2026-10-15T12:34:10+09:00", endedAt: "2026-10-15T12:34:40+09:00" }] });
      if (url.pathname === "/api/v1/events") return jsonResponse({ ...eventPageFixture, items: [] });
      return jsonResponse({ detail: "Synthetic history failure" }, 503);
    },
  });
  const data = await source.getDashboardData();
  expect(data.recordings).toHaveLength(1);
  expect(data.history.endsAt).toBe("2026-10-15T12:35");
  expect(requests.find(url => url.pathname === "/api/v1/recordings")?.searchParams.get("to")).toBe("2026-10-15T12:35:00+09:00");
  expect(requests.some(url => url.pathname === "/api/v2/monitoring/load-history")).toBe(false);
});

function jsonResponse(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" }, status }));
}

function inputUrl(input: RequestInfo | URL) {
  const value = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(value, "https://dashboard.example");
}

function requestBodyText(body: BodyInit | null | undefined) {
  return typeof body === "string" ? body : "{}";
}

function createContractFetch({ authenticated = true }: { authenticated?: boolean } = {}) {
  const requests: RecordedRequest[] = [];
  const implementation = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = inputUrl(input);
    requests.push({ init, url });
    const method = init?.method ?? "GET";

    if (url.pathname === "/api/v1/session" && method === "GET") {
      return authenticated ? jsonResponse(sessionFixture) : jsonResponse({ status: 401, title: "Unauthorized", type: "about:blank" }, 401);
    }
    if (url.pathname === "/api/v1/session" && method === "POST") return jsonResponse(sessionFixture);
    if (url.pathname === "/api/v1/session" && method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
    if (url.pathname === "/api/v1/monitoring/snapshot") return jsonResponse(monitoringFixture);
    if (url.pathname === "/api/v1/notifications" && method === "GET") return jsonResponse(notificationPageFixture);
    if (url.pathname === "/api/v1/notifications/read-all") return Promise.resolve(new Response(null, { status: 204 }));
    if (url.pathname.startsWith("/api/v1/notifications/") && method === "PATCH") return jsonResponse(notificationPageFixture.items[0]);
    if (url.pathname === "/api/v1/history/load") return jsonResponse(loadHistoryFixture);
    if (url.pathname === "/api/v1/events") return jsonResponse(eventPageFixture);
    if (url.pathname === "/api/v1/recordings") return jsonResponse(recordingPageFixture);
    if (url.pathname === `/api/v1/recordings/${recordingPageFixture.items[0].id}`) return jsonResponse(recordingPageFixture.items[0]);
    if (url.pathname === "/api/v1/settings/alerts" && method === "GET") return jsonResponse(alertSettingsFixture);
    if (url.pathname === "/api/v1/settings/alerts" && method === "PUT") return jsonResponse({ ...alertSettingsFixture, version: '"settings-contract-v2"' });
    if (url.pathname === "/api/v1/notification-recipients" && method === "GET") return jsonResponse(recipientPageFixture);
    if (url.pathname === "/api/v1/notification-recipients" && method === "POST") return jsonResponse(recipientFixture, 201);
    if (url.pathname.startsWith("/api/v1/notification-recipients/") && method === "PATCH") return jsonResponse({ ...recipientFixture, version: '"recipient-contract-v2"' });
    if (url.pathname === "/api/v1/notifications/test" && method === "POST") return Promise.resolve(new Response(null, { status: 202 }));
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });
  return { implementation, requests };
}

class FakeEventSource {
  readonly listeners = new Map<string, EventListener[]>();
  closed = false;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown, lastEventId = "") {
    const event = new MessageEvent(type, { data: JSON.stringify(data), lastEventId });
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

test.each(["proposal", "backend"] as const)("%s의 촬영 시각은 확인한 계약의 출처에 따라 사용한다", async (apiContract) => {
  const fetchFixture = createContractFetch();
  const source = createHttpDashboardDataSource({ apiContract, monitoringVersion: "v1", fetchImplementation: fetchFixture.implementation });
  const data = await source.getDashboardData();
  expect(data.monitoring.videoCapturedAt).toBe(apiContract === "proposal" ? monitoringFixture.video.capturedAt : null);
});

test.each(["proposal", "backend"] as const)("%s v1 이력은 최초 조회와 재조회에서 서버 제목과 내용을 별도로 보존한다", async (apiContract) => {
  const base = createContractFetch();
  const event = { ...eventPageFixture.items[0], title: "서버 이벤트 제목", detail: "서버가 제공한 상세 설명입니다." };
  const source = createHttpDashboardDataSource({ apiContract, monitoringVersion: "v1", route: () => "/history",
    fetchImplementation: (input, init) => inputUrl(input).pathname === "/api/v1/events"
      ? jsonResponse({ ...eventPageFixture, items: [event] }) : base.implementation(input, init),
  });
  const initial = await source.getDashboardData();
  const queried = await source.queryHistory!({ from: "2026-09-03T00:00", to: "2026-09-10T00:00" });
  for (const history of [initial.history, queried]) {
    expect(history.events[0]).toMatchObject({ title: event.title, detail: event.detail, content: event.detail });
  }
});

test("v2 수신 오류는 장비의 현재 표시만 무효화하며 재수신 때 같은 보고 상태를 복원한다", async () => {
  const at = "2026-10-13T00:00:09Z";
  const snapshot: ReturnType<typeof monitoringV2StateFixture> = { ...monitoringV2StateFixture("FRESH", 72), deviceStatus: {
    site_id: "site-demo", edge_id: "edge-demo", connection_state: "REPORTING", last_received_at: at,
    effective_state: "HEALTHY", reason_codes: [], snapshot: {
      schema_version: "2.0", message_type: "edge_status", message_id: "synthetic-device-status", site_id: "site-demo", edge_id: "edge-demo",
      generated_at: at, config_revision: "synthetic-config-1", orchestrator_instance_id: "synthetic-status", sequence: 1,
      overall_state: "HEALTHY", reason_codes: [], clock: { state: "SYNCED", offset_ms: 0 },
      sensors: [{ sensor_id: "lidar-a", data_state: "FRESH", last_scan_at: at, reason_codes: [] }],
      services: [{ service: "camera-edge", state: "HEALTHY", last_progress_at: at, reason_codes: [] }],
      delivery: { pending_messages: 0, pending_bytes: 0, quarantined_messages: 0, last_backend_ack_at: null },
      storage: { limit_bytes: 4096, used_bytes: 0, lost_messages: 0, loss_from: null, loss_to: null, last_loss_reason: null, unavailable_evidence_scan_ids: [] },
    },
  } };
  const fetchImplementation = createV2ContractFetch(url => url.pathname === "/api/v2/monitoring/snapshot" ? jsonResponse(snapshot) : undefined);
  const stream = new FakeEventSource();
  const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation,
    eventSourceFactory: () => stream as unknown as EventSource });
  const initial = await source.getDashboardData();
  expect(initial.monitoring.devices.map(device => device.status)).toEqual(["normal", "normal", "normal"]);
  const updates: DashboardData[] = [];
  const unsubscribe = source.subscribe!(data => updates.push(data));
  try {
    stream.emit("monitoring.snapshot", snapshot, "same-snapshot");
    stream.emit("error", {});
    const disconnected = updates.at(-1)!.monitoring;
    expect(disconnected.devices.every(device => device.status === "unknown" && device.statusLabel === "UNKNOWN")).toBe(true);
    expect(disconnected.v2).toMatchObject({ streamState: "reconnecting", connectionState: "REPORTING",
      sensors: [{ id: "lidar-a", state: "FRESH" }], services: [{ name: "camera-edge", state: "HEALTHY" }] });
    stream.emit("monitoring.snapshot", snapshot, "same-snapshot");
    expect(updates.at(-1)!.monitoring.devices).toEqual(initial.monitoring.devices);
    expect(updates.at(-1)!.monitoring.v2?.streamState).toBe("connected");
  } finally { unsubscribe(); }
});

function v2HistoryResponse(url: URL) {
  const from = url.searchParams.get("from")!;
  const to = url.searchParams.get("to")!;
  const start = Date.parse(from);
  const end = Date.parse(to);
  const interval = 3_600_000;
  const samples = [];
  for (let time = Math.floor(start / interval) * interval; time < end; time += interval) {
    const bucketStartAt = new Date(Math.max(start, time)).toISOString();
    samples.push({ bucketStartAt, bucketEndAt: new Date(Math.min(end, time + interval)).toISOString(),
      generatedAt: bucketStartAt, observedAt: bucketStartAt, assessmentId: `assessment-${time}`,
      valuePercent: 0, valid: true, dataState: "AVAILABLE", reasonCodes: [] });
  }
  const snapshot = monitoringV2StateFixture("FRESH", 72);
  return { schemaVersion: "2", pitId: "pit-01", source: snapshot.source, from, to, bucketSeconds: 3600,
    selectionPolicy: "LATEST_STATE_PER_BUCKET", samples };
}

function createV2ContractFetch(override?: (url: URL, init?: RequestInit) => Promise<Response> | undefined) {
  const base = createContractFetch();
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = inputUrl(input);
    const overridden = override?.(url, init);
    if (overridden) return overridden;
    if (url.pathname === "/api/v2/monitoring/snapshot") return jsonResponse(monitoringV2StateFixture("FRESH", 72));
    if (url.pathname === "/api/v2/monitoring/load-history") return jsonResponse(v2HistoryResponse(url));
    if (url.pathname === "/api/v1/events" && url.searchParams.get("pageSize") === "1") return jsonResponse({ ...eventPageFixture, items: [] });
    return base.implementation(input, init);
  });
}

function dailySource({
  override,
  search = "",
  route = "/recordings",
}: {
  override?: (url: URL, init?: RequestInit) => Promise<Response> | undefined;
  search?: string;
  route?: string;
} = {}) {
  const requests: RecordedRequest[] = [];
  const base = createV2ContractFetch();
  const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", route: () => route,
    locationSearch: () => search,
    fetchImplementation: (input, init) => {
      const url = inputUrl(input);
      requests.push({ url, init });
      const response = override?.(url, init);
      if (response) return response;
      if (url.pathname === "/api/v2/recordings/daily") return jsonResponse({ items: [dailyRecordingFixture], next_cursor: null });
      if (url.pathname === `/api/v2/recordings/daily/${dailyRecordingId}`) return jsonResponse(dailyRecordingFixture);
      return base(input, init);
    },
  });
  return { source, requests };
}

describe("화면별 조회 범위와 요청 대기 제한", () => {
  test.each(["all", "single", "refresh"])("알림 %s의 401은 session 취소 후에도 ApiError로 보존한다", async action => {
    let failed = false;
    const onSessionExpired = vi.fn();
    const fetchImplementation = createV2ContractFetch((url, init) => failed && (
      action === "all" && url.pathname === "/api/v1/notifications/read-all"
      || action === "single" && init?.method === "PATCH"
      || action === "refresh" && url.pathname === "/api/v1/notifications"
    ) ? jsonResponse({}, 401) : undefined);
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, onSessionExpired });
    await source.getDashboardData();
    failed = true;
    const operation = action === "single" ? source.markNotificationRead!(notificationPageFixture.items[0].id) : source.markAllNotificationsRead!();
    await expect(operation).rejects.toMatchObject({ name: "ApiError", status: 401 });
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });

  test.each(["/history", "/recordings", "/admin"])("%s는 현황 전용 조회와 timer를 시작하지 않는다", async route => {
    vi.useFakeTimers();
    const stream = new FakeEventSource();
    const base = createV2ContractFetch();
    const fetchImplementation = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = inputUrl(input);
      if (url.pathname === "/api/v2/recordings/daily") return jsonResponse({ items: [], next_cursor: null });
      return base(input, init);
    });
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", route: () => route,
      fetchImplementation, eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const unsubscribe = source.subscribe!(() => undefined);
    const count = () => fetchImplementation.mock.calls.map(([input]) => inputUrl(input));
    const initial = count().length;
    expect(count().filter(url => url.pathname === "/api/v2/monitoring/load-history")).toHaveLength(route === "/history" ? 1 : 0);
    expect(count().some(url => url.pathname === "/api/v1/events" && url.searchParams.get("pageSize") === "1")).toBe(false);
    for (let i = 0; i < 5; i += 1) stream.emit("monitoring.snapshot", monitoringV2StateFixture("FRESH", 72));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(count()).toHaveLength(initial);
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([false, true])("최근 완료 조회는 초기 요청과 실패(%s)를 포함해 1분 간격을 유지한다", async failed => {
    vi.useFakeTimers();
    const stream = new FakeEventSource();
    const fetchImplementation = createV2ContractFetch(url => url.pathname === "/api/v1/events"
      ? failed ? jsonResponse({}, 503) : jsonResponse({ ...eventPageFixture, items: [] }) : undefined);
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", route: () => "/",
      fetchImplementation, eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const unsubscribe = source.subscribe!(() => undefined);
    const count = () => fetchImplementation.mock.calls.filter(([input]) => inputUrl(input).pathname === "/api/v1/events").length;
    for (let i = 0; i < 20; i += 1) stream.emit("monitoring.snapshot", monitoringV2StateFixture("FRESH", 72));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(count()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(count()).toBe(2);
    for (let i = 0; i < 20; i += 1) stream.emit("monitoring.snapshot", monitoringV2StateFixture("FRESH", 72));
    await vi.advanceTimersByTimeAsync(0);
    expect(count()).toBe(2);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(count()).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(["headers", "body"])("보조 요청의 %s 대기는 10초 후 종료하고 snapshot을 보존한다", async stage => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetchImplementation = createV2ContractFetch((url, init) => {
      if (url.pathname !== "/api/v1/notifications") return undefined;
      signal = init?.signal;
      if (stage === "headers") return new Promise<Response>(() => undefined);
      const response = new Response("{}");
      vi.spyOn(response, "text").mockReturnValue(new Promise(() => undefined));
      return Promise.resolve(response);
    });
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation });
    const pending = source.getDashboardData();
    await vi.advanceTimersByTimeAsync(10_000);
    const data = await pending;
    expect(signal?.aborted).toBe(true);
    expect(data.monitoring.summary.loadPercent).toBe(72);
    expect(data.monitoring.notificationState).toMatchObject({ status: "error", httpStatus: 504, code: "REQUEST_TIMEOUT" });
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([401, 403])("지연된 오류 body도 HTTP %i 권한 오류를 보존한다", async status => {
    vi.useFakeTimers();
    const onSessionExpired = vi.fn();
    const fetchImplementation = createV2ContractFetch(url => {
      if (url.pathname !== "/api/v1/notifications") return undefined;
      const response = new Response("{}", { status });
      vi.spyOn(response, "json").mockReturnValue(new Promise(() => undefined));
      return Promise.resolve(response);
    });
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, onSessionExpired });
    const rejected = expect(source.getDashboardData()).rejects.toMatchObject({ status });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(onSessionExpired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("초기 session의 무응답을 종료하고 호출자 취소와 구분한다", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn(() => new Promise<Response>(() => undefined));
    const source = createHttpDashboardDataSource({ fetchImplementation });
    const rejected = expect(source.getDashboardData()).rejects.toMatchObject({ status: 504, code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    const controller = new AbortController();
    const aborted = expect(source.getDashboardData({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await aborted;
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([false, true])("pending 알림 조회의 동일 ID를 중복 조회하지 않고 새 ID(%s)는 보존한다", async changed => {
    const stream = new FakeEventSource();
    let complete: ((response: Response) => void) | undefined;
    let notificationRequests = 0;
    const fetchImplementation = createV2ContractFetch(url => {
      if (url.pathname !== "/api/v1/notifications") return undefined;
      notificationRequests += 1;
      if (notificationRequests === 2) return new Promise(resolve => { complete = resolve; });
      return undefined;
    });
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation,
      eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const unsubscribe = source.subscribe!(() => undefined);
    const snapshot = (id: string) => ({ ...monitoringV2StateFixture("FRESH", 72), operations: {
      effectiveState: "NORMAL", lastKnownState: "NORMAL", lastEvaluatedAt: null, lastAlertAt: null, notificationId: id,
    } });
    stream.emit("monitoring.snapshot", snapshot("notification-one"));
    stream.emit("monitoring.snapshot", snapshot(changed ? "notification-two" : "notification-one"));
    complete!(await jsonResponse(notificationPageFixture));
    await vi.waitFor(() => expect(notificationRequests).toBe(changed ? 3 : 2));
    await Promise.resolve();
    expect(notificationRequests).toBe(changed ? 3 : 2);
    unsubscribe();
  });
});

describe("날짜 녹화와 이벤트 녹화의 독립적인 Backend adapter", () => {
  test("v2 녹화 기본 진입은 날짜 목록만 조회하고 이벤트로 분류하지 않는다", async () => {
    const { source, requests } = dailySource();
    const data = await source.getDashboardData();
    expect(source.supportsDailyRecordings).toBe(true);
    expect(data.recordingsSource).toBe("daily");
    expect(data.recordingsState?.status).toBe("ready");
    expect(data.recordings[0]).toMatchObject({ id: dailyRecordingId, source: "daily", type: "날짜 녹화", status: "available",
      start: "2026-10-12 00:00:00", end: "2026-10-13 00:00:00", duration: "00:00:50", date: "2026-10-12",
      codec: "정보 없음", format: "정보 없음", frameRate: null, size: "정보 없음",
      contentUrl: `/media/daily-recordings/${dailyRecordingId}/hls/index.m3u8`,
      daily: { recordedSeconds: 50, hasGaps: true, exportState: "not_requested" } });
    expect(data.recordings[0].downloadUrl).toBeUndefined();
    expect(requests.some(({ url }) => url.pathname === "/api/v1/recordings")).toBe(false);
    const parameters = requests.find(({ url }) => url.pathname === "/api/v2/recordings/daily")!.url.searchParams;
    expect([...parameters.keys()].sort()).toEqual(["from_date", "limit", "to_date"]);
    expect(parameters.get("to_date")).toBe("2026-10-14");
    expect(parameters.get("limit")).toBe("100");
  });

  test.each(["?recordingSource=event", "?recordingId=recording-contract-1"])("명시적인 이벤트 진입 %s는 v1 목록 및 단건을 유지한다", async (search) => {
    const { source, requests } = dailySource({ search });
    const data = await source.getDashboardData();
    expect(data.recordingsSource).toBe("event");
    expect(data.recordings[0]).toMatchObject({ source: "event", type: "알림" });
    expect(requests.some(({ url }) => url.pathname.startsWith("/api/v2/recordings/daily"))).toBe(false);
    expect(requests.some(({ url }) => url.pathname.startsWith("/api/v1/recordings"))).toBe(true);
  });

  test("한국 날짜 inclusive 조회 종료를 exclusive 날짜로 변환하고 opaque cursor를 그대로 전달한다", async () => {
    const cursor = "opaque+/cursor==";
    const nextId = "650e8400-e29b-41d4-a716-446655440000";
    const { source, requests } = dailySource({ route: "/", override: url => url.pathname === "/api/v2/recordings/daily"
      ? url.searchParams.get("cursor") === null
        ? jsonResponse({ items: [dailyRecordingFixture], next_cursor: cursor })
        : jsonResponse({ items: [{ ...dailyRecordingFixture, recording_id: nextId,
          playback_path: `/media/daily-recordings/${nextId}/hls/index.m3u8` }], next_cursor: null }) : undefined });
    await source.getDashboardData();
    const signal = new AbortController().signal;
    const items = await source.queryRecordings?.({ from: "2026-10-11T15:00:00Z", to: "2026-10-12T14:59:00Z", recordingSource: "daily" }, signal);
    expect(items?.map(item => item.id)).toEqual([dailyRecordingId, nextId]);
    const pages = requests.filter(({ url }) => url.pathname === "/api/v2/recordings/daily");
    expect(pages).toHaveLength(2);
    expect(pages[0].url.searchParams.get("from_date")).toBe("2026-10-12");
    expect(pages[0].url.searchParams.get("to_date")).toBe("2026-10-13");
    expect(pages[1].url.searchParams.get("cursor")).toBe(cursor);
    expect(pages.every(({ init }) => init?.signal && !init.signal.aborted && init.credentials === "include")).toBe(true);
  });

  test("자정 직전 날짜 조회는 event용 분 올림으로 다음 날을 추가하지 않는다", async () => {
    const { source, requests } = dailySource({ override: url => url.pathname === "/api/v2/monitoring/snapshot"
      ? jsonResponse({ ...monitoringV2StateFixture("FRESH", 0), serverTime: "2026-10-12T23:59:50+09:00" }) : undefined });
    await source.getDashboardData();
    expect(requests.find(({ url }) => url.pathname === "/api/v2/recordings/daily")?.url.searchParams.get("to_date")).toBe("2026-10-13");
  });

  test.each([
    { from: "2026-10-13", to: "2026-10-12" },
    { from: "2026-02-30", to: "2026-10-12" },
    { from: "2026-10-12T99:99", to: "2026-10-12" },
    { from: "2026-10-12", to: "9999-12-31" },
  ])("유효하지 않은 날짜 구간 %j은 요청 전에 거부한다", async query => {
    const { source, requests } = dailySource({ route: "/" });
    await source.getDashboardData();
    const before = requests.length;
    await expect(source.queryRecordings?.({ ...query, recordingSource: "daily" })).rejects.toThrow();
    expect(requests).toHaveLength(before);
  });

  test.each(["cursor", "identity"])("반복된 %s는 무한 조회 또는 중복 목록이 되지 않는다", async (duplicate) => {
    const { source } = dailySource({ route: "/", override: url => url.pathname === "/api/v2/recordings/daily"
      ? jsonResponse({ items: duplicate === "identity" ? [dailyRecordingFixture] : [], next_cursor: "same-cursor" }) : undefined });
    await source.getDashboardData();
    await expect(source.queryRecordings?.({ from: "2026-10-12", to: "2026-10-12", recordingSource: "daily" })).rejects.toThrow("Unexpected");
  });

  test("후속 cursor 조회 취소는 마지막 응답을 적용하지 않는다", async () => {
    const controller = new AbortController();
    let page = 0;
    const { source } = dailySource({ route: "/", override: url => {
      if (url.pathname !== "/api/v2/recordings/daily") return undefined;
      page += 1;
      if (page === 2) controller.abort();
      return jsonResponse({ items: [], next_cursor: page === 1 ? "next" : null });
    } });
    await source.getDashboardData();
    await expect(source.queryRecordings?.({ from: "2026-10-12", to: "2026-10-12", recordingSource: "daily" }, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(page).toBe(2);
  });

  test.each([404, 503])("날짜 API %i는 이벤트 목록으로 대체하거나 서버 오류 원문을 표시하지 않는다", async status => {
    const { source, requests } = dailySource({ override: url => url.pathname === "/api/v2/recordings/daily"
      ? jsonResponse({ detail: "/private/media/path SECRET Traceback" }, status) : undefined });
    const data = await source.getDashboardData();
    expect(data.recordings).toEqual([]);
    expect(data.recordingsState).toMatchObject({ status: "error", httpStatus: status });
    expect(data.recordingsState?.message).not.toMatch(/SECRET|Traceback|private/);
    expect(requests.some(({ url }) => url.pathname === "/api/v1/recordings")).toBe(false);
  });

  test.each([401, 403])("날짜 목록 권한 오류 %i는 부분 오류로 숨기지 않는다", async status => {
    const { source } = dailySource({ override: url => url.pathname === "/api/v2/recordings/daily" ? jsonResponse({ detail: "Denied" }, status) : undefined });
    await expect(source.getDashboardData()).rejects.toMatchObject({ status });
  });

  test("runtime camera 불일치와 범위 밖 날짜를 거부한다", async () => {
    for (const changes of [{ camera_id: "other-camera" }, { recording_date: "2020-01-01" }]) {
      const { source } = dailySource({ override: url => url.pathname === "/api/v2/recordings/daily"
        ? jsonResponse({ items: [{ ...dailyRecordingFixture, ...changes }], next_cursor: null }) : undefined });
      const data = await source.getDashboardData();
      expect(data.recordingsState?.status).toBe("error");
      expect(data.recordings).toEqual([]);
    }
  });

  test("날짜 단건은 identity와 public 경로를 검사하고 기본 단건은 event에 유지한다", async () => {
    const { source, requests } = dailySource({ route: "/" });
    await source.getDashboardData();
    expect(await source.getRecording?.(dailyRecordingId, undefined, "daily")).toMatchObject({ source: "daily", id: dailyRecordingId });
    expect(await source.getRecording?.("recording-contract-1")).toMatchObject({ source: "event" });
    const count = requests.length;
    await expect(source.getRecording?.("../invalid", undefined, "daily")).rejects.toThrow("UUID");
    expect(requests).toHaveLength(count);
  });

  test("날짜 단건의 다른 identity와 camera 및 변조된 public 경로를 거부한다", async () => {
    for (const changes of [
      { recording_id: "650e8400-e29b-41d4-a716-446655440000", playback_path: "/media/daily-recordings/650e8400-e29b-41d4-a716-446655440000/hls/index.m3u8" },
      { camera_id: "other-camera" }, { playback_path: "https://private.example/index.m3u8" },
    ]) {
      const { source } = dailySource({ route: "/", override: url => url.pathname === `/api/v2/recordings/daily/${dailyRecordingId}`
        ? jsonResponse({ ...dailyRecordingFixture, ...changes }) : undefined });
      await source.getDashboardData();
      await expect(source.getRecording?.(dailyRecordingId, undefined, "daily")).rejects.toThrow("Unexpected");
    }
  });

  test("준비 요청은 최신 metadata 확인 후 session Cookie와 CSRF를 보내고 202 상태를 유지한다", async () => {
    const { source, requests } = dailySource({ override: (url, init) => url.pathname.endsWith("/exports")
      && init?.method === "POST" ? jsonResponse({ ...dailyRecordingFixture, export_state: "processing" }, 202) : undefined });
    await source.getDashboardData();
    const result = await source.prepareDailyRecordingExport?.(dailyRecordingId);
    expect(result).toMatchObject({ source: "daily", daily: { exportState: "processing" } });
    expect(result?.downloadUrl).toBeUndefined();
    const preparation = requests.find(({ init }) => init?.method === "POST")!;
    expect(preparation.url.pathname).toBe(`/api/v2/recordings/daily/${dailyRecordingId}/exports`);
    expect(preparation.init?.credentials).toBe("include");
    expect(new Headers(preparation.init?.headers).get("X-CSRF-Token")).toBe(sessionFixture.csrfToken);
    const at = requests.indexOf(preparation);
    expect(requests[at - 1].url.pathname).toBe(`/api/v2/recordings/daily/${dailyRecordingId}`);
  });

  test.each([
    { status: "recording" }, { status: "finalizing" }, { status: "failed" }, { status: "expired" }, { status: "deleted" },
    { export_allowed: false }, { expires_at: "2026-10-12T16:00:00Z" },
  ])("미완료 또는 허용되지 않은 날짜 %j는 export POST를 보내지 않는다", async changes => {
    const { source, requests } = dailySource({ override: url => url.pathname === `/api/v2/recordings/daily/${dailyRecordingId}`
      ? jsonResponse({ ...dailyRecordingFixture, ...changes }) : undefined });
    await source.getDashboardData();
    await expect(source.prepareDailyRecordingExport?.(dailyRecordingId)).rejects.toMatchObject({ status: 409, code: "DAILY_EXPORT_UNAVAILABLE" });
    expect(requests.some(({ init }) => init?.method === "POST")).toBe(false);
  });

  test("서버 시각 기준 오늘 녹화는 closed여도 전체 다운로드를 준비하지 않는다", async () => {
    const { source, requests } = dailySource({ override: url => url.pathname === "/api/v2/monitoring/snapshot"
      ? jsonResponse({ ...monitoringV2StateFixture("FRESH", 0), serverTime: "2026-10-12T12:00:00+09:00" })
      : url.pathname === "/api/v2/recordings/daily" ? jsonResponse({ items: [], next_cursor: null }) : undefined });
    await source.getDashboardData();
    await expect(source.prepareDailyRecordingExport?.(dailyRecordingId)).rejects.toMatchObject({ status: 409 });
    expect(requests.some(({ init }) => init?.method === "POST")).toBe(false);
  });

  test("준비 상태 조회에 download_path가 제공된 경우에만 다운로드를 활성화한다", async () => {
    let ready = false;
    const { source, requests } = dailySource({ override: url => url.pathname === `/api/v2/recordings/daily/${dailyRecordingId}`
      ? jsonResponse({ ...dailyRecordingFixture, export_state: ready ? "ready" : "processing",
        download_path: ready ? `/media/daily-recordings/${dailyRecordingId}/content?download=true` : null,
        size_bytes: ready ? 1024 : null, export_expires_at: "2026-10-14T00:00:00Z" }) : undefined });
    await source.getDashboardData();
    const processing = await source.prepareDailyRecordingExport?.(dailyRecordingId);
    expect(processing?.downloadUrl).toBeUndefined();
    expect(processing?.daily?.exportState).toBe("processing");
    ready = true;
    const complete = await source.getRecording?.(dailyRecordingId, undefined, "daily");
    expect(complete?.downloadUrl).toBe(`/media/daily-recordings/${dailyRecordingId}/content?download=true`);
    expect(complete?.size).toBe("1.0 KB");
    expect(requests.some(({ init }) => init?.method === "POST")).toBe(false);
  });

  test("v1과 proposal은 날짜 녹화 지원 또는 export 준비 기능을 제공하지 않는다", () => {
    for (const options of [{ apiContract: "backend", monitoringVersion: "v1" }, { apiContract: "proposal", monitoringVersion: "v2" }] as const) {
      const source = createHttpDashboardDataSource(options);
      expect(source.supportsDailyRecordings).toBe(false);
      expect(source).not.toHaveProperty("prepareDailyRecordingExport");
    }
  });
});

test("Backend 녹화 metadata 생략은 정보 없음과 접근 불가로 표시한다", async () => {
  const recording = { ...recordingPageFixture.items[0], videoCodec: undefined, containerFormat: undefined,
    status: undefined, frameRate: undefined, heightPixels: undefined, widthPixels: undefined };
  const source = createHttpDashboardDataSource({ apiContract: "backend", fetchImplementation: () => jsonResponse(recording) });
  const result = await source.getRecording?.(recording.id);
  expect(result).toMatchObject({ codec: "정보 없음", format: "정보 없음", status: "unavailable", frameRate: null, height: null, width: null });
  expect(result?.contentUrl).toBeUndefined();
  expect(result?.downloadUrl).toBeUndefined();
});

test.each([undefined, null, ""])("녹화 형식과 codec 누락값 %s를 생성하지 않는다", async (missing) => {
  const recording = { ...recordingPageFixture.items[0], videoCodec: missing, containerFormat: missing };
  const source = createHttpDashboardDataSource({ apiContract: "backend", fetchImplementation: () => jsonResponse(recording) });
  expect(await source.getRecording?.(recording.id)).toMatchObject({ codec: "정보 없음", format: "정보 없음" });
});

test("녹화 실패여도 Backend가 제공한 metadata는 보존한다", async () => {
  const recording = { ...recordingPageFixture.items[0], status: "unavailable", mediaStatus: "failed", videoCodec: "h264", containerFormat: "mp4",
    durationSeconds: 0, sizeBytes: 0, retainedUntil: null };
  const source = createHttpDashboardDataSource({ apiContract: "backend", fetchImplementation: () => jsonResponse(recording) });
  expect(await source.getRecording?.(recording.id)).toMatchObject({ codec: "H264", format: "MP4", duration: "00:00:00", size: "0 B", retentionEndsAt: "정보 없음" });
});

test("녹화 목록과 단건의 UTC 시각은 조회 기준 offset으로 변환하고 null과 접근 상태를 보존한다", async () => {
  const recording = { ...recordingPageFixture.items[0], startedAt: "2026-10-14T23:59:30Z", endedAt: "2026-10-15T00:00:30Z",
    retainedFrom: "2026-10-15T00:01:00Z", retainedUntil: null, durationSeconds: null,
    mediaStatus: "failed", status: "unavailable", errorCode: "NO_FRAMES_AVAILABLE",
    gaps: [{ start_at: "2026-10-14T23:59:30Z", end_at: "2026-10-15T00:00:30Z" }] };
  const fetchImplementation = createV2ContractFetch(url => {
    if (url.pathname === "/api/v2/monitoring/snapshot") return jsonResponse({ ...monitoringV2StateFixture("FRESH", 0), serverTime: "2026-10-15T09:30:00+09:00" });
    if (url.pathname === "/api/v1/recordings") return jsonResponse({ ...recordingPageFixture, items: [recording] });
    if (url.pathname.startsWith("/api/v1/recordings/")) return jsonResponse(recording);
  });
  const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", route: () => "/recordings", locationSearch: () => "?recordingSource=event", fetchImplementation });
  const data = await source.getDashboardData();
  expect(data.recordings[0]).toMatchObject({ date: "2026-10-15", start: "2026-10-15 08:59:30", end: "2026-10-15 09:00:30", time: "08:59 - 09:00",
    retentionStartsAt: "2026-10-15 09:01:00", retentionEndsAt: "정보 없음", duration: "정보 없음", status: "unavailable", errorCode: "NO_FRAMES_AVAILABLE",
    gaps: [{ start: "2026-10-15 08:59:30", end: "2026-10-15 09:00:30" }] });
  expect(data.recordings[0].contentUrl).toBeUndefined();
  expect(data.recordings[0].downloadUrl).toBeUndefined();
  expect(await source.getRecording?.(recording.id)).toEqual(data.recordings[0]);
});

test("Backend optional 알림 설정은 계약의 default를 적용한다", async () => {
  const fetchFixture = createContractFetch();
  const settings = { version: alertSettingsFixture.version, collectionThresholdPercent: alertSettingsFixture.collectionThresholdPercent,
    preCollectionAlert: { thresholdPercent: alertSettingsFixture.preCollectionAlert.thresholdPercent } };
  const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v1", route: () => "/admin", fetchImplementation: (input, init) =>
    inputUrl(input).pathname === "/api/v1/settings/alerts" ? jsonResponse(settings) : fetchFixture.implementation(input, init),
  });
  const data = await source.getDashboardData();
  expect(data.admin.alertSettings).toMatchObject({ enabledEventTypes: ["collection_required", "measurement_error", "device_error"],
    maximumRepeatCount: 3, preCollectionAlert: { enabled: true }, recoveryNotificationEnabled: true, repeatIntervalMinutes: 30, sendDelayMinutes: 0 });
});

test("읽음 시각이 생략된 Backend 알림은 읽지 않은 상태를 유지한다", async () => {
  const fetchFixture = createContractFetch();
  const notifications = { ...notificationPageFixture, items: [{ ...notificationPageFixture.items[0], readAt: undefined }] };
  const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v1", fetchImplementation: (input, init) =>
    inputUrl(input).pathname === "/api/v1/notifications" ? jsonResponse(notifications) : fetchFixture.implementation(input, init),
  });
  const data = await source.getDashboardData();
  expect(data.monitoring.headerNotifications[0].read).toBe(false);
});

describe("테스트 알림 이후 종 목록 동기화", () => {
  test("v2 snapshot 변경 없이 접수된 테스트 알림을 조회하고 publish한다", async () => {
    let accepted = false;
    const added = { ...notificationPageFixture.items[0], id: "notification-test", title: "테스트 알림" };
    const fetchImplementation = createV2ContractFetch((url, init) => {
      if (url.pathname === "/api/v1/notifications/test") { accepted = true; return Promise.resolve(new Response(null, { status: 202 })); }
      if (url.pathname === "/api/v1/notifications" && accepted) return jsonResponse({ ...notificationPageFixture, items: [added, ...notificationPageFixture.items], unreadCount: 2 });
      expect(init?.signal?.aborted).not.toBe(true);
    });
    const stream = new FakeEventSource();
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn<(data: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);
    await source.sendTestNotification!("recipient-contract-1", ["email"]);
    expect(listener.mock.lastCall?.[0].monitoring).toMatchObject({ unreadNotificationCount: 2, notificationState: { status: "ready" } });
    expect(listener.mock.lastCall?.[0].monitoring.headerNotifications[0].id).toBe(added.id);
    const post = fetchImplementation.mock.calls.find(([input]) => inputUrl(input).pathname === "/api/v1/notifications/test");
    expect(post?.[1]).toMatchObject({ credentials: "include", method: "POST" });
    expect(new Headers(post?.[1]?.headers).get("X-CSRF-Token")).toBe(sessionFixture.csrfToken);
    unsubscribe?.();
  });

  test("POST 실패는 접수 실패이며 후속 조회를 하지 않는다", async () => {
    const fetchImplementation = createV2ContractFetch(url => url.pathname === "/api/v1/notifications/test" ? jsonResponse({}, 503) : undefined);
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation });
    await source.getDashboardData();
    await expect(source.sendTestNotification!("recipient-contract-1", ["email"])).rejects.toMatchObject({ status: 503 });
    expect(fetchImplementation.mock.calls.filter(([input]) => inputUrl(input).pathname === "/api/v1/notifications")).toHaveLength(1);
  });

  test.each([503, 403, 401])("접수 후 조회 오류 %i는 접수 성공을 실패로 바꾸지 않는다", async status => {
    let accepted = false;
    const onSessionExpired = vi.fn();
    const fetchImplementation = createV2ContractFetch(url => {
      if (url.pathname === "/api/v1/notifications/test") { accepted = true; return Promise.resolve(new Response(null, { status: 202 })); }
      if (url.pathname === "/api/v1/notifications" && accepted) return jsonResponse({}, status);
    });
    const stream = new FakeEventSource();
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, onSessionExpired, eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn<(data: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);
    await expect(source.sendTestNotification!("recipient-contract-1", ["email"])).resolves.toBeUndefined();
    expect(listener.mock.lastCall?.[0].monitoring.unreadNotificationCount).toBe(1);
    if (status === 503) expect(listener.mock.lastCall?.[0].monitoring.notificationState).toMatchObject({ status: "error", stale: true });
    if (status === 403) expect(listener.mock.lastCall?.[0].authError).toMatchObject({ status: 403 });
    expect(onSessionExpired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    unsubscribe?.();
  });

  test.each(["read", "created"] as const)("후속 조회 중 %s 변경은 오래된 목록으로 덮어쓰지 않는다", async change => {
    let queries = 0;
    let complete: (response: Response) => void = () => undefined;
    const added = { ...notificationPageFixture.items[0], id: "notification-later", title: "새 알림" };
    const updated = change === "read"
      ? { ...notificationPageFixture, items: [{ ...notificationPageFixture.items[0], readAt: "2026-09-10T10:21:00+09:00" }], unreadCount: 0 }
      : { ...notificationPageFixture, items: [added, ...notificationPageFixture.items], unreadCount: 2 };
    const base = createContractFetch();
    const fetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => {
      if (inputUrl(input).pathname === "/api/v1/notifications") {
        queries += 1;
        if (queries === 2) return new Promise<Response>(resolve => { complete = resolve; });
        if (queries > 2) return jsonResponse(updated);
      }
      return base.implementation(input, init);
    };
    const stream = new FakeEventSource();
    const source = createHttpDashboardDataSource({ fetchImplementation, eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn<(data: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);
    const pending = source.sendTestNotification!("recipient-contract-1", ["email"]);
    await vi.waitFor(() => expect(queries).toBe(2));
    if (change === "read") await source.markAllNotificationsRead!();
    else stream.emit("notification.created", added);
    listener.mockClear();
    complete(new Response(JSON.stringify(notificationPageFixture)));
    await pending;
    expect(listener.mock.calls.every(([data]) => data.monitoring.unreadNotificationCount === updated.unreadCount)).toBe(true);
    expect(listener.mock.lastCall?.[0].monitoring.unreadNotificationCount).toBe(updated.unreadCount);
    expect(queries).toBe(change === "read" ? 4 : 3);
    unsubscribe?.();
  });

  test.each(["unsubscribe", "reload"] as const)("접수 후 %s 취소는 늦은 조회를 publish하지 않는다", async cancellation => {
    let queries = 0;
    let complete: (response: Response) => void = () => undefined;
    const fetchImplementation = createV2ContractFetch(url => {
      if (url.pathname === "/api/v1/notifications" && ++queries === 2) return new Promise<Response>(resolve => { complete = resolve; });
    });
    const stream = new FakeEventSource();
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn<(data: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);
    const pending = source.sendTestNotification!("recipient-contract-1", ["email"]);
    await vi.waitFor(() => expect(queries).toBe(2));
    if (cancellation === "unsubscribe") unsubscribe?.();
    else await source.getDashboardData();
    listener.mockClear();
    complete(new Response(JSON.stringify({ ...notificationPageFixture, unreadCount: 99 })));
    await expect(pending).resolves.toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe?.();
  });
});

describe("보조 조회의 오류 경계", () => {
  test.each([500, 404, "invalid"])("알림 %s는 현재 판단과 영상을 차단하거나 미읽음 수를 0으로 만들지 않는다", async (failure) => {
    const fetchImplementation = createV2ContractFetch((url) => url.pathname === "/api/v1/notifications"
      ? failure === "invalid" ? jsonResponse({ ...notificationPageFixture, items: [{ ...notificationPageFixture.items[0], title: null }] })
        : jsonResponse({ detail: "Notification query failed" }, failure as number) : undefined);
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation });
    const data = await source.getDashboardData();
    expect(data.monitoring.summary.loadPercent).toBe(72);
    expect(data.monitoring.videoUrl).toBe("/media/cameras/camera-main/live");
    expect(data.monitoring.videoCapturedAt).toBeNull();
    expect(data.monitoring.unreadNotificationCount).toBeNull();
    expect(data.monitoring.notificationState).toMatchObject({ status: "error", stale: false });
    expect(data.monitoring.loadHistoryState?.status).toBe("ready");
  });

  test.each([401, 403])("알림의 권한 오류 %i는 보조 조회 실패로 숨기지 않는다", async (status) => {
    const onSessionExpired = vi.fn();
    const fetchImplementation = createV2ContractFetch((url) => url.pathname === "/api/v1/notifications" ? jsonResponse({ detail: "Access denied" }, status) : undefined);
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, onSessionExpired });
    await expect(source.getDashboardData()).rejects.toMatchObject({ status });
    expect(onSessionExpired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  });

  test.each([401, 403])("오류 body가 null이어도 권한 오류 %i를 보존한다", async (status) => {
    const fetchImplementation = createV2ContractFetch((url) => url.pathname === "/api/v1/notifications" ? jsonResponse(null, status) : undefined);
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, onSessionExpired: () => undefined });
    await expect(source.getDashboardData()).rejects.toMatchObject({ status });
  });

  test("새 경보의 알림 조회 실패는 이전 목록과 수를 유지하고 다음 snapshot에서 자동 복구한다", async () => {
    let failed = false;
    const fetchImplementation = createV2ContractFetch((url) => url.pathname === "/api/v1/notifications" && failed ? jsonResponse({}, 500) : undefined);
    const stream = new FakeEventSource();
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn<(data: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);
    const snapshot = { ...monitoringV2StateFixture("FRESH", 72), operations: {
      effectiveState: "NORMAL", lastKnownState: "NORMAL", lastEvaluatedAt: null, lastAlertAt: null, notificationId: "notification-after-update",
    } };
    failed = true;
    stream.emit("monitoring.snapshot", snapshot);
    await vi.waitFor(() => expect(listener.mock.lastCall?.[0].monitoring.notificationState?.status).toBe("error"));
    expect(listener.mock.lastCall?.[0].monitoring).toMatchObject({ unreadNotificationCount: 1, notificationState: { status: "error", stale: true } });
    expect(listener.mock.lastCall?.[0].monitoring.headerNotifications[0].id).toBe(notificationPageFixture.items[0].id);
    failed = false;
    stream.emit("monitoring.snapshot", snapshot);
    await vi.waitFor(() => expect(listener.mock.lastCall?.[0].monitoring.notificationState?.status).toBe("ready"));
    expect(fetchImplementation.mock.calls.filter(([input]) => inputUrl(input).pathname === "/api/v2/monitoring/snapshot")).toHaveLength(1);
    unsubscribe?.();
  });

  test("최초 알림 실패 뒤 동일 snapshot 재수신으로 알림 오류가 복구된다", async () => {
    let failed = true;
    const fetchImplementation = createV2ContractFetch((url) => url.pathname === "/api/v1/notifications" && failed ? jsonResponse({}, 500) : undefined);
    const stream = new FakeEventSource();
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn<(data: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);
    failed = false;
    stream.emit("monitoring.snapshot", monitoringV2StateFixture("FRESH", 72));
    await vi.waitFor(() => expect(listener.mock.lastCall?.[0].monitoring.notificationState?.status).toBe("ready"));
    expect(listener.mock.lastCall?.[0].monitoring.unreadNotificationCount).toBe(1);
    unsubscribe?.();
  });

  test("구독 중 알림 권한 부족은 stream을 닫고 명시적 인증 오류를 전달한다", async () => {
    let failed = false;
    const fetchImplementation = createV2ContractFetch((url) => url.pathname === "/api/v1/notifications" && failed ? jsonResponse({}, 403) : undefined);
    const stream = new FakeEventSource();
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn<(data: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);
    failed = true;
    stream.emit("monitoring.snapshot", { ...monitoringV2StateFixture("FRESH", 72), operations: {
      effectiveState: "CRITICAL", lastKnownState: "CRITICAL", lastEvaluatedAt: null, lastAlertAt: null, notificationId: "notif-new",
    } });
    await vi.waitFor(() => expect(listener.mock.lastCall?.[0].authError?.status).toBe(403));
    expect(stream.closed).toBe(true);
    unsubscribe?.();
  });

  test("녹화 목록 오류는 snapshot과 별도 상태로 남기며 최근 완료는 조회하지 않는다", async () => {
    const fetchImplementation = createV2ContractFetch((url) => ["/api/v1/events", "/api/v2/recordings/daily"].includes(url.pathname) ? jsonResponse({}, 500) : undefined);
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, route: () => "/recordings" });
    const data = await source.getDashboardData();
    expect(data.monitoring.summary.loadPercent).toBe(72);
    expect(fetchImplementation.mock.calls.some(([input]) => inputUrl(input).pathname === "/api/v1/events")).toBe(false);
    expect(data.recordingsState).toMatchObject({ status: "error", httpStatus: 500 });
  });

  test.each([401, 403])("최근 완료 조회 권한 오류 %i는 초기화를 거부한다", async (status) => {
    const fetchImplementation = createV2ContractFetch((url) => url.pathname === "/api/v1/events" ? jsonResponse({}, status) : undefined);
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, onSessionExpired: () => undefined });
    await expect(source.getDashboardData()).rejects.toMatchObject({ status });
  });
});

describe("v2 추이와 기존 이력의 독립 조회", () => {
  test.each(["site_id", "edge_id"] as const)("%s 재할당 뒤 추이 조회 실패는 다른 source의 이전 곡선을 재사용하지 않는다", async changedField => {
    let failed = false;
    let recovered = false;
    const initialSnapshot = monitoringV2StateFixture("FRESH", 72);
    const nextSource = { ...initialSnapshot.source, [changedField]: "reassigned-source" };
    const fetchImplementation = createV2ContractFetch(url => {
      if (!failed) return undefined;
      if (url.pathname === "/api/v2/monitoring/snapshot") return jsonResponse({ ...initialSnapshot, source: nextSource,
        assessment: initialSnapshot.assessment && { ...initialSnapshot.assessment, site_id: nextSource.site_id, edge_id: nextSource.edge_id },
        deviceStatus: { ...initialSnapshot.deviceStatus, site_id: nextSource.site_id, edge_id: nextSource.edge_id } });
      if (url.pathname === "/api/v2/monitoring/load-history") return recovered
        ? jsonResponse({ ...v2HistoryResponse(url), source: nextSource }) : jsonResponse({}, 503);
      return undefined;
    });
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation });
    const initial = await source.getDashboardData();
    expect(initial.monitoring.loadHistory.length).toBeGreaterThan(0);
    failed = true;
    const result = await source.getDashboardData();
    expect(result.monitoring.v2).toMatchObject({ siteId: nextSource.site_id, edgeId: nextSource.edge_id });
    expect(result.monitoring.loadHistory).toEqual([]);
    expect(result.monitoring.loadHistoryState).toMatchObject({ status: "error", stale: false, httpStatus: 503 });
    expect(result.monitoring.unreadNotificationCount).toBe(initial.monitoring.unreadNotificationCount);
    recovered = true;
    const recovery = await source.getDashboardData();
    expect(recovery.monitoring.loadHistory.length).toBeGreaterThan(0);
    expect(recovery.monitoring.loadHistoryState?.status).toBe("ready");
  });

  test("같은 source의 일시적인 추이 실패는 마지막 유효 곡선을 유지한다", async () => {
    let failed = false;
    const fetchImplementation = createV2ContractFetch(url => failed && url.pathname === "/api/v2/monitoring/load-history" ? jsonResponse({}, 503) : undefined);
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation });
    const initial = await source.getDashboardData();
    failed = true;
    const result = await source.getDashboardData();
    expect(result.monitoring.loadHistory).toEqual(initial.monitoring.loadHistory);
    expect(result.monitoring.loadHistoryState).toMatchObject({ status: "error", stale: true, httpStatus: 503 });
    const repeatedFailure = await source.getDashboardData();
    expect(repeatedFailure.monitoring.loadHistory).toEqual(initial.monitoring.loadHistory);
    expect(repeatedFailure.monitoring.loadHistoryState).toMatchObject({ status: "error", stale: true });
  });

  test("현재 상태가 NO_DATA여도 유효한 과거 0%와 generatedAt 좌표를 유지한다", async () => {
    const fetchImplementation = createV2ContractFetch((url) => url.pathname === "/api/v2/monitoring/snapshot" ? jsonResponse(monitoringV2StateFixture("NO_DATA")) : undefined);
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation });
    const data = await source.getDashboardData();
    expect(data.monitoring.summary.loadPercent).toBeNull();
    expect(data.monitoring.loadHistory[0].value).toBe(0);
    expect(Date.parse(data.monitoring.loadHistory[0].measuredAt)).toBe(Date.parse(data.monitoring.loadHistory[0].generatedAt!));
    const url = fetchImplementation.mock.calls.map(([input]) => inputUrl(input)).find((value) => value.pathname === "/api/v2/monitoring/load-history")!;
    expect(Date.parse(url.searchParams.get("to")!)).toBeLessThanOrEqual(Date.parse(monitoringV2StateFixture("NO_DATA").serverTime));
    expect(Date.parse(url.searchParams.get("to")!) - Date.parse(url.searchParams.get("from")!)).toBe(24 * 3_600_000);
  });

  test.each(["load", "events"])("%s 실패는 다른 이력 영역의 응답을 보존한다", async (area) => {
    const fetchImplementation = createV2ContractFetch((url) => url.pathname === (area === "load" ? "/api/v2/monitoring/load-history" : "/api/v1/events")
      ? jsonResponse({}, 500) : undefined);
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, route: () => "/history" });
    const data = await source.getDashboardData();
    expect(data.history[area === "load" ? "loadState" : "eventsState"]?.status).toBe("error");
    expect(area === "load" ? data.history.events.length : data.history.loadSamples.length).toBeGreaterThan(0);
    expect(data.monitoring.summary.loadPercent).toBe(72);
  });

  test("30일 선택은 기존 운영 이력을 조회하고 v2 추이만 미지원으로 구분한다", async () => {
    const fetchImplementation = createV2ContractFetch();
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation });
    await source.getDashboardData();
    const before = fetchImplementation.mock.calls.filter(([input]) => inputUrl(input).pathname === "/api/v2/monitoring/load-history").length;
    const history = await source.queryHistory?.({ from: "2026-09-13T00:00:00Z", to: "2026-10-13T00:00:00Z" });
    expect(history?.loadState?.status).toBe("unsupported");
    expect(history?.events.length).toBeGreaterThan(0);
    expect(fetchImplementation.mock.calls.filter(([input]) => inputUrl(input).pathname === "/api/v2/monitoring/load-history")).toHaveLength(before);
  });

  test("SSE마다 추이를 다시 조회하지 않고 1분 timer와 구독 회수를 사용한다", async () => {
    vi.useFakeTimers();
    const fetchImplementation = createV2ContractFetch();
    const stream = new FakeEventSource();
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation, eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn<(data: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);
    stream.emit("monitoring.snapshot", monitoringV2StateFixture("FRESH", 72));
    stream.emit("monitoring.snapshot", monitoringV2StateFixture("FRESH", 72));
    expect(fetchImplementation.mock.calls.filter(([input]) => inputUrl(input).pathname === "/api/v2/monitoring/load-history")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImplementation.mock.calls.filter(([input]) => inputUrl(input).pathname === "/api/v2/monitoring/load-history")).toHaveLength(2);
    unsubscribe?.();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchImplementation.mock.calls.filter(([input]) => inputUrl(input).pathname === "/api/v2/monitoring/load-history")).toHaveLength(2);
  });
});

test("현황에서 사용하지 않는 pit 이름 조회를 data source에 노출하지 않는다", () => {
  const source = createHttpDashboardDataSource({ apiContract: "backend" });
  expect(source).not.toHaveProperty("getPitName");
});

test("삭제된 판단 목록 조회를 data source에 노출하거나 자동 요청하지 않는다", () => {
  const fetchImplementation = vi.fn();
  const source = createHttpDashboardDataSource({ apiContract: "backend", fetchImplementation });
  expect(Object.hasOwn(source, "getAlertEvidencePage")).toBe(false);
  expect(fetchImplementation).not.toHaveBeenCalled();
});

test("녹화 확보 구간은 Backend의 인증 경로로만 조회하고 legacy 식별자를 요청하지 않는다", async () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const fetchImplementation = vi.fn(() => jsonResponse({ clip_id: id, camera_id: "camera-main",
    requested_start_at: "2026-10-13T00:00:00Z", requested_end_at: "2026-10-13T00:01:00Z",
    actual_start_at: "2026-10-13T00:00:10Z", actual_end_at: "2026-10-13T00:00:50Z", coverage: "partial", gaps: [], error: null }));
  const source = createHttpDashboardDataSource({ apiContract: "backend", fetchImplementation });
  expect(await source.getRecordingCoverage?.(id)).toMatchObject({ coverage: "partial", actualStart: "2026-10-13T00:00:10Z" });
  const [path, init] = fetchImplementation.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe(`/api/v1/media/clips/${id}`);
  expect(init.credentials).toBe("include");
  await expect(source.getRecordingCoverage?.("rec-legacy")).rejects.toThrow("media clip identifier");
  expect(fetchImplementation).toHaveBeenCalledOnce();
});

test.each([409, 412])("설정과 수신 대상 변경 충돌 %i는 성공 응답으로 변환하지 않는다", async (status) => {
  const base = createContractFetch();
  const fetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT" || init?.method === "PATCH"
    ? jsonResponse({ code: "version_conflict", detail: "Version conflict" }, status) : base.implementation(input, init);
  const source = createHttpDashboardDataSource({ apiContract: "backend", fetchImplementation, route: () => "/admin" });
  const data = await source.getDashboardData();
  await expect(source.replaceAlertSettings?.(data.admin.alertSettings)).rejects.toMatchObject({ status, code: "version_conflict" });
  await expect(source.updateNotificationRecipient?.(data.admin.recipients[0], data.admin.recipientSettings[data.admin.recipients[0].email]))
    .rejects.toMatchObject({ status, code: "version_conflict" });
});

describe("HTTP 대시보드 데이터 소스", () => {
  test("계약 예제의 최근 24시간 적재율은 오름차순 1시간 간격을 유지한다", () => {
    const timestamps = monitoringFixture.recentLoad.map((sample) => new Date(sample.measuredAt).getTime());

    expect(timestamps).toHaveLength(24);
    expect(timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]))
      .toEqual(Array.from({ length: 23 }, () => 3_600_000));
  });

  test("계약 예제의 수거 필요 marker는 발생 시점의 수거 임계율과 일치한다", () => {
    const collectionRequiredMarkers = loadHistoryFixture.eventMarkers.filter((marker) => marker.type === "collection_required");

    for (const marker of collectionRequiredMarkers) {
      const effectiveThreshold = loadHistoryFixture.collectionThresholds
        .filter((threshold) => new Date(threshold.effectiveAt).getTime() <= new Date(marker.occurredAt).getTime())
        .at(-1);
      expect(marker.valuePercent).toBe(effectiveThreshold?.valuePercent);
    }
  });

  test("관리자 경로의 계약 응답 전체를 화면 도메인 모델로 변환한다", async () => {
    const { implementation, requests } = createContractFetch();
    const source = createHttpDashboardDataSource({ fetchImplementation: implementation, route: () => "/admin" });

    const data = await source.getDashboardData();

    expect(data.session?.user.displayName).toBe("계약 관리자");
    expect(data.monitoring.summary).toMatchObject({
      collectionThreshold: 80,
      operationState: "accumulating",
      remainingTime: "4시간 6분",
    });
    expect(data.monitoring.lidarProfiles[0]).toMatchObject({ average: "1.8 m", label: "LiDAR 1" });
    expect(data.monitoring.lidarProfiles[0].samples).toEqual([
      { height: 1.2, positionRatio: 0 },
      { height: 2.4, positionRatio: 1 },
    ]);
    expect(data.monitoring.headerNotifications[0]).toMatchObject({ id: "notification-contract-1", read: false });
    expect(data.monitoring.unreadNotificationCount).toBe(1);
    expect(data.admin.alertSettings.maximumRepeatCount).toBe(3);
    expect(data.admin.recipients[0]).toMatchObject({ id: "recipient-contract-1", name: "계약 담당자" });
    expect(requests.map(({ url }) => url.pathname)).toEqual(expect.arrayContaining([
      "/api/v1/session",
      "/api/v1/monitoring/snapshot",
      "/api/v1/notifications",
      "/api/v1/settings/alerts",
      "/api/v1/notification-recipients",
    ]));
  });

  test("실제 Backend의 기록용 resolved를 해제로 표시하지 않고 severity를 보존한다", async () => {
    const base = createContractFetch();
    const implementation = vi.fn((input: RequestInfo | URL, init?: RequestInit) => inputUrl(input).pathname === "/api/v1/events"
      ? jsonResponse({ ...eventPageFixture, items: [{ ...eventPageFixture.items[0], severity: "error", status: "resolved" }] })
      : base.implementation(input, init));
    const source = createHttpDashboardDataSource({ fetchImplementation: implementation, apiContract: "backend" });
    const history = await source.queryHistory?.({ eventCategory: "alert", from: "2026-09-03T00:00", to: "2026-09-10T00:00" });
    expect(history?.events[0]).toMatchObject({ status: null, tone: "error", type: "알림" });
  });

  test.each(["completed", "occurred"] as const)("Backend 수거 이벤트의 %s 상태는 실제 완료 기록에만 표시한다", async (status) => {
    const base = createContractFetch();
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v1", fetchImplementation: (input, init) => inputUrl(input).pathname === "/api/v1/events"
      ? jsonResponse({ ...eventPageFixture, items: [{ ...eventPageFixture.items[0], category: "collection", type: "collection_completed", status }] })
      : base.implementation(input, init),
    });
    const history = await source.queryHistory?.({ from: "2026-09-03T00:00", to: "2026-09-10T00:00" });
    expect(history?.events[0]).toMatchObject({ status: status === "completed" ? "완료" : null, type: "수거" });
  });

  test("이력의 시간, 유형, 임계율 변경과 분 단위 이벤트 위치를 보존한다", async () => {
    const { implementation, requests } = createContractFetch({ authenticated: false });
    const source = createHttpDashboardDataSource({ fetchImplementation: implementation, route: () => "/history" });

    await source.getDashboardData();

    const history = await source.queryHistory?.({ eventCategory: "alert", from: "2026-09-03T00:00", to: "2026-09-10T00:00" });

    expect(history?.chartEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ hour: 156.28333333333333, label: "수거 필요", value: 85 }),
      expect.objectContaining({ label: "수거 완료", value: 4 }),
      expect.objectContaining({ label: "오류", value: 61 }),
    ]));
    expect(history?.thresholds).toHaveLength(2);
    expect(history?.events[0]).toMatchObject({ recordingId: "recording-contract-1", status: "해제", type: "알림" });
    const initialHistoryRequest = requests.find(({ url }) => url.pathname === "/api/v1/history/load");
    expect(initialHistoryRequest?.url.searchParams.get("from")).toBe("2026-09-03T10:24:20+09:00");
    expect(initialHistoryRequest?.url.searchParams.get("to")).toBe("2026-09-10T10:24:20+09:00");
    const historyRequest = requests.filter(({ url }) => url.pathname === "/api/v1/history/load").at(-1);
    expect(historyRequest?.url.searchParams.get("eventCategory")).toBe("alert");
    expect(historyRequest?.url.searchParams.get("from")).toBe("2026-09-03T00:00:00+09:00");
    expect(historyRequest?.url.searchParams.get("to")).toBe("2026-09-10T00:00:00+09:00");
  });

  test("녹화 메타데이터와 재생 및 다운로드 경로를 변환한다", async () => {
    const { implementation, requests } = createContractFetch({ authenticated: false });
    const source = createHttpDashboardDataSource({ fetchImplementation: implementation, route: () => "/" });
    await source.getDashboardData();

    const recordings = await source.queryRecordings?.({ from: "2026-09-03T00:00", to: "2026-09-10T00:00" });

    expect(recordings?.[0]).toMatchObject({
      codec: "H264",
      contentUrl: "/api/v1/recordings/recording-contract-1/content",
      downloadUrl: "/api/v1/recordings/recording-contract-1/download",
      frameRate: 30,
      height: 480,
      size: "1.8 GB",
      thumbnailUrl: "/api/v1/recordings/recording-contract-1/thumbnail",
      width: 640,
    });
    const recordingRequest = requests.find(({ url }) => url.pathname === "/api/v1/recordings");
    expect(recordingRequest?.url.searchParams.get("from")).toBe("2026-09-03T00:00:00+09:00");
    expect(recordingRequest?.url.searchParams.get("to")).toBe("2026-09-10T00:00:00+09:00");
  });

  test("관련 녹화 직접 진입은 기본 기간 목록 대신 식별자로 조회한다", async () => {
    const { implementation, requests } = createContractFetch({ authenticated: false });
    const source = createHttpDashboardDataSource({
      fetchImplementation: implementation,
      locationSearch: () => "?recordingId=recording-contract-1",
      route: () => "/recordings",
    });

    const data = await source.getDashboardData();

    expect(data.recordings).toHaveLength(1);
    expect(data.recordings[0].id).toBe("recording-contract-1");
    expect(requests.some(({ url }) => url.pathname === "/api/v1/recordings/recording-contract-1")).toBe(true);
    expect(requests.some(({ url }) => url.pathname === "/api/v1/recordings" && url.searchParams.has("from"))).toBe(false);
  });

  test("로그인 요청과 session 종료 요청에 계약 body, Cookie 설정과 CSRF를 적용한다", async () => {
    const { implementation, requests } = createContractFetch({ authenticated: false });
    const source = createHttpDashboardDataSource({ fetchImplementation: implementation, route: () => "/" });

    await source.createSession?.({ password: "contract-password", persistent: true, username: "contract-admin" });
    await source.deleteSession?.();

    const loginRequest = requests.find(({ init, url }) => url.pathname === "/api/v1/session" && init?.method === "POST");
    expect(loginRequest?.init?.credentials).toBe("include");
    expect(new Headers(loginRequest?.init?.headers).has("X-CSRF-Token")).toBe(false);
    expect(JSON.parse(requestBodyText(loginRequest?.init?.body)) as unknown).toEqual({
      password: "contract-password",
      persistent: true,
      username: "contract-admin",
    });
    const logoutRequest = requests.find(({ init, url }) => url.pathname === "/api/v1/session" && init?.method === "DELETE");
    expect(logoutRequest?.init?.credentials).toBe("include");
    expect(new Headers(logoutRequest?.init?.headers).get("X-CSRF-Token")).toBe("csrf-contract-example");
  });

  test("다른 origin의 녹화 리소스 경로를 거부한다", async () => {
    const base = createContractFetch({ authenticated: false });
    const implementation = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (inputUrl(input).pathname === "/api/v1/recordings") {
        return jsonResponse({
          ...recordingPageFixture,
          items: [{ ...recordingPageFixture.items[0], contentPath: "https://media.example/recording.mp4" }],
        });
      }
      return base.implementation(input, init);
    });
    const source = createHttpDashboardDataSource({ fetchImplementation: implementation, route: () => "/" });

    await expect(source.queryRecordings?.({ from: "2026-09-03T00:00", to: "2026-09-10T00:00" }))
      .rejects.toThrow("dashboard origin");
  });

  test("상태 변경 요청에 CSRF와 ETag를 포함하고 계약 body를 전송한다", async () => {
    const { implementation, requests } = createContractFetch();
    const source = createHttpDashboardDataSource({ fetchImplementation: implementation, route: () => "/admin" });
    const data = await source.getDashboardData();

    await source.markNotificationRead?.("notification-contract-1");
    await source.markAllNotificationsRead?.();
    await source.replaceAlertSettings?.({ ...data.admin.alertSettings, maximumRepeatCount: 5 });
    const updatedRecipient = await source.updateNotificationRecipient?.(data.admin.recipients[0], {
      ...data.admin.recipientSettings["operator@example.com"],
      sms: false,
    });
    await source.sendTestNotification?.("recipient-contract-1", ["email", "sms"]);

    const settingsRequest = requests.find(({ url, init }) => url.pathname === "/api/v1/settings/alerts" && init?.method === "PUT");
    expect(new Headers(settingsRequest?.init?.headers).get("X-CSRF-Token")).toBe("csrf-contract-example");
    expect(new Headers(settingsRequest?.init?.headers).get("If-Match")).toBe('"settings-contract-v1"');
    expect(JSON.parse(requestBodyText(settingsRequest?.init?.body)) as unknown).toMatchObject({ maximumRepeatCount: 5, sendDelayMinutes: 0 });
    const recipientRequest = requests.find(({ url, init }) => url.pathname === "/api/v1/notification-recipients/recipient-contract-1" && init?.method === "PATCH");
    expect(new Headers(recipientRequest?.init?.headers).get("Content-Type")).toBe("application/merge-patch+json");
    expect(new Headers(recipientRequest?.init?.headers).get("If-Match")).toBe('"recipient-contract-v1"');
    expect(updatedRecipient).toMatchObject({
      recipient: { version: '"recipient-contract-v2"' },
      settings: { email: true, sms: true },
    });
    const testRequest = requests.find(({ url }) => url.pathname === "/api/v1/notifications/test");
    expect(JSON.parse(requestBodyText(testRequest?.init?.body)) as unknown).toEqual({ channels: ["email", "sms"], recipientId: "recipient-contract-1" });
  });

  test("SSE 중복을 제거하고 스냅샷, 새 알림과 재동기화를 현재 데이터에 병합한다", async () => {
    const { implementation } = createContractFetch({ authenticated: false });
    const fakeEventSource = new FakeEventSource();
    const onSessionExpired = vi.fn();
    const source = createHttpDashboardDataSource({
      eventSourceFactory: () => fakeEventSource as unknown as EventSource,
      fetchImplementation: implementation,
      onSessionExpired,
      route: () => "/",
    });
    await source.getDashboardData();
    const listener = vi.fn<(data: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);

    fakeEventSource.emit("monitoring.snapshot", { ...monitoringFixture, snapshotId: "snapshot-contract-2", summary: { ...monitoringFixture.summary, loadPercent: 77 } }, "event-101");
    fakeEventSource.emit("monitoring.snapshot", { ...monitoringFixture, snapshotId: "snapshot-contract-2", summary: { ...monitoringFixture.summary, loadPercent: 77 } }, "event-101");
    fakeEventSource.emit("notification.created", notificationPageFixture.items[0], "event-102");
    fakeEventSource.emit("notification.created", { ...notificationPageFixture.items[0], id: "notification-contract-read", readAt: monitoringFixture.serverTime }, "event-103");
    fakeEventSource.emit("stream.resync-required", { reason: "event_not_retained", snapshotPath: "/api/v1/monitoring/snapshot" }, "event-104");

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(4));
    expect(listener.mock.calls[0][0].monitoring.summary.loadPercent).toBe(77);
    expect(listener.mock.calls[1][0].monitoring.headerNotifications[0].id).toBe("notification-contract-1");
    expect(listener.mock.calls[2][0].monitoring.headerNotifications[0]).toMatchObject({ id: "notification-contract-read", read: true });
    expect(listener.mock.calls[2][0].monitoring.unreadNotificationCount).toBe(1);
    expect(listener.mock.calls[3][0].monitoring.summary.loadPercent).toBe(72);
    fakeEventSource.emit("session.expired", { reason: "expired" }, "event-105");
    expect(onSessionExpired).toHaveBeenCalledOnce();
    expect(fakeEventSource.closed).toBe(true);
    unsubscribe?.();
    expect(fakeEventSource.closed).toBe(true);
  });

  test("인증된 SSE 재동기화는 개인 알림함도 다시 조회한다", async () => {
    const base = createContractFetch();
    const fakeEventSource = new FakeEventSource();
    let notificationRequestCount = 0;
    const implementation = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = inputUrl(input);
      if (url.pathname === "/api/v1/notifications" && (init?.method ?? "GET") === "GET") {
        notificationRequestCount += 1;
        if (notificationRequestCount > 1) {
          return jsonResponse({
            ...notificationPageFixture,
            items: [
              {
                ...notificationPageFixture.items[0],
                id: "notification-contract-resynced",
                occurredAt: "2026-09-10T10:23:00+09:00",
              },
              ...notificationPageFixture.items,
            ],
            page: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 },
            unreadCount: 2,
          });
        }
      }
      return base.implementation(input, init);
    });
    const source = createHttpDashboardDataSource({
      eventSourceFactory: () => fakeEventSource as unknown as EventSource,
      fetchImplementation: implementation,
      route: () => "/",
    });
    await source.getDashboardData();
    const listener = vi.fn<(data: DashboardData) => void>();
    source.subscribe?.(listener);

    fakeEventSource.emit("stream.resync-required", { reason: "event_not_retained", snapshotPath: "/api/v1/monitoring/snapshot" }, "event-resync");

    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
    expect(listener.mock.calls[0][0].monitoring.headerNotifications[0].id).toBe("notification-contract-resynced");
    expect(listener.mock.calls[0][0].monitoring.unreadNotificationCount).toBe(2);
    expect(notificationRequestCount).toBe(2);
  });

  test("잘못된 SSE snapshot은 진행 중인 정상 재동기화 응답을 폐기하지 않는다", async () => {
    const base = createContractFetch();
    const stream = new FakeEventSource();
    let snapshotRequests = 0;
    let complete: (response: Response) => void = () => undefined;
    const fetchImplementation = vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      if (inputUrl(input).pathname === "/api/v1/monitoring/snapshot" && ++snapshotRequests > 1) {
        return new Promise<Response>((resolve) => { complete = resolve; });
      }
      return base.implementation(input, options);
    });
    const source = createHttpDashboardDataSource({ fetchImplementation, eventSourceFactory: () => stream as unknown as EventSource });
    await source.getDashboardData();
    const listener = vi.fn<(value: DashboardData) => void>();
    const unsubscribe = source.subscribe?.(listener);
    stream.emit("stream.resync-required", { reason: "event_not_retained" });
    stream.emit("monitoring.snapshot", {});
    complete(new Response(JSON.stringify({ ...monitoringFixture, summary: { ...monitoringFixture.summary, loadPercent: 90 } })));
    await vi.waitFor(() => expect(listener.mock.calls.at(-1)?.[0].monitoring.summary.loadPercent).toBe(90));
    unsubscribe?.();
  });

  test("부분 결측, 누락 LiDAR profile과 지연 장비를 손실 없이 변환한다", async () => {
    const base = createContractFetch({ authenticated: false });
    const implementation = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = inputUrl(input);
      if (url.pathname === "/api/v1/monitoring/snapshot") {
        return jsonResponse({
          ...monitoringFixture,
          devices: [{ ...monitoringFixture.devices[0], status: "delayed" }],
          lidarProfiles: [{
            ...monitoringFixture.lidarProfiles[0],
            samples: monitoringFixture.lidarProfiles[0].samples.map((sample) => ({ ...sample, height: null, valid: false })),
          }],
          recentLoad: monitoringFixture.recentLoad.map((sample) => ({ ...sample, valid: false, valuePercent: null })),
          summary: { ...monitoringFixture.summary, averageCollectionCycleSeconds: null },
        });
      }
      return base.implementation(input, init);
    });
    const source = createHttpDashboardDataSource({ fetchImplementation: implementation, route: () => "/" });

    const data = await source.getDashboardData();

    expect(data.monitoring.devices[0].status).toBe("delayed");
    expect(data.monitoring.loadHistory).toHaveLength(monitoringFixture.recentLoad.length);
    expect(data.monitoring.loadHistory.every((sample) => sample.value === null)).toBe(true);
    expect(data.monitoring.lidarProfiles).toHaveLength(2);
    expect(data.monitoring.lidarProfiles[0].samples.every((sample) => sample.height === null)).toBe(true);
    expect(data.monitoring.lidarProfiles[1].samples).toEqual([]);
    expect(data.monitoring.lidarProfiles[1]).toMatchObject({ average: "-", label: "LiDAR 2", maximum: "-", minimum: "-" });
    expect(data.monitoring.summary.averageCollectionCycle).toBe("정보 없음");
  });

  test("RFC 9457 오류를 보존하고 인증 만료를 한 번 전달한다", async () => {
    const base = createContractFetch();
    let failureStatus = 412;
    const onSessionExpired = vi.fn();
    const implementation = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = inputUrl(input);
      if (url.pathname === "/api/v1/settings/alerts" && init?.method === "PUT") {
        return jsonResponse({ code: failureStatus === 412 ? "version_conflict" : "session_expired", detail: "계약 오류", status: failureStatus, title: "Request failed", type: "about:blank" }, failureStatus);
      }
      return base.implementation(input, init);
    });
    const source = createHttpDashboardDataSource({ fetchImplementation: implementation, onSessionExpired, route: () => "/admin" });
    const data = await source.getDashboardData();

    const conflict = await source.replaceAlertSettings!(data.admin.alertSettings).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(ApiError);
    expect(conflict).toMatchObject({ code: "version_conflict", status: 412 });
    expect(onSessionExpired).not.toHaveBeenCalled();

    failureStatus = 401;
    const expired = await source.replaceAlertSettings!(data.admin.alertSettings).catch((error: unknown) => error);
    expect(expired).toBeInstanceOf(ApiError);
    expect(expired).toMatchObject({ code: "session_expired", status: 401 });
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });

  test("session 조회가 401이면 이전 CSRF 상태를 폐기한다", async () => {
    const base = createContractFetch();
    let sessionRequestCount = 0;
    const implementation = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = inputUrl(input);
      if (url.pathname === "/api/v1/session" && (init?.method ?? "GET") === "GET") {
        sessionRequestCount += 1;
        if (sessionRequestCount === 2) {
          return jsonResponse({ status: 401, title: "Unauthorized", type: "about:blank" }, 401);
        }
      }
      return base.implementation(input, init);
    });
    const source = createHttpDashboardDataSource({ fetchImplementation: implementation, route: () => "/" });

    expect((await source.getDashboardData()).session).not.toBeNull();
    expect((await source.getDashboardData()).session).toBeNull();
    await source.sendTestNotification?.("recipient-contract-1", ["email"]);

    const request = base.requests.find(({ url }) => url.pathname === "/api/v1/notifications/test");
    expect(new Headers(request?.init?.headers).has("X-CSRF-Token")).toBe(false);
  });
});
