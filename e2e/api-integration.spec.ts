import { expect, test } from "@playwright/test";

import type { components } from "../src/generated/backend-contract.js";
import { eventFixture, eventPageFixture } from "../src/test/api-contract-fixtures.js";
import { mediaRecordingFixture, monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";

import { installBackendApi } from "./backend-api.js";

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

test("30일과 90일 조회는 기존 운영 기록을 유지하고 v2 그래프만 범위 미지원으로 표시한다", async ({ page }) => {
  const api = await installBackendApi(page);
  const eventQueries: URL[] = [];
  await page.route("**/api/v1/events?*", route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("pageSize") === "100") eventQueries.push(url);
    return url.searchParams.get("category") === "collection" ? route.fallback() : route.fulfill({ json: { ...eventPageFixture, items: [{ ...eventFixture, occurredAt: "2026-10-12T00:00:00Z", recordingId: null }] } });
  });
  await page.goto("/history?source=api");
  await expect(page.locator(".history-chart")).toBeVisible();
  const requested = api.requests.filter(url => url.pathname === "/api/v2/monitoring/load-history").length;
  for (const days of [30, 90]) {
    await page.getByRole("button", { name: `최근 ${days}일`, exact: true }).click();
    await page.getByRole("button", { name: "조회", exact: true }).click();
    await expect(page.getByRole("button", { name: "조회", exact: true })).toBeEnabled();
    await expect(page.locator(".history-chart")).toContainText("최대 7일");
    await expect(page.locator(".history-events")).toContainText(eventFixture.title);
    expect(api.requests.filter(url => url.pathname === "/api/v2/monitoring/load-history")).toHaveLength(requested);
    const query = eventQueries.at(-1)!;
    expect(Date.parse(query.searchParams.get("to")!) - Date.parse(query.searchParams.get("from")!)).toBe(days * 86_400_000);
  }
  await expect(page.locator(".history-event-target")).toHaveCount(0);
});

test("녹화 범위 상세는 선택 시에만 조회하고 카드와 다운로드 위치를 유지한다", async ({ page }) => {
  const api = await installBackendApi(page);
  const id = "550e8400-e29b-41d4-a716-446655440000";
  api.setRecordings([{ ...mediaRecordingFixture, id }]);
  const detail = {
    clip_id: id, camera_id: "camera-main", event_id: "evt-alt-1", status: "ready", accepted_at: "2026-09-09T00:00:30+09:00",
    requested_start_at: "2026-09-09T00:00:00+09:00", requested_end_at: "2026-09-09T00:00:30+09:00",
    actual_start_at: "2026-09-09T00:00:05+09:00", actual_end_at: "2026-09-09T00:00:25+09:00",
    coverage: "partial", gaps: [{ start_at: "2026-09-09T00:00:00+09:00", end_at: "2026-09-09T00:00:05+09:00" }],
    recording_policy: { pre_roll_seconds: 10, post_roll_seconds: 20, retention_days: 7 },
    completed_at: "2026-09-09T00:01:00+09:00", expires_at: "2026-09-16T00:01:00+09:00", deleted_at: null, content_path: `/api/v1/clips/${id}/content`, error: null,
  } satisfies components["schemas"]["ClipDetail"];
  let coverageRequests = 0;
  await page.route(`**/api/v1/media/clips/${id}`, route => { coverageRequests += 1; return route.fulfill({ json: detail }); });
  await page.goto(`/recordings?source=api&recordingId=${id}`);
  const opener = page.getByRole("button", { name: "부분 저장", exact: true });
  await expect(opener).toBeVisible();
  expect(coverageRequests).toBe(0);
  await page.evaluate(() => document.fonts.ready);
  await opener.scrollIntoViewIfNeeded();
  const geometry = () => page.locator(".recordings-main .card, .recording-frame").evaluateAll(cards => cards.map(card => {
    const { x, y, width, height } = card.getBoundingClientRect();
    return { x, y, width, height };
  }));
  const before = await geometry();
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "녹화 범위 상세", exact: true });
  await expect(dialog.locator("dl > div").filter({ hasText: "요청 시작" })).toContainText(detail.requested_start_at);
  await expect(dialog.locator("dl > div").filter({ hasText: "확보 시작" })).toContainText(detail.actual_start_at);
  await expect(dialog).toContainText("구간별 누락 원인은 API에서 제공하지 않습니다.");
  expect(coverageRequests).toBe(1);
  expect(await geometry()).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await geometry()).toEqual(before);
});

test("현재 분의 녹화는 목록에 유지하고 현황 전용 추이는 요청하지 않는다", async ({ page }) => {
  const initial = { ...monitoringV2StateFixture("FRESH", 0), serverTime: "2026-10-15T12:34:50+09:00" };
  const api = await installBackendApi(page, { initial });
  api.setRecordings([{ ...mediaRecordingFixture, startedAt: "2026-10-15T12:34:10+09:00", endedAt: "2026-10-15T12:34:40+09:00" }]);
  await page.goto("/recordings?source=api&recordingSource=event");
  await expect(page.locator(".recordings-list .recording-item")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "종료 시각", exact: true })).toHaveValue("2026-10-15 12:35");
  const requests = api.requests.filter(url => url.pathname === "/api/v2/monitoring/load-history");
  expect(requests).toHaveLength(0);
  const recordingRequest = api.requests.find(url => url.pathname === "/api/v1/recordings");
  expect(recordingRequest?.searchParams.get("to")).toBe("2026-10-15T12:35:00+09:00");
});
