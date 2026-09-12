import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { App } from "./App";
import { createMockDashboardDataSource } from "./data/mock-dashboard-data-source";

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

test("로그인 화면에서는 대시보드 데이터를 요청하지 않는다", () => {
  const getDashboardData = vi.fn(async () => createMockDashboardDataSource().getDashboardData());
  window.history.replaceState(null, "", "/login");

  render(<App dataSource={{ getDashboardData }} />);

  expect(screen.getByRole("main", { name: "관리자 로그인" })).toBeVisible();
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
