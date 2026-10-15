import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import type { components } from "../src/generated/backend-contract.js";
import { extractBackendContract, readManifest, type Json } from "../scripts/backend-contract.ts";

type Session = components["schemas"]["Session"];
type RecordingPage = components["schemas"]["RecordingPage"];
const screenshots = `${process.env.SYNC_RUN_DIRECTORY ?? "test-results/integration"}/private/screenshots`;

test("실제 Backend의 과거 적재율 값과 현재 임계율을 이력 그래프에 그대로 표시한다", async ({ page, playwright }) => {
  const backend = await playwright.request.newContext({ baseURL: "http://backend:8000" });
  // Keep these graph samples outside the one-hour metric test's history bucket.
  const base = Math.floor(Date.now() / 900_000) * 900_000 - 2 * 3_600_000;
  const expected = [];
  try {
    for (const [index, percent] of [0, 25, null, 68.5, 100].entries()) {
      const generatedAt = new Date(base - (4 - index) * 900_000 + 30_000).toISOString();
      const assessmentId = randomUUID();
      const messageId = randomUUID();
      const response = await backend.post("/api/edge/v2/assessments", {
        headers: { Authorization: "Bearer " + (process.env.SYNC_EDGE_TOKEN ?? ""), "Idempotency-Key": messageId },
        data: {
          schema_version: "2.0", message_type: "edge_assessment", message_id: messageId,
          site_id: "site-demo", edge_id: "edge-demo", generated_at: generatedAt, config_revision: "synthetic-config-1",
          assessment_type: "STATE", assessment_id: assessmentId, revision: 1,
          observed_from: generatedAt, observed_to: generatedAt, rule_version: "synthetic-history-rule",
          decision_state: percent === null ? "UNAVAILABLE" : index === 3 ? "LIMITED" : "AVAILABLE",
          reason_codes: percent === null ? ["INPUT_UNAVAILABLE"] : index === 3 ? ["INPUT_LIMITED"] : [],
          fill_state: "SYNTHETIC_HISTORY", fill_estimate: percent === null ? null : { ratio: percent / 100, method_version: "synthetic-history-method" },
          event: null, capabilities: { fill: "ENABLED", occlusion: "NOT_IMPLEMENTED", collection: "NOT_IMPLEMENTED", vision: "NOT_IMPLEMENTED" },
          evidence: { scans: [], vision_observations: [] },
        },
      });
      expect(response.ok()).toBe(true);
      expected.push({ assessmentId, percent });
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page);
    const historyResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/v2/monitoring/load-history"
        && Date.parse(url.searchParams.get("to") ?? "") - Date.parse(url.searchParams.get("from") ?? "") === 7 * 86_400_000;
    });
    const snapshotResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v2/monitoring/snapshot");
    await page.getByRole("link", { name: "이력", exact: true }).click();
    const history = await (await historyResponse).json() as components["schemas"]["LoadHistoryV2"];
    const snapshot = await (await snapshotResponse).json() as components["schemas"]["MonitoringSnapshotV2"];
    await expect(page.getByRole("heading", { name: "이력", exact: true })).toBeVisible();
    await expect(page.locator(".history-chart")).not.toContainText("유효한 적재율 데이터가 없습니다.");
    const points = await page.locator(".history-load-line").evaluateAll(paths => paths.flatMap(path =>
      [...(path.getAttribute("d") ?? "").matchAll(/[ML]([\d.e+-]+) ([\d.e+-]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }))));
    expect(points).toHaveLength(history.samples.filter(sample => sample.valid && sample.valuePercent !== null).length);
    for (const item of expected) {
      const sample = history.samples.find(sample => sample.assessmentId === item.assessmentId);
      expect(sample).toMatchObject({ valuePercent: item.percent, valid: item.percent !== null });
      if (item.percent === null || !sample?.generatedAt) continue;
      const x = 58 + 1842 * (Date.parse(sample.generatedAt) - Date.parse(history.from)) / (Date.parse(history.to) - Date.parse(history.from));
      expect(points.some(point => Math.abs(point.x - x) < 0.001 && Math.abs(point.y - (192 - item.percent! * 1.3)) < 0.001)).toBe(true);
    }
    await expect(page.getByLabel(/대표 적재율 68.5%, 입력 제한/)).toBeVisible();
    const threshold = page.locator('.history-chart path[stroke-dasharray="6 6"]');
    const thresholdY = Number((await threshold.getAttribute("d"))?.match(/^M58 ([\d.]+)H1900$/)?.[1]);
    expect(thresholdY).toBeCloseTo(192 - snapshot.summary.collectionThresholdPercent * 1.3);
    await page.getByRole("button", { name: "최근 24시간", exact: true }).click();
    await page.getByRole("button", { name: "조회", exact: true }).click();
    await expect(page.getByRole("button", { name: "조회", exact: true })).toBeEnabled();
    await expect(page.getByLabel(/대표 적재율 68.5%, 입력 제한/)).toBeVisible();
    expect(await page.locator(".history-load-line").count()).toBeGreaterThanOrEqual(4);
    await page.screenshot({ path: `${screenshots}/history-valid-values.png`, fullPage: true });
  } finally { await backend.dispose(); }
});

