import { expect, test, type Page } from "@playwright/test";

import { eventRecordingId, monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";

import { installBackendApi, partialEventReplayWithGaps, syntheticEventReplay } from "./backend-api.js";
import { eventReplayPartFixture } from "../src/test/backend-contract-fixtures.js";
import { syntheticDailyRecording } from "./daily-recording-api.js";

const initial = { ...monitoringV2StateFixture("FRESH", 0), serverTime: "2026-10-15T09:30:00+09:00" };
const event = { windowFrom: "2026-10-14T23:59:30Z", windowTo: "2026-10-15T00:00:30Z", occurredAt: "2026-10-15T00:00:00Z" };
const cardGeometry = (page: Page) => page.locator(".recordings-main, .recordings-main .card, .recording-frame").evaluateAll(elements => elements.map(element => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}));

test("이벤트 녹화 상태 상세는 hover와 click으로 열고 카드 스크롤 및 배치 변경 없이 닫는다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  api.setEventReplays([syntheticEventReplay({}, event)]);
  await page.goto("/recordings?source=api&recordingSource=event");
  await expect(page.locator(".event-replay")).toBeVisible();
  await expect(page.getByRole("button", { name: "녹화 정보 새로고침" })).toHaveCount(0);
  await expect(page.locator(".recordings-page .card")).toHaveCount(5);
  await page.evaluate(() => document.fonts.ready);
  const before = await cardGeometry(page);
  expect(before.length).toBeGreaterThan(0);
  api.setEventReplays([syntheticEventReplay({ state: "UNAVAILABLE", parts: [], playbackSeconds: 0, coveredSeconds: 0, reasonCodes: ["NO_COVERAGE"] }, event)]);
  await page.locator(".recording-item").click();
  const trigger = page.getByRole("button", { name: "영상 없음 상세", exact: true });
  await expect(trigger).toBeVisible();
  await expect(page.locator(".event-replay")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "이벤트 구간 다운로드 불가", exact: false })).toHaveCount(0);
  expect(await cardGeometry(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await trigger.hover();
  const popup = page.getByRole("dialog", { name: "녹화 상태 상세", exact: true });
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("이 이벤트 구간에서 재생할 수 있는 영상이 없습니다.");
  await expect(popup.locator("script")).toHaveCount(0);
  expect(await cardGeometry(page)).toEqual(before);
  await popup.hover();
  await expect(popup).toBeVisible();
  await page.getByRole("heading", { name: "녹화 영상", exact: true, level: 1 }).hover();
  await expect(popup).toHaveCount(0);
  await trigger.click();
  await page.getByRole("heading", { name: "녹화 영상", exact: true, level: 1 }).hover();
  await expect(popup).toBeVisible();
  await page.getByRole("button", { name: "녹화 상태 상세 닫기" }).click();
  await expect(popup).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(popup).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await cardGeometry(page)).toEqual(before);
});

test("UTC 이벤트 녹화 응답을 조회 기준 시각으로 표시하고 기간과 유형을 올바르게 전송한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  api.setEventReplays([syntheticEventReplay({}, event)]);
  await page.goto("/recordings?source=api&recordingSource=event");
  await expect(page.locator(".recording-item-main strong")).toHaveText("2026-10-15");
  await expect(page.locator(".recording-info dl > div").filter({ has: page.locator("dt", { hasText: "시작 시각" }) })).toContainText("2026-10-15 08:59:30");
  await page.getByRole("textbox", { name: "시작 시각", exact: true }).fill("2026-10-15 08:55");
  await page.getByRole("textbox", { name: "종료 시각", exact: true }).fill("2026-10-15 09:05");
  await page.getByRole("button", { name: "알림", exact: true }).click();
  const response = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/v2/recordings/events" && url.searchParams.get("category") === "alert";
  });
  await page.getByRole("button", { name: "조회", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator(".recording-item")).toHaveCount(1);
  const query = api.requests.filter(url => url.pathname === "/api/v2/recordings/events").at(-1)?.searchParams;
  expect(query?.get("from")).toBe("2026-10-15T08:55:00+09:00");
  expect(query?.get("to")).toBe("2026-10-15T09:05:00+09:00");
  expect(query?.get("category")).toBe("alert");
  expect(query?.get("page")).toBe("1");
  expect(query?.get("pageSize")).toBe("50");
  expect(query?.get("stable")).toBe("true");
  await expect(page.locator(".event-replay")).toBeVisible();
});

