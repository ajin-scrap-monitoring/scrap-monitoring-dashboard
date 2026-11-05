import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import { App } from "./App";
import { resetNavigationForTesting } from "./app-router";
import { createMockDashboardDataSource } from "./data/mock-dashboard-data-source";

beforeEach(() => {
  resetNavigationForTesting();
});

test.each(["/history", "/recordings"])("%s의 최초 데이터 확인 중에는 로그인 링크나 사용자 메뉴를 표시하지 않는다", async (path) => {
  const data = await createMockDashboardDataSource().getDashboardData();
  data.session = { expiresAt: "2026-10-16T00:00:00Z", user: { displayName: "조회 사용자", id: "viewer-1", role: "viewer" } };
  let complete: (value: typeof data) => void = () => undefined;
  const dataSource = { getDashboardData: () => new Promise<typeof data>((resolve) => { complete = resolve; }) };
  window.history.replaceState(null, "", path);
  render(<App dataSource={dataSource} />);
  expect(screen.getByRole("main", { name: "데이터를 불러오는 중입니다." })).toBeVisible();
  expect(screen.queryByRole("link", { name: "로그인" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "사용자 메뉴" })).not.toBeInTheDocument();
  expect(document.querySelector(".global-nav")).toBeEmptyDOMElement();
  expect(screen.queryByLabelText("데이터 수신 상태")).not.toBeInTheDocument();
  await act(() => { complete(data); return Promise.resolve(); });
  expect(await screen.findByRole("button", { name: "사용자 메뉴" })).toBeVisible();
  expect(screen.getByText("조회 사용자")).toBeVisible();
  expect(Array.from(document.querySelectorAll(".global-nav a"), link => link.textContent)).toEqual(["현황", "이력", "녹화 영상"]);
  expect(screen.queryByRole("link", { name: "로그인" })).not.toBeInTheDocument();
  expect(await screen.findByLabelText("데이터 수신 상태")).toHaveTextContent("연결 정상");
});

test("최초 조회 중에는 수신 상태를 숨기고 실패와 재시도 성공 후에는 표시한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  let reject: (error: Error) => void = () => undefined;
  const getDashboardData = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue(data);
  render(<App dataSource={{ getDashboardData }} />);
  expect(screen.queryByLabelText("데이터 수신 상태")).not.toBeInTheDocument();
  expect(screen.queryByText("수신 대기")).not.toBeInTheDocument();
  expect(screen.queryByText("마지막 수신 없음")).not.toBeInTheDocument();
  await act(() => { reject(new TypeError("Network error")); return Promise.resolve(); });
  expect(screen.getByLabelText("데이터 수신 상태")).toHaveTextContent("연결 문제");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 대시보드" })).toBeVisible();
  expect(screen.getByLabelText("데이터 수신 상태")).toHaveTextContent("연결 정상");
});

test("대시보드 주 영역을 렌더링한다", async () => {
  render(<App dataSource={createMockDashboardDataSource()} />);

  expect(await screen.findByRole("main", { name: "스크랩 모니터링 대시보드" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "스크랩 모니터링" })).toBeVisible();
  expect(
    screen.getByRole("img", { name: "최근 24시간 대표 적재율 그래프" }),
  ).toBeVisible();
  expect(screen.getByText("LiDAR 2 일부 측정 불가")).toBeVisible();
  expect(screen.getByText("1 / 2")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "다음 알림 페이지" }));
  expect(screen.getByText("2 / 2")).toBeVisible();
  expect(screen.getByText("안정성 경보")).toBeVisible();

  fireEvent.pointerEnter(screen.getByLabelText("08:00 대표 적재율 72%"));
  expect(screen.getByText("대표 적재율 72%")).toBeVisible();
});

test("유효한 차트 표본이 없어도 현재 상태 화면을 유지한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  data.monitoring.loadHistory = [];
  data.monitoring.lidarProfiles = data.monitoring.lidarProfiles.map((profile) => ({ ...profile, samples: [] }));
  data.monitoring.devices[0].status = "delayed";
  window.history.replaceState(null, "", "/");

  render(<App dataSource={{ getDashboardData: () => Promise.resolve(data) }} />);

  expect(await screen.findByText("최근 적재율 데이터가 없습니다.")).toBeVisible();
  expect(screen.getAllByText("유효한 높이 데이터가 없습니다.")).toHaveLength(2);
  expect(screen.getByText("지연", { exact: true })).toBeVisible();
});

