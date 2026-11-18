import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { sessionFixture } from "../src/test/api-contract-fixtures.js";
import { monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";

import { installBackendApi, syntheticEventReplay } from "./backend-api.js";
import { syntheticMp4 } from "./contract-api.js";
import { syntheticDailyRecording, type DailyRecordingResponse } from "./daily-recording-api.js";

const initial = { ...monitoringV2StateFixture("FRESH", 0), serverTime: "2026-10-13T09:00:00+09:00" };
const cards = (page: Page) => page.locator(".recordings-content .card");
const geometry = (page: Page) => page.locator(".recordings-content .card, .recording-frame").evaluateAll(elements => elements.map(element => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x: x + scrollX, y: y + scrollY, width, height };
}));

test("많은 날짜 녹화 구간에서도 시간축과 카드 배치를 유지하고 재생 갱신에 같은 표시를 재사용한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  await page.goto("/recordings?source=api");
  await expect(page.locator(".recording-frame video")).toBeVisible();
  const before = await geometry(page);
  const start = Date.parse(syntheticDailyRecording.window_start_at);
  const at = (seconds: number) => new Date(start + seconds * 1000).toISOString();
  const count = 100;
  api.daily.setRecordings([{ ...syntheticDailyRecording, recorded_seconds: count,
    playable_until_at: at((count - 1) * 4 + 1),
    available_intervals: Array.from({ length: count }, (_, index) => ({ start_at: at(index * 4), end_at: at(index * 4 + 1), playback_start_seconds: index, playback_end_seconds: index + 1 })),
    gaps: Array.from({ length: count }, (_, index) => ({ start_at: at(index * 4 + 2), end_at: at(index * 4 + 3), reason_code: "SYNTHETIC_GAP" })),
  }]);
  await page.getByRole("button", { name: "조회", exact: true }).click();
  const timeline = page.locator(".daily-recording-timeline-track");
  await expect(timeline.locator("svg")).toHaveCount(1);
  expect(await timeline.locator("*").count()).toBeLessThan(10);
  expect(await timeline.locator("path.daily-recording-range-available").getAttribute("d").then(value => value?.match(/M/g)?.length)).toBe(count);
  expect(await timeline.locator("path.daily-recording-range-gap").getAttribute("d").then(value => value?.match(/M/g)?.length)).toBe(count);
  await expect(timeline.locator("path.daily-recording-range-available")).toHaveCSS("fill", "rgb(11, 165, 143)");
  await expect(timeline.locator("path.daily-recording-range-gap")).toHaveCSS("fill", "rgb(216, 86, 86)");
  await timeline.evaluate(element => {
    element.setAttribute("data-mutations", "0");
    new MutationObserver(records => element.setAttribute("data-mutations", String(Number(element.getAttribute("data-mutations")) + records.length)))
      .observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["d", "class", "style"] });
  });
  await page.locator(".recording-frame video").evaluate(element => {
    const video = element as HTMLVideoElement;
    for (let index = 0; index < 30; index += 1) { video.currentTime = index % 2; video.dispatchEvent(new Event("timeupdate")); }
  });
  await expect(timeline).toHaveAttribute("data-mutations", "0");
  expect(await geometry(page)).toEqual(before);
  const seek = timeline.getByRole("button", { name: /방향키로 확보 구간 선택/ });
  await seek.focus();
  await page.keyboard.press("End");
  await expect(seek).toHaveAccessibleName(/^확보 구간 00:06:36 ~ 00:06:37/);
  await page.keyboard.press("Home");
  await expect(seek).toHaveAccessibleName(/^확보 구간 00:00:00 ~ 00:00:01/);
  await page.keyboard.press("Enter");
  await expect(page.locator(".recorded-time")).toContainText("00:00:00");
});

