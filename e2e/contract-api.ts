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

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8nqWQAAAABJRU5ErkJggg==",
  "base64",
);

export async function installContractApi(page: Page, { initiallyAuthenticated = false, whepFailures = 0 } = {}) {
  let authenticated = initiallyAuthenticated;
  let remainingWhepFailures = whepFailures;
  let settings: components["schemas"]["AlertSettings"] = structuredClone(alertSettingsFixture);
  let recipients: components["schemas"]["NotificationRecipient"][] = [structuredClone(recipientFixture)];
  const requests: ContractRequest[] = [];

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
      await json(notificationPageFixture);
      return;
    }
    if (url.pathname === "/api/v1/notifications/read-all" && method === "POST") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (url.pathname.startsWith("/api/v1/notifications/") && method === "PATCH") {
      await json({ ...notificationPageFixture.items[0], readAt: monitoringFixture.serverTime });
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
        body: Buffer.from([0]),
        contentType: "video/mp4",
        headers: { "Accept-Ranges": "bytes", "Content-Length": "1" },
        status: 200,
      });
      return;
    }
    if (url.pathname === `/api/v1/recordings/${recordingFixture.id}/download`) {
      await route.fulfill({
        body: Buffer.from([0]),
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
