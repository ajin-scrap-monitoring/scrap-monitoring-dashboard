import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { DashboardDataSource } from "./dashboard-data-source";
import { createMockDashboardDataSource } from "./mock-dashboard-data-source";
import { useDashboardData } from "./use-dashboard-data";

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
