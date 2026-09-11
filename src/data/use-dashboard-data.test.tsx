import { fireEvent, render, screen } from "@testing-library/react";
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
