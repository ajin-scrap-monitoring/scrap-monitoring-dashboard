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

type RecordedRequest = { init?: RequestInit; url: URL };

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

afterEach(() => vi.restoreAllMocks());

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
