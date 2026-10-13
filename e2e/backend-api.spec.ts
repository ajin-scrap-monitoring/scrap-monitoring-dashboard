import { expect, test } from "@playwright/test";

import { monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";

import { installBackendApi, type MediaMode } from "./backend-api.js";

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
    const close = dialog.getByRole("button", { name: "닫기", exact: true });
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
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cards: Math.max(0, ...[...document.querySelectorAll(".card")].map((card) => card.scrollHeight - card.clientHeight)),
    }));
    expect(overflow.page).toBeLessThanOrEqual(0);
    expect(overflow.cards).toBeLessThanOrEqual(2);
  }
});
