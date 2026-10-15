import { fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { expect, test, vi } from "vitest";

import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import { monitoringV2Data } from "../data/monitoring-v2";
import { monitoringV2StateFixture } from "../test/backend-contract-fixtures";

import { MonitoringPage } from "./MonitoringPage";

const video = vi.hoisted(() => ({ active: 0 }));
vi.mock("../components/LiveVideo", () => ({
  LiveVideo: function LiveVideo({ alt }: { alt: string }) {
    useEffect(() => { video.active += 1; return () => { video.active -= 1; }; }, []);
    return <img alt={alt} src="/synthetic.jpg" />;
  },
}));

test.each(["FRESH", "STALE", "UNAVAILABLE", "UNKNOWN", "NO_DATA"] as const)("v2 %s에서도 기존 8개 카드와 지표 영역을 유지하고 값을 보충하지 않는다", async (state) => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data(monitoringV2StateFixture(state, 72.5), "pit-01");
  render(<MonitoringPage data={data} dataSource={dataSource} />);
  const main = screen.getByRole("main");
  expect(main.querySelector(".kpi-value")).toHaveTextContent(state === "FRESH" ? "72.5%" : "판단 불가");
  const cards = main.querySelectorAll(".monitoring-grid > .card");
  expect(cards).toHaveLength(8);
  expect([...cards].map((card) => card.querySelector("h2")?.textContent ?? card.getAttribute("aria-label"))).toEqual([
    "현재 상태", "실시간 영상", "측정 영역", "최근 24시간 적재율", "LiDAR 1", "LiDAR 2", "활성 알림", "장비 상태",
  ]);
  expect(within(main).getByText("적재율 경보").parentElement).toHaveTextContent("경보 평가 미제공");
  expect(within(main).getByText("예상 도달", { exact: true }).parentElement).toHaveTextContent("미지원");
  for (const label of ["최근 1시간 변화량", "평균 수거 주기"]) expect(within(main).getByText(label).parentElement).toHaveTextContent("미지원");
  expect(within(main).getByText("최근 수거 후 경과").parentElement).toHaveTextContent("정보 없음");
  expect(main.querySelectorAll(".load-chart-line, .profile-chart-line")).toHaveLength(0);
  expect(within(main).queryByText("적재 중", { exact: true })).not.toBeInTheDocument();
  expect(within(main).queryByText("대기", { exact: true })).not.toBeInTheDocument();
  expect(within(main).queryByText("0건", { exact: true })).not.toBeInTheDocument();
  expect(within(main).getByText("참고도 / 실측 배치 미제공")).toBeInTheDocument();
  expect(cards[6]).toHaveTextContent("활성 여부를 확인할 수 있는 알림 정보가 없습니다.");
  fireEvent.click(screen.getByRole("button", { name: "상태 상세" }));
  const details = screen.getByRole("dialog", { name: "모니터링 상태 상세" });
  expect((await within(details).findByText("데이터 상태")).parentElement).toHaveTextContent(state);
  if (state === "NO_DATA") expect(within(details).getAllByText("정보 없음").length).toBeGreaterThan(0);
});

test("SSE 연결 중단은 적재율을 숨기고 같은 snapshot 복구는 0%를 표시한다", async () => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data(monitoringV2StateFixture("FRESH", 0), "pit-01");
  const view = render(<MonitoringPage data={data} dataSource={dataSource} />);
  expect(view.container.querySelector(".kpi-value")).toHaveTextContent("0%");
  const disconnected = structuredClone(data);
  disconnected.monitoring.status = "disconnected";
  disconnected.monitoring.summary.loadPercent = null;
  if (disconnected.monitoring.v2) disconnected.monitoring.v2.streamState = "reconnecting";
  view.rerender(<MonitoringPage data={disconnected} dataSource={dataSource} />);
  expect(view.container.querySelector(".kpi-value")).toHaveTextContent("판단 불가");
  expect(screen.getByRole("status")).toHaveTextContent("재연결");
  view.rerender(<MonitoringPage data={data} dataSource={dataSource} />);
  expect(view.container.querySelector(".kpi-value")).toHaveTextContent("0%");
});