test("날짜 녹화 단건 조회의 일시적인 실패는 같은 player로 자동 복구한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  api.daily.setRecordings([{ ...syntheticDailyRecording, recording_date: "2026-10-13", window_start_at: "2026-10-12T15:00:00Z", window_end_at: "2026-10-13T15:00:00Z", status: "recording", export_allowed: false,
    coverage_as_of_at: "2026-10-12T15:00:12Z", playable_until_at: "2026-10-12T15:00:12Z",
    gaps: [{ start_at: "2026-10-12T15:00:01Z", end_at: "2026-10-12T15:00:11Z", reason_code: "CAMERA_DISCONNECTED" }],
    available_intervals: syntheticDailyRecording.available_intervals.map(interval => ({ ...interval, start_at: interval.start_at.replace("11T", "12T"), end_at: interval.end_at.replace("11T", "12T") })),
  }]);
  let requests = 0;
  await page.route(`**/api/v2/recordings/daily/${syntheticDailyRecording.recording_id}/summary`, route => {
    requests += 1;
    return requests === 3 ? route.fulfill({ status: 503, json: { detail: "Synthetic temporary failure" } }) : route.fallback();
  });
  await page.goto("/recordings?source=api");
  const video = page.locator(".recording-frame video");
  await expect(video).toBeVisible();
  await video.evaluate(element => element.setAttribute("data-recovery-player", "confirmed"));
  const before = await geometry(page);
  await expect(page.getByRole("button", { name: "확인 실패 상세", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(video).toHaveAttribute("data-recovery-player", "confirmed");
  await expect(page.getByRole("button", { name: "확인 실패 상세", exact: true })).toHaveCount(0, { timeout: 10_000 });
  expect(requests).toBeGreaterThanOrEqual(4);
  await expect(video).toHaveAttribute("data-recovery-player", "confirmed");
  expect(await geometry(page)).toEqual(before);
  expect(api.daily.requests.some(request => request.method() === "POST")).toBe(false);
});

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
  expect(api.requests.some(url => url.pathname === "/api/v2/recordings/events")).toBe(false);
  expect(api.daily.mediaRequests.some(request => request.url().endsWith("/hls/index.m3u8"))).toBe(true);
  expect(api.daily.mediaRequests.filter(request => request.url().endsWith(".ts")).length).toBeGreaterThanOrEqual(1);
  expect(api.daily.mediaRequests.every(request => new URL(request.url()).pathname.startsWith(`/media/daily-recordings/${syntheticDailyRecording.recording_id}/`))).toBe(true);
  expect(errors).toEqual([]);
});

test("녹화 중인 긴 EVENT playlist는 최신 구간이 아니라 첫 segment에서 재생한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  const recording: DailyRecordingResponse = { ...syntheticDailyRecording, recording_date: "2026-10-13", status: "recording", export_allowed: false,
    window_start_at: "2026-10-12T15:00:00Z", window_end_at: "2026-10-13T15:00:00Z",
    coverage_as_of_at: "2026-10-12T15:00:40Z", playable_until_at: "2026-10-12T15:00:40Z",
    recorded_seconds: 40, gaps: [], has_gaps: false,
    available_intervals: [{ start_at: "2026-10-12T15:00:00Z", end_at: "2026-10-12T15:00:40Z", playback_start_seconds: 0, playback_end_seconds: 40 }],
  };
  api.daily.setRecordings([recording]);
  const prefix = `/media/daily-recordings/${recording.recording_id}/media`;
  const segments = Array.from({ length: 40 }, (_, index) => `#EXTINF:1.000,\n${prefix}/segment-${index}.ts`);
  await page.route("**/media/daily-recordings/*/hls/index.m3u8", route => route.fulfill({
    contentType: "application/vnd.apple.mpegurl",
    body: `#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-PLAYLIST-TYPE:EVENT\n${segments.join("\n#EXT-X-DISCONTINUITY\n")}\n`,
  }));
  await page.goto("/recordings?source=api");
  const video = page.locator(".recording-frame video");
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBe(320);
  const requested = api.daily.mediaRequests.filter(request => request.url().endsWith(".ts"));
  expect(new URL(requested[0].url()).pathname).toBe(`${prefix}/segment-0.ts`);
  await video.evaluate(element => { const player = element as HTMLVideoElement; player.muted = true; return player.play(); });
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  await video.evaluate(element => (element as HTMLVideoElement).pause());
  expect(await video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeLessThan(5);
});