test("로그인 화면에서는 대시보드 데이터를 요청하지 않는다", async () => {
  const getDashboardData = vi.fn(async () => createMockDashboardDataSource().getDashboardData());
  window.history.replaceState(null, "", "/login");

  render(<App dataSource={{ getDashboardData }} />);

  expect(await screen.findByRole("main", { name: "사용자 로그인" })).toBeVisible();
  expect(getDashboardData).not.toHaveBeenCalled();
});

test("모니터링 데이터가 없어도 이력 화면은 독립적으로 표시한다", async () => {
  window.history.replaceState(null, "", "/history");

  render(<App dataSource={createMockDashboardDataSource("no-data")} />);

  expect(await screen.findByRole("main", { name: "스크랩 모니터링 이력" })).toBeVisible();
  expect(screen.getByText("조회된 이벤트가 없습니다.")).toBeVisible();
});

test("조회 사용자의 관리자 경로에는 권한 오류를 표시한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  data.session = {
    expiresAt: "2026-09-10T18:00:00+09:00",
    user: { displayName: "조회자", id: "viewer-1", role: "viewer" },
  };
  window.history.replaceState(null, "", "/admin");

  render(<App dataSource={{ getDashboardData: () => Promise.resolve(data) }} />);

  expect(await screen.findByRole("main", { name: "접근 권한이 없습니다." })).toBeVisible();
  expect(screen.queryByRole("link", { name: /^관리자$/ })).not.toBeInTheDocument();
});

test("현황 화면 언마운트 시 activateMonitoringDetails의 release를 호출한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const release = vi.fn();
  const activateMonitoringDetails = vi.fn(() => ({
    ready: Promise.resolve(),
    release,
  }));
  const dataSource = {
    getDashboardData: () => Promise.resolve(data),
    activateMonitoringDetails,
  };
  window.history.replaceState(null, "", "/");
  const { unmount } = render(<App dataSource={dataSource} />);
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 대시보드" })).toBeVisible();
  expect(activateMonitoringDetails).toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();

  unmount();
  expect(release).toHaveBeenCalledOnce();
});

test.each([
  { name: "60초 초과 재진입은 새 collection summary 응답 전까지 로딩 화면을 유지한다", stale: true },
  { name: "60초 이내 재진입은 ready가 즉시 끝나 현황을 바로 표시한다", stale: false },
])("$name", async ({ stale }) => {
  const data = await createMockDashboardDataSource().getDashboardData();
  let finishSecond: () => void = () => {};
  let activations = 0;
  const activateMonitoringDetails = vi.fn(() => {
    activations += 1;
    if (activations === 2 && stale) {
      return { ready: new Promise<void>(resolve => { finishSecond = resolve; }), release: () => {} };
    }
    return { ready: Promise.resolve(), release: () => {} };
  });
  const dataSource = {
    getDashboardData: () => Promise.resolve(data),
    loadRouteData: vi.fn((route: string) => Promise.resolve(route === "history" ? { history: data.history } : {})),
    activateMonitoringDetails,
    isMonitoringDetailsReady: () => activations >= 1 && !stale,
  };
  window.history.replaceState(null, "", "/");
  render(<App dataSource={dataSource} />);
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 대시보드" })).toBeVisible();

  const { navigate } = await import("./app-router");
  act(() => { navigate("/history"); });
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 이력" })).toBeVisible();

  const loadingText = "데이터를 불러오는 중입니다.";
  const mentionsLoading = (node: Node) => node.textContent?.includes(loadingText) === true
    || (node instanceof Element && (node.getAttribute("aria-label") === loadingText || node.querySelector(`[aria-label="${loadingText}"]`) !== null));
  const records: MutationRecord[] = [];
  const observer = new MutationObserver(list => { records.push(...list); });
  observer.observe(document.body, { childList: true, subtree: true });
  act(() => { navigate("/"); });
  await act(() => Promise.resolve());
  records.push(...observer.takeRecords());
  const loadingSeen = records.some(record => Array.from(record.addedNodes).some(mentionsLoading));
  if (stale) {
    expect(await screen.findByText("데이터를 불러오는 중입니다.")).toBeVisible();
    expect(screen.queryByRole("main", { name: "스크랩 모니터링 대시보드" })).not.toBeInTheDocument();
    act(() => { finishSecond(); });
  }
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 대시보드" })).toBeVisible();
  observer.disconnect();
  if (!stale) expect(loadingSeen).toBe(false);
  expect(activateMonitoringDetails).toHaveBeenCalledTimes(2);
});

