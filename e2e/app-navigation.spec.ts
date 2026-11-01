import { expect, test } from "@playwright/test";
import { eventFixture } from "../src/test/api-contract-fixtures.js";
import { installBackendApi, syntheticEventReplay } from "./backend-api.js";

test("메뉴로 4개 화면을 2회 순환해도 document, config, snapshot 요청이 없고 session은 관리자 진입마다 재확인된다", async ({ page }) => {
  const api = await installBackendApi(page);

  let documentLoads = 0;
  let configRequests = 0;

  page.on("request", (req) => {
    if (req.isNavigationRequest()) documentLoads += 1;
    if (req.url().includes("runtime-config.json")) configRequests += 1;
  });

  await page.goto("/?source=api");
  await expect(page.getByRole("heading", { name: "스크랩 모니터링", level: 1, exact: true })).toBeVisible();

  const initialDocs = documentLoads;
  const initialConfigs = configRequests;
  const initialSnapshots = api.requests.filter((r) => r.pathname === "/api/v2/monitoring/snapshot").length;
  const initialSessions = api.requests.filter((r) => r.pathname === "/api/v1/session").length;

  for (let cycle = 0; cycle < 2; cycle += 1) {
    // 이력으로 이동
    await page.getByRole("link", { name: "이력", exact: true }).click();
    await expect(page.getByRole("heading", { name: "이력", level: 1, exact: true })).toBeVisible();

    // 녹화 영상으로 이동
    await page.getByRole("link", { name: "녹화 영상", exact: true }).click();
    await expect(page.getByRole("heading", { name: "녹화 영상", level: 1, exact: true })).toBeVisible();

    // 관리자로 이동 (session 재확인 발생)
    await page.getByRole("link", { name: "관리자", exact: true }).click();
    await expect(page.getByRole("heading", { name: "관리자 설정", level: 1, exact: true })).toBeVisible();

    // 현황으로 복귀
    await page.getByRole("link", { name: "현황", exact: true }).click();
    await expect(page.getByRole("heading", { name: "스크랩 모니터링", level: 1, exact: true })).toBeVisible();
  }

  // 첫 load 이후 추가 document, runtime-config, snapshot 요청 0
  expect(documentLoads).toBe(initialDocs);
  expect(configRequests).toBe(initialConfigs);
  expect(api.requests.filter((r) => r.pathname === "/api/v2/monitoring/snapshot").length).toBe(initialSnapshots);

  // session은 관리자 진입마다 1회 발생 (2회 순환 -> 총 2회 추가)
  expect(api.requests.filter((r) => r.pathname === "/api/v1/session").length).toBe(initialSessions + 2);

  // SSE 연결 1개 유지
  const metrics = await page.evaluate(() => window.backendFixture.metrics());
  expect(metrics.streams).toBe(1);
});

