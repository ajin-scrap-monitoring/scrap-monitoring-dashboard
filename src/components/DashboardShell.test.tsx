import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

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