test("이벤트 녹화 상세 조회 실패는 브라우저 새로고침으로 복구한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  api.setEventReplays([syntheticEventReplay({}, event)]);
  let failing = true;
  await page.route(`**/api/v2/recordings/events/${eventRecordingId}?*`, route => failing ? route.fulfill({ status: 503, json: { detail: "Synthetic failure" } }) : route.fallback());
  await page.goto("/recordings?source=api&recordingSource=event");
  await page.getByRole("button", { name: /상세$/ }).first().click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "녹화 정보 새로고침" })).toHaveCount(0);
  await expect(page.locator(".event-replay")).toHaveCount(0);
  await expect(page.locator(".recordings-page .card")).toHaveCount(5);
  const before = await cardGeometry(page);
  expect(before.length).toBeGreaterThan(0);
  failing = false;
  await page.reload();
  await expect(page.locator(".event-replay")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "녹화 상태 상세" })).toHaveCount(0);
  expect(await cardGeometry(page)).toEqual(before);
});

test("이벤트 녹화 목록은 첫 화면에 서버 1페이지만 받고 필요한 순위에 닿을 때만 다음 서버 페이지를 순서대로 요청한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  const base = Date.parse("2026-10-15T00:00:00Z");
  api.setEventReplays(Array.from({ length: 240 }, (_, index) => syntheticEventReplay({}, {
    eventId: `evt-paged-${String(index).padStart(3, "0")}`,
    windowFrom: new Date(base - index * 60_000).toISOString(), windowTo: new Date(base - index * 60_000 + 30_000).toISOString(),
    occurredAt: new Date(base - index * 60_000 + 15_000).toISOString() })));
  await page.goto("/recordings?source=api&recordingSource=event");
  await expect(page.locator(".recording-item")).toHaveCount(6);
  const eventRequests = () => api.requests.filter(url => url.pathname === "/api/v2/recordings/events");
  const requested = () => eventRequests().map(url => `${url.searchParams.get("page")}/${url.searchParams.get("pageSize")}`);
  expect(requested()).toEqual(["1/50"]);
  expect(eventRequests()[0].searchParams.get("stable")).toBe("true");
  expect(eventRequests()[0].searchParams.get("snapshot_token")).toBeNull();

  const pagination = page.getByLabel("녹화 목록 페이지", { exact: true });
  await expect(pagination).toContainText("1 / 40");
  await expect(page.getByText("240건", { exact: true })).toBeVisible();
  const next = page.getByRole("button", { name: "다음 녹화 목록 페이지" });
  await next.click();
  await expect(pagination).toContainText("2 / 40");
  await next.click();
  await expect(pagination).toContainText("3 / 40");
  expect(requested()).toEqual(["1/50"]);
  for (let p = 4; p <= 9; p++) {
    await next.click();
    await expect(pagination).toContainText(`${p} / 40`);
  }
  await expect(page.locator(".recording-item")).toHaveCount(6);
  expect(requested()).toEqual(["1/50", "2/50"]);
  // 다음 페이지 요청에는 snapshot_token이 전달된다.
  expect(eventRequests()[1].searchParams.get("snapshot_token")).toBe("token-stable-123");

  // 필터 변경은 처음부터 다시 조회한다.
  await page.getByRole("button", { name: "알림", exact: true }).click();
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect.poll(() => requested().at(-1)).toBe("1/50");
  await expect(pagination).toContainText("1 /");
});