test("이력의 영상 보기 클릭 시 녹화 영상 화면으로 이동하고 브라우저 뒤로/앞으로 이동이 동작한다", async ({ page }) => {
  const api = await installBackendApi(page);
  const id = "evt-alt-31";
  api.setEventReplays([syntheticEventReplay({}, { eventId: id, occurredAt: "2026-10-12T00:00:00Z", windowFrom: "2026-10-11T23:59:30Z", windowTo: "2026-10-12T00:00:30Z" })]);
  api.setHistoryEvents([{ ...eventFixture, occurredAt: "2026-10-12T00:00:00Z", recordingId: "legacy-id", recordingEventId: id } as unknown as typeof eventFixture]);

  await page.goto("/history?source=api");
  await expect(page.getByRole("heading", { name: "이력", level: 1, exact: true })).toBeVisible();

  const videoLink = page.getByRole("link", { name: "영상 보기" }).first();
  await expect(videoLink).toBeVisible();
  await videoLink.click();

  // 녹화 영상 화면 및 query parameter 확인
  await expect(page.getByRole("heading", { name: "녹화 영상", level: 1, exact: true })).toBeVisible();
  expect(page.url()).toContain(`/recordings?recordingId=${id}`);

  // 브라우저 뒤로 이동
  await page.goBack();
  await expect(page.getByRole("heading", { name: "이력", level: 1, exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/history");

  // 브라우저 앞으로 이동
  await page.goForward();
  await expect(page.getByRole("heading", { name: "녹화 영상", level: 1, exact: true })).toBeVisible();
  expect(page.url()).toContain(`/recordings?recordingId=${id}`);
});

test("각 경로 직접 접속과 새로고침이 가능하고, Ctrl 클릭 시 현재 화면을 유지한다", async ({ page, context }) => {
  await installBackendApi(page);

  for (const path of ["/", "/history", "/recordings", "/admin"]) {
    await page.goto(`${path}?source=api`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }

  await page.goto("/?source=api");
  await expect(page.getByRole("heading", { name: "스크랩 모니터링", level: 1, exact: true })).toBeVisible();

  const newTabPromise = context.waitForEvent("page", { timeout: 2000 }).catch(() => null);
  await page.getByRole("link", { name: "이력", exact: true }).click({ modifiers: ["Control"] });

  expect(new URL(page.url()).pathname).toBe("/");
  const newTab = await newTabPromise;
  if (newTab) await newTab.close();
});

test("앱 내부 이동 중 session.expired SSE를 받으면 로그인 화면으로 이동한다", async ({ page }) => {
  await installBackendApi(page);
  await page.goto("/?source=api");
  await expect(page.getByRole("heading", { name: "스크랩 모니터링", level: 1, exact: true })).toBeVisible();

  await page.getByRole("link", { name: "이력", exact: true }).click();
  await expect(page.getByRole("heading", { name: "이력", level: 1, exact: true })).toBeVisible();

  await page.evaluate(() => {
    window.backendFixture.emit("session.expired", JSON.stringify({ reason: "session_expired" }));
  });

  await expect(page.getByRole("heading", { name: /스크랩 모니터링.*관리자 시스템/ })).toBeVisible();
  expect(page.url()).toContain("/login");
});

test("키보드로 메뉴 선택 시 새 화면의 h1에 focus가 가고 맨 위로 scroll된다", async ({ page }) => {
  await installBackendApi(page);
  await page.goto("/?source=api");
  await expect(page.getByRole("heading", { name: "스크랩 모니터링", level: 1, exact: true })).toBeVisible();

  const historyLink = page.getByRole("link", { name: "이력", exact: true });
  await historyLink.focus();
  await page.keyboard.press("Enter");

  const h1 = page.getByRole("heading", { name: "이력", level: 1, exact: true });
  await expect(h1).toBeVisible();
  await expect(h1).toBeFocused();

  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBe(0);
});

test("녹화 화면 영상 재생 중 다른 화면으로 이동하면 영상, object URL, 요청이 정리된다", async ({ page }) => {
  const api = await installBackendApi(page);
  const id = "evt-alt-31";
  api.setEventReplays([syntheticEventReplay({}, { eventId: id, occurredAt: "2026-10-12T00:00:00Z", windowFrom: "2026-10-11T23:59:30Z", windowTo: "2026-10-12T00:00:30Z" })]);
  api.setHistoryEvents([{ ...eventFixture, occurredAt: "2026-10-12T00:00:00Z", recordingId: "legacy-id", recordingEventId: id } as unknown as typeof eventFixture]);

  await page.goto(`/recordings?recordingId=${id}&source=api`);
  await expect(page.getByRole("heading", { name: "녹화 영상", level: 1, exact: true })).toBeVisible();

  const video = page.locator("video").first();
  await expect(video).toBeVisible();

  // 관리자 화면으로 이동
  await page.getByRole("link", { name: "관리자", exact: true }).click();
  await expect(page.getByRole("heading", { name: "관리자 설정", level: 1, exact: true })).toBeVisible();

  await expect.poll(() => page.evaluate(() => ({
    videos: document.querySelectorAll("video").length,
    objectUrls: window.backendFixture.metrics().objectUrls,
  }))).toEqual({ videos: 0, objectUrls: 0 });
});

test("탭이 숨겨지면 load-history와 camera-status 요청이 멈추고, 다시 보이면 재개된다", async ({ page }) => {
  const api = await installBackendApi(page);
  await page.goto("/?source=api");
  await expect(page.getByRole("heading", { name: "스크랩 모니터링", level: 1, exact: true })).toBeVisible();

  // 숨김 전환
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  const cameraRequestsBefore = api.requests.filter((r) => r.pathname === "/api/v2/monitoring/camera-status").length;
  const loadHistoryBefore = api.requests.filter((r) => r.pathname === "/api/v2/monitoring/load-history").length;

  // 3초 대기 동안 추가 요청 0
  await page.waitForTimeout(3000);

  expect(api.requests.filter((r) => r.pathname === "/api/v2/monitoring/camera-status").length).toBe(cameraRequestsBefore);
  expect(api.requests.filter((r) => r.pathname === "/api/v2/monitoring/load-history").length).toBe(loadHistoryBefore);

  // 다시 보임 전환
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  // 표시 복귀 후 camera-status 즉시 재조회로 요청 수 증가 확인
  await expect.poll(() => api.requests.filter((r) => r.pathname === "/api/v2/monitoring/camera-status").length).toBeGreaterThan(cameraRequestsBefore);
});

test("메뉴로 현황 -> 이력 -> 현황 이동 때 로딩 화면이 나타나지 않는다", async ({ page }) => {
  await installBackendApi(page);
  await page.addInitScript(() => {
    const text = "데이터를 불러오는 중입니다.";
    const w = window as unknown as { __loadingSeen: boolean; __observe: boolean };
    w.__loadingSeen = false;
    w.__observe = false;
    const check = (node: Node) => node.textContent?.includes(text) === true
      || (node instanceof Element && (node.getAttribute("aria-label") === text || node.querySelector(`[aria-label="${text}"]`) !== null));
    new MutationObserver((records) => {
      if (!w.__observe) return;
      if (records.some((record) => Array.from(record.addedNodes).some(check))) w.__loadingSeen = true;
    }).observe(document, { childList: true, subtree: true });
  });

  await page.goto("/?source=api");
  await expect(page.getByRole("heading", { name: "스크랩 모니터링", level: 1, exact: true })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __observe: boolean }).__observe = true; });

  await page.getByRole("link", { name: "이력", exact: true }).click();
  await expect(page.getByRole("heading", { name: "이력", level: 1, exact: true })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __loadingSeen: boolean }).__loadingSeen = false; });

  await page.getByRole("link", { name: "현황", exact: true }).click();
  await expect(page.getByRole("heading", { name: "스크랩 모니터링", level: 1, exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __loadingSeen: boolean }).__loadingSeen)).toBe(false);
});

