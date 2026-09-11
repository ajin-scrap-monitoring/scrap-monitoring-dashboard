import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

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

test("실시간 스냅샷은 늦게 도착한 초기 응답에 덮어쓰이지 않는다", async () => {
  const staleData = await createMockDashboardDataSource().getDashboardData();
  const latestData = structuredClone(staleData);
  latestData.monitoring.summary.loadPercent = 91;
  let resolveInitial: ((data: typeof staleData) => void) | undefined;
  let publishSnapshot: ((data: typeof staleData) => void) | undefined;
  const dataSource: DashboardDataSource = {
    getDashboardData: () => new Promise((resolve) => {
      resolveInitial = resolve;
    }),
    subscribe: (listener) => {
      publishSnapshot = listener;
      return () => undefined;
    },
  };

  render(<DashboardDataHarness dataSource={dataSource} />);

  act(() => {
    publishSnapshot?.(latestData);
  });
  expect(screen.getByText("91%")).toBeVisible();

  act(() => {
    resolveInitial?.(staleData);
  });
  expect(screen.getByText("91%")).toBeVisible();
});

test("실시간 스냅샷 뒤의 초기 요청 오류는 최신 상태를 지우지 않는다", async () => {
  const latestData = await createMockDashboardDataSource().getDashboardData();
  latestData.monitoring.summary.loadPercent = 93;
  let rejectInitial: ((error: Error) => void) | undefined;
  let publishSnapshot: ((data: typeof latestData) => void) | undefined;
  const dataSource: DashboardDataSource = {
    getDashboardData: () => new Promise((_, reject) => {
      rejectInitial = reject;
    }),
    subscribe: (listener) => {
      publishSnapshot = listener;
      return () => undefined;
    },
  };

  render(<DashboardDataHarness dataSource={dataSource} />);

  act(() => {
    publishSnapshot?.(latestData);
  });
  expect(screen.getByText("93%")).toBeVisible();

  act(() => {
    rejectInitial?.(new Error("stale failure"));
  });
  expect(screen.getByText("93%")).toBeVisible();
  expect(screen.queryByText("stale failure")).not.toBeInTheDocument();
});
