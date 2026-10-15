import { expect, test } from "@playwright/test";

import { monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";
import { notificationPageFixture } from "../src/test/api-contract-fixtures.js";

import { installBackendApi, type MediaMode } from "./backend-api.js";

test("이력에서 녹화로 이동할 때 사용자 영역과 수신 상태를 숨기고 조회 완료 후 표시한다", async ({ page }) => {
  await installBackendApi(page);
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector("header .header-login-link")) document.documentElement.dataset.loginLinkSeen = "true";
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/history?source=api");
  await expect(page.getByRole("button", { name: "사용자 메뉴", exact: true })).toBeVisible();
  let releaseConfig = () => {};
  let releaseSession = () => {};
  const configGate = new Promise<void>((resolve) => { releaseConfig = resolve; });
  const sessionGate = new Promise<void>((resolve) => { releaseSession = resolve; });
  await page.route("**/runtime-config.json", async (route) => { await configGate; await route.fallback(); });
  await page.route("**/api/v1/session", async (route) => { await sessionGate; await route.fallback(); });
  try {
    await page.getByRole("link", { name: "녹화 영상", exact: true }).click();
    await expect(page.getByRole("main", { name: "대시보드 설정을 불러오는 중입니다.", exact: true })).toBeVisible();
    await expect(page.locator("header .user-tools")).toBeEmpty();
    await expect(page.getByLabel("데이터 수신 상태")).toHaveCount(0);
    releaseConfig();
    await expect(page.getByRole("main", { name: "데이터를 불러오는 중입니다.", exact: true })).toBeVisible();
    await expect(page.locator("header .user-tools")).toBeEmpty();
    await expect(page.getByLabel("데이터 수신 상태")).toHaveCount(0);
    await expect(page.getByText("수신 대기", { exact: true })).toHaveCount(0);
    await expect(page.getByText("마지막 수신 없음", { exact: true })).toHaveCount(0);
    releaseSession();
    await expect(page.getByRole("heading", { name: "녹화 영상", level: 1, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "사용자 메뉴", exact: true })).toBeVisible();
    await expect(page.getByLabel("데이터 수신 상태")).toContainText("연결 정상");
    await expect(page.locator("header .header-login-link")).toHaveCount(0);
    expect(await page.locator("html").getAttribute("data-login-link-seen")).toBeNull();
  } finally {
    releaseConfig();
    releaseSession();
  }
});

test("공통 상단은 판단 상태와 별도로 수신 시각, 연결 오류와 동일 snapshot 복구를 표시한다", async ({ page }) => {
  const initial = { ...monitoringV2StateFixture("UNAVAILABLE"), measuredAt: null };
  const api = await installBackendApi(page, { initial });
  for (const path of ["/", "/history", "/recordings"]) {
    const first = "2026-10-15T12:34:56.000Z";
    const recovered = "2026-10-15T12:35:56.000Z";
    await page.clock.setFixedTime(new Date(first));
    await page.goto(`${path}?source=api`);
    const meta = page.getByLabel("데이터 수신 상태");
    await expect(meta).toContainText("연결 정상");
    await expect(meta.locator("time")).toHaveAttribute("datetime", first);
    await expect(meta.locator("time")).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    await expect(meta).not.toContainText("판단 불가");
    await page.evaluate(() => window.backendFixture.emit("error", ""));
    await expect(meta).toContainText("연결 문제");
    await expect(meta.locator("time")).toHaveAttribute("datetime", first);
    await page.clock.setFixedTime(new Date(recovered));
    await api.snapshot(initial);
    await expect(meta).toContainText("연결 정상");
    await expect(meta.locator("time")).toHaveAttribute("datetime", recovered);
  }
});

test("실제 API와 synthetic 화면은 같은 카드 순서, 위치와 크기를 유지한다", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".monitoring-grid > .card")).toHaveCount(8);
  const layout = () => page.locator(".monitoring-grid > .card").evaluateAll((cards) => cards.map((card) => {
    const { x, y, width, height } = card.getBoundingClientRect();
    return { label: card.querySelector("h2")?.textContent ?? card.getAttribute("aria-label"), x, y, width, height };
  }));
  const initial = await layout();
  await installBackendApi(page);
  await page.goto("/?source=api");
  await expect(page.locator(".monitoring-grid > .card")).toHaveCount(8);
  expect(await layout()).toEqual(initial);
  await expect(page.locator(".kpi-value")).toHaveText("판단 불가");
  await expect(page.locator(".load-chart-line").first()).toBeVisible();
  await expect(page.locator(".alerts-card")).not.toContainText("0건");
  await expect(page.locator(".kpi-card")).not.toContainText("적재 중");
});

