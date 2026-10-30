import { expect, test } from "@playwright/test";

import { sessionFixture } from "../src/test/api-contract-fixtures.js";
import { installBackendApi } from "./backend-api.js";

test("document 종료는 모든 연결을 정리하고 cached document 복원은 새 연결 하나만 시작한다", async ({ page }) => {
  const api = await installBackendApi(page);
  await page.goto("/?source=api");
  await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
  const geometry = await page.locator("main.monitoring-page").boundingBox();
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await expect.poll(() => page.evaluate(() => window.backendFixture.metrics())).toMatchObject({ streams: 1, videos: 1, objectUrls: 1 });
    const sessionQueries = api.requests.filter(url => url.pathname === "/api/v1/session").length;
    expect(await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      return { ...window.backendFixture.metrics(), rootChildren: document.getElementById("root")?.childElementCount };
    })).toMatchObject({ streams: 0, videos: 0, objectUrls: 0, rootChildren: 0 });
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.backendFixture.metrics())).toMatchObject({ streams: 1, videos: 1, objectUrls: 1 });
    expect(api.requests.filter(url => url.pathname === "/api/v1/session").length).toBeGreaterThan(sessionQueries);
    expect(await page.locator("main.monitoring-page").boundingBox()).toEqual(geometry);
  }
});

for (const [path, title, moduleName] of [
  ["/history", "이력", "HistoryPage"],
  ["/recordings", "녹화 영상", "RecordingsPage"],
  ["/admin", "관리자 설정", "AdminPage"],
] as const) {
  test(`${title} 모듈은 session 조회와 병렬 로드하고 현황 전용 정보를 조회하지 않는다`, async ({ page }) => {
    const api = await installBackendApi(page);
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let moduleRequested = false;
    page.on("request", request => {
      if (new URL(request.url()).pathname.includes(`/assets/${moduleName}-`)) moduleRequested = true;
    });
    await page.route("**/api/v1/session", async route => {
      await gate;
      await route.fulfill({ json: sessionFixture });
    });
    try {
      await page.goto(`${path}?source=api`);
      await expect.poll(() => moduleRequested).toBe(true);
      await expect(page.getByRole("main", { name: "데이터를 불러오는 중입니다." })).toBeVisible();
      await expect(page.getByRole("link", { name: "로그인", exact: true })).toHaveCount(0);
      await expect(page.locator(".global-nav a")).toHaveCount(0);
      const pendingHeader = await page.locator(".topbar").boundingBox();
      release();
      await expect(page.getByRole("heading", { name: title, level: 1, exact: true })).toBeVisible();
      await expect(page.locator(".global-nav a")).toHaveText(["현황", "이력", "녹화 영상", "관리자"]);
      expect(await page.locator(".topbar").boundingBox()).toEqual(pendingHeader);
      expect(api.requests.filter(url => url.pathname === "/api/v2/monitoring/load-history")).toHaveLength(path === "/history" ? 1 : 0);
      expect(api.requests.some(url => url.pathname === "/api/v1/events" && url.searchParams.get("pageSize") === "1")).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { release(); }
  });

  test(`${title} 모듈 대기 중에는 session 확인 후에도 메뉴와 사용자 도구를 숨긴다`, async ({ page }) => {
    await installBackendApi(page);
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/assets/${moduleName}-*.js`, async route => { await gate; await route.continue(); });
    try {
      await page.goto(`${path}?source=api`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("main", { name: "화면을 불러오는 중입니다." })).toBeVisible();
      await expect(page.locator(".global-nav a")).toHaveCount(0);
      await expect(page.locator(".user-tools")).toBeEmpty();
      const pendingHeader = await page.locator(".topbar").boundingBox();
      release();
      await expect(page.getByRole("heading", { name: title, level: 1, exact: true })).toBeVisible();
      await expect(page.locator(".global-nav a")).toHaveText(["현황", "이력", "녹화 영상", "관리자"]);
      expect(await page.locator(".topbar").boundingBox()).toEqual(pendingHeader);
    } finally { release(); }
  });
}