test("날짜 범위를 한국 날짜로 조회하고 전체와 유형 필터를 구분한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  api.setEventReplays([syntheticEventReplay({}, { windowFrom: "2026-10-11T16:00:00Z", windowTo: "2026-10-11T16:01:00Z", occurredAt: "2026-10-11T16:00:00Z" })]);
  await page.goto("/recordings?source=api");
  await expect(page.locator(".recording-item .recording-type")).toHaveText("날짜 녹화");
  await page.getByRole("textbox", { name: "시작 시각", exact: true }).fill("2026-10-11 12:00");
  await page.getByRole("textbox", { name: "종료 시각", exact: true }).fill("2026-10-12 12:00");
  const dailyResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v2/recordings/daily/summary");
  await page.getByRole("button", { name: "조회", exact: true }).click();
  const query = new URL((await dailyResponse).url()).searchParams;
  expect(query.get("from_date")).toBe("2026-10-11");
  expect(query.get("to_date")).toBe("2026-10-13");
  expect(query.has("pit_id")).toBe(false);
  expect(query.has("camera_id")).toBe(false);
  expect(query.has("category")).toBe(false);
  await expect(page.locator(".recording-item")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "이벤트", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "전체", exact: true }).click();
  const eventResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v2/recordings/events");
  await page.getByRole("button", { name: "조회", exact: true }).click();
  expect((await eventResponse).status()).toBe(200);
  await expect(page.locator(".recording-item")).toHaveCount(2);
  await expect(page.locator(".recording-item .recording-type")).toHaveText(["알림", "날짜 녹화"]);
  const allGeometry = await geometry(page);
  await page.getByRole("button", { name: "알림", exact: true }).click();
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(page.locator(".recording-item")).toHaveCount(1);
  await expect(page.locator(".recording-item .recording-type")).not.toHaveText("날짜 녹화");
  await expect(page.getByRole("region", { name: "날짜 녹화 범위" })).toHaveCount(0);
  expect(await geometry(page)).toEqual(allGeometry);
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
  expect(api.daily.requests.filter(request => request.method() === "GET" && new URL(request.url()).pathname.endsWith(`${syntheticDailyRecording.recording_id}/summary`)).length).toBeGreaterThanOrEqual(4);
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
  const failed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v2/recordings/daily/summary" && response.status() === 503);
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await failed;
  await expect(page.getByRole("button", { name: "조회", exact: true })).toBeEnabled();
  await expect(page.locator(".recording-item")).toHaveCount(1);
  const queryAlert = page.locator(".recordings-query-head").getByRole("alert");
  await expect(queryAlert).toHaveText("녹화 영상을 조회하지 못했습니다. 기존 조회 결과를 유지합니다.");
  expect(await geometry(page)).toEqual(before);
  api.daily.failList(false);
  api.daily.setRecordings([]);
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(queryAlert).toHaveCount(0);
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
  await page.route(`**/api/v2/recordings/daily/${id}/summary`, route => {
    if (!requested) return route.fallback();
    const base = Object.fromEntries(
      Object.entries(syntheticDailyRecording).filter(([key]) => key !== "available_intervals" && key !== "gaps"),
    );
    if (++polls < 2) {
      return route.fulfill({ json: { ...base, view: "metadata", revision: 1, export_state: "processing" } });
    }
    api.daily.setRecordings([failed]);
    return route.fallback();
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

test("관리자의 날짜 녹화 삭제는 확인창 뒤에 CSRF와 함께 요청하고 카드 배치를 유지한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  await page.goto("/recordings?source=api");
  await expect(page.locator(".recording-frame video")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const before = await geometry(page);
  const remove = page.getByRole("button", { name: "날짜 녹화 삭제", exact: true });
  await expect(remove).toBeVisible();
  if (page.viewportSize()?.height === 1080) await expect(remove).toBeInViewport();
  const del = () => api.daily.requests.filter(request => request.method() === "DELETE");
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "날짜 녹화 삭제", exact: true });
  await expect(dialog).toContainText("이벤트 구간도 재생할 수 없게 됩니다");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(del()).toHaveLength(0);
  api.daily.conflictOnDelete(true);
  await remove.click();
  await dialog.getByRole("button", { name: "영구 삭제", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("삭제할 수 없습니다");
  expect(del()).toHaveLength(1);
  api.daily.conflictOnDelete(false);
  await dialog.getByRole("button", { name: "영구 삭제", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(del()).toHaveLength(2);
  expect(await del()[1].allHeaders()).toMatchObject({ "x-csrf-token": sessionFixture.csrfToken });
  await expect(page.locator(".recording-item")).toHaveCount(0);
  await expect(page.getByText("날짜 녹화를 삭제했습니다.", { exact: false })).toBeVisible();
  expect(await geometry(page)).toEqual(before);
});

test("조회 사용자에게는 날짜 녹화 삭제를 표시하지 않는다", async ({ page }) => {
  await installBackendApi(page, { initial });
  await page.route("**/api/v1/session", route => route.fulfill({ json: { ...sessionFixture, user: { ...sessionFixture.user, role: "viewer" } } }));
  await page.goto("/recordings?source=api");
  await expect(page.locator(".recording-frame video")).toBeVisible();
  await expect(page.getByRole("button", { name: "날짜 녹화 삭제" })).toHaveCount(0);
});

test("날짜 영상 확대 창은 Tab으로 영상 내부 controls에 이동하며 modal 밖으로 나가지 않고 영상에서도 Escape로 닫는다", async ({ page }) => {
  await installBackendApi(page, { initial });
  await page.addInitScript(() => {
    const canPlayType = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "canPlayType")?.value as (this: HTMLMediaElement, type: string) => CanPlayTypeResult;
    HTMLMediaElement.prototype.canPlayType = function (type) {
      return type === "application/vnd.apple.mpegurl" ? "" : canPlayType.call(this, type);
    };
  });
  await page.goto("/recordings?source=api");
  const opener = page.getByRole("button", { name: "녹화 영상 크게 보기" });
  await expect(opener).toBeVisible();
  const baseVideo = page.locator(".recording-frame video");
  await expect(baseVideo).toHaveAttribute("controlsList", "nofullscreen");
  await expect.poll(() => baseVideo.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
  await baseVideo.dblclick();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "녹화 영상 크게 보기" });
  const close = dialog.getByRole("button", { name: "녹화 영상 닫기" });
  const video = dialog.locator("video");
  await expect(video).toHaveAttribute("controlsList", "nofullscreen");
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(video).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).not.toBeFocused();
  await expect(video).toBeFocused();
  const outside = [];
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    // native controls의 끝에서 focus가 브라우저 UI로 나가면 activeElement는 body이며, 다음 Tab이 창 안으로 되돌린다.
    outside.push(await page.evaluate(() => document.activeElement !== document.body && !document.querySelector(".video-modal")?.contains(document.activeElement)));
  }
  expect(outside).not.toContain(true);
  await expect(dialog).toBeVisible();
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(video).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.press("Enter");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("날짜 녹화는 summary 목록과 metadata summary 및 cursor interval endpoint로 timeline을 표시한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  await page.goto("/recordings?source=api");
  await expect(page.locator(".recording-frame video")).toBeVisible();

  const summaryListRequests = api.daily.requests.filter(req => {
    const url = new URL(req.url());
    return req.method() === "GET" && url.pathname === "/api/v2/recordings/daily/summary";
  });
  expect(summaryListRequests.length).toBeGreaterThan(0);
  expect(new URL(summaryListRequests[0].url()).searchParams.has("view")).toBe(false);

  const summaryDetailRequests = api.daily.requests.filter(req => {
    const url = new URL(req.url());
    return req.method() === "GET" && url.pathname === `/api/v2/recordings/daily/${syntheticDailyRecording.recording_id}/summary`;
  });
  expect(summaryDetailRequests.length).toBeGreaterThan(0);

  const gapRequests = api.daily.requests.filter(req => {
    const url = new URL(req.url());
    return req.method() === "GET" && url.pathname === `/api/v2/recordings/daily/${syntheticDailyRecording.recording_id}/gaps`;
  });
  const intervalRequests = api.daily.requests.filter(req => {
    const url = new URL(req.url());
    return req.method() === "GET" && url.pathname === `/api/v2/recordings/daily/${syntheticDailyRecording.recording_id}/available-intervals`;
  });
  expect(gapRequests.length).toBeGreaterThan(0);
  expect(intervalRequests.length).toBeGreaterThan(0);

  const legacyRequests = api.daily.requests.filter(req => {
    const url = new URL(req.url());
    return req.method() === "GET" && (
      url.pathname === "/api/v2/recordings/daily" ||
      url.pathname === `/api/v2/recordings/daily/${syntheticDailyRecording.recording_id}`
    );
  });
  expect(legacyRequests).toHaveLength(0);

  const timeline = page.getByRole("region", { name: "날짜 녹화 범위" });
  await expect(timeline).toBeVisible();
  await expect(timeline).toContainText("부분 저장");
  await expect(timeline.getByRole("img", { name: "누락 구간 00:00:01 ~ 00:00:11", exact: true })).toBeVisible();
});

function pagedDailyRecording(
  id: string,
  recordingDate: string,
  windowStartAt: string,
  windowEndAt: string,
  count: number,
): DailyRecordingResponse {
  const start = Date.parse(windowStartAt);
  const at = (seconds: number) => new Date(start + seconds * 1000).toISOString();
  return {
    ...syntheticDailyRecording,
    recording_id: id,
    recording_date: recordingDate,
    window_start_at: windowStartAt,
    window_end_at: windowEndAt,
    coverage_as_of_at: windowEndAt,
    playback_path: `/media/daily-recordings/${id}/hls/index.m3u8`,
    recorded_seconds: count,
    playable_until_at: at((count - 1) * 4 + 1),
    available_intervals: Array.from({ length: count }, (_, index) => ({
      start_at: at(index * 4),
      end_at: at(index * 4 + 1),
      playback_start_seconds: index,
      playback_end_seconds: index + 1,
    })),
    gaps: Array.from({ length: count }, (_, index) => ({
      start_at: at(index * 4 + 2),
      end_at: at(index * 4 + 3),
      reason_code: "SYNTHETIC_GAP",
    })),
  };
}

test("날짜 녹화는 구간 페이지 cursor를 한 페이지씩 이전과 다음으로 이동하고 미확인 실제 시각과 누락 구간 dialog를 표시한다", async ({ page }) => {
  const rec = pagedDailyRecording(
    syntheticDailyRecording.recording_id,
    syntheticDailyRecording.recording_date,
    syntheticDailyRecording.window_start_at,
    syntheticDailyRecording.window_end_at,
    105,
  );
  const api = await installBackendApi(page, { initial });
  api.daily.setRecordings([rec]);
  await page.goto("/recordings?source=api");
  await expect(page.locator(".recording-frame video")).toBeVisible();
  await expect(page.locator(".recorded-time")).toContainText("00:00:00");

  const availableRequests = () => api.daily.requests.filter(req =>
    req.method() === "GET" && new URL(req.url()).pathname === `/api/v2/recordings/daily/${rec.recording_id}/available-intervals`,
  );
  const gapRequests = () => api.daily.requests.filter(req =>
    req.method() === "GET" && new URL(req.url()).pathname === `/api/v2/recordings/daily/${rec.recording_id}/gaps`,
  );

  // 초기 적재에서는 page 1만 조회하고 전체 page prefetch를 수행하지 않는다.
  expect(availableRequests()).toHaveLength(1);
  expect(gapRequests()).toHaveLength(1);

  const timeline = page.getByRole("region", { name: "날짜 녹화 범위" });
  const prevButton = timeline.getByRole("button", { name: "이전", exact: true });
  const nextButton = timeline.getByRole("button", { name: "다음", exact: true });
  await expect(prevButton).toBeDisabled();
  await expect(nextButton).toBeEnabled();

  await nextButton.click();
  await expect(prevButton).toBeEnabled();
  await expect(nextButton).toBeDisabled();
  await expect(page.locator(".recorded-time")).toContainText("실제 시각 미확인");
  await expect(timeline).toContainText("확보 여부 미확인 구간");
  expect(availableRequests()).toHaveLength(2);
  expect(new URL(availableRequests()[1].url()).searchParams.get("cursor")).toBeTruthy();
  expect(new URL(gapRequests()[1].url()).searchParams.get("cursor")).toBeTruthy();

  const assertCardBounds = async () => {
    const overflows = await page.locator(".recording-info, .recording-download").evaluateAll(elements =>
      elements.map(el => el.scrollHeight - el.clientHeight),
    );
    expect(overflows.every(value => value <= 2)).toBe(true);
    const horizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(2);
  };

  await assertCardBounds();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await assertCardBounds();
  await page.setViewportSize({ width: 1280, height: 900 });
  await assertCardBounds();

  await prevButton.click();
  await expect(prevButton).toBeDisabled();
  await expect(nextButton).toBeEnabled();
  await expect(page.locator(".recorded-time")).toContainText("00:00:00");

  await page.getByRole("button", { name: "누락 구간", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "녹화 범위 상세" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("105");
  await expect(dialog).toContainText("2026-10-12 00:00:02 ~ 2026-10-12 00:00:03");

  const dialogPrev = dialog.getByRole("button", { name: "이전", exact: true });
  const dialogNext = dialog.getByRole("button", { name: "다음", exact: true });
  await expect(dialogPrev).toBeDisabled();
  await expect(dialogNext).toBeEnabled();

  await dialogNext.click();
  await expect(dialogPrev).toBeEnabled();
  await expect(dialogNext).toBeDisabled();
  await expect(dialog).toContainText("2026-10-12 00:06:42 ~ 2026-10-12 00:06:43");

  await dialogPrev.click();
  await expect(dialogPrev).toBeDisabled();
  await expect(dialog).toContainText("2026-10-12 00:00:02 ~ 2026-10-12 00:00:03");
  await page.keyboard.press("Escape");
});

test("날짜 녹화 구간 조회는 INVALID_CURSOR와 DAILY_SNAPSHOT_CHANGED 및 503 오류에서 복구하고 선택 전환 시 cursor를 초기화한다", async ({ page }) => {
  const rec1 = pagedDailyRecording(
    syntheticDailyRecording.recording_id,
    syntheticDailyRecording.recording_date,
    syntheticDailyRecording.window_start_at,
    syntheticDailyRecording.window_end_at,
    105,
  );
  const rec2Id = "550e8400-e29b-41d4-a716-446655440001";
  const rec2 = pagedDailyRecording(
    rec2Id,
    "2026-10-11",
    "2026-10-10T15:00:00Z",
    "2026-10-11T15:00:00Z",
    105,
  );

  let failInvalidCursorOnce = true;
  let failSnapshotChangedOnce = false;
  let failAvailable503Once = false;
  let browserAvailRequests = 0;
  page.on("request", req => {
    if (req.method() === "GET" && new URL(req.url()).pathname === `/api/v2/recordings/daily/${rec1.recording_id}/available-intervals`) {
      browserAvailRequests += 1;
    }
  });

  const api = await installBackendApi(page, { initial });
  api.daily.setRecordings([rec1, rec2]);

  await page.route("**/api/v2/recordings/daily/*/gaps*", route => {
    const url = new URL(route.request().url());
    if (failInvalidCursorOnce && url.searchParams.get("cursor")) {
      failInvalidCursorOnce = false;
      return route.fulfill({ status: 400, json: { code: "INVALID_CURSOR", detail: "Synthetic stale cursor" } });
    }
    if (failSnapshotChangedOnce && url.searchParams.get("cursor")) {
      failSnapshotChangedOnce = false;
      api.daily.bumpRevision();
      return route.fulfill({ status: 409, json: { code: "DAILY_SNAPSHOT_CHANGED", detail: "Synthetic snapshot changed" } });
    }
    return route.fallback();
  });

  await page.route("**/api/v2/recordings/daily/*/available-intervals*", route => {
    if (failAvailable503Once) {
      failAvailable503Once = false;
      return route.fulfill({ status: 503, json: { code: "SERVICE_BUSY", detail: "Synthetic overload" } });
    }
    return route.fallback();
  });

  await page.goto("/recordings?source=api");
  await expect(page.locator(".recording-frame video")).toBeVisible();

  const timeline = page.getByRole("region", { name: "날짜 녹화 범위" });
  const prevButton = timeline.getByRole("button", { name: "이전", exact: true });
  const nextButton = timeline.getByRole("button", { name: "다음", exact: true });

  // 1) 400 INVALID_CURSOR는 Page 1 단발 재시도로 복구한다.
  await nextButton.click();
  await expect(prevButton).toBeDisabled();
  await expect(nextButton).toBeEnabled();
  await expect(timeline.getByRole("alert")).toHaveCount(0);

  // 2) 409 DAILY_SNAPSHOT_CHANGED는 summary 재조회 후 Page 1로 복구한다.
  failSnapshotChangedOnce = true;
  const summaryCallsBefore = api.daily.requests.filter(req =>
    req.method() === "GET" && new URL(req.url()).pathname === `/api/v2/recordings/daily/${rec1.recording_id}/summary`,
  ).length;
  await nextButton.click();
  await expect.poll(() => api.daily.requests.filter(req =>
    req.method() === "GET" && new URL(req.url()).pathname === `/api/v2/recordings/daily/${rec1.recording_id}/summary`,
  ).length).toBeGreaterThan(summaryCallsBefore);
  await expect(prevButton).toBeDisabled();
  await expect(nextButton).toBeEnabled();

  // 3) 503은 자동 재시도 루프 없이 alert와 수동 다시 조회를 표시한다.
  failAvailable503Once = true;
  const availBefore503 = browserAvailRequests;
  await nextButton.click();
  await expect(timeline.getByRole("alert")).toBeVisible();
  await expect(page.locator(".recorded-time")).toContainText("실제 시각 확인 불가");
  await page.waitForTimeout(350);
  expect(browserAvailRequests).toBe(availBefore503 + 1);

  await timeline.getByRole("button", { name: "다시 조회", exact: true }).click();
  await expect(timeline.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".recorded-time")).toContainText("실제 시각 미확인");

  // 4) 다른 녹화를 선택하면 cursor와 페이지 상태가 Page 1로 초기화된다.
  await page.getByRole("button", { name: /2026-10-11/ }).click();
  await expect.poll(() => api.daily.requests.some(req =>
    req.method() === "GET" && new URL(req.url()).pathname === `/api/v2/recordings/daily/${rec2Id}/available-intervals`,
  )).toBe(true);
  const rec2AvailUrls = api.daily.requests
    .filter(req => req.method() === "GET" && new URL(req.url()).pathname === `/api/v2/recordings/daily/${rec2Id}/available-intervals`)
    .map(req => new URL(req.url()));
  expect(rec2AvailUrls[rec2AvailUrls.length - 1].searchParams.has("cursor")).toBe(false);
  await expect(prevButton).toBeDisabled();
  await expect(page.locator(".recorded-time")).toContainText("00:00:00");
});
