import { expect, test } from "@playwright/test";

import { eventFixture, eventPageFixture } from "../src/test/api-contract-fixtures.js";
import { monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";

import { historyV2, installBackendApi, syntheticEventReplay } from "./backend-api.js";

test("알림 500은 현황과 과거 그래프를 유지하고 수동 재조회 없이 snapshot 수신으로 복구한다", async ({ page }) => {
  const initial = monitoringV2StateFixture("FRESH", 0);
  const api = await installBackendApi(page, { initial });
  let failing = true;
  let attempts = 0;
  await page.route("**/api/v1/notifications?*", route => { attempts += 1; return failing ? route.fulfill({ status: 500, json: { detail: "Synthetic failure" } }) : route.fallback(); });
  await page.goto("/?source=api");
  await expect(page.locator(".kpi-value")).toHaveText("0%");
  await expect(page.locator(".load-chart-line").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "알림 조회 실패", exact: true })).toBeVisible();
  const geometry = () => page.locator(".monitoring-grid > .card").evaluateAll(cards => cards.map(card => {
    const { x, y, width, height } = card.getBoundingClientRect();
    return { x, y, width, height };
  }));
  const before = await geometry();
  await page.getByRole("button", { name: "알림 조회 실패", exact: true }).click();
  const popover = page.getByLabel("최근 알림");
  const notice = popover.getByRole("alert");
  await expect(notice).toContainText("알림을 확인할 수 없습니다");
  await expect(notice).toContainText("알림 정보를 받으면 자동으로 표시합니다.");
  await expect(notice.locator("strong")).toHaveCSS("font-size", "14px");
  await expect(notice.locator("p")).toHaveCSS("font-size", "12px");
  await expect(notice).not.toContainText("Synthetic failure");
  await expect(popover.getByRole("button", { name: /다시 조회/ })).toHaveCount(0);
  failing = false;
  await api.snapshot(initial);
  await expect(page.getByRole("button", { name: "알림 1건", exact: true })).toBeVisible();
  await expect(popover.getByRole("alert")).toHaveCount(0);
  expect(await geometry()).toEqual(before);
  expect(attempts).toBeGreaterThanOrEqual(2);
});

test("30일과 90일 조회는 v2 그래프와 운영 기록을 함께 표시하고 bucket_seconds를 보내지 않는다", async ({ page }) => {
  const api = await installBackendApi(page);
  const eventQueries: URL[] = [];
  await page.route("**/api/v1/events?*", route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("pageSize") === "8") eventQueries.push(url);
    return url.searchParams.get("category") === "collection" ? route.fallback() : route.fulfill({ json: { ...eventPageFixture, items: [{ ...eventFixture, occurredAt: "2026-10-12T00:00:00Z", recordingId: null }] } });
  });
  api.setLoadHistory(url => url.searchParams.get("from")?.startsWith("2026-07-") ? { status: 200, delayMs: 800, body: historyV2(url, monitoringV2StateFixture("UNAVAILABLE")) } : undefined);
  await page.goto("/history?source=api");
  await expect(page.locator(".history-chart")).toBeVisible();
  for (const days of [30, 90]) {
    const before = api.requests.filter(url => url.pathname === "/api/v2/monitoring/load-history").length;
    await page.getByRole("button", { name: `최근 ${days}일`, exact: true }).click();
    await page.getByRole("button", { name: "조회", exact: true }).click();
    if (days === 90) await expect(page.locator("#history-query-status")).toContainText("조회 중입니다.");
    await expect(page.getByRole("button", { name: "조회", exact: true })).toBeEnabled();
    await expect(page.locator("#history-query-status")).toHaveCount(0);
    await expect(page.locator(".history-chart")).not.toContainText("최대 7일");
    await expect(page.locator(".history-load-line").first()).toBeVisible();
    await expect(page.locator(".history-events")).toContainText(eventFixture.title);
    const requested = api.requests.filter(url => url.pathname === "/api/v2/monitoring/load-history").slice(before);
    expect(requested).toHaveLength(1);
    expect(requested[0].searchParams.has("bucket_seconds")).toBe(false);
    expect(Date.parse(requested[0].searchParams.get("to")!) - Date.parse(requested[0].searchParams.get("from")!)).toBe(days * 86_400_000);
    const query = eventQueries.at(-1)!;
    expect(Date.parse(query.searchParams.get("to")!) - Date.parse(query.searchParams.get("from")!)).toBe(days * 86_400_000);
  }
  await expect(page.locator(".history-event-target")).toHaveCount(0);
});

