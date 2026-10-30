import type { Page } from "@playwright/test";

import type { components } from "../src/generated/backend-contract.js";
import { alertSettingsFixture, eventPageFixture, loadHistoryFixture, notificationPageFixture, sessionFixture } from "../src/test/api-contract-fixtures.js";
import { collectionSummaryFixture, eventRecordingPageFixture, eventReplayFixture, eventReplayPartFixture, measurementLayoutFixture, monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";

import { installDailyRecordingApi, syntheticDailyRecording } from "./daily-recording-api.js";

export type BackendSnapshot = components["schemas"]["MonitoringSnapshotV2"];
export type EventReplayResponse = ReturnType<typeof eventReplayFixture>;
export function syntheticEventReplay(overrides: Record<string, unknown> = {}, event: Record<string, unknown> = {}): EventReplayResponse {
  const id = syntheticDailyRecording.recording_id;
  const base = eventReplayFixture({}, event);
  const part = eventReplayPartFixture({ recordingId: id, playbackPath: `/media/daily-recordings/${id}/hls/index.m3u8`, fromAt: base.event.windowFrom, toAt: base.event.windowTo });
  return { ...base, effectiveTo: base.event.windowTo, parts: [part], ...overrides };
}
export function partialEventReplayWithGaps(overrides: Record<string, unknown> = {}, event: Record<string, unknown> = {}): EventReplayResponse {
  const id = syntheticDailyRecording.recording_id;
  const base = eventReplayFixture({
    state: "PARTIAL",
    requestedSeconds: 60,
    coveredSeconds: 40,
    playbackSeconds: 40,
    unavailableIntervals: [
      { fromAt: "2026-10-12T00:59:40Z", toAt: "2026-10-12T01:00:00Z", kind: "GAP", reasonCode: "RECORDING_GAP" },
    ],
  }, event);
  const part = eventReplayPartFixture({
    recordingId: id,
    playbackPath: `/media/daily-recordings/${id}/hls/index.m3u8`,
    fromAt: base.event.windowFrom,
    toAt: "2026-10-12T00:59:40Z",
    startSeconds: 3570,
    endSeconds: 3610,
    relativeStartSeconds: 0,
    relativeEndSeconds: 40,
    mapping: "LINEAR",
  });
  return { ...base, effectiveTo: base.event.windowTo, parts: [part], ...overrides };
}
export type MediaMode = "healthy" | "silent" | "slow-start" | "interrupted" | "invalid" | "unavailable" | "unauthorized";
export type BrowserControl = {
  emit: (type: string, data: string) => void;
  eventUrls: () => string[];
  metrics: () => { streams: number; videos: number; objectUrls: number; attempts: number };
};

declare global {
  interface Window { backendFixture: BrowserControl }
}

export function historyV2(url: URL, snapshot: BackendSnapshot): components["schemas"]["LoadHistoryV2"] {
  const until = Date.parse(url.searchParams.get("to") ?? snapshot.serverTime);
  const since = Date.parse(url.searchParams.get("from") ?? new Date(until - 86_400_000).toISOString());
  // Backend와 같이 응답 상한 1,441 구간을 만족하는 가장 작은 간격을 고른다.
  const bucketSeconds = ([60, 300, 900, 3600, 7200, 21600, 86400] as const).find((seconds) => Math.ceil(until / (seconds * 1000)) - Math.floor(since / (seconds * 1000)) <= 1441) ?? 86400;
  const interval = bucketSeconds * 1000;
  const first = Math.floor(since / interval) * interval;
  return {
    schemaVersion: "2", pitId: snapshot.pitId, source: snapshot.source,
    from: new Date(since).toISOString(), to: new Date(until).toISOString(), bucketSeconds,
    selectionPolicy: "LATEST_STATE_PER_BUCKET",
    samples: Array.from({ length: Math.ceil((until - first) / interval) }, (_, index) => {
      const start = Math.max(since, first + index * interval);
      const end = Math.min(until, first + (index + 1) * interval);
      const missing = index % 7 === 3;
      const generatedAt = new Date(start + Math.floor((end - start) / 2)).toISOString();
      return {
        bucketStartAt: new Date(start).toISOString(), bucketEndAt: new Date(end).toISOString(),
        generatedAt: missing ? null : generatedAt, observedAt: missing ? null : generatedAt,
        assessmentId: missing ? null : `assessment-${index}`, valid: !missing,
        valuePercent: missing ? null : index % 5 === 0 ? 0 : 68.5,
        dataState: missing ? "NO_DATA" : index % 5 === 1 ? "LIMITED" : "AVAILABLE",
        reasonCodes: missing ? ["STATE_NOT_RECEIVED"] : [],
      };
    }),
  };
}

export async function installBackendApi(page: Page, { initial = monitoringV2StateFixture("UNAVAILABLE"), authenticated = true, mediaMode = "healthy", runtimeConfig = true }: { initial?: BackendSnapshot; authenticated?: boolean; mediaMode?: MediaMode; runtimeConfig?: boolean } = {}) {
  let snapshot = initial;
  let sessionActive = authenticated;
  let eventReplays: EventReplayResponse[] = [syntheticEventReplay()];
  let historyEvents: Array<typeof eventPageFixture.items[number]> = [...eventPageFixture.items];
  let notifications: components["schemas"]["NotificationPage"] = notificationPageFixture;
  let collectionSummary: ReturnType<typeof collectionSummaryFixture> = collectionSummaryFixture();
  // null이면 해당 API를 제공하지 않는 응답(501)이다.
  let activeAlerts: unknown = null;
  let layout: unknown = measurementLayoutFixture();
  let profiles: unknown = null;
  let loadHistory: ((url: URL) => { status: number; body: unknown; delayMs?: number } | undefined) | null = null;
  const requests: URL[] = [];
  if (runtimeConfig) await page.route("**/runtime-config.json", (route) => route.fulfill({ json: { schemaVersion: 1, pitId: initial.pitId, cameraId: "camera-main" } }));
  await page.addInitScript(({ initialSnapshot, mode }) => {
    const streams = new Set<SyntheticEventSource>();
    const eventUrls: string[] = [];
    const videos = new Set<object>();
    const objectUrls = new Set<string>();
    let attempts = 0;
    let currentSnapshot: unknown = initialSnapshot;
    class SyntheticEventSource extends EventTarget {
      constructor(url: string) {
        super();
        eventUrls.push(url);
        streams.add(this);
        queueMicrotask(() => {
          if (streams.has(this)) this.dispatchEvent(new MessageEvent("monitoring.snapshot", { data: JSON.stringify(currentSnapshot) }));
        });
      }
      close() { streams.delete(this); }
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: SyntheticEventSource });
    const nativeCreate = URL.createObjectURL.bind(URL);
    const nativeRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = nativeCreate(blob); objectUrls.add(url); return url; };
    URL.revokeObjectURL = (url) => { objectUrls.delete(url); nativeRevoke(url); };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
      if (url.pathname === "/api/v2/monitoring/snapshot") return nativeFetch(input, init).then(async (response) => {
        if (response.ok) currentSnapshot = await response.clone().json();
        return response;
      });
      if (!url.pathname.startsWith("/media/cameras/") || !url.pathname.endsWith("/live")) return nativeFetch(input, init);
      attempts += 1;
      const silent = mode === "silent" || (mode === "slow-start" && attempts === 1);
      const interrupted = mode === "interrupted" && attempts === 1;
      if (mode === "unavailable" || mode === "unauthorized") return Promise.resolve(new Response(null, { status: mode === "unauthorized" ? 401 : 503 }));
      if (init?.signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 48;
      const context = canvas.getContext("2d");
      if (context) { context.fillStyle = "#153b55"; context.fillRect(0, 0, 64, 48); }
      const jpeg = mode === "invalid" ? new Uint8Array([255, 216, 255, 217])
        : Uint8Array.from(atob(canvas.toDataURL("image/jpeg").split(",")[1]), (character) => character.charCodeAt(0));
      const header = new TextEncoder().encode(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
      const frame = new Uint8Array(header.length + jpeg.length + 2);
      frame.set(header);
      frame.set(jpeg, header.length);
      frame.set([13, 10], header.length + jpeg.length);
      const identity = {};
      let timer: ReturnType<typeof setInterval> | undefined;
      let closed = false;
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        videos.delete(identity);
        init?.signal?.removeEventListener("abort", abort);
      };
      const abort = () => { cleanup(); controller.error(new DOMException("Aborted", "AbortError")); };
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
          videos.add(identity);
          init?.signal?.addEventListener("abort", abort, { once: true });
          if (!silent) {
            controller.enqueue(frame);
            if (!interrupted) timer = setInterval(() => { if (!closed) controller.enqueue(frame); }, 300);
          }
        }, cancel: cleanup,
      });
      return Promise.resolve(new Response(body, { headers: { "Content-Type": "multipart/x-mixed-replace; boundary=frame" } }));
    };
    window.backendFixture = {
      emit(type, data) { for (const stream of streams) stream.dispatchEvent(new MessageEvent(type, { data })); },
      eventUrls() { return [...eventUrls]; },
      metrics() { return { streams: streams.size, videos: videos.size, objectUrls: objectUrls.size, attempts }; },
    };
  }, { initialSnapshot: initial, mode: mediaMode });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status });
    if (url.pathname === "/api/v1/session") {
      if (route.request().method() === "POST") sessionActive = true;
      if (route.request().method() === "DELETE") { sessionActive = false; await route.fulfill({ status: 204 }); return; }
      await (sessionActive ? json(sessionFixture) : json({ detail: "Unauthorized" }, 401));
    } else if (!sessionActive) await json({ detail: "Unauthorized" }, 401);
    else if (url.pathname === "/api/v2/monitoring/snapshot") await json(snapshot);
    else if (url.pathname === "/api/v2/monitoring/load-history") {
      const override = loadHistory?.(url);
      if (override?.delayMs) await new Promise((resolve) => setTimeout(resolve, override.delayMs));
      await (override ? json(override.body, override.status) : json(historyV2(url, snapshot)));
    }
    else if (url.pathname === "/api/v2/monitoring/active-alerts") await (activeAlerts === null ? json({ detail: "Unexpected fixture request" }, 501) : json(activeAlerts));
    else if (url.pathname === "/api/v2/monitoring/layout") await (layout === null ? json({ detail: "Layout unavailable" }, 503) : json(layout));
    else if (url.pathname === "/api/v2/monitoring/profiles") await (profiles === null ? json({ detail: "Unexpected fixture request" }, 501) : json(profiles));
    else if (url.pathname === "/api/v2/monitoring/alerts") await json({ items: [], limit: 20, offset: Number(url.searchParams.get("offset") ?? 0), totalItems: 0 });
    else if (url.pathname === `/api/v1/config/pits/${encodeURIComponent(snapshot.pitId)}`) await json({ id: snapshot.pitId, name: "시험 pit", total_depth_cm: 300, warning_threshold_percent: 75, critical_threshold_percent: 85, updated_at: snapshot.serverTime });
    else if (url.pathname === "/api/v1/notifications") await json(notifications);
    else if (url.pathname === "/api/v1/notifications/read-all") {
      notifications = { ...notifications, unreadCount: 0, items: notifications.items.map((item) => ({ ...item, readAt: "2026-10-13T00:00:10Z" })) };
      await route.fulfill({ status: 204 });
    }
    else if (url.pathname.startsWith("/api/v1/notifications/") && route.request().method() === "PATCH") {
      const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      const notification = notifications.items.find((item) => item.id === id);
      if (!notification) { await json({ detail: "Not found" }, 404); return; }
      const updated = { ...notification, readAt: notification.readAt ?? "2026-10-13T00:00:10Z" };
      notifications = { ...notifications, unreadCount: Math.max(0, notifications.unreadCount - (notification.readAt ? 0 : 1)), items: notifications.items.map((item) => item.id === id ? updated : item) };
      await json(updated);
    }
    else if (url.pathname === "/api/v1/history/load") await json(loadHistoryFixture);
    else if (url.pathname === "/api/v1/events") {
      const category = url.searchParams.get("category");
      const filtered = historyEvents.filter((item) => !category || item.category === category);
      const [number, size] = [Number(url.searchParams.get("page") ?? 1), Number(url.searchParams.get("pageSize") ?? 20)];
      await json({ ...eventPageFixture, items: filtered.slice((number - 1) * size, number * size),
        page: { page: number, pageSize: size, totalItems: filtered.length, totalPages: Math.ceil(filtered.length / size) } });
    }
    else if (url.pathname === "/api/v2/monitoring/collection-summary") await json(collectionSummary);
    else if (url.pathname === "/api/v1/settings/alerts") await json(alertSettingsFixture);
    else if (url.pathname === "/api/v1/notification-recipients") await json({ items: [], page: { page: 1, pageSize: 100, totalItems: 0, totalPages: 1 } });
    else if (url.pathname === "/api/v2/recordings/events") {
      const category = url.searchParams.get("category");
      const withPlayback = url.searchParams.get("include_playback") === "true";
      const items = eventReplays.filter(item => !category || item.event.category === category)
        .map(item => withPlayback && !("playback" in item.event) ? { ...item.event, playback: { state: item.state, playbackSeconds: item.playbackSeconds, reasonCodes: item.reasonCodes } } : item.event);
      const [number, size] = [Number(url.searchParams.get("page") ?? 1), Number(url.searchParams.get("pageSize") ?? 100)];
      await json({ ...eventRecordingPageFixture(items.slice((number - 1) * size, number * size)),
        page: { page: number, pageSize: size, totalItems: items.length, totalPages: Math.ceil(items.length / size) } });
    } else if (url.pathname.startsWith("/api/v2/recordings/events/")) {
      const replay = eventReplays.find(item => item.event.eventId === decodeURIComponent(url.pathname.split("/").at(-1) ?? ""));
      await (replay ? json(replay) : json({ detail: "Not found" }, 404));
    } else await json({ detail: "Unexpected fixture request" }, 501);
  });
  const daily = await installDailyRecordingApi(page, () => sessionActive, url => requests.push(url));
  return {
    requests,
    daily,
    expire: () => { sessionActive = false; },
    setEventReplays: (next: EventReplayResponse[]) => { eventReplays = next; },
    setHistoryEvents: (next: typeof historyEvents) => { historyEvents = next; },
    setNotifications: (next: typeof notifications) => { notifications = next; },
    setCollectionSummary: (next: typeof collectionSummary) => { collectionSummary = next; },
    setActiveAlerts: (next: unknown) => { activeAlerts = next; },
    setLayout: (next: unknown) => { layout = next; },
    setProfiles: (next: unknown) => { profiles = next; },
    setLoadHistory: (next: typeof loadHistory) => { loadHistory = next; },
    async snapshot(next: BackendSnapshot) { snapshot = next; await page.evaluate((value) => window.backendFixture.emit("monitoring.snapshot", JSON.stringify(value)), next); },
  };
}