test("실제 Backend OpenAPI와 고정한 계약 snapshot 일치", async ({ playwright }) => {
  const backend = await playwright.request.newContext({ baseURL: "http://backend:8000" });
  try {
    const response = await backend.get("/openapi.json");
    expect(response.ok()).toBe(true);
    const actual = await response.json() as Json;
    const snapshot = JSON.parse(await readFile(new URL("../docs/contracts/backend/openapi.json", import.meta.url), "utf8")) as Json;
    expect(extractBackendContract(actual, await readManifest())).toEqual(snapshot);
  } finally { await backend.dispose(); }
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("operator");
  await page.getByLabel("비밀번호").fill(process.env.SYNC_VIEWER_PASSWORD ?? "");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "스크랩 모니터링", exact: true })).toBeVisible();
}

test("실제 session과 Edge v2 판단 불가, MJPEG 연결 및 확대 종료", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  const unauthorized = await page.request.get("/api/v2/monitoring/snapshot?pit_id=pit-01");
  expect(unauthorized.status()).toBe(401);
  await login(page);
  await expect(page.locator(".kpi-value")).toHaveText("판단 불가");
  await expect(page.locator(".monitoring-grid > .card")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "상태 상세", exact: true })).toHaveCount(0);
  const snapshotResponse = await page.request.get("/api/v2/monitoring/snapshot?pit_id=pit-01");
  expect(snapshotResponse.ok()).toBe(true);
  const snapshot = await snapshotResponse.json() as components["schemas"]["MonitoringSnapshotV2"];
  expect(snapshot.reasonCodes).toContain("FILL_METHOD_NOT_IMPLEMENTED");
  expect(snapshot.deviceStatus.effective_state).toBe("MEASUREMENT_UNAVAILABLE");
  const image = page.getByRole("img", { name: "스크랩 적재 공간 실시간 영상", exact: true });
  await expect(image).toBeVisible();
  const pageWidth = await page.getByRole("main").evaluate((element) => {
    const viewport = element as unknown as { scrollWidth: number; clientWidth: number };
    return { content: viewport.scrollWidth, width: viewport.clientWidth };
  });
  expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.width);
  await expect.poll(() => image.evaluate((element) => (element as unknown as { naturalWidth: number }).naturalWidth)).toBe(320);
  expect(urls.some((url) => url.includes("/api/v2/monitoring/events?pit_id=pit-01"))).toBe(true);
  expect(urls.some((url) => url.includes("/webrtc/"))).toBe(false);
  await page.getByRole("button", { name: "실시간 영상 크게 보기" }).click();
  await expect(page.getByRole("dialog", { name: "실시간 영상 크게 보기" })).toBeVisible();
  await expect(page.getByRole("img", { name: "스크랩 적재 공간 실시간 영상", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "영상 닫기", exact: true }).click();
  await expect(image).toBeVisible();
  await page.screenshot({ path: `${screenshots}/monitoring-v2.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "실시간 영상 크게 보기" }).click();
  const close = page.getByRole("button", { name: "영상 닫기", exact: true });
  await expect(close).toBeFocused();
  expect((await close.boundingBox())?.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "실시간 영상 크게 보기" })).toBeFocused();
  await page.screenshot({ path: `${screenshots}/monitoring-v2-minimum.png`, fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const wide = await page.getByRole("main").evaluate((element) => {
    const viewport = element as unknown as { scrollWidth: number; clientWidth: number };
    return { content: viewport.scrollWidth, width: viewport.clientWidth };
  });
  expect(wide.content).toBeLessThanOrEqual(wide.width);
  await page.screenshot({ path: `${screenshots}/monitoring-v2-wide.png`, fullPage: true });
});

test("실제 v2 수신 API, SSE와 적재율 추이에서 0%, STALE, session 종료 처리", async ({ page, playwright }) => {
  const backend = await playwright.request.newContext({ baseURL: "http://backend:8000" });
  const now = new Date().toISOString();
  const envelope = (message_type: string) => ({ schema_version: "2.0", message_type, message_id: randomUUID(), site_id: "site-demo", edge_id: "edge-demo", generated_at: new Date().toISOString(), config_revision: "synthetic-config-1" });
  const status = {
    ...envelope("edge_status"), orchestrator_instance_id: "synthetic-browser-case", sequence: 1, overall_state: "HEALTHY", reason_codes: [], clock: { state: "SYNCED", offset_ms: 0 },
    sensors: ["lidar-a", "lidar-b"].map((sensor_id) => ({ sensor_id, data_state: "FRESH", last_scan_at: now, reason_codes: [] })),
    services: [{ service: "camera-edge", state: "HEALTHY", last_progress_at: now, reason_codes: [] }],
    delivery: { pending_messages: 0, pending_bytes: 0, quarantined_messages: 0, last_backend_ack_at: null },
    storage: { limit_bytes: 4096, used_bytes: 0, lost_messages: 0, loss_from: null, loss_to: null, last_loss_reason: null, unavailable_evidence_scan_ids: [] },
  };
  const send = async (endpoint: string, payload: { message_id: string } & Record<string, unknown>) => {
    const response = await backend.post("/api/edge/v2/" + endpoint, { data: payload, headers: { Authorization: "Bearer " + (process.env.SYNC_EDGE_TOKEN ?? ""), "Idempotency-Key": payload.message_id } });
    expect(response.ok()).toBe(true);
  };
  try {
    await send("status", status);
    const assessment = {
      ...envelope("edge_assessment"), assessment_type: "STATE", assessment_id: randomUUID(), revision: 1,
      observed_from: now, observed_to: now, rule_version: "synthetic-browser-rule", decision_state: "AVAILABLE", reason_codes: [], fill_state: "SYNTHETIC_ZERO",
      fill_estimate: { ratio: 0, method_version: "synthetic-browser-method" }, event: null,
      capabilities: { fill: "ENABLED", occlusion: "NOT_IMPLEMENTED", collection: "NOT_IMPLEMENTED", vision: "NOT_IMPLEMENTED" }, evidence: { scans: [], vision_observations: [] },
    };
    const baselineAt = new Date(Date.parse(now) - 3_600_000).toISOString();
    await send("assessments", { ...assessment, assessment_id: randomUUID(), message_id: randomUUID(), generated_at: baselineAt,
      observed_from: baselineAt, observed_to: baselineAt, fill_estimate: { ratio: 0.6, method_version: "synthetic-browser-method" } });
    await login(page);
    const camera = page.locator(".device").filter({ has: page.getByText("카메라", { exact: true }) });
    await expect(camera.locator(".status-text")).toHaveText("정상");
    await expect(camera.locator(".status-text")).toHaveAttribute("title", "HEALTHY");
    await send("assessments", assessment);
    await expect(page.locator(".kpi-value")).toHaveText("0%");
    const pastLoad = page.locator(".status-details > div").filter({ hasText: "1시간 전 적재율" }).locator("strong");
    await expect(pastLoad).toHaveText("60%");
    const snapshotResponse = await page.request.get("/api/v2/monitoring/snapshot?pit_id=pit-01");
    expect(snapshotResponse.status(), "Authenticated v2 snapshot response").toBe(200);
    const confirmedSnapshot = await snapshotResponse.json() as components["schemas"]["MonitoringSnapshotV2"];
    const cameraService = confirmedSnapshot.deviceStatus.snapshot?.services.find(service => service.service === "camera-edge");
    expect(cameraService).toMatchObject({ state: "HEALTHY", reason_codes: [] });
    expect(Date.parse(cameraService?.last_progress_at ?? "")).toBe(Date.parse(now));
    const historyResponse = await page.request.get("/api/v2/monitoring/load-history?" + new URLSearchParams({
      pit_id: "pit-01",
      from: new Date(Date.parse(assessment.generated_at) - 60_000).toISOString(),
      to: confirmedSnapshot.serverTime,
    }).toString());
    expect(historyResponse.status(), "Authenticated v2 load-history response").toBe(200);
    const history = await historyResponse.json() as components["schemas"]["LoadHistoryV2"];
    expect(history).toMatchObject({ schemaVersion: "2", pitId: "pit-01", bucketSeconds: 60,
      source: { pit_id: "pit-01", site_id: "site-demo", edge_id: "edge-demo" } });
    const zeroSample = history.samples.find((sample) => sample.assessmentId === assessment.assessment_id);
    expect(zeroSample).toMatchObject({ assessmentId: assessment.assessment_id, valuePercent: 0, valid: true, dataState: "AVAILABLE" });
    expect(Date.parse(zeroSample?.generatedAt ?? "")).toBe(Date.parse(assessment.generated_at));
    expect(Date.parse(zeroSample?.observedAt ?? "")).toBe(Date.parse(assessment.observed_to));
    expect(confirmedSnapshot.operations?.effectiveState).toBe("NORMAL");
    await expect(page.locator(".alarm-status")).toHaveText("경고 기준 미만");
    const criticalAt = new Date().toISOString();
    await send("assessments", { ...assessment, ...envelope("edge_assessment"), assessment_id: randomUUID(), observed_from: criticalAt, observed_to: criticalAt, fill_estimate: { ratio: 0.95, method_version: "synthetic-browser-method" } });
    await expect(page.locator(".kpi-value")).toHaveText("95%");
    await expect(pastLoad).toHaveText("60%");
    await expect(page.locator(".alarm-status")).toHaveText("위험");
    const alertResponse = await page.request.get("/api/v2/monitoring/alerts?pit_id=pit-01&limit=1");
    expect(alertResponse.ok()).toBe(true);
    const alerts = await alertResponse.json() as components["schemas"]["V2AlertPage"];
    expect(alerts.items).toHaveLength(1);
    const notificationResponse = await page.request.get("/api/v1/notifications?page=1&pageSize=20");
    expect(notificationResponse.ok()).toBe(true);
    const notifications = await notificationResponse.json() as components["schemas"]["NotificationPage"];
    const recorded = notifications.items.find((item) => item.id === alerts.items[0].notificationId);
    if (!recorded) throw new Error("Current v2 alert notification is missing.");
    await page.getByRole("button", { name: /^알림 [1-9][0-9]*건$/ }).click();
    const notificationPopover = page.getByLabel("최근 알림");
    await expect(notificationPopover.getByText(recorded.title, { exact: true })).toBeVisible();
    expect(notifications.unreadCount).toBeGreaterThan(0);
    const readAllResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/notifications/read-all" && response.request().method() === "POST");
    await notificationPopover.getByRole("button", { name: "모두 읽음", exact: true }).click();
    expect((await readAllResponse).status()).toBe(204);
    await expect(page.getByRole("button", { name: "알림 0건", exact: true })).toBeVisible();
    await expect(notificationPopover.locator(".header-notification:not(.read)")).toHaveCount(0);
    const readState = await page.request.get("/api/v1/notifications?page=1&pageSize=20");
    expect(readState.status()).toBe(200);
    const readNotifications = await readState.json() as components["schemas"]["NotificationPage"];
    expect(readNotifications.unreadCount).toBe(0);
    expect(readNotifications.items.find(item => item.id === recorded.id)?.readAt).toBeTruthy();
    await page.reload();
    await expect(page.getByRole("button", { name: "알림 0건", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "알림 0건", exact: true }).click();
    await expect(page.getByLabel("최근 알림").getByText(recorded.title, { exact: true })).toBeVisible();
    await expect(page.getByLabel("최근 알림").locator(".header-notification:not(.read)")).toHaveCount(0);
    await page.getByRole("heading", { name: "스크랩 모니터링", exact: true }).click();
    for (const path of ["/api/v2/monitoring/collection-events", "/api/v2/monitoring/collection-events/opaque-assessment/revisions"]) {
      const response = await page.request.get(path + "?pit_id=pit-01&limit=1");
      expect(response.ok()).toBe(true);
      expect((await response.json() as components["schemas"]["CollectionEventPage"]).items).toEqual([]);
    }
    const old = new Date(Date.now() - 181_000).toISOString();
    await send("assessments", { ...assessment, ...envelope("edge_assessment"), assessment_id: randomUUID(), observed_from: old, observed_to: old });
    await expect(page.locator(".kpi-value")).toHaveText("판단 불가");
    await expect(pastLoad).toHaveText("60%");
    await expect(page.getByLabel("데이터 수신 상태")).toContainText("연결 정상");
    const staleResponse = await page.request.get("/api/v2/monitoring/snapshot?pit_id=pit-01");
    expect(staleResponse.ok()).toBe(true);
    const staleSnapshot = await staleResponse.json() as components["schemas"]["MonitoringSnapshotV2"];
    expect(staleSnapshot.dataState).toBe("STALE");
    const response = await page.request.get("/api/v1/session");
    const session = await response.json() as Session;
    expect((await page.request.delete("/api/v1/session", { headers: { "X-CSRF-Token": session.csrfToken } })).status()).toBe(204);
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get("/api/v2/monitoring/alerts?pit_id=pit-01")).status()).toBe(401);
    expect((await page.request.get("/api/v2/monitoring/load-history?pit_id=pit-01")).status()).toBe(401);
  } finally { await backend.dispose(); }
});

test("실제 날짜 녹화의 session 보호, 공개 HLS 경로와 오늘 녹화의 다운로드 제한", async ({ page, playwright }) => {
  expect((await page.request.get("/api/v2/recordings/daily")).status()).toBe(401);
  const mediaPaths: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/media/daily-recordings/")) mediaPaths.push(path);
  });
  await login(page);
  const response = await page.request.get("/api/v2/recordings/daily");
  expect(response.status()).toBe(200);
  const daily = await response.json() as components["schemas"]["DailyPage"];
  const recording = daily.items.find(item => item.status === "recording" && item.playback_state === "ready");
  if (!recording?.playback_path) throw new Error("Today's synthetic daily HLS is missing.");
  expect(recording.export_allowed).toBe(false);
  expect(recording.download_path).toBeNull();
  expect(recording.recorded_seconds).toBeGreaterThan(0);
  expect(recording.recorded_seconds).toBeLessThan(86_400);
  expect(recording.playback_path).toBe(`/media/daily-recordings/${recording.recording_id}/hls/index.m3u8`);
  const playlistResponse = await page.request.get(recording.playback_path);
  expect(playlistResponse.status()).toBe(200);
  expect(playlistResponse.headers()["cache-control"]).toContain("no-store");
  const playlist = await playlistResponse.text();
  expect(playlist).toContain("#EXTM3U");
  expect(playlist).not.toContain("/api/v2/");
  const segments = playlist.split(/\r?\n/).filter(line => line.startsWith(`/media/daily-recordings/${recording.recording_id}/media/`) && line.endsWith(".ts"));
  expect(segments.length).toBeGreaterThan(0);
  const segment = await page.request.get(segments[0]);
  expect(segment.status()).toBe(200);
  const bytes = await segment.body();
  expect(bytes.length).toBeGreaterThan(188);
  expect(bytes[0]).toBe(0x47);
  const anonymous = await playwright.request.newContext({ baseURL: process.env.SYNC_BASE_URL ?? "http://dashboard:8080" });
  try {
    for (const path of [recording.playback_path, segments[0], `/media/daily-recordings/${recording.recording_id}/content?download=true`]) {
      expect((await anonymous.get(path)).status()).toBe(401);
    }
  } finally { await anonymous.dispose(); }
  expect((await page.request.post(`/api/v2/recordings/daily/${recording.recording_id}/exports`)).status()).toBe(403);
  await page.getByRole("link", { name: "녹화 영상", exact: true }).click();
  await expect(page.locator(".recording-item .recording-type")).toContainText(["날짜 녹화"]);
  const video = page.locator(".recording-frame video");
  await expect.poll(() => video.evaluate(element => (element as unknown as { videoWidth: number }).videoWidth)).toBe(320);
  // metadata preload does not require the browser to buffer playback before play().
  await video.evaluate(element => {
    const player = element as HTMLVideoElement;
    player.muted = true;
    player.dataset.playResult = "pending";
    void player.play().then(() => { player.dataset.playResult = "playing"; }, () => { player.dataset.playResult = "rejected"; });
  });
  await expect.poll(() => video.evaluate(element => {
    const player = element as HTMLVideoElement;
    return { playResult: player.dataset.playResult, advanced: player.currentTime > 0.1, ready: player.readyState >= 3,
      paused: player.paused, seeking: player.seeking, mediaError: player.error?.code ?? null,
      buffered: Array.from({ length: player.buffered.length }, (_, index) => [player.buffered.start(index), player.buffered.end(index)]),
      currentTime: player.currentTime };
  }), { timeout: 15_000 }).toMatchObject({ playResult: "playing", advanced: true, ready: true, paused: false, mediaError: null });
  await video.evaluate(element => (element as unknown as { pause: () => void }).pause());
  await expect(page.getByRole("button", { name: "다운로드 불가", exact: true })).toBeDisabled();
  await expect(page.locator(".recording-download")).toContainText("오늘 녹화는 재생만 가능합니다.");
  await expect(page.locator(".recording-download [role=alert]")).toHaveCount(0);
  expect(mediaPaths.some(path => path.endsWith("/hls/index.m3u8"))).toBe(true);
  expect(mediaPaths.some(path => path.endsWith(".ts"))).toBe(true);
  await page.screenshot({ path: `${screenshots}/recordings-daily-hls.png`, fullPage: true });
});

test("실제 부분 MP4의 nullable metadata, Range, 다운로드와 삭제 후 접근", async ({ page, playwright }) => {
  await login(page);
  await page.goto("/recordings?recordingSource=event");
  await expect(page.getByRole("heading", { name: "녹화 영상", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("부분 저장", { exact: false })).toBeVisible();
  const resolution = page.locator(".recording-info dl > div").filter({ has: page.locator("dt", { hasText: "해상도" }) });
  await expect(resolution).toContainText("정보 없음");
  const cardOverflow = await page.evaluate<number>("Math.max(0, ...[...document.querySelectorAll('.recording-info, .recording-download')].map((element) => element.scrollHeight - element.clientHeight))");
  expect(cardOverflow).toBeLessThanOrEqual(2);
  await expect.poll(() => page.locator(".recording-frame video").evaluate((element) => (element as unknown as { readyState: number }).readyState)).toBeGreaterThanOrEqual(1);
  await page.locator(".recording-frame video").evaluate((element) => (element as unknown as { play: () => Promise<void> }).play());
  await expect.poll(() => page.locator(".recording-frame video").evaluate((element) => (element as unknown as { currentTime: number }).currentTime)).toBeGreaterThan(0.1);
  await page.locator(".recording-frame video").evaluate((element) => (element as unknown as { pause: () => void }).pause());
  const list = await (await page.request.get("/api/v1/recordings?pit_id=pit-01")).json() as RecordingPage;
  const recording = list.items[0];
  expect(recording.coverage).toBe("partial");
  expect(recording.widthPixels).toBeNull();
  expect(recording.contentPath).toBeTruthy();
  const fromTime = Math.floor(Date.parse(recording.startedAt) / 60_000) * 60_000 - 60_000;
  const toTime = Math.ceil(Date.parse(recording.endedAt) / 60_000) * 60_000 + 60_000;
  const inputTime = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
  const queryRecordings = async (category: string, label: string, from = fromTime, to = toTime) => {
    await page.getByRole("textbox", { name: "시작 시각", exact: true }).fill(inputTime(from));
    await page.getByRole("textbox", { name: "종료 시각", exact: true }).fill(inputTime(to));
    await page.getByRole("button", { name: label, exact: true }).click();
    const responsePromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/recordings" && (url.searchParams.get("category") ?? "all") === category;
    });
    await page.getByRole("button", { name: "조회", exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const url = new URL(response.url());
    expect(url.searchParams.get("pit_id")).toBe("pit-01");
    expect(Date.parse(url.searchParams.get("from") ?? "")).toBe(from);
    expect(Date.parse(url.searchParams.get("to") ?? "")).toBe(to);
    const result = await response.json() as RecordingPage;
    expect(result.items.every(item => category === "all" || item.eventCategory === category)).toBe(true);
    expect(result.items.every(item => Date.parse(item.startedAt) < to && Date.parse(item.endedAt) >= from)).toBe(true);
    await expect(page.locator(".recording-item")).toHaveCount(result.items.length);
    return result;
  };
  for (const [category, label] of [["all", "이벤트"], ["collection", "수거"], ["alert", "알림"], ["error", "오류"]]) {
    const filtered = await queryRecordings(category, label);
    if (category === "all" || category === recording.eventCategory) expect(filtered.items.some(item => item.id === recording.id)).toBe(true);
    else expect(filtered.items.some(item => item.id === recording.id)).toBe(false);
  }
  const outsideFrom = fromTime - 24 * 3_600_000;
  expect((await queryRecordings("all", "이벤트", outsideFrom, outsideFrom + 60_000)).items).toEqual([]);
  await expect(page.getByText("조회된 녹화 영상이 없습니다.", { exact: true })).toBeVisible();
  const categoryLabel = { collection: "수거", alert: "알림", error: "오류" }[recording.eventCategory];
  await queryRecordings(recording.eventCategory, categoryLabel);
  await expect(page.locator(".recording-frame video")).toBeVisible();
  const clipPath = `/api/v1/media/clips/${recording.id}`;
  const clipResponse = await page.request.get(clipPath);
  expect(clipResponse.ok()).toBe(true);
  const clip = await clipResponse.json() as components["schemas"]["ClipDetail"];
  expect(clip).toMatchObject({ clip_id: recording.id, camera_id: "camera-main", status: "ready", coverage: "partial" });
  expect(clip.actual_start_at).not.toBeNull();
  expect(clip.actual_end_at).not.toBeNull();
  const coverageResponse = page.waitForResponse((response) => new URL(response.url()).pathname === clipPath && response.request().method() === "GET");
  const coverageButton = page.getByRole("button", { name: "부분 저장", exact: true });
  await coverageButton.click();
  expect((await coverageResponse).ok()).toBe(true);
  const coverageDialog = page.getByRole("dialog", { name: "녹화 범위 상세", exact: true });
  await expect(coverageDialog).toBeVisible();
  for (const [label, value] of [
    ["요청 시작", clip.requested_start_at], ["요청 종료", clip.requested_end_at],
    ["확보 시작", clip.actual_start_at], ["확보 종료", clip.actual_end_at],
  ] as const) {
    await expect(coverageDialog.locator("dl > div").filter({ has: page.locator("dt", { hasText: label }) }).locator("dd")).toHaveText(value ?? "정보 없음");
  }
  await expect(coverageDialog.getByText("구간별 누락 원인은 API에서 제공하지 않습니다.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(coverageDialog).toHaveCount(0);
  await expect(coverageButton).toBeFocused();
  const range = await page.request.get(recording.contentPath ?? "", { headers: { Range: "bytes=0-31" } });
  expect(range.status()).toBe(206);
  expect((await range.body()).length).toBe(32);
  expect(range.headers()["content-range"]).toMatch(/^bytes 0-31\//);
  const invalid = await page.request.get(recording.contentPath ?? "", { headers: { Range: "bytes=999999999999-" } });
  expect(invalid.status()).toBe(416);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll(".recording-info, .recording-download")].map((element) => element.scrollHeight - element.clientHeight)))).toBeLessThanOrEqual(2);
  await page.screenshot({ path: `${screenshots}/recordings-minimum.png`, fullPage: true });
  await page.goto(`/recordings?recordingId=${recording.id}`);
  await expect(page.locator(".recording-frame video")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "녹화 영상 다운로드", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(`${recording.id}.mp4`);
  expect(await download.failure()).toBeNull();
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Downloaded MP4 file is missing.");
  const downloadedBytes = await readFile(downloadPath);
  expect(downloadedBytes.length).toBeGreaterThan(32);
  expect(downloadedBytes.subarray(4, 8).toString("ascii")).toBe("ftyp");
  const fullContent = await page.request.get(recording.contentPath ?? "");
  expect(fullContent.status()).toBe(200);
  expect(downloadedBytes).toEqual(await fullContent.body());
  const admin = await playwright.request.newContext({ baseURL: "http://backend:8000" });
  try {
    const response = await admin.post("/api/v1/session", { data: { username: "admin", password: process.env.SYNC_ADMIN_PASSWORD, persistent: false } });
    const session = await response.json() as Session;
    const deleted = await admin.delete(`/api/v1/media/clips/${recording.id}`, { headers: { "X-CSRF-Token": session.csrfToken } });
    expect(deleted.status()).toBe(204);
    await page.reload();
    await expect(page.locator(".recording-item .status-text")).toContainText("삭제됨");
    await expect(page.locator(".recording-frame video")).toHaveCount(0);
    expect((await page.request.get(recording.contentPath ?? "")).status()).toBe(410);
    await expect(page.getByRole("button", { name: "다운로드 불가", exact: true })).toBeDisabled();
  } finally { await admin.dispose(); }
});
