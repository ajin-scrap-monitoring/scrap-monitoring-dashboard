import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { sessionFixture } from "../src/test/api-contract-fixtures.js";
import { mediaRecordingFixture, monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";

import { installBackendApi } from "./backend-api.js";
import { syntheticMp4 } from "./contract-api.js";
import { syntheticDailyRecording, type DailyRecordingResponse } from "./daily-recording-api.js";

const initial = { ...monitoringV2StateFixture("FRESH", 0), serverTime: "2026-10-13T09:00:00+09:00" };
const cards = (page: Page) => page.locator(".recordings-content .card");
const geometry = (page: Page) => page.locator(".recordings-content .card, .recording-frame").evaluateAll(elements => elements.map(element => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x: x + scrollX, y: y + scrollY, width, height };
}));

test("날짜 녹화는 공개 HLS 경로의 MSE 재생과 확보 구간 및 누락을 구분한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  await page.addInitScript(() => {
    const canPlayType = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "canPlayType")?.value as (this: HTMLMediaElement, type: string) => CanPlayTypeResult;
    HTMLMediaElement.prototype.canPlayType = function (type) {
      return type === "application/vnd.apple.mpegurl" ? "" : canPlayType.call(this, type);
    };
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/recordings?source=api");
  await expect(page.locator(".recording-item")).toHaveCount(1);
  await expect(page.locator(".recording-item .recording-type")).toHaveText("날짜 녹화");
  await expect(page.locator(".recording-item .status-text")).toHaveText("재생 가능");
  await expect(page.locator(".recording-item")).not.toContainText(/부분 녹화|누락 있음/);
  await expect(cards(page)).toHaveCount(5);
  const video = page.locator(".recording-frame video");
  await expect.poll(() => video.evaluate(element => ({ width: (element as HTMLVideoElement).videoWidth, height: (element as HTMLVideoElement).videoHeight }))).toEqual({ width: 320, height: 240 });
  await video.evaluate(element => (element as HTMLVideoElement).play());
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  await video.evaluate(element => (element as HTMLVideoElement).pause());
  const timeline = page.getByRole("region", { name: "날짜 녹화 범위" });
  await expect(timeline).toContainText("부분 저장");
  await expect(timeline).not.toContainText("전체 구간 확보");
  await expect(timeline.getByRole("img", { name: "누락 구간 00:00:01 ~ 00:00:11", exact: true })).toBeVisible();
  await expect(timeline.getByRole("button", { name: /^누락 구간/ })).toHaveCount(0);
  const laterInterval = timeline.getByRole("button", { name: "확보 구간 00:00:11 ~ 00:00:12, 재생", exact: true });
  await laterInterval.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".recorded-time")).toContainText("00:00:11");
  expect(api.requests.some(url => url.pathname === "/api/v1/recordings")).toBe(false);
  expect(api.daily.mediaRequests.some(request => request.url().endsWith("/hls/index.m3u8"))).toBe(true);
  expect(api.daily.mediaRequests.filter(request => request.url().endsWith(".ts")).length).toBeGreaterThanOrEqual(1);
  expect(api.daily.mediaRequests.every(request => new URL(request.url()).pathname.startsWith(`/media/daily-recordings/${syntheticDailyRecording.recording_id}/`))).toBe(true);
  expect(errors).toEqual([]);
});

test("날짜 범위를 한국 날짜의 종료일 포함 조건으로 전송하고 이벤트 목록과 분리한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  api.setRecordings([{ ...mediaRecordingFixture, startedAt: "2026-10-12T01:00:00+09:00", endedAt: "2026-10-12T01:01:00+09:00" }]);
  await page.goto("/recordings?source=api");
  await expect(page.locator(".recording-item .recording-type")).toHaveText("날짜 녹화");
  await page.getByRole("textbox", { name: "시작 시각", exact: true }).fill("2026-10-11 12:00");
  await page.getByRole("textbox", { name: "종료 시각", exact: true }).fill("2026-10-12 12:00");
  const dailyResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v2/recordings/daily");
  await page.getByRole("button", { name: "조회", exact: true }).click();
  const query = new URL((await dailyResponse).url()).searchParams;
  expect(query.get("from_date")).toBe("2026-10-11");
  expect(query.get("to_date")).toBe("2026-10-13");
  expect(query.has("pit_id")).toBe(false);
  expect(query.has("camera_id")).toBe(false);
  expect(query.has("category")).toBe(false);
  await expect(page.locator(".recording-item")).toHaveCount(1);
  await page.getByRole("button", { name: "이벤트", exact: true }).click();
  const eventResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/recordings");
  await page.getByRole("button", { name: "조회", exact: true }).click();
  expect((await eventResponse).status()).toBe(200);
  await expect(page.locator(".recording-item .recording-type")).not.toHaveText("날짜 녹화");
  await expect(page.getByRole("region", { name: "날짜 녹화 범위" })).toHaveCount(0);
  await page.getByRole("button", { name: "날짜", exact: true }).click();
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(page.locator(".recording-item .recording-type")).toHaveText("날짜 녹화");
});

