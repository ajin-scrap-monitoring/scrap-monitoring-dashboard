import { expect, test } from "@playwright/test";

import { sessionFixture } from "../src/test/api-contract-fixtures.js";
import { installBackendApi } from "./backend-api.js";

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
      release();
      await expect(page.getByRole("heading", { name: title, level: 1, exact: true })).toBeVisible();
      expect(api.requests.filter(url => url.pathname === "/api/v2/monitoring/load-history")).toHaveLength(path === "/history" ? 1 : 0);
      expect(api.requests.some(url => url.pathname === "/api/v1/events" && url.searchParams.get("pageSize") === "1")).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { release(); }
  });
}
