import { expect, test, type Page } from "@playwright/test";

import { eventRecordingId, monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";

import { installBackendApi, partialEventReplayWithGaps, syntheticEventReplay } from "./backend-api.js";

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
  await page.evaluate(() => document.fonts.ready);
  const before = await cardGeometry(page);
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
  expect(query?.get("pageSize")).toBe("20");
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
  const before = await cardGeometry(page);
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
  const requested = () => api.requests.filter(url => url.pathname === "/api/v2/recordings/events")
    .map(url => `${url.searchParams.get("page")}/${url.searchParams.get("pageSize")}`);
  expect(requested()).toEqual(["1/20"]);
  const pagination = page.getByLabel("녹화 목록 페이지", { exact: true });
  await expect(pagination).toContainText("1 / 40");
  await expect(page.getByText("240건", { exact: true })).toBeVisible();
  const next = page.getByRole("button", { name: "다음 녹화 목록 페이지" });
  await next.click();
  await expect(pagination).toContainText("2 / 40");
  await next.click();
  await expect(pagination).toContainText("3 / 40");
  expect(requested()).toEqual(["1/20"]);
  await next.click();
  await expect(pagination).toContainText("4 / 40");
  await expect(page.locator(".recording-item")).toHaveCount(6);
  expect(requested()).toEqual(["1/20", "1/100"]);
  // 필터 변경은 처음부터 다시 조회한다.
  await page.getByRole("button", { name: "알림", exact: true }).click();
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect.poll(() => requested().at(-1)).toBe("1/20");
  await expect(pagination).toContainText("1 /");
});

test("unavailableIntervals가 있는 PARTIAL 이벤트 상세의 부분 저장 버튼과 녹화 범위 상세 창 내용을 확인한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  api.setEventReplays([partialEventReplayWithGaps({}, event)]);
  await page.goto("/recordings?source=api&recordingSource=event");
  const trigger = page.locator(".recording-coverage-trigger");
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText("부분 저장");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "녹화 범위 상세" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("요청 구간")).toBeVisible();
  await expect(dialog.getByText("요청 길이")).toBeVisible();
  await expect(dialog.getByText("60초")).toBeVisible();
  await expect(dialog.getByText("확보 길이")).toBeVisible();
  await expect(dialog.getByText("재생 길이")).toBeVisible();
  await expect(dialog.getByText(/확인된 누락/)).toBeVisible();
  await expect(dialog.getByText(/RECORDING_GAP/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("gaps에 사유 코드가 있는 날짜 녹화의 부분 저장 버튼과 녹화 범위 상세 창 내용을 확인한다", async ({ page }) => {
  await installBackendApi(page, { initial });
  await page.goto("/recordings?source=api&recordingSource=daily");
  const trigger = page.locator(".recording-coverage-trigger");
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText("부분 저장");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "녹화 범위 상세" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("녹화 날짜")).toBeVisible();
  await expect(dialog.getByText("2026-10-12", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/CAMERA_DISCONNECTED/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