test("지난 날짜의 MP4는 session과 CSRF로 준비한 뒤 완료 조회 후 다운로드한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  await page.route("**/api/v1/session", route => route.fulfill({ json: { ...sessionFixture, user: { ...sessionFixture.user, role: "viewer" } } }));
  await page.context().addCookies([{ name: "synthetic_session", value: "public-browser-fixture", url: "http://127.0.0.1:4173", httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/recordings?source=api");
  const prepare = page.getByRole("button", { name: "MP4 다운로드 준비", exact: true });
  await expect(prepare).toBeEnabled();
  await expect(page.getByRole("button", { name: "녹화 영상 다운로드", exact: true })).toHaveCount(0);
  const exportResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/exports"));
  await prepare.click();
  const response = await exportResponse;
  expect(response.status()).toBe(202);
  const headers = await response.request().allHeaders();
  expect(headers["x-csrf-token"]).toBe(sessionFixture.csrfToken);
  expect(headers.cookie).toContain("synthetic_session=public-browser-fixture");
  await expect(page.getByRole("button", { name: "다운로드 준비 중", exact: true })).toBeDisabled();
  const downloadButton = page.getByRole("button", { name: "녹화 영상 다운로드", exact: true });
  await expect(downloadButton).toBeEnabled();
  expect(api.daily.requests.filter(request => request.method() === "POST")).toHaveLength(1);
  expect(api.daily.requests.filter(request => request.method() === "GET" && new URL(request.url()).pathname.endsWith(syntheticDailyRecording.recording_id)).length).toBeGreaterThanOrEqual(4);
  await page.evaluate(() => {
    const click = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "click")?.value as (this: HTMLElement) => void;
    HTMLAnchorElement.prototype.click = function () {
      document.documentElement.dataset.requestedDownload = this.download;
      // Chromium browser-managed downloads bypass Playwright request routing.
      this.removeAttribute("download");
      click.call(this);
    };
  });
  const downloadEvent = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  expect(await page.locator("html").getAttribute("data-requested-download")).toBe("2026-10-12.mp4");
  const path = await download.path();
  if (!path) throw new Error("Synthetic daily MP4 download is missing.");
  expect(await readFile(path)).toEqual(syntheticMp4);
  expect(api.daily.mediaRequests.some(request => new URL(request.url()).pathname.endsWith("/content") && new URL(request.url()).searchParams.get("download") === "true")).toBe(true);
});

test("오늘 녹화는 재생을 유지하고 다운로드 불가를 장애로 표시하지 않는다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  api.daily.setRecordings([{ ...syntheticDailyRecording, recording_date: "2026-10-13", window_start_at: "2026-10-12T15:00:00Z", window_end_at: "2026-10-13T15:00:00Z", status: "recording", export_allowed: false,
    coverage_as_of_at: "2026-10-12T15:00:12Z", playable_until_at: "2026-10-12T15:00:12Z",
    gaps: [{ start_at: "2026-10-12T15:00:01Z", end_at: "2026-10-12T15:00:11Z", reason_code: "CAMERA_DISCONNECTED" }],
    available_intervals: syntheticDailyRecording.available_intervals.map(interval => ({ ...interval, start_at: interval.start_at.replace("11T", "12T"), end_at: interval.end_at.replace("11T", "12T") })),
  }]);
  await page.goto("/recordings?source=api");
  await expect(page.locator(".recording-item .status-text")).toHaveText("녹화 중");
  await expect(page.locator(".recording-frame video")).toBeVisible();
  await expect(page.getByRole("button", { name: "다운로드 불가", exact: true })).toBeDisabled();
  await expect(page.locator(".recording-download")).toContainText("오늘 녹화는 재생만 가능합니다.");
  await expect(page.locator(".recording-download [role=alert]")).toHaveCount(0);
  expect(api.daily.requests.some(request => request.method() === "POST")).toBe(false);
});