test("unavailableIntervals가 있는 PARTIAL 이벤트 상세의 누락 구간 버튼과 녹화 범위 상세 창 내용을 확인한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  api.setEventReplays([partialEventReplayWithGaps({}, event)]);
  await page.goto("/recordings?source=api&recordingSource=event");
  const trigger = page.locator(".recording-coverage-trigger");
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText("누락 구간");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "녹화 범위 상세" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("요청 구간")).toBeVisible();
  await expect(dialog.getByText("요청 길이")).toBeVisible();
  await expect(dialog.getByText("1:00")).toBeVisible();
  await expect(dialog.getByText("확보 길이")).toBeVisible();
  await expect(dialog.getByText("재생 길이")).toBeVisible();
  await expect(dialog.getByText(/확인된 누락/)).toBeVisible();
  await expect(dialog.getByText(/RECORDING_GAP/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("gaps에 사유 코드가 있는 날짜 녹화의 누락 구간 버튼과 녹화 범위 상세 창 내용을 확인한다", async ({ page }) => {
  await installBackendApi(page, { initial });
  await page.goto("/recordings?source=api&recordingSource=daily");
  const trigger = page.locator(".recording-coverage-trigger");
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText("누락 구간");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "녹화 범위 상세" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("녹화 날짜")).toBeVisible();
  await expect(dialog.getByText("2026-10-12", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/CAMERA_DISCONNECTED/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("이벤트 구간 다운로드: 준비 -> 준비 중 -> 다운로드 및 failed -> 다시 추출", async ({ page }) => {
  const eventId = "20261015-000000-alert";
  const api = await installBackendApi(page, { initial });
  api.setEventReplays([
    syntheticEventReplay({
      exportPath: `/api/v2/recordings/events/${eventId}/exports`,
      downloadReasonCode: "EVENT_EXPORT_NOT_REQUESTED",
    }, { ...event, eventId }),
  ]);

  await page.goto("/recordings?source=api&recordingSource=event");
  await page.locator(".recording-item").first().click();

  const prepareButton = page.getByRole("button", { name: "구간 파일 준비", exact: true });
  await expect(prepareButton).toBeVisible();

  // 1. 구간 파일 준비 클릭 -> 202 접수 및 ready 전환
  await prepareButton.click();
  await expect(page.getByText("구간 파일이 준비되었습니다. (4.0 KB)")).toBeVisible();
  const downloadButton = page.getByRole("button", { name: "다운로드", exact: true });
  await expect(downloadButton).toBeVisible();

  // 2. failed 상태 시 다시 추출 버튼 동작
  const failedRequestId = "c0ffee00-1111-2222-3333-444455556666";
  const exportPath = `/api/v2/recordings/events/${eventId}/exports/${failedRequestId}`;
  api.setExportStatus(exportPath, {
    requestId: failedRequestId,
    eventId,
    statusPath: exportPath,
    status: "failed",
    clipId: null,
    coverage: null,
    sizeBytes: null,
    downloadPath: null,
    expiresAt: null,
    actualFrom: null,
    actualTo: null,
    errorCode: "TRANSCODE_ERROR",
    gaps: [],
  });

  // localStorage에 failed 요청 설정 후 새로고침하여 복원 상태 테스트
  await page.evaluate(({ id, path, reqId }) => {
    const value = JSON.stringify({
      requestId: reqId,
      statusPath: path,
      savedAt: Date.now(),
    });
    localStorage.setItem(`scrap-dashboard:event-export:v1:user-contract:${id}:30:30`, value);
    localStorage.setItem(`scrap-dashboard:event-export:v1:anonymous:${id}:30:30`, value);
  }, { id: eventId, path: exportPath, reqId: failedRequestId });

  await page.reload();
  await page.locator(".recording-item").first().click();

  await expect(page.getByText("구간 파일 준비에 실패했습니다.")).toBeVisible();
  const retryButton = page.getByRole("button", { name: "다시 추출", exact: true });
  await expect(retryButton).toBeVisible();

  // 다시 추출 클릭 시 같은 requestId로 재요청
  const retryRequest = page.waitForRequest(req => req.url().includes("/exports") && req.method() === "POST");
  await retryButton.click();
  const postData = (await retryRequest).postData();
  const postBody = (postData ? JSON.parse(postData) : {}) as Record<string, unknown>;
  expect(postBody.requestId).toBe(failedRequestId);
  expect(postBody.retryFailed).toBe(true);
});

test("영상 파일 정보: 날짜 file ready, file=null (준비 전), 조회 실패 (조회 안 됨)", async ({ page }) => {
  const recordingId = syntheticDailyRecording.recording_id;
  const api = await installBackendApi(page, { initial });

  // 1. ready 상태 날짜 녹화
  api.setDailyMediaInfo(recordingId, {
    recording_id: recordingId,
    file: { status: "ready", codec: "h264", width: 1920, height: 1080, fps: 30, fps_num: 30, fps_den: 1, size_bytes: 1048576, reason_code: null },
    segments: { status: "ready", total: 10, measured: 10, formats: [{ codec: "h264", width: 1920, height: 1080, segment_count: 10 }], mixed: false },
  });

  await page.goto("/recordings?source=api&recordingSource=daily");
  await page.locator(".recording-item").first().click();

  // 정보 영역 확인
  const infoSection = page.locator(".recording-info");
  await expect(infoSection).toContainText("h264");
  await expect(infoSection).toContainText("1920 x 1080");
  await expect(infoSection).toContainText("30 fps");
  await expect(infoSection).toContainText("1.0 MB");

  // 2. file=null 인 경우: 날짜 MP4 준비 전
  api.setDailyMediaInfo(recordingId, {
    recording_id: recordingId,
    file: null,
    segments: { status: "partial", total: 10, measured: 5, formats: [], mixed: null },
  });
  // 캐시 클리어 후 새로고침
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator(".recording-item").first().click();
  await expect(infoSection).toContainText("날짜 MP4 준비 전");

  // 3. 조회 실패(404 or 503)인 경우: 조회 안 됨
  api.setDailyMediaInfo(recordingId, null);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator(".recording-item").first().click();
  await expect(infoSection).toContainText("조회 안 됨");
});

test("세 viewport 모두에서 녹화 화면의 카드 배치를 유지하고 수평으로 넘치지 않는다", async ({ page }) => {
  await installBackendApi(page, { initial });
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/recordings?source=api&recordingSource=daily");
    await page.evaluate(() => document.fonts.ready);

    const cards = page.locator(".recordings-page .card");
    await expect(cards).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await expect(cards.nth(i)).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
});

test("이벤트 녹화 확대는 원본을 정지하고 이벤트 구간 위치를 주고받으며", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  await page.addInitScript(() => {
    const canPlayType = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "canPlayType")?.value as (this: HTMLMediaElement, type: string) => CanPlayTypeResult;
    HTMLMediaElement.prototype.canPlayType = function (type) {
      return type === "application/vnd.apple.mpegurl" ? "" : canPlayType.call(this, type);
    };
  });
  const id = syntheticDailyRecording.recording_id;
  const second = (extra: Record<string, unknown>) => eventReplayPartFixture({ recordingId: id, playbackPath: `/media/daily-recordings/${id}/hls/index.m3u8`, fromAt: event.windowFrom, toAt: event.windowTo, ...extra });
  api.setEventReplays([syntheticEventReplay({
    state: "PARTIAL", requestedSeconds: 60, coveredSeconds: 2, playbackSeconds: 2,
    parts: [second({ startSeconds: 0, endSeconds: 1, relativeStartSeconds: 0, relativeEndSeconds: 1 }), second({ startSeconds: 1, endSeconds: 2, relativeStartSeconds: 1, relativeEndSeconds: 2 })],
  }, event)]);
  await page.goto("/recordings?source=api&recordingSource=event");
  const frame = page.locator(".recording-frame");
  const baseVideo = frame.locator("video");
  await expect(frame.locator(".event-replay")).toBeVisible();
  await expect.poll(() => baseVideo.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);

  await frame.getByRole("slider", { name: "재생 위치" }).fill("1");
  await expect(frame.locator("time")).toHaveText("0:01 / 0:02");
  await frame.getByRole("button", { name: "재생", exact: true }).click();
  await expect.poll(() => baseVideo.evaluate(element => !(element as HTMLVideoElement).paused || (element as HTMLVideoElement).ended)).toBe(true);

  await page.getByRole("button", { name: "녹화 영상 크게 보기" }).click();
  const dialog = page.getByRole("dialog", { name: "녹화 영상 크게 보기" });
  await expect(dialog.locator(".event-replay")).toBeVisible();
  await expect(frame.getByRole("button", { name: "재생", exact: true })).toBeVisible();
  expect(await baseVideo.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
  await page.waitForTimeout(700);
  expect(await baseVideo.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
  const expandedSlider = dialog.getByRole("slider", { name: "재생 위치" });
  const startValue = Number(await expandedSlider.inputValue());
  expect(startValue).toBeGreaterThanOrEqual(1);
  await expandedSlider.fill("0");
  await expect(dialog.locator("time")).toHaveText("0:00 / 0:02");

  await dialog.getByRole("button", { name: "녹화 영상 닫기" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(frame.locator("time")).toHaveText("0:00 / 0:02");
  await expect(frame.getByRole("slider", { name: "재생 위치" })).toHaveValue("0");
  expect(await baseVideo.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
  await page.waitForTimeout(700);
  expect(await baseVideo.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
  await expect(frame.getByRole("button", { name: "재생", exact: true })).toBeVisible();
});
