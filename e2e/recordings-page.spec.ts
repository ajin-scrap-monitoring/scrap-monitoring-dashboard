import { expect, test, type Page } from "@playwright/test";

import { mediaRecordingFixture, monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";

import { installBackendApi } from "./backend-api.js";

const id = "550e8400-e29b-41d4-a716-446655440000";
const recording = { ...mediaRecordingFixture, id, startedAt: "2026-10-14T23:59:30Z", endedAt: "2026-10-15T00:00:30Z" };
const initial = { ...monitoringV2StateFixture("FRESH", 0), serverTime: "2026-10-15T09:30:00+09:00" };
const cardGeometry = (page: Page) => page.locator(".recordings-main, .recordings-main .card, .recording-frame").evaluateAll(elements => elements.map(element => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}));

test("녹화 상태 상세는 hover와 click으로 열고 카드 스크롤 및 배치 변경 없이 닫는다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  api.setRecordings([recording]);
  await page.goto("/recordings?source=api&recordingSource=event");
  await expect(page.locator(".recording-frame video")).toBeVisible();
  await expect(page.getByRole("button", { name: "녹화 정보 새로고침" })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const before = await cardGeometry(page);
  const error = "SYNTHETIC_ENCODING_FAILURE_".repeat(500) + "\n<script>syntheticOnly()</script>";
  api.setRecordings([{ ...recording, status: "unavailable", mediaStatus: "failed", coverage: "none", contentPath: null, downloadPath: null,
    durationSeconds: null, errorCode: error, gaps: Array.from({ length: 100 }, () => ({ start_at: recording.startedAt, end_at: recording.endedAt })) }]);
  await page.locator(".recording-item").click();
  const trigger = page.getByRole("button", { name: "녹화 실패 상세", exact: true });
  await expect(trigger).toBeVisible();
  await expect(page.locator(".recording-item")).not.toContainText("정보 없음");
  await expect(page.locator(".recording-info dl")).toContainText("MP4");
  await expect(page.locator(".recording-info dl")).toContainText("H264");
  await expect(page.getByRole("button", { name: "영상 없음", exact: true })).toHaveCount(0);
  await expect(page.locator(".recording-frame video")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "다운로드 불가", exact: true })).toBeDisabled();
  expect(await cardGeometry(page)).toEqual(before);
  const infoOverflow = () => page.locator(".recording-info").evaluate(element => ({ x: element.scrollWidth - element.clientWidth, y: element.scrollHeight - element.clientHeight, overflow: getComputedStyle(element).overflowY }));
  const overflow = await infoOverflow();
  expect(overflow.x).toBeLessThanOrEqual(1);
  expect(overflow.y).toBeLessThanOrEqual(1);
  expect(overflow.overflow).not.toMatch(/auto|scroll/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await expect(page.getByText(error, { exact: true })).toHaveCount(0);
  await trigger.hover();
  const popup = page.getByRole("dialog", { name: "녹화 상태 상세", exact: true });
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("녹화 영상을 생성하지 못했습니다.");
  await expect(popup).toContainText("오류 코드");
  await expect(popup).toContainText("확인 불가");
  await expect(popup).toContainText("100개");
  await expect(popup).toContainText("영상 없음");
  await expect(popup).not.toContainText(error);
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
  if (page.viewportSize()?.height === 1080) await expect(page.getByRole("button", { name: "다운로드 불가", exact: true })).toBeInViewport();
});

test("UTC 녹화 응답을 조회 기준 시각으로 표시하고 기간과 유형을 올바르게 전송한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  api.setRecordings([recording]);
  await page.goto("/recordings?source=api&recordingSource=event");
  await expect(page.locator(".recording-item-main strong")).toHaveText("2026-10-15");
  await expect(page.locator(".recording-info dl > div").filter({ has: page.locator("dt", { hasText: "시작 시각" }) })).toContainText("2026-10-15 08:59:30");
  await page.getByRole("textbox", { name: "시작 시각", exact: true }).fill("2026-10-15 08:55");
  await page.getByRole("textbox", { name: "종료 시각", exact: true }).fill("2026-10-15 09:05");
  await page.getByRole("button", { name: "알림", exact: true }).click();
  const response = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/v1/recordings" && url.searchParams.get("category") === "alert";
  });
  await page.getByRole("button", { name: "조회", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator(".recording-item")).toHaveCount(1);
  const query = api.requests.filter(url => url.pathname === "/api/v1/recordings").at(-1)?.searchParams;
  expect(query?.get("pit_id")).toBe(initial.pitId);
  expect(query?.get("from")).toBe("2026-10-15T08:55:00+09:00");
  expect(query?.get("to")).toBe("2026-10-15T09:05:00+09:00");
  expect(query?.get("category")).toBe("alert");
  expect(query?.get("page")).toBe("1");
  expect(query?.get("pageSize")).toBe("100");
  await expect(page.locator(".recording-frame video")).toBeVisible();
});

test("녹화 단건 조회 실패는 브라우저 새로고침으로 복구한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial });
  api.setRecordings([recording]);
  let failing = true;
  await page.route(`**/api/v1/recordings/${id}`, route => failing ? route.fulfill({ status: 503, json: { detail: "Synthetic failure" } }) : route.fallback());
  await page.goto("/recordings?source=api&recordingSource=event");
  await page.getByRole("button", { name: "확인 실패 상세" }).click();
  await expect(page.getByRole("alert")).toHaveText("녹화 정보를 확인하지 못했습니다.");
  await expect(page.getByRole("button", { name: "녹화 정보 새로고침" })).toHaveCount(0);
  await expect(page.locator(".recording-frame video")).toHaveCount(0);
  const before = await cardGeometry(page);
  failing = false;
  await page.reload();
  await expect(page.locator(".recording-frame video")).toBeVisible();
  await expect(page.getByRole("button", { name: "녹화 영상 다운로드", exact: true })).toBeEnabled();
  await expect(page.getByRole("dialog", { name: "녹화 상태 상세" })).toHaveCount(0);
  expect(await cardGeometry(page)).toEqual(before);
});