test("날짜 녹화의 마감 처리와 실패 및 만료는 같은 카드 배치에서 구분한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  let before: Awaited<ReturnType<typeof geometry>> | undefined;
  for (const [status, label] of [["finalizing", "녹화 정리 중"], ["failed", "녹화 실패"], ["expired", "보관 만료"]] as const) {
    api.daily.setRecordings([{ ...syntheticDailyRecording, status, playback_state: status === "finalizing" ? "pending" : "unavailable", playback_protocol: null, playback_path: null, export_allowed: false }]);
    await page.goto("/recordings?source=api");
    await expect(page.locator(".recording-item .status-text")).toContainText(label);
    await expect(cards(page)).toHaveCount(5);
    await expect(page.locator(".recording-frame video")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "다운로드 불가", exact: true })).toBeDisabled();
    await page.evaluate(() => document.fonts.ready);
    const current = await geometry(page);
    if (before) expect(current).toEqual(before);
    before = current;
  }
  expect(api.daily.requests.some(request => request.method() === "POST")).toBe(false);
});

test("목록 조회 실패와 빈 결과는 기존 카드와 영상 프레임의 배치를 유지한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  await page.goto("/recordings?source=api");
  await expect(page.locator(".recording-frame video")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const before = await geometry(page);
  api.daily.failList(true);
  const failed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v2/recordings/daily" && response.status() === 503);
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await failed;
  await expect(page.getByRole("button", { name: "조회", exact: true })).toBeEnabled();
  await expect(page.locator(".recording-item")).toHaveCount(1);
  await expect(page.getByText("녹화 영상을 조회하지 못했습니다.", { exact: false })).toHaveCount(0);
  expect(await geometry(page)).toEqual(before);
  api.daily.failList(false);
  api.daily.setRecordings([]);
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(page.locator(".recording-item")).toHaveCount(0);
  await expect(cards(page)).toHaveCount(5);
  await expect(page.locator(".recording-info dl")).toContainText("정보 없음");
  await expect(page.getByRole("button", { name: "다운로드 불가", exact: true })).toBeDisabled();
  expect(await geometry(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("MP4 비동기 준비 실패는 재진입 후에도 구분하고 HLS 재생과 기존 배치를 유지한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  const id = syntheticDailyRecording.recording_id;
  const code = `2_${"A".repeat(98)}`;
  const failed: DailyRecordingResponse = { ...syntheticDailyRecording, export_state: "failed", error: { code, message: "PRIVATE_EXPORT_DETAILS" } };
  let requested = false;
  let polls = 0;
  await page.route(`**/api/v2/recordings/daily/${id}/exports`, route => {
    requested = true;
    return route.fulfill({ status: 202, json: { ...syntheticDailyRecording, export_state: "processing" } });
  });
  await page.route(`**/api/v2/recordings/daily/${id}`, route => {
    if (!requested) return route.fallback();
    if (++polls < 2) return route.fulfill({ json: { ...syntheticDailyRecording, export_state: "processing" } });
    api.daily.setRecordings([failed]);
    return route.fulfill({ json: failed });
  });
  await page.goto("/recordings?source=api");
  const video = page.locator(".recording-frame video");
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBe(320);
  await page.evaluate(() => document.fonts.ready);
  const before = await geometry(page);
  await page.getByRole("button", { name: "MP4 다운로드 준비", exact: true }).click();
  await expect(page.getByRole("button", { name: "다운로드 준비 중", exact: true })).toBeDisabled();
  const assertFailure = async () => {
    await expect(page.locator(".recording-download [role=alert]")).toContainText("MP4 파일 준비에 실패했습니다.");
    await expect(page.locator(".recording-download [role=alert]")).toHaveAttribute("title", `오류 코드: ${code}`);
    await expect(page.getByRole("button", { name: "MP4 다운로드 준비", exact: true })).toBeEnabled();
    await expect(page.locator(".recording-item .status-text")).toHaveText("재생 가능");
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBe(320);
    await video.evaluate(element => (element as HTMLVideoElement).play());
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
    await video.evaluate(element => (element as HTMLVideoElement).pause());
    await page.getByRole("button", { name: "MP4 준비 실패 상세", exact: true }).click();
    const popover = page.getByRole("dialog", { name: "녹화 상태 상세" });
    await expect(popover).toContainText("MP4 다운로드 파일을 준비하지 못했습니다.");
    await expect(popover.getByText(code, { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("PRIVATE_EXPORT_DETAILS");
    await page.keyboard.press("Escape");
    expect(await geometry(page)).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  };
  await assertFailure();
  await page.reload();
  await assertFailure();
});
