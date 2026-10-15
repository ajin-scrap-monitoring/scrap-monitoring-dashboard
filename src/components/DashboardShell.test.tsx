import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { DashboardPageShell } from "./DashboardShell";

test("공통 페이지 셸은 활성 메뉴와 푸터를 조립한다", () => {
  render(
    <DashboardPageShell activePage="history" headerNotifications={[]}>
      <main>이력 본문</main>
    </DashboardPageShell>,
  );

  expect(screen.getByRole("link", { name: "이력" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByText("이력 본문")).toBeVisible();
  expect(screen.getByText(/Copyright 2026 AJIN INDUSTRIAL/)).toBeVisible();
});

test("인증된 공통 헤더는 갱신된 알림과 읽음 상태를 관리한다", async () => {
  window.sessionStorage.setItem("scrap-monitoring-authenticated", "true");
  const { rerender } = render(
    <DashboardPageShell
      activePage="monitoring"
      headerNotifications={[{ id: "notification-1", title: "수거 필요", detail: "대표 적재율 80%", level: "warning", read: false, time: "10:00" }]}
      headerUnreadCount={23}
    >
      <main>현황 본문</main>
    </DashboardPageShell>,
  );

  fireEvent.click(screen.getByRole("button", { name: "알림 23건" }));
  rerender(
    <DashboardPageShell
      activePage="monitoring"
      headerNotifications={[{ id: "notification-1", title: "수거 필요", detail: "대표 적재율 84%", level: "warning", read: false, time: "10:01" }]}
      headerUnreadCount={23}
    >
      <main>현황 본문</main>
    </DashboardPageShell>,
  );
  expect(await screen.findByText("대표 적재율 84%")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /수거 필요/ }));
  expect(screen.getByRole("button", { name: "알림 22건" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "모두 읽음" }));

  expect(screen.getByRole("button", { name: "알림 0건" })).toBeVisible();
  window.sessionStorage.removeItem("scrap-monitoring-authenticated");
});

test("조회 사용자의 헤더에는 관리자 진입점을 표시하지 않는다", () => {
  render(
    <DashboardPageShell
      activePage="monitoring"
      headerNotifications={[]}
      session={{ expiresAt: "2026-09-10T18:00:00+09:00", user: { displayName: "조회자", id: "viewer-1", role: "viewer" } }}
    >
      <main>현황 본문</main>
    </DashboardPageShell>,
  );

  expect(screen.getByRole("button", { name: "관리자 메뉴" })).toBeVisible();
  expect(screen.queryByRole("link", { name: /^관리자$/ })).not.toBeInTheDocument();
});

test("최초 알림 실패는 0건 대신 미확인 배지를 표시하고 기존 popover에서만 재시도한다", () => {
  const refreshNotifications = vi.fn(() => Promise.resolve());
  render(<DashboardPageShell activePage="monitoring" headerNotifications={[]} headerUnreadCount={null}
    notificationState={{ status: "error", message: "알림을 불러오지 못했습니다.", stale: false }}
    dataSource={{ getDashboardData: vi.fn(), refreshNotifications }}
    session={{ expiresAt: "2026-10-15T18:00:00Z", user: { displayName: "조회자", id: "viewer-1", role: "viewer" } }}>
    <main>현황 본문</main>
  </DashboardPageShell>);
  expect(screen.queryByText(/미읽음 수를 확인/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "알림 0건" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "알림 조회 실패" }));
  expect(screen.getByRole("button", { name: "모두 읽음" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("미읽음 수를 확인할 수 없습니다.");
  fireEvent.click(screen.getByRole("button", { name: "알림 다시 조회" }));
  expect(refreshNotifications).toHaveBeenCalledOnce();
});

test("이전 알림을 유지한 조회 실패는 마지막 응답이라는 설명을 표시한다", () => {
  render(<DashboardPageShell activePage="monitoring" headerNotifications={[]} headerUnreadCount={3}
    notificationState={{ status: "error", stale: true }}
    session={{ expiresAt: "2026-10-15T18:00:00Z", user: { displayName: "조회자", id: "viewer-1", role: "viewer" } }}>
    <main>현황 본문</main>
  </DashboardPageShell>);
  fireEvent.click(screen.getByRole("button", { name: "알림 3건" }));
  expect(screen.getByRole("alert")).toHaveTextContent("마지막으로 불러온 알림을 표시합니다.");
});
