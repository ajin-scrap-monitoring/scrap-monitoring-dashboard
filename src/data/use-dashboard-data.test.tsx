import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { DashboardDataSource } from "./dashboard-data-source";
import { createMockDashboardDataSource } from "./mock-dashboard-data-source";
import { useDashboardData } from "./use-dashboard-data";
import { ApiError } from "./http-dashboard-data-source";

function DashboardDataHarness({ dataSource }: { dataSource: DashboardDataSource }) {
  const { data, error, isLoading, reload } = useDashboardData(dataSource);

  return (
    <div>
      {isLoading && <span>loading</span>}
      {error && <span>{error.message}</span>}
      {data && <span>{data.monitoring.summary.loadPercent}%</span>}
      <button type="button" onClick={reload}>retry</button>
    </div>
  );
}

test("요청 오류 뒤 재시도하면 새 스냅샷을 표시한다", async () => {
  const normalSource = createMockDashboardDataSource();
  let attempt = 0;
  const dataSource: DashboardDataSource = {
    getDashboardData: async (options) => {
      attempt += 1;
      if (attempt === 1) throw new Error("temporary failure");
      return normalSource.getDashboardData(options);
    },
  };

  render(<DashboardDataHarness dataSource={dataSource} />);

  expect(await screen.findByText("temporary failure")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  expect(await screen.findByText("72%")).toBeVisible();
});

test("초기 스냅샷을 적용한 뒤 실시간 구독을 시작한다", async () => {
  const initialData = await createMockDashboardDataSource().getDashboardData();
  const latestData = structuredClone(initialData);
  latestData.monitoring.summary.loadPercent = 91;
  let resolveInitial: ((data: typeof initialData) => void) | undefined;
  let publishSnapshot: ((data: typeof initialData) => void) | undefined;
  const subscribe = vi.fn((listener: (data: typeof initialData) => void) => {
    publishSnapshot = listener;
    return () => undefined;
  });
  const dataSource: DashboardDataSource = {
    getDashboardData: () => new Promise((resolve) => {
      resolveInitial = resolve;
    }),
    subscribe,
  };

  render(<DashboardDataHarness dataSource={dataSource} />);
  expect(subscribe).not.toHaveBeenCalled();

  await act(async () => {
    resolveInitial?.(initialData);
    await Promise.resolve();
  });
  expect(screen.getByText("72%")).toBeVisible();
  expect(subscribe).toHaveBeenCalledOnce();

  act(() => {
    publishSnapshot?.(latestData);
  });
  expect(screen.getByText("91%")).toBeVisible();
});

test("초기 스냅샷 요청이 실패하면 실시간 구독을 시작하지 않는다", async () => {
  let rejectInitial: ((error: Error) => void) | undefined;
  const subscribe = vi.fn(() => () => undefined);
  const dataSource: DashboardDataSource = {
    getDashboardData: () => new Promise((_, reject) => {
      rejectInitial = reject;
    }),
    subscribe,
  };

  render(<DashboardDataHarness dataSource={dataSource} />);

  await act(async () => {
    rejectInitial?.(new Error("stale failure"));
    await Promise.resolve();
  });
  expect(screen.getByText("stale failure")).toBeVisible();
  expect(subscribe).not.toHaveBeenCalled();
});

test("reload 뒤 늦은 초기 응답은 새 요청과 구독을 덮어쓰지 않는다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const latest = structuredClone(data);
  latest.monitoring.summary.loadPercent = 90;
  const pending: ((value: typeof data) => void)[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const subscribe = vi.fn(() => () => undefined);
  const source: DashboardDataSource = {
    getDashboardData: (options) => new Promise((resolve) => { pending.push(resolve); signals.push(options?.signal); }), subscribe,
  };
  render(<DashboardDataHarness dataSource={source} />);
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  expect(signals[0]?.aborted).toBe(true);
  await act(() => { pending[1](latest); return Promise.resolve(); });
  await act(() => { pending[0](data); return Promise.resolve(); });
  expect(screen.getByText("90%")).toBeVisible();
  expect(subscribe).toHaveBeenCalledOnce();
});

test("화면 종료는 구독과 초기 요청을 취소하고 늦은 event를 무시한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const unsubscribe = vi.fn();
  let publish: (value: typeof data) => void = () => undefined;
  let signal: AbortSignal | undefined;
  const source: DashboardDataSource = {
    getDashboardData: (options) => { signal = options?.signal; return Promise.resolve(data); },
    subscribe: (listener) => { publish = listener; return unsubscribe; },
  };
  const view = render(<DashboardDataHarness dataSource={source} />);
  await screen.findByText("72%");
  view.unmount();
  expect(signal?.aborted).toBe(true);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(() => publish(data)).not.toThrow();
});