test("현황과 다른 화면을 반복 이동해도 분리된 img와 SVG circle이 누적되지 않는다", async ({ page }) => {
  await installBackendApi(page);
  await page.goto("/?source=api");
  await expect(page.getByRole("heading", { name: "스크랩 모니터링", level: 1, exact: true })).toBeVisible();
  const cdp = await page.context().newCDPSession(page);

  const cycle = async () => {
    for (const [link, heading] of [["이력", "이력"], ["녹화 영상", "녹화 영상"], ["관리자", "관리자 설정"], ["현황", "스크랩 모니터링"]]) {
      await page.getByRole("link", { name: link, exact: true }).click();
      await expect(page.getByRole("heading", { name: heading, level: 1, exact: true })).toBeVisible();
    }
  };
  const countObjects = async (expression: string) => {
    const prototype = await cdp.send("Runtime.evaluate", { expression });
    const queried = await cdp.send("Runtime.queryObjects", { prototypeObjectId: prototype.result.objectId! });
    const length = await cdp.send("Runtime.callFunctionOn", { objectId: queried.objects.objectId!, functionDeclaration: "function () { return this.length; }", returnByValue: true });
    await cdp.send("Runtime.releaseObject", { objectId: queried.objects.objectId! });
    return length.result.value as number;
  };
  const measure = async () => {
    // 비동기 해제를 기다리기 위해 화면을 안정화한 뒤 GC를 두 번 실행한다.
    await page.waitForTimeout(500);
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    return { images: await countObjects("HTMLImageElement.prototype"), circles: await countObjects("SVGCircleElement.prototype") };
  };

  for (let index = 0; index < 3; index += 1) await cycle();
  const first = await measure();
  for (let index = 0; index < 6; index += 1) await cycle();
  const second = await measure();

  // 6바퀴 동안 누수가 있으면 바퀴 수에 비례해 늘어난다. 현재 화면의 요소 차이만 허용한다.
  expect(second.images).toBeLessThanOrEqual(first.images + 2);
  expect(second.circles).toBeLessThanOrEqual(first.circles + 10);
});