test("적재율 경보는 Backend의 평가 결과를 표시하고 연결 중단과 미제공을 구분한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial: monitoringV2StateFixture("FRESH", 72.5) });
  await page.goto("/?source=api");
  const alarm = page.locator(".alarm-status");
  await expect(alarm).toHaveText("미지원");
  const valueColor = await page.locator(".mini-stat strong").first().evaluate(element => getComputedStyle(element).color);
  await expect(alarm).toHaveCSS("color", valueColor);
  for (const [effectiveState, text, percent] of [
    ["NORMAL", "경고 기준 미만", 72.5],
    ["WARNING", "경고", 82.5],
    ["CRITICAL", "위험", 82.5],
    ["UNKNOWN", "확인 불가", 82.5],
    ["ERROR", "판정 불가", 82.5],
  ] as const) {
    await api.snapshot({ ...monitoringV2StateFixture(effectiveState === "ERROR" ? "UNAVAILABLE" : effectiveState === "UNKNOWN" ? "UNKNOWN" : "FRESH", percent), operations: {
      effectiveState, lastKnownState: "CRITICAL", lastEvaluatedAt: null, lastAlertAt: null, notificationId: null,
    } });
    await expect(alarm).toHaveText(text);
    await expect(alarm).toHaveCSS("color", valueColor);
    expect(await alarm.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.locator(".kpi-card")).not.toContainText("운영 상태");
    await expect(page.locator(".kpi-card")).not.toContainText("수거 중");
  }
  const critical = { ...monitoringV2StateFixture("FRESH", 82.5), operations: {
    effectiveState: "CRITICAL" as const, lastKnownState: "CRITICAL" as const, lastEvaluatedAt: null, lastAlertAt: null, notificationId: null,
  } };
  await api.snapshot(critical);
  await expect(alarm).toHaveText("위험");
  await page.evaluate(() => window.backendFixture.emit("error", ""));
  await expect(alarm).toHaveText("확인 불가");
  await api.snapshot(critical);
  await expect(alarm).toHaveText("위험");
  await api.snapshot({ ...monitoringV2StateFixture("FRESH", 72.5), operations: null });
  await expect(alarm).toHaveText("미지원");
  await expect(alarm).toHaveCSS("color", valueColor);
  expect(await alarm.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
});

test("제공된 경보 평가와 실제 완료 시각을 변환하고 새 경보를 알림함에 연결한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial: monitoringV2StateFixture("FRESH", 0) });
  api.setCompletionEvents([{ id: "evt-col-opaque", type: "collection_completed", category: "collection", status: "completed", severity: "info", occurredAt: "2026-10-12T22:00:10Z", title: "수거 완료", detail: "실제 완료 기록", resolvedAt: "2026-10-12T22:00:10Z", recordingId: null }]);
  await page.goto("/?source=api");
  const elapsed = page.locator(".status-details > div").filter({ hasText: "최근 수거 후 경과" });
  await expect(elapsed).toContainText("2시간 0분");
  api.setNotifications({ ...notificationPageFixture, unreadCount: 2, page: { ...notificationPageFixture.page, totalItems: 2 }, items: [{
    id: "notif-v2-opaque", detail: "v2 경보가 기록되었습니다.", occurredAt: "2026-10-13T00:00:10Z", readAt: null, severity: "error", title: "수거 필요", type: "collection_required",
  }, ...notificationPageFixture.items] });
  await api.snapshot({ ...monitoringV2StateFixture("FRESH", 95), operations: {
    effectiveState: "CRITICAL", lastKnownState: "CRITICAL", lastEvaluatedAt: "2026-10-13T00:00:09Z", lastAlertAt: "2026-10-13T00:00:10Z", notificationId: "notif-v2-opaque",
  } });
  await expect(page.locator(".kpi-value")).toHaveText("95%");
  await page.getByRole("button", { name: "알림 2건", exact: true }).click();
  await expect(page.getByLabel("최근 알림").getByText("수거 필요", { exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "스크랩 모니터링", exact: true }).click();
  await expect(page.locator(".alarm-status")).toHaveText("위험");
  await expect(page.getByRole("button", { name: "상태 상세", exact: true })).toHaveCount(0);
  await expect(page.locator(".kpi-card")).not.toContainText("수거 중");
  await expect(page.locator(".alerts-card")).not.toContainText("0건");
  expect(api.requests.some((url) => url.pathname === "/api/v1/monitoring/snapshot")).toBe(false);
});

