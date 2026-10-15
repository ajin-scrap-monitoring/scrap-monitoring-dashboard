import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { DashboardHeader, DashboardPageShell } from "./DashboardShell";

test.each([false, true])("인증 확인 전에는 로컬 로그인 표시 %s와 무관하게 사용자 영역을 숨긴다", (stored) => {
  if (stored) window.sessionStorage.setItem("scrap-monitoring-authenticated", "true");
  else window.sessionStorage.removeItem("scrap-monitoring-authenticated");
  const view = render(<DashboardHeader activePage="history" initialNotifications={[]} sessionPending />);
  expect(view.container.querySelector(".user-tools")).toBeEmptyDOMElement();
  expect(screen.queryByRole("link", { name: "로그인" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "사용자 메뉴" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "관리자" })).not.toBeInTheDocument();
  window.sessionStorage.removeItem("scrap-monitoring-authenticated");
});

test("비로그인이 확인된 헤더에는 로그인 링크를 표시한다", () => {
  render(<DashboardHeader activePage="history" initialNotifications={[]} session={null} />);
  expect(screen.getByRole("link", { name: "로그인" })).toBeVisible();
});

test.each([
  ["viewer", "현장 운영자", "조회 사용자"],
  ["viewer", "품질 담당자", "품질 담당자"],
  ["administrator", "관리자", "관리자"],
  ["administrator", "현장 운영자", "현장 운영자"],
] as const)("%s 계정 이름 %s를 %s로 표시한다", (role, displayName, expected) => {
  const view = render(<DashboardHeader activePage="history" initialNotifications={[]}
    session={{ expiresAt: "2026-10-16T00:00:00Z", user: { id: "synthetic-user", displayName, role } }} />);
  expect(view.container.querySelector(".user-menu")).toHaveTextContent(expected);
  fireEvent.click(screen.getByRole("button", { name: "사용자 메뉴" }));
  expect(view.container.querySelector(".user-popover-profile strong")).toHaveTextContent(expected);
  expect(Boolean(screen.queryByRole("link", { name: "관리자 설정" }))).toBe(role === "administrator");
});

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

  expect(screen.getByRole("button", { name: "사용자 메뉴" })).toBeVisible();
  expect(screen.queryByRole("link", { name: /^관리자$/ })).not.toBeInTheDocument();
});

test("최초 알림 실패는 미확인 배지와 실패 안내만 표시하고 수동 재조회 버튼을 제공하지 않는다", () => {
  render(<DashboardPageShell activePage="monitoring" headerNotifications={[]} headerUnreadCount={null}
    notificationState={{ status: "error", message: "PRIVATE_SERVER_ERROR_DETAILS", stale: false }}
    dataSource={{ getDashboardData: vi.fn() }}
    session={{ expiresAt: "2026-10-15T18:00:00Z", user: { displayName: "조회자", id: "viewer-1", role: "viewer" } }}>
    <main>현황 본문</main>
  </DashboardPageShell>);
  expect(screen.queryByText("알림을 확인할 수 없습니다")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "알림 0건" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "알림 조회 실패" }));
  expect(screen.getByRole("button", { name: "모두 읽음" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveClass("notification-unavailable");
  expect(screen.getByText("알림을 확인할 수 없습니다")).toBeVisible();
  expect(screen.getByText("알림 정보를 받으면 자동으로 표시합니다.")).toBeVisible();
  expect(screen.queryByText("PRIVATE_SERVER_ERROR_DETAILS")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "알림 다시 조회" })).not.toBeInTheDocument();
});

test("이전 알림을 유지한 조회 실패는 마지막 응답이라는 설명을 표시한다", () => {
  render(<DashboardPageShell activePage="monitoring" headerNotifications={[]} headerUnreadCount={3}
    notificationState={{ status: "error", stale: true }}
    session={{ expiresAt: "2026-10-15T18:00:00Z", user: { displayName: "조회자", id: "viewer-1", role: "viewer" } }}>
    <main>현황 본문</main>
  </DashboardPageShell>);
  fireEvent.click(screen.getByRole("button", { name: "알림 3건" }));
  expect(screen.getByRole("alert")).toHaveClass("has-previous");
  expect(screen.getByRole("alert")).toHaveTextContent("최신 알림을 확인할 수 없습니다");
  expect(screen.getByRole("alert")).toHaveTextContent("마지막으로 받은 알림을 표시합니다.");
  expect(screen.queryByRole("button", { name: "알림 다시 조회" })).not.toBeInTheDocument();
});

test("긴 사용자명과 알림의 원문은 title과 접근 가능한 텍스트에 유지한다", () => {
  const displayName = "현장모니터링담당자".repeat(10);
  const title = "서버 알림 제목 ".repeat(20);
  const detail = "서버 알림 내용 ".repeat(20);
  const view = render(<DashboardHeader activePage="monitoring" initialNotifications={[{ id: "long-notice", title, detail, read: false, level: "warning", time: "10:00" }]}
    session={{ expiresAt: "2026-10-16T00:00:00Z", user: { id: "synthetic-user", role: "administrator", displayName } }} />);
  expect(view.container.querySelector(".user-menu > span")).toHaveAttribute("title", displayName);
  expect(view.container.querySelector(".user-menu > span")).toHaveTextContent(displayName);
  fireEvent.click(screen.getByRole("button", { name: "사용자 메뉴" }));
  expect(view.container.querySelector(".user-popover-profile strong")).toHaveAttribute("title", displayName);
  fireEvent.click(screen.getByRole("button", { name: "알림 1건" }));
  expect(view.container.querySelector(".header-notification strong")).toHaveAttribute("title", title);
  expect(view.container.querySelector(".header-notification small")).toHaveAttribute("title", detail);
});
