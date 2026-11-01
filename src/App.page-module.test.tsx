import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const FALLBACK_TEXT = "화면을 불러오는 중입니다.";

beforeEach(() => {
  vi.resetModules();
  window.scrollTo = vi.fn();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.doUnmock("./pages/AdminPage");
  vi.resetModules();
});

async function loadApp() {
  const [{ App }, router, { createMockDashboardDataSource }] = await Promise.all([
    import("./App"),
    import("./app-router"),
    import("./data/mock-dashboard-data-source"),
  ]);
  router.resetNavigationForTesting();
  return { App, navigate: router.navigate, dataSource: createMockDashboardDataSource() };
}

function observeText(text: string) {
  let seen = false;
  const check = () => { if (document.body.textContent?.includes(text)) seen = true; };
  const observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return { stop: () => { check(); observer.disconnect(); return seen; } };
}

test.each([
  ["/history", "이력"],
  ["/recordings", "녹화 영상"],
  ["/admin", "관리자 설정"],
])("앱 내부 이동으로 처음 여는 %s 화면은 Suspense fallback 문구를 DOM에 만들지 않는다", async (path, heading) => {
  const { App, navigate, dataSource } = await loadApp();
  const session = { expiresAt: "2026-10-16T00:00:00Z", user: { displayName: "운영자", id: "user-1", role: "administrator" as const } };
  const getDashboardData = dataSource.getDashboardData.bind(dataSource);
  render(<App dataSource={{ ...dataSource, getDashboardData: async (options) => ({ ...(await getDashboardData(options)), session }) }} />);
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 대시보드" })).toBeVisible();

  const observer = observeText(FALLBACK_TEXT);
  act(() => { navigate(path); });
  expect(screen.getByRole("main", { name: "데이터를 불러오는 중입니다." })).toBeVisible();
  expect(document.querySelectorAll(".global-nav a").length).toBeGreaterThan(0);
  expect(await screen.findByRole("heading", { name: heading, level: 1 })).toBeVisible();
  expect(observer.stop()).toBe(false);
  expect(screen.queryByText(FALLBACK_TEXT)).not.toBeInTheDocument();
});

test("화면 모듈 load 실패는 오류 화면으로 표시하고 다시 시도로 복구한다", async () => {
  let attempts = 0;
  vi.doMock("./pages/AdminPage", async (importOriginal) => {
    attempts += 1;
    if (attempts === 1) throw new Error("chunk load failed");
    return importOriginal();
  });
  const { App, navigate, dataSource } = await loadApp();
  const session = { expiresAt: "2026-10-16T00:00:00Z", user: { displayName: "운영자", id: "user-1", role: "administrator" as const } };
  const getDashboardData = dataSource.getDashboardData.bind(dataSource);
  render(<App dataSource={{ ...dataSource, getDashboardData: async (options) => ({ ...(await getDashboardData(options)), session }) }} />);
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 대시보드" })).toBeVisible();

  act(() => { navigate("/admin"); });
  expect(await screen.findByRole("main", { name: "데이터를 불러올 수 없습니다." })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByRole("heading", { name: "관리자 설정", level: 1 })).toBeVisible();
  expect(attempts).toBeGreaterThanOrEqual(2);
});