test("모두 읽음 응답이 늦어도 요청 이후의 새 경보는 미읽음 상태를 유지한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial: monitoringV2StateFixture("FRESH", 0) });
  let announceRead = () => {};
  let releaseRead = () => {};
  const readStarted = new Promise<void>((resolve) => { announceRead = resolve; });
  const readAcknowledged = new Promise<void>((resolve) => { releaseRead = resolve; });
  await page.route("**/api/v1/notifications/read-all", async (route) => {
    api.setNotifications({ ...notificationPageFixture, unreadCount: 0, items: notificationPageFixture.items.map((item) => ({ ...item, readAt: "2026-10-13T00:00:10Z" })) });
    announceRead();
    await readAcknowledged;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/?source=api");
  await page.getByRole("button", { name: "알림 1건", exact: true }).click();
  await page.getByRole("button", { name: "모두 읽음" }).click();
  await readStarted;
  api.setNotifications({ ...notificationPageFixture, unreadCount: 1, items: [
    { ...notificationPageFixture.items[0], id: "notif-after-read", title: "새 경보", readAt: null },
    ...notificationPageFixture.items.map((item) => ({ ...item, readAt: "2026-10-13T00:00:10Z" })),
  ] });
  const updated = { ...monitoringV2StateFixture("FRESH", 95), operations: {
    effectiveState: "CRITICAL" as const, lastKnownState: "CRITICAL" as const, lastEvaluatedAt: null, lastAlertAt: null, notificationId: "notif-after-read",
  } };
  await api.snapshot(updated);
  const notification = page.locator(".header-notification").filter({ hasText: "새 경보" });
  await expect(notification).toBeVisible();
  await expect(page.getByRole("button", { name: "알림 1건", exact: true })).toBeVisible();
  const acknowledgment = page.waitForResponse((response) => response.url().endsWith("/api/v1/notifications/read-all"));
  releaseRead();
  await acknowledgment;
  await expect.poll(() => api.requests.filter((url) => url.pathname === "/api/v1/notifications").length).toBe(3);
  await api.snapshot(updated);
  await expect(notification).not.toHaveClass(/(?:^|\s)read(?:\s|$)/);
  await expect(page.getByRole("button", { name: "알림 1건", exact: true })).toBeVisible();
});

test("모두 읽음 이후의 목록 재조회 실패는 성공한 읽음을 되돌리지 않는다", async ({ page }) => {
  const initial = monitoringV2StateFixture("FRESH", 0);
  const api = await installBackendApi(page, { initial });
  let notificationRequests = 0;
  await page.route("**/api/v1/notifications?*", async (route) => {
    if (++notificationRequests === 2) await route.fulfill({ json: { detail: "Unavailable" }, status: 503 });
    else await route.fallback();
  });
  await page.goto("/?source=api");
  await page.getByRole("button", { name: "알림 1건", exact: true }).click();
  const failedRefresh = page.waitForResponse((response) => response.url().includes("/api/v1/notifications?") && response.status() === 503);
  await page.getByRole("button", { name: "모두 읽음" }).click();
  await failedRefresh;
  await expect(page.getByRole("button", { name: "알림 0건", exact: true })).toBeVisible();
  await expect(page.locator(".header-notification").first()).toHaveClass(/(?:^|\s)read(?:\s|$)/);
  await expect(page.getByRole("alert")).toContainText("알림");
  await expect(page.getByRole("button", { name: "알림 다시 조회", exact: true })).toHaveCount(0);
  await api.snapshot(initial);
  await expect.poll(() => notificationRequests).toBe(3);
  await expect(page.getByRole("button", { name: "알림 0건", exact: true })).toBeVisible();
});

test("v2 전체 상태, 0%와 소수 적재율을 표시하고 동일 snapshot으로 복구한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial: monitoringV2StateFixture("FRESH", 0) });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?source=api");
  await expect(page.locator(".kpi-value")).toHaveText("0%");
  for (const state of ["STALE", "UNKNOWN", "NO_DATA", "UNAVAILABLE", "FRESH"] as const) {
    await api.snapshot(monitoringV2StateFixture(state, 72.5));
    await expect(page.locator(".kpi-value")).toHaveText(state === "FRESH" ? "72.5%" : "판단 불가");
  }
  await page.evaluate(() => window.backendFixture.emit("error", ""));
  await expect(page.locator(".kpi-value")).toHaveText("판단 불가");
  await expect(page.getByRole("status").filter({ hasText: "재연결" })).toBeVisible();
  await api.snapshot(monitoringV2StateFixture("FRESH", 72.5));
  await expect(page.locator(".kpi-value")).toHaveText("72.5%");
  for (const percent of [72.123456, 99.999999, 0.000001]) {
    await api.snapshot(monitoringV2StateFixture("FRESH", percent));
    await expect(page.locator(".kpi-value")).toHaveText(`${percent}%`);
    expect(await page.locator(".kpi-value").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
  }
  await api.snapshot(monitoringV2StateFixture("FRESH", 72.5));
  await page.evaluate(() => window.backendFixture.emit("monitoring.snapshot", "{broken"));
  await expect(page.locator(".kpi-value")).toHaveText("72.5%");
  expect(errors).toEqual([]);
  expect(api.requests.some((url) => url.pathname === "/api/v1/monitoring/snapshot")).toBe(false);
  expect(api.requests.some((url) => url.pathname.includes("webrtc"))).toBe(false);
});

