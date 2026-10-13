import { expect, test } from "@playwright/test";

import { installBackendApi } from "../e2e/backend-api.js";
import { monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";

const cases = [
  { origin: "http://dashboard:8080", pitId: "pit-01", cameraId: "camera-main" },
  { origin: "http://dashboard-alt:8080", pitId: "pit-example", cameraId: "camera-example" },
];

test("같은 production 이미지에 주입한 두 runtime 설정으로 실제 Browser의 대상을 변경한다", async ({ browser, playwright }) => {
  for (const config of cases) {
    const request = await playwright.request.newContext({ baseURL: config.origin });
    const context = await browser.newContext();
    try {
      const response = await request.get("/runtime-config.json");
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toMatch(/^application\/json/);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.json()).toEqual({ schemaVersion: 1, pitId: config.pitId, cameraId: config.cameraId });
      const page = await context.newPage();
      const snapshot = monitoringV2StateFixture("FRESH", 0);
      const initial = { ...snapshot, pitId: config.pitId, source: { ...snapshot.source, pit_id: config.pitId } };
      const api = await installBackendApi(page, { initial, runtimeConfig: false });
      await page.addInitScript(() => {
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, options) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.startsWith("/media/cameras/")) window.sessionStorage.setItem("runtime-test-camera", url);
          return nativeFetch(input, options);
        };
      });
      await page.goto(config.origin);
      await expect(page.locator(".kpi-value")).toHaveText("0%");
      const snapshots = api.requests.filter((url) => url.pathname === "/api/v2/monitoring/snapshot");
      expect(snapshots.length).toBeGreaterThan(0);
      expect(snapshots.every((url) => url.searchParams.get("pit_id") === config.pitId)).toBe(true);
      await expect.poll(() => page.evaluate(() => window.backendFixture.eventUrls()[0])).toBe(`/api/v2/monitoring/events?pit_id=${encodeURIComponent(config.pitId)}`);
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem("runtime-test-camera"))).toBe(`/media/cameras/${config.cameraId}/live`);
      await expect(page.locator(".live-indicator")).toBeVisible();
    } finally { await context.close(); await request.dispose(); }
  }
});

test("runtime 설정을 읽기 전에는 API와 영상을 요청하지 않는다", async ({ page }) => {
  const api = await installBackendApi(page, { runtimeConfig: false });
  let release: () => void = () => undefined;
  await page.route("**/runtime-config.json", async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { schemaVersion: 1, pitId: "pit-01", cameraId: "camera-main" } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "대시보드 설정을 불러오는 중입니다." })).toBeVisible();
  expect(api.requests).toHaveLength(0);
  expect(await page.evaluate(() => window.backendFixture.metrics().attempts)).toBe(0);
  release();
  await expect(page.getByRole("heading", { name: "스크랩 모니터링", exact: true })).toBeVisible();
});

test("runtime 대상 변경은 열린 화면을 유지하고 같은 Browser의 전체 reload에 적용한다", async ({ page }) => {
  const api = await installBackendApi(page, { initial: monitoringV2StateFixture("FRESH", 0), runtimeConfig: false });
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("/media/cameras/")) sessionStorage.setItem("runtime-test-camera", url);
      return nativeFetch(input, options);
    };
  });
  await page.goto("/");
  await expect(page.locator(".kpi-value")).toHaveText("0%");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("runtime-test-camera"))).toBe("/media/cameras/camera-main/live");
  let runtimeLoads = 0;
  await page.route("**/runtime-config.json", async (route) => {
    runtimeLoads += 1;
    await route.fulfill({ json: { schemaVersion: 1, pitId: "pit-example", cameraId: "camera-example" } });
  });
  const next = monitoringV2StateFixture("FRESH", 25);
  await api.snapshot({ ...next, pitId: "pit-example", source: { ...next.source, pit_id: "pit-example" } });
  await expect(page.locator(".kpi-value")).toHaveText("0%");
  expect(runtimeLoads).toBe(0);
  expect(api.requests.filter((url) => url.pathname === "/api/v2/monitoring/snapshot")
    .every((url) => url.searchParams.get("pit_id") === "pit-01")).toBe(true);
  const requestsBeforeReload = api.requests.length;
  await page.reload();
  await expect(page.locator(".kpi-value")).toHaveText("25%");
  expect(runtimeLoads).toBeGreaterThan(0);
  const requestsAfterReload = api.requests.slice(requestsBeforeReload)
    .filter((url) => url.pathname === "/api/v2/monitoring/snapshot");
  expect(requestsAfterReload.length).toBeGreaterThan(0);
  expect(requestsAfterReload.every((url) => url.searchParams.get("pit_id") === "pit-example")).toBe(true);
  await expect.poll(() => page.evaluate(() => window.backendFixture.eventUrls()[0])).toBe("/api/v2/monitoring/events?pit_id=pit-example");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("runtime-test-camera"))).toBe("/media/cameras/camera-example/live");
  await expect(page.locator(".live-indicator")).toBeVisible();
});

for (const [name, response] of [
  ["missing", { status: 404, body: "not found" }],
  ["malformed", { status: 200, contentType: "application/json", body: "{broken" }],
  ["unsupported", { status: 200, json: { schemaVersion: 2, pitId: "pit-01", cameraId: "camera-main" } }],
  ["invalid identifier", { status: 200, json: { schemaVersion: 1, pitId: "pit-01", cameraId: "../camera" } }],
] as const) {
  test(`runtime ${name} 설정 오류는 API 및 영상 요청을 차단하고 reload로 복구한다`, async ({ page }) => {
    const api = await installBackendApi(page, { runtimeConfig: false });
    await page.route("**/runtime-config.json", (route) => route.fulfill(response));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "대시보드 설정을 불러올 수 없습니다." })).toBeVisible();
    expect(api.requests).toHaveLength(0);
    expect(await page.evaluate(() => window.backendFixture.metrics().attempts)).toBe(0);
    await page.unroute("**/runtime-config.json");
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.getByRole("heading", { name: "스크랩 모니터링", exact: true })).toBeVisible();
  });
}
