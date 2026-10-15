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

test("장비 상태 코드는 표시 문구로 변환하고 scan 및 수신 시각과 지연은 표시하지 않는다", async () => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data(monitoringV2StateFixture("UNAVAILABLE"), "pit-01");
  const received = "2026-10-15T00:00:12.123456Z";
  data.monitoring.devices = [
    { label: "lidar-a", received, receivedLabel: "마지막 scan", latency: "정보 없음", status: "normal", statusLabel: "FRESH" },
    { label: "엣지 장비", received, latency: "정보 없음", status: "delayed", statusLabel: "DEGRADED" },
    { label: "카메라", received: "정보 없음", latency: "정보 없음", status: "unknown" },
    { label: "미확인 장비", received: "정보 없음", latency: "정보 없음", status: "unknown", statusLabel: "constructor" },
  ];
  const { container } = render(<MonitoringPage data={data} dataSource={dataSource} />);
  expect(screen.getByText("정상")).toHaveAttribute("title", "FRESH");
  expect(screen.getByText("일부 기능 제한")).toHaveAttribute("title", "DEGRADED");
  expect(screen.getByText("constructor")).toBeVisible();
  expect(container.querySelectorAll(".device time, .device-meta")).toHaveLength(0);
  expect(container.querySelector(".devices-card")).not.toHaveTextContent(/마지막 scan|최근 수신|지연 정보/);
  expect(container.querySelector(".devices-card")).not.toHaveTextContent(received);
  expect(data.monitoring.devices[0].statusLabel).toBe("FRESH");
  expect(data.monitoring.devices[0].received).toBe(received);
});

test.each([
  ["STALE", "갱신 지연"], ["RECOVERING", "복구 중"], ["UNAVAILABLE", "사용 불가"], ["UNKNOWN", "확인 불가"],
  ["HEALTHY", "정상"], ["MEASUREMENT_UNAVAILABLE", "측정 불가"], ["CONFIG_ERROR", "설정 오류"],
  ["STARTING", "시작 중"], ["RETRYING", "재연결 중"], ["FATAL", "사용 불가"],
])("장비 상태 %s의 의미를 %s로 표시한다", async (statusLabel, label) => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring.devices = [{ label: "장비", received: "정보 없음", latency: "정보 없음", status: "unknown", statusLabel }];
  render(<MonitoringPage data={data} dataSource={dataSource} />);
  expect(screen.getByText(label, { selector: ".device .status-text" })).toHaveAttribute("title", statusLabel);
});

test.each([
  ["HEALTHY", "정상", "ok"], ["STARTING", "시작 중", "warning"], ["DEGRADED", "일부 기능 제한", "warning"],
  ["RETRYING", "재연결 중", "warning"], ["FATAL", "사용 불가", "error"], ["UNKNOWN", "확인 불가", ""],
])("실제 카메라 service %s의 문구와 상태색을 기존 행에 표시한다", async (state, label, tone) => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  const snapshot = monitoringV2StateFixture("UNAVAILABLE");
  data.monitoring = monitoringV2Data({ ...snapshot, deviceStatus: { ...snapshot.deviceStatus, connection_state: "REPORTING", snapshot: {
    sensors: [], services: [{ service: "camera-edge", state, last_progress_at: snapshot.serverTime, reason_codes: [] }],
  } } }, "pit-01");
  const { container } = render(<MonitoringPage data={data} dataSource={dataSource} />);
  const row = screen.getByText("카메라", { selector: ".device-name" }).closest(".device")!;
  const status = within(row as HTMLElement).getByText(label, { selector: ".status-text" });
  expect(status).toHaveAttribute("title", state);
  if (tone) expect(status).toHaveClass(tone);
  expect(container.querySelectorAll(".monitoring-grid > .card")).toHaveLength(8);
  expect(row.querySelector("time, .device-meta")).toBeNull();
  expect(row).not.toHaveTextContent(snapshot.serverTime);
});

test.each(["FRESH", "STALE", "UNAVAILABLE", "UNKNOWN", "NO_DATA"] as const)("v2 %s에서도 기존 8개 카드와 지표 영역을 유지하고 값을 보충하지 않는다", async (state) => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data(monitoringV2StateFixture(state, 72.5), "pit-01");
  render(<MonitoringPage data={data} dataSource={dataSource} />);
  const main = screen.getByRole("main");
  expect(main.querySelector(".kpi-value")).toHaveTextContent(state === "FRESH" ? "72.5%" : "판단 불가");
  expect(main.querySelector(".kpi-label")).toHaveTextContent("추정 적재율");
  const metrics = main.querySelectorAll(".kpi-card .mini-stat");
  expect([...metrics].map(metric => metric.querySelector(".label")?.textContent)).toEqual([
    "수거 임계율", "적재율 경보", "예상 도달", "1시간 전 적재율", "최근 수거 후 경과", "평균 수거 주기",
  ]);
  expect([...metrics].every(metric => metric.querySelector("strong"))).toBe(true);
  expect(main).not.toHaveTextContent("유효한 적재율 정보 없음");
  const cards = main.querySelectorAll(".monitoring-grid > .card");
  expect(cards).toHaveLength(8);
  expect([...cards].map((card) => card.querySelector("h2")?.textContent ?? card.getAttribute("aria-label"))).toEqual([
    "현재 상태", "실시간 영상", "측정 영역", "최근 24시간 적재율", "LiDAR 1", "LiDAR 2", "활성 알림", "장비 상태",
  ]);
  expect(within(main).getByText("적재율 경보").parentElement).toHaveTextContent("미지원");
  expect(within(main).getByText("예상 도달", { exact: true }).parentElement).toHaveTextContent("미지원");
  expect(within(main).getByText("1시간 전 적재율").parentElement).toHaveTextContent("정보 없음");
  expect(within(main).getByText("평균 수거 주기").parentElement).toHaveTextContent("미지원");
  expect(within(main).getByText("최근 수거 후 경과").parentElement).toHaveTextContent("정보 없음");
  expect(main.querySelectorAll(".load-chart-line, .profile-chart-line")).toHaveLength(0);
  expect(within(main).queryByText("적재 중", { exact: true })).not.toBeInTheDocument();
  expect(within(main).queryByText("대기", { exact: true })).not.toBeInTheDocument();
  expect(within(main).queryByText("0건", { exact: true })).not.toBeInTheDocument();
  expect(within(main).queryByText("참고도 / 실측 배치 미제공")).not.toBeInTheDocument();
  expect(cards[6]).toHaveTextContent("활성 여부를 확인할 수 있는 알림 정보가 없습니다.");
  expect(screen.queryByRole("button", { name: "상태 상세" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "모니터링 상태 상세" })).not.toBeInTheDocument();
});