test("90일을 넘는 기간은 요청 전에 안내하고 요청하지 않는다", async ({ page }) => {
  const api = await installBackendApi(page);
  await page.goto("/history?source=api");
  await expect(page.locator(".history-chart")).toBeVisible();
  await page.getByRole("button", { name: "최근 90일", exact: true }).click();
  await page.getByRole("textbox", { name: "시작 시각", exact: true }).fill("2000-01-01T00:00");
  const before = api.requests.filter(url => url.pathname === "/api/v2/monitoring/load-history").length;
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("최대 90일");
  expect(api.requests.filter(url => url.pathname === "/api/v2/monitoring/load-history")).toHaveLength(before);
});

for (const [status, code, guidance] of [
  [503, "HISTORY_QUERY_TIMEOUT", "기간을 줄여 다시 조회"],
  [422, "HISTORY_TOO_MANY_POINTS", "구간 수가 응답 한도"],
  [422, "HISTORY_FUTURE_RANGE", "종료 시각이 현재보다 미래"],
  [422, "HISTORY_RANGE_MUST_BE_WITHIN_90_DAYS", "최대 90일"],
] as const) {
  test(`적재율 이력 ${status} ${code}는 빈 그래프로 대체하지 않고 안내하며 자동 재시도하지 않는다`, async ({ page }) => {
    const api = await installBackendApi(page);
    api.setLoadHistory(url => Date.parse(url.searchParams.get("to") ?? "") - Date.parse(url.searchParams.get("from") ?? "") > 8 * 86_400_000 ? { status, body: { detail: code } } : undefined);
    await page.goto("/history?source=api");
    await expect(page.locator(".history-load-line").first()).toBeVisible();
    await page.getByRole("button", { name: "최근 30일", exact: true }).click();
    await page.getByRole("button", { name: "조회", exact: true }).click();
    await expect(page.locator(".history-chart")).toContainText(guidance);
    await expect(page.locator(".history-load-line")).toHaveCount(0);
    const failed = api.requests.filter(url => url.pathname === "/api/v2/monitoring/load-history").length;
    await page.waitForTimeout(1500);
    expect(api.requests.filter(url => url.pathname === "/api/v2/monitoring/load-history")).toHaveLength(failed);
  });
}

test("현재 분의 녹화는 목록에 유지하고 현황 전용 추이는 요청하지 않는다", async ({ page }) => {
  const initial = { ...monitoringV2StateFixture("FRESH", 0), serverTime: "2026-10-15T12:34:50+09:00" };
  const api = await installBackendApi(page, { initial });
  api.setEventReplays([syntheticEventReplay({}, { windowFrom: "2026-10-15T03:34:10Z", windowTo: "2026-10-15T03:34:40Z", occurredAt: "2026-10-15T03:34:10Z" })]);
  await page.goto("/recordings?source=api&recordingSource=event");
  await expect(page.locator(".recordings-list .recording-item")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "종료 시각", exact: true })).toHaveValue("2026-10-15 12:35");
  const requests = api.requests.filter(url => url.pathname === "/api/v2/monitoring/load-history");
  expect(requests).toHaveLength(0);
  const recordingRequest = api.requests.find(url => url.pathname === "/api/v2/recordings/events");
  expect(recordingRequest?.searchParams.get("to")).toBe("2026-10-15T12:35:00+09:00");
});