test("영상 확대는 단일 연결과 focus 복원을 유지한다", async () => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data(monitoringV2StateFixture("UNAVAILABLE"), "pit-01");
  const view = render(<MonitoringPage data={data} dataSource={dataSource} />);
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

test("상태 상세는 Backend 값을 유지하고 키보드로 닫는다", async () => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data(monitoringV2StateFixture("UNAVAILABLE"), "pit-01");
  const view = render(<MonitoringPage data={data} dataSource={dataSource} />);
  const opener = screen.getByRole("button", { name: "상태 상세" });
  opener.focus();
  fireEvent.click(opener);
  const details = screen.getByRole("dialog", { name: "모니터링 상태 상세" });
  expect(await within(details).findByText("site-demo / edge-demo")).toBeInTheDocument();
  expect(within(details).getByText("SYNTHETIC_UNAVAILABLE")).toBeInTheDocument();
  expect(within(details).getAllByText("미구현")).toHaveLength(4);
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "닫기" })).toHaveFocus());
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  expect(video.active).toBe(1);
  view.unmount();
});

test("경보 상태는 실제 작업 상태와 분리하고 과거 CRITICAL을 현재 경보로 표시하지 않는다", async () => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data({ ...monitoringV2StateFixture("FRESH", 72.5), operations: {
    effectiveState: "UNKNOWN", lastKnownState: "CRITICAL", lastEvaluatedAt: "2026-10-13T00:00:08Z", lastAlertAt: "2026-10-13T00:00:07Z", notificationId: "notif-opaque-7",
  } }, "pit-01");
  const view = render(<MonitoringPage data={data} dataSource={dataSource} />);
  expect(screen.getByText("적재율 경보").parentElement).toHaveTextContent("확인 불가");
  expect(screen.queryByText("수거 중", { exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "상태 상세" }));
  const details = screen.getByRole("dialog");
  expect((await within(details).findByText("현재 경보 상태")).parentElement).toHaveTextContent("UNKNOWN");
  expect(within(details).getByText("마지막 유효 경보 상태").parentElement).toHaveTextContent("CRITICAL");
  expect(within(details).getByText("경보 복귀 임계율").parentElement).toHaveTextContent("80%");
  expect(within(details).getByText("알림 ID").parentElement).toHaveTextContent("notif-opaque-7");
  const disconnected = structuredClone(data);
  if (disconnected.monitoring.v2) {
    disconnected.monitoring.v2.streamState = "reconnecting";
    if (disconnected.monitoring.v2.operations) disconnected.monitoring.v2.operations.effectiveState = "CRITICAL";
  }
  view.rerender(<MonitoringPage data={disconnected} dataSource={dataSource} />);
  expect(screen.getByText("적재율 경보").parentElement).toHaveTextContent("확인 불가");
  expect(within(details).getByText("현재 경보 상태").parentElement).toHaveTextContent("UNKNOWN");
  view.unmount();
});

test.each([
  ["NORMAL", "경고 기준 미만", "ok"],
  ["WARNING", "경고", "warning"],
  ["CRITICAL", "위험", "error"],
  ["UNKNOWN", "확인 불가", "muted"],
  ["ERROR", "판정 불가", "error"],
] as const)("Backend 경보 %s는 %s로 표시하고 작업 상태를 만들지 않는다", async (effectiveState, label, tone) => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data({ ...monitoringV2StateFixture(effectiveState === "ERROR" ? "UNAVAILABLE" : "FRESH", effectiveState === "NORMAL" ? 72.5 : 82.5), operations: {
    effectiveState, lastKnownState: "CRITICAL", lastEvaluatedAt: null, lastAlertAt: null, notificationId: null,
  } }, "pit-01");
  const view = render(<MonitoringPage data={data} dataSource={dataSource} />);
  const alarm = view.container.querySelector(".alarm-status");
  expect(alarm).toHaveTextContent(label);
  expect(alarm).toHaveClass(tone);
  expect(screen.queryByText("운영 상태", { exact: true })).not.toBeInTheDocument();
  for (const operation of ["대기", "적재 중", "수거 중"]) expect(screen.queryByText(operation, { exact: true })).not.toBeInTheDocument();
  const disconnected = structuredClone(data);
  if (disconnected.monitoring.v2) disconnected.monitoring.v2.streamState = "reconnecting";
  view.rerender(<MonitoringPage data={disconnected} dataSource={dataSource} />);
  expect(alarm).toHaveTextContent("확인 불가");
  view.rerender(<MonitoringPage data={data} dataSource={dataSource} />);
  expect(alarm).toHaveTextContent(label);
});

test("경보 정보가 없으면 높은 적재율과 collecting으로 경보 등급을 추정하지 않는다", async () => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring.alarmState = null;
  data.monitoring.summary.loadPercent = 100;
  data.monitoring.summary.operationState = "collecting";
  const view = render(<MonitoringPage data={data} dataSource={dataSource} />);
  expect(view.container.querySelector(".alarm-status")).toHaveTextContent("경보 평가 미제공");
  expect(screen.queryByText("수거 중", { exact: true })).not.toBeInTheDocument();
});