test("SSE 연결 중단은 적재율을 숨기고 같은 snapshot 복구는 0%를 표시한다", async () => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data(monitoringV2StateFixture("FRESH", 0), "pit-01");
  const view = render(<MonitoringPage data={data} dataSource={dataSource} />);
  expect(view.container.querySelector(".kpi-value")).toHaveTextContent("0%");
  const disconnected = structuredClone(data);
  disconnected.monitoring.status = "disconnected";
  disconnected.reception.status = "error";
  disconnected.monitoring.summary.loadPercent = null;
  if (disconnected.monitoring.v2) disconnected.monitoring.v2.streamState = "reconnecting";
  view.rerender(<MonitoringPage data={disconnected} dataSource={dataSource} />);
  expect(view.container.querySelector(".kpi-value")).toHaveTextContent("판단 불가");
  expect(screen.getByText("실시간 연결 재연결 중")).toBeVisible();
  expect(screen.getByLabelText("데이터 수신 상태")).toHaveTextContent("연결 문제");
  view.rerender(<MonitoringPage data={data} dataSource={dataSource} />);
  expect(view.container.querySelector(".kpi-value")).toHaveTextContent("0%");
  expect(screen.getByLabelText("데이터 수신 상태")).toHaveTextContent("연결 정상");
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

test("현황은 상태 상세 버튼과 모달 및 기술 진단 정보를 표시하지 않는다", async () => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data(monitoringV2StateFixture("UNAVAILABLE"), "pit-01");
  render(<MonitoringPage data={data} dataSource={dataSource} />);
  expect(screen.queryByRole("button", { name: "상태 상세" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "모니터링 상태 상세" })).not.toBeInTheDocument();
  expect(screen.queryByText("site-demo / edge-demo")).not.toBeInTheDocument();
  expect(screen.queryByText("SYNTHETIC_UNAVAILABLE")).not.toBeInTheDocument();
});

test("1시간 전 적재율은 기존 지표 영역에 표시하고 tooltip에서 관측 시각과 제한 상태를 설명한다", async () => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data(monitoringV2StateFixture("FRESH", 30), "pit-01");
  data.monitoring.summary.loadOneHourAgo = { value: 68.123456, observedAt: "2026-10-12T23:00:09Z", dataState: "LIMITED" };
  const { container } = render(<MonitoringPage data={data} dataSource={dataSource} />);
  const pastLoad = screen.getByText("68.123456%");
  expect(pastLoad.parentElement).toHaveTextContent("1시간 전 적재율");
  expect(pastLoad).toHaveAttribute("title", expect.stringContaining("관측 시각:"));
  expect(pastLoad).toHaveAttribute("title", expect.stringContaining("제한된 데이터"));
  expect(screen.queryByText("최근 1시간 변화량")).not.toBeInTheDocument();
  expect(container.querySelectorAll(".monitoring-grid > .card")).toHaveLength(8);
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
  const disconnected = structuredClone(data);
  if (disconnected.monitoring.v2) {
    disconnected.monitoring.v2.streamState = "reconnecting";
    if (disconnected.monitoring.v2.operations) disconnected.monitoring.v2.operations.effectiveState = "CRITICAL";
  }
  view.rerender(<MonitoringPage data={disconnected} dataSource={dataSource} />);
  expect(screen.getByText("적재율 경보").parentElement).toHaveTextContent("확인 불가");
  view.unmount();
});

test.each([
  ["NORMAL", "경고 기준 미만"],
  ["WARNING", "경고"],
  ["CRITICAL", "위험"],
  ["UNKNOWN", "확인 불가"],
  ["ERROR", "판정 불가"],
] as const)("Backend 경보 %s는 %s로 표시하고 작업 상태를 만들지 않는다", async (effectiveState, label) => {
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  data.monitoring = monitoringV2Data({ ...monitoringV2StateFixture(effectiveState === "ERROR" ? "UNAVAILABLE" : "FRESH", effectiveState === "NORMAL" ? 72.5 : 82.5), operations: {
    effectiveState, lastKnownState: "CRITICAL", lastEvaluatedAt: null, lastAlertAt: null, notificationId: null,
  } }, "pit-01");
  const view = render(<MonitoringPage data={data} dataSource={dataSource} />);
  const alarm = view.container.querySelector(".alarm-status");
  expect(alarm).toHaveTextContent(label);
  expect(alarm).toHaveAttribute("class", "alarm-status");
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
  expect(view.container.querySelector(".alarm-status")).toHaveTextContent("미지원");
  expect(screen.queryByText("수거 중", { exact: true })).not.toBeInTheDocument();
});
