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

test("인증된 공통 헤더는 알림 읽음 상태를 관리한다", () => {
  window.sessionStorage.setItem("scrap-monitoring-authenticated", "true");
  render(
    <DashboardPageShell
      activePage="monitoring"
      headerNotifications={[{ id: 1, title: "수거 필요", detail: "대표 적재율 80%", level: "warning", read: false, time: "10:00" }]}
    >
      <main>현황 본문</main>
    </DashboardPageShell>,
  );

  fireEvent.click(screen.getByRole("button", { name: "알림 1건" }));
  fireEvent.click(screen.getByRole("button", { name: "모두 읽음" }));

  expect(screen.getByRole("button", { name: "알림 0건" })).toBeVisible();
  window.sessionStorage.removeItem("scrap-monitoring-authenticated");
});
