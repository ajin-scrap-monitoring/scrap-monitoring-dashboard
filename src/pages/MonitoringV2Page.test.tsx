import { fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { expect, test, vi } from "vitest";

import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import { monitoringV2Data } from "../data/monitoring-v2";
import { monitoringV2StateFixture } from "../test/backend-contract-fixtures";

import MonitoringV2Page from "./MonitoringV2Page";

const video = vi.hoisted(() => ({ active: 0 }));
vi.mock("../components/LiveVideo", () => ({
  LiveVideo: function LiveVideo({ alt }: { alt: string }) {
    useEffect(() => { video.active += 1; return () => { video.active -= 1; }; }, []);
    return <img alt={alt} src="/synthetic.jpg" />;
  },
}));

test.each(["FRESH", "STALE", "UNAVAILABLE", "UNKNOWN", "NO_DATA"] as const)("v2 %s를 표시하고 미제공 v1 정보를 노출하지 않는다", async (state) => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data(monitoringV2StateFixture(state, 72.5), "pit-01");
  render(<MonitoringV2Page data={data} dataSource={dataSource} />);
  const main = screen.getByRole("main");
  expect(within(main).getByText("데이터 상태").parentElement).toHaveTextContent(state);
  expect(main.querySelector(".kpi-value")).toHaveTextContent(state === "FRESH" ? "72.5%" : "판단 불가");
  expect(within(main).queryByLabelText("최근 적재율 변화")).not.toBeInTheDocument();
  expect(within(main).queryByText("예상 도달 시각", { exact: true })).not.toBeInTheDocument();
  expect(within(main).queryByText("합성", { exact: false })).not.toBeInTheDocument();
  if (state === "NO_DATA") expect(within(main).getAllByText("정보 없음").length).toBeGreaterThan(0);
});

test("SSE 연결 중단은 적재율을 숨기고 같은 snapshot 복구는 0%를 표시한다", async () => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data(monitoringV2StateFixture("FRESH", 0), "pit-01");
  const view = render(<MonitoringV2Page data={data} dataSource={dataSource} />);
  expect(view.container.querySelector(".kpi-value")).toHaveTextContent("0%");
  const disconnected = structuredClone(data);
  disconnected.monitoring.status = "disconnected";
  disconnected.monitoring.summary.loadPercent = null;
  if (disconnected.monitoring.v2) disconnected.monitoring.v2.streamState = "reconnecting";
  view.rerender(<MonitoringV2Page data={disconnected} dataSource={dataSource} />);
  expect(view.container.querySelector(".kpi-value")).toHaveTextContent("판단 불가");
  expect(screen.getByRole("status")).toHaveTextContent("재연결");
  view.rerender(<MonitoringV2Page data={data} dataSource={dataSource} />);
  expect(view.container.querySelector(".kpi-value")).toHaveTextContent("0%");
});

test("영상 확대는 단일 연결과 focus 복원을 유지한다", async () => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data(monitoringV2StateFixture("UNAVAILABLE"), "pit-01");
  const view = render(<MonitoringV2Page data={data} dataSource={dataSource} />);
  const opener = screen.getByRole("button", { name: "실시간 영상 크게 보기" });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(video.active).toBe(1);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  expect(video.active).toBe(1);
  view.unmount();
  expect(video.active).toBe(0);
});
