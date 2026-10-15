import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import type { DashboardData } from "../domain/dashboard";

import { HistoryPage } from "./HistoryPage";

test("후속 조회와 data source 변경은 이전 이력 조회를 취소한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const pending: ((value: DashboardData["history"]) => void)[] = [];
  const queryHistory = vi.fn<(query: unknown, signal?: AbortSignal) => Promise<DashboardData["history"]>>()
    .mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const source = { getDashboardData: () => Promise.resolve(data), queryHistory };
  const props = { history: data.history, headerNotifications: [], reception: data.reception };
  const view = render(<HistoryPage {...props} dataSource={source} />);
  const form = view.container.querySelector("form");
  if (!form) throw new Error("Query form missing.");
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(queryHistory.mock.calls[0][1]?.aborted).toBe(true);
  await act(() => { pending[1]({ ...data.history, events: [], chartEvents: [] }); return Promise.resolve(); });
  await act(() => { pending[0](data.history); return Promise.resolve(); });
  expect(screen.getByText("조회된 이벤트가 없습니다.")).toBeVisible();
  fireEvent.submit(form);
  view.rerender(<HistoryPage {...props} dataSource={{ ...source }} />);
  expect(queryHistory.mock.calls[2][1]?.aborted).toBe(true);
  expect(screen.getByRole("button", { name: "조회" })).toBeEnabled();
  await act(() => { pending[2](data.history); return Promise.resolve(); });
  expect(screen.getByText("조회된 이벤트가 없습니다.")).toBeVisible();
});

test("조회 실패는 기존 이력을 유지하고 종료 뒤 실패는 적용하지 않는다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  let reject: (error: Error) => void = () => undefined;
  const queryHistory = vi.fn<(query: unknown, signal?: AbortSignal) => Promise<DashboardData["history"]>>()
    .mockRejectedValueOnce(new Error("failure")).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const source = { getDashboardData: () => Promise.resolve(data), queryHistory };
  const view = render(<HistoryPage dataSource={source} history={data.history} headerNotifications={[]} reception={data.reception} />);
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByRole("alert")).toHaveTextContent("기존 조회 결과를 유지");
  expect(screen.getByText("총 9건")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  view.unmount();
  expect(queryHistory.mock.calls[1][1]?.aborted).toBe(true);
  await act(() => { reject(new Error("late failure")); return Promise.resolve(); });
});

test("같은 조건 재조회에서 선택한 chart marker가 제거되면 tooltip을 숨긴다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const queryHistory = vi.fn().mockResolvedValue({ ...data.history, chartEvents: [] });
  const source = { getDashboardData: () => Promise.resolve(data), queryHistory };
  const view = render(<HistoryPage dataSource={source} history={data.history} headerNotifications={[]} reception={data.reception} />);
  const markers = view.container.querySelectorAll(".history-event-target");
  expect(markers.length).toBeGreaterThan(0);
  fireEvent.focus(markers[markers.length - 1]);
  expect(view.container.querySelector(".history-chart-tooltip")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  await act(async () => { await Promise.resolve(); });
  expect(view.container.querySelector(".history-chart")).not.toBeNull();
  expect(view.container.querySelector(".history-chart-tooltip")).toBeNull();
});