test("v2 영상 확대와 키보드 닫기는 단일 연결 및 자원 회수를 유지한다", async ({ page }) => {
  await installBackendApi(page);
  await page.goto("/?source=api");
  await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
  const opener = page.getByRole("button", { name: "실시간 영상 크게 보기" });
  for (let index = 0; index < 3; index += 1) {
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "실시간 영상 크게 보기" });
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole("button", { name: "영상 닫기", exact: true });
    await expect(close).toBeFocused();
    const bounds = await close.boundingBox();
    expect(bounds?.y).toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(close).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.backendFixture.metrics().videos)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.backendFixture.metrics().objectUrls)).toBe(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  await page.getByRole("link", { name: "이력", exact: true }).click();
  await expect(page.getByRole("heading", { name: "이력", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.backendFixture.metrics().videos)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.backendFixture.metrics().objectUrls)).toBe(0);
});

for (const mode of ["silent", "unavailable", "invalid"] satisfies MediaMode[]) {
  test(`v2 영상 ${mode} 오류는 LIVE를 숨기고 제한된 재연결 뒤 수동 재시도를 제공한다`, async ({ page }) => {
    await page.clock.install();
    await installBackendApi(page, { mediaMode: mode });
    await page.goto("/?source=api");
    await expect(page.locator(".kpi-value")).toHaveText("판단 불가");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect.poll(() => page.evaluate(() => window.backendFixture.metrics().attempts)).toBe(attempt + 1);
      if (mode === "silent") await page.clock.runFor(10_000);
      if (attempt < 3) await page.clock.runFor((attempt + 1) * 1000);
    }
    await expect(page.getByText("영상 연결 불가", { exact: true })).toBeVisible();
    await expect(page.getByText("LIVE", { exact: true })).toHaveCount(0);
    await expect(page.locator(".live-time")).toHaveCount(0);
    await page.getByRole("button", { name: "영상 다시 연결" }).click();
    await expect.poll(() => page.evaluate(() => window.backendFixture.metrics().attempts)).toBe(5);
  });
}

test("v2 초기 인증과 session 만료는 로그인으로 이동하고 연결을 종료한다", async ({ page }) => {
  const api = await installBackendApi(page, { authenticated: false });
  await page.goto("/?source=api");
  await expect(page).toHaveURL(/\/login$/);
  expect(api.requests.some((url) => url.pathname === "/api/v2/monitoring/snapshot")).toBe(false);
  await page.getByLabel("아이디").fill("synthetic-operator");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.locator(".kpi-value")).toHaveText("판단 불가");
  api.expire();
  await page.evaluate(() => window.backendFixture.emit("session.expired", "{}"));
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate(() => window.backendFixture.metrics().videos)).toBe(0);
});

test("v2 긴 계약 정보와 녹화 metadata는 모든 대상 너비에서 잘리지 않는다", async ({ page }) => {
  const initial = { ...monitoringV2StateFixture("UNAVAILABLE"), reasonCodes: ["SYNTHETIC_".repeat(30)] };
  await installBackendApi(page, { initial });
  for (const path of ["/?source=api", "/recordings?source=api"]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    if (path.startsWith("/?")) {
      await expect(page.getByRole("button", { name: "상태 상세", exact: true })).toHaveCount(0);
      await expect(page.getByText(initial.reasonCodes[0], { exact: true })).toHaveCount(0);
    }
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cards: Math.max(0, ...[...document.querySelectorAll(".card")].map((card) => card.scrollHeight - card.clientHeight)),
    }));
    expect(overflow.page).toBeLessThanOrEqual(0);
    expect(overflow.cards).toBeLessThanOrEqual(2);
  }
});
