import type { Page } from "@playwright/test";
import type { components } from "../src/generated/api-contract.js";

import {
  alertSettingsFixture,
  eventPageFixture,
  loadHistoryFixture,
  monitoringFixture,
  notificationPageFixture,
  recipientFixture,
  recordingFixture,
  recordingPageFixture,
  sessionFixture,
} from "../src/test/api-contract-fixtures.js";

export type ContractRequest = {
  headers: Record<string, string>;
  method: string;
  postData: string | null;
  url: URL;
};

export { syntheticMp4 };

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8nqWQAAAABJRU5ErkJggg==",
  "base64",
);

const syntheticMp4 = Buffer.from("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", "base64");

export async function installContractApi(page: Page, { initiallyAuthenticated = false, whepFailures = 0, backendContract = false } = {}) {
  await page.route("**/runtime-config.json", (route) => route.fulfill({ json: { schemaVersion: 1, pitId: "pit-01", cameraId: "camera-main" } }));
  let authenticated = initiallyAuthenticated;
  let remainingWhepFailures = whepFailures;
  let settings: components["schemas"]["AlertSettings"] = structuredClone(alertSettingsFixture);
  let notifications: components["schemas"]["NotificationPage"] = structuredClone(notificationPageFixture);
  let recipients: components["schemas"]["NotificationRecipient"][] = [structuredClone(recipientFixture)];
  const requests: ContractRequest[] = [];
  await page.addInitScript((backend) => {
    const browser = globalThis as unknown as { sessionStorage: { setItem: (key: string, value: string) => void } };
    browser.sessionStorage.setItem("scrap-monitoring-api-contract", backend ? "backend" : "proposal");
  }, backendContract);

  await page.addInitScript(() => {
    type SessionDescription = { sdp?: string; type: string };
    type IceCandidate = { candidate: string; sdpMid: string };
    class ContractPeerConnection {
      connectionState = "new";
      localDescription: SessionDescription | null = null;
      onconnectionstatechange: (() => void) | null = null;
      onicecandidate: ((event: { candidate: IceCandidate | null }) => void) | null = null;
      ontrack: ((event: { streams: unknown[] }) => void) | null = null;

      addTransceiver() {}
      close() { this.connectionState = "closed"; }
      createAnswer() { return Promise.resolve({ sdp: "v=0\r\na=contract-answer\r\n", type: "answer" }); }
      createOffer() {
        return Promise.resolve({
          sdp: "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=ice-ufrag:contract\r\na=ice-pwd:contract-password\r\n",
          type: "offer",
        });
      }
      setLocalDescription(description: SessionDescription) {
        this.localDescription = description.type === "rollback" ? null : description;
        if (description.type !== "rollback") {
          queueMicrotask(() => this.onicecandidate?.({
            candidate: { candidate: "candidate:1 1 UDP 1 192.0.2.1 5000 typ host", sdpMid: "0" },
          }));
          queueMicrotask(() => this.onicecandidate?.({ candidate: null }));
        }
        return Promise.resolve();
      }
      setRemoteDescription() {
        this.connectionState = "connected";
        this.onconnectionstatechange?.();
        return Promise.resolve();
      }
    }

    Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, value: ContractPeerConnection });
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    requests.push({ headers: request.headers(), method, postData: request.postData(), url });

    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => route.fulfill({
      body: JSON.stringify(body),
      contentType: "application/json",
      headers,
      status,
    });

    if (url.pathname === "/api/v1/session" && method === "GET") {
      await (authenticated
        ? json(sessionFixture)
        : json({ status: 401, title: "Unauthorized", type: "about:blank" }, 401));
      return;
    }
    if (url.pathname === "/api/v1/session" && method === "POST") {
      authenticated = true;
      await json(sessionFixture);
      return;
    }
    if (url.pathname === "/api/v1/session" && method === "DELETE") {
      authenticated = false;
      await route.fulfill({ status: 204 });
      return;
    }
    if (url.pathname === "/api/v1/monitoring/snapshot") {
      await json(monitoringFixture, 200, { "Cache-Control": "no-store" });
      return;
    }
    if (url.pathname === "/api/v1/monitoring/events") {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({
        body: `retry: 60000\nid: snapshot-contract-e2e\nevent: monitoring.snapshot\ndata: ${JSON.stringify(monitoringFixture)}\n\n`,
        contentType: "text/event-stream",
        headers: { "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
        status: 200,
      });
      return;
    }
    if (url.pathname === "/api/v1/notifications" && method === "GET") {
      await json(notifications);
      return;
    }
    if (url.pathname === "/api/v1/notifications/read-all" && method === "POST") {
      notifications = { ...notifications, unreadCount: 0, items: notifications.items.map((item) => ({ ...item, readAt: item.readAt ?? monitoringFixture.serverTime })) };
      await route.fulfill({ status: 204 });
      return;
    }
    if (url.pathname.startsWith("/api/v1/notifications/") && method === "PATCH") {
      const notification = notifications.items.find((item) => item.id === decodeURIComponent(url.pathname.split("/").at(-1) ?? ""));
      if (!notification) { await json({ detail: "Not found" }, 404); return; }
      const updated = { ...notification, readAt: notification.readAt ?? monitoringFixture.serverTime };
      notifications = { ...notifications, unreadCount: Math.max(0, notifications.unreadCount - (notification.readAt ? 0 : 1)), items: notifications.items.map((item) => item.id === updated.id ? updated : item) };
      await json(updated);
      return;
    }
    if (url.pathname === "/api/v1/history/load") {
      const category = url.searchParams.get("eventCategory");
      await json({ ...loadHistoryFixture, eventMarkers: category ? loadHistoryFixture.eventMarkers.filter((event) => event.category === category) : loadHistoryFixture.eventMarkers });
      return;
    }
    if (url.pathname === "/api/v1/events") {
      const category = url.searchParams.get("eventCategory");
      await json({ ...eventPageFixture, items: category && category !== "alert" ? [] : eventPageFixture.items });
      return;
    }
    if (url.pathname === "/api/v1/recordings" && method === "GET") {
      const category = url.searchParams.get("eventCategory");
      await json({ ...recordingPageFixture, items: category && category !== "alert" ? [] : recordingPageFixture.items });
      return;
    }
    if (url.pathname === `/api/v1/recordings/${recordingFixture.id}/thumbnail`) {
      await route.fulfill({ body: transparentPng, contentType: "image/png", status: 200 });
      return;
    }
    if (url.pathname === `/api/v1/recordings/${recordingFixture.id}/content`) {
      await route.fulfill({
        body: syntheticMp4,
        contentType: "video/mp4",
        headers: { "Accept-Ranges": "bytes", "Content-Length": String(syntheticMp4.length) },
        status: 200,
      });
      return;
    }
    if (url.pathname === `/api/v1/recordings/${recordingFixture.id}/download`) {
      await route.fulfill({
        body: syntheticMp4,
        contentType: "video/mp4",
        headers: { "Content-Disposition": `attachment; filename="${recordingFixture.id}.mp4"` },
        status: 200,
      });
      return;
    }
    if (url.pathname === `/api/v1/recordings/${recordingFixture.id}`) {
      await json(recordingFixture);
      return;
    }
    if (url.pathname === "/api/v1/settings/alerts" && method === "GET") {
      await json(settings, 200, { ETag: settings.version });
      return;
    }
    if (url.pathname === "/api/v1/settings/alerts" && method === "PUT") {
      const body = JSON.parse(request.postData() ?? "{}") as components["schemas"]["AlertSettingsUpdate"];
      settings = { ...body, version: '"settings-contract-v2"' };
      await json(settings, 200, { ETag: settings.version });
      return;
    }
    if (url.pathname === "/api/v1/notification-recipients" && method === "GET") {
      await json({ items: recipients, page: { page: 1, pageSize: 100, totalItems: recipients.length, totalPages: 1 } });
      return;
    }
    if (url.pathname === "/api/v1/notification-recipients" && method === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as components["schemas"]["NotificationRecipientCreate"];
      const recipient: components["schemas"]["NotificationRecipient"] = { ...body, id: `recipient-contract-${recipients.length + 1}`, version: '"recipient-contract-v1"' };
      recipients = [...recipients, recipient];
      await json(recipient, 201, { ETag: recipient.version, Location: `/api/v1/notification-recipients/${recipient.id}` });
      return;
    }
    if (url.pathname.startsWith("/api/v1/notification-recipients/") && method === "PATCH") {
      const id = url.pathname.split("/").at(-1);
      const body = JSON.parse(request.postData() ?? "{}") as components["schemas"]["NotificationRecipientPatch"];
      const current = recipients.find((recipient) => recipient.id === id) ?? recipientFixture;
      const updated = { ...current, ...body, version: '"recipient-contract-v2"' };
      recipients = recipients.map((recipient) => recipient.id === id ? updated : recipient);
      await json(updated, 200, { ETag: updated.version });
      return;
    }
    if (url.pathname === "/api/v1/notifications/test" && method === "POST") {
      await route.fulfill({ status: 202 });
      return;
    }
    if (url.pathname.startsWith("/api/v1/webrtc/streams/") && method === "POST") {
      if (remainingWhepFailures > 0) {
        remainingWhepFailures -= 1;
        await json({ status: 503, title: "Media unavailable", type: "about:blank" }, 503);
        return;
      }
      await route.fulfill({
        body: "v=0\r\na=ice-options:trickle\r\na=contract-answer\r\n",
        contentType: "application/sdp",
        headers: {
          ETag: '"whep-contract-v1"',
          Location: "/api/v1/webrtc/sessions/whep-contract-1",
        },
        status: 201,
      });
      return;
    }
    if (url.pathname === "/api/v1/webrtc/sessions/whep-contract-1" && method === "PATCH") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (url.pathname === "/api/v1/webrtc/sessions/whep-contract-1" && method === "DELETE") {
      await route.fulfill({ status: 200 });
      return;
    }

    await json({ status: 404, title: "Not Found", type: "about:blank" }, 404);
  });

  return { requests };
}
