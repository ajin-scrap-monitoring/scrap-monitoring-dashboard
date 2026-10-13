import type { Page } from "@playwright/test";

import type { components } from "../src/generated/backend-contract.js";
import { alertSettingsFixture, eventPageFixture, loadHistoryFixture, notificationPageFixture, sessionFixture } from "../src/test/api-contract-fixtures.js";
import { mediaRecordingFixture, monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";

import { syntheticMp4 } from "./contract-api.js";

export type BackendSnapshot = components["schemas"]["MonitoringSnapshotV2"];
export type MediaMode = "healthy" | "silent" | "invalid" | "unavailable" | "unauthorized";
export type BrowserControl = {
  emit: (type: string, data: string) => void;
  eventUrls: () => string[];
  metrics: () => { streams: number; videos: number; objectUrls: number; attempts: number };
};

declare global {
  interface Window { backendFixture: BrowserControl }
}

export async function installBackendApi(page: Page, { initial = monitoringV2StateFixture("UNAVAILABLE"), authenticated = true, mediaMode = "healthy", runtimeConfig = true }: { initial?: BackendSnapshot; authenticated?: boolean; mediaMode?: MediaMode; runtimeConfig?: boolean } = {}) {
  let snapshot = initial;
  let sessionActive = authenticated;
  let recordings: components["schemas"]["Recording"][] = [mediaRecordingFixture];
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
          if (mode !== "silent") {
            controller.enqueue(frame);
            timer = setInterval(() => { if (!closed) controller.enqueue(frame); }, 300);
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
    else if (url.pathname === "/api/v1/notifications") await json(notificationPageFixture);
    else if (url.pathname === "/api/v1/history/load") await json(loadHistoryFixture);
    else if (url.pathname === "/api/v1/events") await json(eventPageFixture);
    else if (url.pathname === "/api/v1/settings/alerts") await json(alertSettingsFixture);
    else if (url.pathname === "/api/v1/notification-recipients") await json({ items: [], page: { page: 1, pageSize: 100, totalItems: 0, totalPages: 1 } });
    else if (url.pathname === "/api/v1/recordings") await json({ items: recordings, page: { page: 1, pageSize: 100, totalItems: recordings.length, totalPages: 1 } });
    else if (url.pathname.startsWith("/api/v1/recordings/")) {
      const recording = recordings.find((item) => item.id === decodeURIComponent(url.pathname.split("/").at(-1) ?? ""));
      await (recording ? json(recording) : json({ detail: "Not found" }, 404));
    } else await json({ detail: "Unexpected fixture request" }, 501);
  });
  await page.route("**/media/clips/**", (route) => route.fulfill({ body: syntheticMp4, contentType: "video/mp4" }));
  return {
    requests,
    expire: () => { sessionActive = false; },
    setRecordings: (next: typeof recordings) => { recordings = next; },
    async snapshot(next: BackendSnapshot) { snapshot = next; await page.evaluate((value) => window.backendFixture.emit("monitoring.snapshot", JSON.stringify(value)), next); },
  };
}
