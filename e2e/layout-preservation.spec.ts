import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { eventFixture, eventPageFixture } from "../src/test/api-contract-fixtures.js";
import { monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";

import { installBackendApi } from "./backend-api.js";

type Geometry = { className: string; x: number; y: number; width: number; height: number };
const baseline = JSON.parse(readFileSync(new URL("./layout-baseline.json", import.meta.url), "utf8")) as Record<string, Geometry[]>;
const selector = ".topbar, .page-heading, .card, .app-footer, .history-table-wrap tr, .recording-frame, .recordings-side";
const pages = [
  { path: "/", key: "monitoring", main: ".monitoring-page", cards: 8 },
  { path: "/history", key: "history", main: ".history-page", cards: 3 },
  { path: "/recordings", key: "recordings", main: ".recordings-page", cards: 5 },
  { path: "/admin", key: "admin", main: ".admin-page", cards: 4 },
] as const;

async function geometry(page: Page): Promise<Geometry[]> {
  return page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { className: element.getAttribute("class") ?? "", x, y, width, height };
  }));
}

async function fontsAndImagesReady(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode().catch(() => undefined))));
}

async function expectGeometry(page: Page, expected: Geometry[]) {
  await expect.poll(async () => (await geometry(page)).map((entry) => entry.className)).toEqual(expected.map((entry) => entry.className));
  const actual = await geometry(page);
  for (let index = 0; index < expected.length; index += 1) {
    for (const field of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(actual[index][field] - expected[index][field]), `${expected[index].className}[${index}].${field}`).toBeLessThanOrEqual(0.1);
    }
  }
}

for (const definition of pages) {
  test(`synthetic ${definition.key}의 기본 배치와 크기를 변경 전 기준으로 유지한다`, async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem("scrap-monitoring-authenticated", "true"));
    await page.goto(`${definition.path}?source=mock`);
    await expect(page.locator(`${definition.main} h1`)).toBeVisible();
    await expect(page.locator(".card")).toHaveCount(definition.cards);
    await fontsAndImagesReady(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("A fixed layout viewport is required.");
    const expected = baseline[`${viewport.width}x${viewport.height}-${definition.key}`];
    expect(expected, "A frozen pre-change baseline is required.").toBeDefined();
    expect(expected.filter((entry) => entry.className.split(" ").includes("card"))).toHaveLength(definition.cards);
    await expectGeometry(page, expected);
  });
}

test("긴 상태 상세와 pit 이름은 기존 배치를 밀어내지 않고 내부에서 스크롤한다", async ({ page }) => {
  const longName = "상세에서만 표시하는 긴 pit 이름 ".repeat(30);
  const initial = { ...monitoringV2StateFixture("UNAVAILABLE"), reasonCodes: Array.from({ length: 30 }, (_, index) => `SYNTHETIC_REASON_${index}_${"LONG_REASON_".repeat(25)}`) };
  await installBackendApi(page, { initial });
  await page.route("**/api/v1/config/pits/*", (route) => route.fulfill({ json: {
    id: initial.pitId, name: longName, total_depth_cm: 300, warning_threshold_percent: 75, critical_threshold_percent: 85,
    updated_at: "2026-10-13T00:00:00Z",
  } }));
  await page.goto("/?source=api");
  const opener = page.getByRole("button", { name: "상태 상세", exact: true });
  await expect(opener).toBeVisible();
  await fontsAndImagesReady(page);
  const before = await geometry(page);
  const scrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "모니터링 상태 상세", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(longName, { exact: true })).toBeVisible();
  await expectGeometry(page, before);
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(scrollBefore);
  const panel = dialog.locator(".monitoring-detail-panel");
  const overflow = await panel.evaluate((element) => ({ horizontal: element.scrollWidth - element.clientWidth, vertical: element.scrollHeight - element.clientHeight }));
  expect(overflow.horizontal).toBeLessThanOrEqual(1);
  expect(overflow.vertical).toBeGreaterThan(0);
  const bounds = await panel.boundingBox();
  const viewport = page.viewportSize();
  if (!bounds || !viewport) throw new Error("The detail panel and viewport must be measurable.");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expectGeometry(page, before);
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(scrollBefore);
});

test("경보 근거의 긴 식별자를 열고 닫아도 기존 표 행과 카드 크기를 유지한다", async ({ page }) => {
  await installBackendApi(page);
  const occurredAt = "2026-10-12T12:00:00Z";
  const assessmentId = "synthetic-assessment-".repeat(70);
  await page.route("**/api/v1/events?*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("category") === "collection") return route.fallback();
    return route.fulfill({ json: { ...eventPageFixture, items: [{ ...eventFixture, id: "evt-alt-1", occurredAt, recordingId: null }] } });
  });
  await page.route("**/api/v2/monitoring/alerts?*", (route) => route.fulfill({ json: {
    limit: 20, offset: 0, totalItems: 1,
    items: [{ eventId: "evt-alt-1", notificationId: "notif-1", assessmentId, loadPercent: 85, observedAt: occurredAt, triggeredAt: occurredAt, readAt: null }],
  } }));
  await page.goto("/history?source=api");
  const opener = page.getByRole("button", { name: /경보 근거 보기$/ });
  await expect(opener).toBeVisible();
  await fontsAndImagesReady(page);
  await opener.scrollIntoViewIfNeeded();
  const before = await geometry(page);
  const scrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "경보 근거", exact: true });
  await expect(dialog.getByText(assessmentId, { exact: true })).toBeVisible();
  expect(await dialog.locator(".monitoring-detail-panel").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expectGeometry(page, before);
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(scrollBefore);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expectGeometry(page, before);
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(scrollBefore);
});