test("알림 상태가 loading이면 알림 확인 중을 표시하고 badge를 숨기며 popover에서 불러오는 중을 표시한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  data.session = { expiresAt: "2026-10-16T00:00:00Z", user: { displayName: "조회 사용자", id: "viewer-1", role: "viewer" } };
  data.monitoring.notificationState = { status: "loading" };
  data.monitoring.unreadNotificationCount = null;
  window.history.replaceState(null, "", "/");

  render(<App dataSource={{ getDashboardData: () => Promise.resolve(data) }} />);
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 대시보드" })).toBeVisible();

  const button = screen.getByRole("button", { name: "알림 확인 중" });
  expect(button).toBeVisible();
  expect(button.querySelector(".notification-badge")).toBeNull();

  fireEvent.click(button);
  // popover 모듈 로딩 중의 placeholder도 같은 문구를 표시하므로 실제 알림 popover의 버튼이 나타난 뒤 검사한다.
  expect(await screen.findByRole("button", { name: "모두 읽음" })).toBeDisabled();
  expect(screen.getByText("불러오는 중...")).toBeVisible();
});

test("4개 화면 이동 동안 getDashboardData와 subscribe는 1회이며, 각 화면 데이터는 이동마다 요청된다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  data.session = { expiresAt: "2026-10-16T00:00:00Z", user: { displayName: "관리자", id: "admin-1", role: "administrator" } };

  const getDashboardData = vi.fn().mockResolvedValue(data);
  const subscribe = vi.fn(() => () => {});
  const loadRouteData = vi.fn().mockImplementation((route: string) => {
    if (route === "history") return Promise.resolve({ history: data.history });
    if (route === "recordings") return Promise.resolve({ recordings: data.recordings, recordingsState: { status: "ready" } });
    if (route === "admin") return Promise.resolve({ admin: data.admin });
    return Promise.resolve({});
  });

  const dataSource = {
    getDashboardData,
    subscribe,
    loadRouteData,
    activateMonitoringDetails: () => ({ ready: Promise.resolve(), release: () => {} }),
  };

  window.history.replaceState(null, "", "/");
  render(<App dataSource={dataSource} />);

  expect(await screen.findByRole("main", { name: "스크랩 모니터링 대시보드" })).toBeVisible();
  expect(getDashboardData).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledTimes(1);

  // 이력으로 이동
  const { navigate } = await import("./app-router");
  act(() => {
    navigate("/history");
  });
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 이력" })).toBeVisible();
  expect(loadRouteData).toHaveBeenCalledWith("history", expect.anything());

  // 녹화 영상으로 이동
  act(() => {
    navigate("/recordings");
  });
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 녹화 영상" })).toBeVisible();
  expect(loadRouteData).toHaveBeenCalledWith("recordings", expect.anything());

  // 관리자로 이동
  act(() => {
    navigate("/admin");
  });
  expect(await screen.findByRole("main", { name: "관리자 설정" })).toBeVisible();
  expect(loadRouteData).toHaveBeenCalledWith("admin", expect.anything());

  // 이동 후에도 getDashboardData와 subscribe는 여전히 1회
  expect(getDashboardData).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledTimes(1);
});

test("빠른 연속 이동에서 이전 화면 데이터 요청은 abort되고 늦은 결과는 무시된다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const abortSignals: AbortSignal[] = [];

  let resolveHistory = () => {};
  const historyGate = new Promise((resolve) => { resolveHistory = () => resolve(undefined); });

  const loadRouteData = vi.fn().mockImplementation((route: string, options: { signal: AbortSignal }) => {
    abortSignals.push(options.signal);
    if (route === "history") {
      return historyGate.then(() => ({ history: data.history }));
    }
    if (route === "recordings") {
      return Promise.resolve({ recordings: data.recordings, recordingsState: { status: "ready" } });
    }
    return Promise.resolve({});
  });

  const dataSource = {
    getDashboardData: () => Promise.resolve(data),
    subscribe: () => () => {},
    loadRouteData,
    activateMonitoringDetails: () => ({ ready: Promise.resolve(), release: () => {} }),
  };

  window.history.replaceState(null, "", "/");
  render(<App dataSource={dataSource} />);
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 대시보드" })).toBeVisible();

  const { navigate } = await import("./app-router");

  act(() => {
    navigate("/history");
  });

  // history 요청 진행 중인 상태에서 바로 recordings로 navigate
  act(() => {
    navigate("/recordings");
  });

  // history 요청의 signal은 abort되어야 함
  expect(abortSignals[0].aborted).toBe(true);

  // recordings 화면이 성공적으로 표시됨
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 녹화 영상" })).toBeVisible();

  // 뒤늦게 history 응답이 도착해도 recordings 화면 유지
  act(() => {
    resolveHistory();
  });

  expect(screen.getByRole("main", { name: "스크랩 모니터링 녹화 영상" })).toBeVisible();
});

