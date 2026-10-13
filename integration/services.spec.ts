import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import type { components } from "../src/generated/backend-contract.js";
import { extractBackendContract, readManifest, type Json } from "../scripts/backend-contract.ts";

type Session = components["schemas"]["Session"];
type RecordingPage = components["schemas"]["RecordingPage"];
const screenshots = `${process.env.SYNC_RUN_DIRECTORY ?? "test-results/integration"}/private/screenshots`;

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
  await expect(page.getByText("FILL_METHOD_NOT_IMPLEMENTED", { exact: true })).toBeVisible();
  await expect(page.getByText("MEASUREMENT_UNAVAILABLE", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(image).toBeVisible();
  await page.screenshot({ path: `${screenshots}/monitoring-v2.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "실시간 영상 크게 보기" }).click();
  const close = page.getByRole("button", { name: "닫기", exact: true });
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

test("실제 v2 수신 API와 SSE에서 0%, STALE, session 종료 처리", async ({ page, playwright }) => {
  const backend = await playwright.request.newContext({ baseURL: "http://backend:8000" });
  const now = new Date().toISOString();
  const envelope = (message_type: string) => ({ schema_version: "2.0", message_type, message_id: randomUUID(), site_id: "site-demo", edge_id: "edge-demo", generated_at: new Date().toISOString(), config_revision: "synthetic-config-1" });
  const status = {
    ...envelope("edge_status"), orchestrator_instance_id: "synthetic-browser-case", sequence: 1, overall_state: "HEALTHY", reason_codes: [], clock: { state: "SYNCED", offset_ms: 0 },
    sensors: ["lidar-a", "lidar-b"].map((sensor_id) => ({ sensor_id, data_state: "FRESH", last_scan_at: now, reason_codes: [] })), services: [],
    delivery: { pending_messages: 0, pending_bytes: 0, quarantined_messages: 0, last_backend_ack_at: null },
    storage: { limit_bytes: 4096, used_bytes: 0, lost_messages: 0, loss_from: null, loss_to: null, last_loss_reason: null, unavailable_evidence_scan_ids: [] },
  };
  const send = async (endpoint: string, payload: { message_id: string } & Record<string, unknown>) => {
    const response = await backend.post("/api/edge/v2/" + endpoint, { data: payload, headers: { Authorization: "Bearer " + (process.env.SYNC_EDGE_TOKEN ?? ""), "Idempotency-Key": payload.message_id } });
    expect(response.ok()).toBe(true);
  };
  try {
    await send("status", status);
    await login(page);
    const assessment = {
      ...envelope("edge_assessment"), assessment_type: "STATE", assessment_id: randomUUID(), revision: 1,
      observed_from: now, observed_to: now, rule_version: "synthetic-browser-rule", decision_state: "AVAILABLE", reason_codes: [], fill_state: "SYNTHETIC_ZERO",
      fill_estimate: { ratio: 0, method_version: "synthetic-browser-method" }, event: null,
      capabilities: { fill: "ENABLED", occlusion: "NOT_IMPLEMENTED", collection: "NOT_IMPLEMENTED", vision: "NOT_IMPLEMENTED" }, evidence: { scans: [], vision_observations: [] },
    };
    await send("assessments", assessment);
    await expect(page.locator(".kpi-value")).toHaveText("0%");
    const old = new Date(Date.now() - 181_000).toISOString();
    await send("assessments", { ...assessment, ...envelope("edge_assessment"), assessment_id: randomUUID(), observed_from: old, observed_to: old });
    await expect(page.getByText("관측 기한 초과", { exact: true })).toBeVisible();
    await expect(page.locator(".kpi-value")).toHaveText("판단 불가");
    const response = await page.request.get("/api/v1/session");
    const session = await response.json() as Session;
    expect((await page.request.delete("/api/v1/session", { headers: { "X-CSRF-Token": session.csrfToken } })).status()).toBe(204);
    await expect(page).toHaveURL(/\/login$/);
  } finally { await backend.dispose(); }
});

test("실제 부분 MP4의 nullable metadata, Range, 다운로드와 삭제 후 접근", async ({ page, playwright }) => {
  await login(page);
  await page.getByRole("link", { name: "녹화 영상", exact: true }).click();
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
  const admin = await playwright.request.newContext({ baseURL: "http://backend:8000" });
  try {
    const response = await admin.post("/api/v1/session", { data: { username: "admin", password: process.env.SYNC_ADMIN_PASSWORD, persistent: false } });
    const session = await response.json() as Session;
    const deleted = await admin.delete(`/api/v1/media/clips/${recording.id}`, { headers: { "X-CSRF-Token": session.csrfToken } });
    expect(deleted.status()).toBe(204);
    await page.getByRole("button", { name: "녹화 정보 새로고침" }).click();
    await expect(page.locator(".recording-item .status-text")).toContainText("삭제됨");
    await expect(page.locator(".recording-frame video")).toHaveCount(0);
    expect((await page.request.get(recording.contentPath ?? "")).status()).toBe(410);
    await expect(page.getByRole("button", { name: "다운로드 불가", exact: true })).toBeDisabled();
  } finally { await admin.dispose(); }
});