test("구독의 권한 부족은 기존 데이터를 숨기고 명시적 오류를 표시한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const unsubscribe = vi.fn();
  let publish: (value: typeof data) => void = () => undefined;
  const source: DashboardDataSource = {
    getDashboardData: () => Promise.resolve(data),
    subscribe: (listener) => { publish = listener; return unsubscribe; },
  };
  render(<DashboardDataHarness dataSource={source} />);
  await screen.findByText("72%");
  act(() => publish({ ...data, authError: { status: 403, message: "조회 권한이 없습니다." } }));
  expect(screen.getByText("조회 권한이 없습니다.")).toBeVisible();
  expect(screen.queryByText("72%")).not.toBeInTheDocument();
  expect(unsubscribe).toHaveBeenCalledOnce();
  act(() => publish(data));
  expect(screen.getByText("조회 권한이 없습니다.")).toBeVisible();
  expect(screen.queryByText("72%")).not.toBeInTheDocument();
});

test("403으로 실패한 source에서 정상 source로 바꾸면 대기 중 이전 오류를 숨기고 성공 시 해소한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const denied: DashboardDataSource = { getDashboardData: () => Promise.reject(new ApiError(403, "source-A denied")) };
  let resolveNext: (value: typeof data) => void = () => undefined;
  const available: DashboardDataSource = { getDashboardData: () => new Promise(resolve => { resolveNext = resolve; }) };
  const view = render(<DashboardDataHarness dataSource={denied} />);
  expect(await screen.findByText("source-A denied")).toBeVisible();
  view.rerender(<DashboardDataHarness dataSource={available} />);
  expect(screen.queryByText("source-A denied")).not.toBeInTheDocument();
  expect(screen.getByText("loading")).toBeVisible();
  await act(() => { resolveNext(data); return Promise.resolve(); });
  expect(screen.getByText("72%")).toBeVisible();
  expect(screen.queryByText("source-A denied")).not.toBeInTheDocument();
  expect(screen.queryByText("loading")).not.toBeInTheDocument();
});

test("source 변경 중에는 이전 데이터와 구독을 숨기고 늦은 성공 및 오류를 무시한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const nextData = structuredClone(data);
  nextData.monitoring.summary.loadPercent = 91;
  const unsubscribe = vi.fn();
  let publishPrevious: (value: typeof data) => void = () => undefined;
  const previous: DashboardDataSource = { getDashboardData: () => Promise.resolve(data),
    subscribe: listener => { publishPrevious = listener; return unsubscribe; } };
  let resolveNext: (value: typeof data) => void = () => undefined;
  const next: DashboardDataSource = { getDashboardData: () => new Promise(resolve => { resolveNext = resolve; }) };
  const view = render(<DashboardDataHarness dataSource={previous} />);
  await screen.findByText("72%");
  view.rerender(<DashboardDataHarness dataSource={next} />);
  expect(screen.queryByText("72%")).not.toBeInTheDocument();
  expect(screen.getByText("loading")).toBeVisible();
  expect(unsubscribe).toHaveBeenCalledOnce();
  act(() => publishPrevious({ ...data, authError: { status: 403, message: "late denied" } }));
  await act(() => { resolveNext(nextData); return Promise.resolve(); });
  expect(screen.getByText("91%")).toBeVisible();
  expect(screen.queryByText("late denied")).not.toBeInTheDocument();
});

test.each(["success", "failure"])("이전 source의 늦은 초기 %s는 새 source 결과를 덮어쓰지 않는다", async outcome => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const nextData = structuredClone(data);
  nextData.monitoring.summary.loadPercent = 91;
  let resolvePrevious: (value: typeof data) => void = () => undefined;
  let rejectPrevious: (error: Error) => void = () => undefined;
  let signal: AbortSignal | undefined;
  const previous: DashboardDataSource = { getDashboardData: options => {
    signal = options?.signal;
    return new Promise((resolve, reject) => { resolvePrevious = resolve; rejectPrevious = reject; });
  } };
  const next: DashboardDataSource = { getDashboardData: () => Promise.resolve(nextData) };
  const view = render(<DashboardDataHarness dataSource={previous} />);
  view.rerender(<DashboardDataHarness dataSource={next} />);
  await screen.findByText("91%");
  expect(signal?.aborted).toBe(true);
  await act(() => {
    if (outcome === "success") resolvePrevious(data);
    else rejectPrevious(new Error("late failure"));
    return Promise.resolve();
  });
  expect(screen.getByText("91%")).toBeVisible();
  expect(screen.queryByText("72%")).not.toBeInTheDocument();
  expect(screen.queryByText("late failure")).not.toBeInTheDocument();
});
