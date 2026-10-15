import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { App } from "./App";
import { createMockDashboardDataSource } from "./data/mock-dashboard-data-source";

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
  expect(screen.queryByLabelText("데이터 수신 상태")).not.toBeInTheDocument();
  await act(() => { complete(data); return Promise.resolve(); });
  expect(await screen.findByRole("button", { name: "사용자 메뉴" })).toBeVisible();
  expect(screen.getByText("조회 사용자")).toBeVisible();
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

test("로그인 화면에서는 대시보드 데이터를 요청하지 않는다", () => {
  const getDashboardData = vi.fn(async () => createMockDashboardDataSource().getDashboardData());
  window.history.replaceState(null, "", "/login");

  render(<App dataSource={{ getDashboardData }} />);

  expect(screen.getByRole("main", { name: "사용자 로그인" })).toBeVisible();
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