test("관리자 화면 앱 내부 진입 시 session을 재확인하고, 권한이 변경되었으면 접근 권한 없음을 표시한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  data.session = { expiresAt: "2026-10-16T00:00:00Z", user: { displayName: "관리자", id: "admin-1", role: "administrator" } };

  let subscriber: ((d: typeof data) => void) | null = null;

  const loadRouteData = vi.fn().mockImplementation((route: string, options: { revalidateSession?: boolean }) => {
    if (route === "admin" && options.revalidateSession) {
      // revalidateSession 시 일반 사용자 역할로 변경 시뮬레이션
      data.session = { expiresAt: "2026-10-16T00:00:00Z", user: { displayName: "일반사용자", id: "user-1", role: "viewer" } };
      subscriber?.(data);
      return Promise.resolve({ admin: { ...data.admin, recipients: [] } });
    }
    return Promise.resolve({});
  });

  const dataSource = {
    getDashboardData: () => Promise.resolve(data),
    subscribe: (fn: (d: typeof data) => void) => {
      subscriber = fn;
      return () => { subscriber = null; };
    },
    loadRouteData,
    activateMonitoringDetails: () => ({ ready: Promise.resolve(), release: () => {} }),
  };

  window.history.replaceState(null, "", "/");
  render(<App dataSource={dataSource} />);
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 대시보드" })).toBeVisible();

  const { navigate } = await import("./app-router");
  act(() => {
    navigate("/admin");
  });

  expect(loadRouteData).toHaveBeenCalledWith("admin", expect.objectContaining({ revalidateSession: true }));
  expect(await screen.findByRole("main", { name: "접근 권한이 없습니다." })).toBeVisible();
});

test("첫 화면 전 로딩은 메뉴를 숨기고 앱 내부 이동 로딩은 메뉴를 유지한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  data.session = { expiresAt: "2026-10-16T00:00:00Z", user: { displayName: "운영자", id: "user-1", role: "administrator" } };

  let resolveApp = () => {};
  const appGate = new Promise((resolve) => { resolveApp = () => resolve(undefined); });

  let resolveRecordings = () => {};
  const recordingsGate = new Promise((resolve) => { resolveRecordings = () => resolve(undefined); });

  const loadRouteData = vi.fn().mockImplementation((route: string) => {
    if (route === "recordings") {
      return recordingsGate.then(() => ({ recordings: data.recordings, recordingsState: { status: "ready" } }));
    }
    return Promise.resolve({});
  });

  const dataSource = {
    getDashboardData: () => appGate.then(() => data),
    subscribe: () => () => {},
    loadRouteData,
    activateMonitoringDetails: () => ({ ready: Promise.resolve(), release: () => {} }),
  };

  window.history.replaceState(null, "", "/");
  render(<App dataSource={dataSource} />);

  // 첫 화면 로딩 중: 메뉴와 사용자 도구 숨김
  expect(screen.getByRole("main", { name: "데이터를 불러오는 중입니다." })).toBeVisible();
  expect(document.querySelector(".global-nav")).toBeEmptyDOMElement();
  expect(screen.queryByRole("button", { name: "사용자 메뉴" })).not.toBeInTheDocument();

  // 첫 화면 로딩 완료
  act(() => {
    resolveApp();
  });
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 대시보드" })).toBeVisible();
  expect(document.querySelectorAll(".global-nav a")).toHaveLength(4);
  expect(screen.getByRole("button", { name: "사용자 메뉴" })).toBeVisible();

  // 앱 내부 이동: 녹화 영상으로 이동 (녹화 데이터 지연)
  const { navigate } = await import("./app-router");
  act(() => {
    navigate("/recordings");
  });

  // 앱 내부 이동 로딩 중: 본문은 로딩 화면이지만 메뉴와 사용자 도구 유지
  expect(screen.getByRole("main", { name: "데이터를 불러오는 중입니다." })).toBeVisible();
  expect(document.querySelectorAll(".global-nav a")).toHaveLength(4);
  expect(screen.getByRole("button", { name: "사용자 메뉴" })).toBeVisible();
  // 활성 탭은 이동 대상 화면인 "녹화 영상"
  const activeLink = document.querySelector(".global-nav a.active");
  expect(activeLink?.textContent).toBe("녹화 영상");

  // 녹화 데이터 완료
  act(() => {
    resolveRecordings();
  });
  expect(await screen.findByRole("main", { name: "스크랩 모니터링 녹화 영상" })).toBeVisible();
});
