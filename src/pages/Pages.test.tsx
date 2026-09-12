import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";

import { AUTHENTICATION_SESSION_KEY } from "../app-routing";
import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import { AdminPage } from "./AdminPage";
import { HistoryPage } from "./HistoryPage";
import { LoginPage } from "./LoginPage";
import { RecordingsPage } from "./RecordingsPage";

beforeEach(() => {
  window.sessionStorage.setItem(AUTHENTICATION_SESSION_KEY, "true");
});

test("이력 유형 필터와 페이지 이동을 제공한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  render(<HistoryPage history={data.history} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="normal" />);

  expect(screen.getByText("총 9건")).toBeVisible();
  expect(screen.getByText("1 / 2")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "다음 이벤트 페이지" }));
  expect(screen.getByText("2 / 2")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "오류" }));
  expect(screen.getByText("총 1건")).toBeVisible();
  expect(screen.getByText("LiDAR 2 측정값 제외")).toBeVisible();
});

test("녹화 목록을 필터링하고 다음 페이지에서 영상을 선택한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  render(<RecordingsPage recordings={data.recordings} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="normal" />);

  expect(screen.getByText("8건")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "다음 녹화 목록 페이지" }));
  expect(screen.getByText("2 / 2")).toBeVisible();
  expect(screen.getByRole("img", { name: "2026-09-03 녹화 영상" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "오류" }));
  expect(screen.getByText("2건")).toBeVisible();
  expect(screen.getByRole("img", { name: "2026-09-07 녹화 영상" })).toBeVisible();
});

test("빈 이력, 녹화 목록과 알림 대상에 명시적인 상태를 표시한다", async () => {
  const data = await createMockDashboardDataSource("empty-lists").getDashboardData();
  const { unmount } = render(<HistoryPage history={data.history} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="normal" />);
  expect(screen.getByText("조회된 이벤트가 없습니다.")).toBeVisible();
  unmount();

  const recordings = render(<RecordingsPage recordings={data.recordings} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="normal" />);
  expect(screen.getByText("조회된 녹화 영상이 없습니다.")).toBeVisible();
  expect(screen.getByText("선택할 수 있는 녹화 영상이 없습니다.")).toBeVisible();
  recordings.unmount();

  render(<AdminPage admin={data.admin} headerNotifications={[]} />);
  expect(screen.getByText("등록된 알림 대상이 없습니다.")).toBeVisible();
  expect(screen.getByText("1 / 1")).toBeVisible();
});

test("관리자 알림 대상 추가 입력을 검증하고 새 대상을 등록한다", async () => {
  const user = userEvent.setup();
  const data = await createMockDashboardDataSource().getDashboardData();
  render(<AdminPage admin={data.admin} headerNotifications={[]} />);

  await user.click(screen.getByRole("button", { name: "알림 대상 추가" }));
  const dialog = screen.getByRole("form", { name: "알림 대상 추가" });
  await user.click(within(dialog).getByRole("button", { name: "알림 대상 추가" }));
  expect(screen.getByRole("alert")).toHaveTextContent("이름, 소속, 이메일을 입력하세요.");

  const inputs = within(dialog).getAllByRole("textbox");
  await user.type(inputs[0], "홍길동");
  await user.type(inputs[1], "생산관리팀");
  await user.type(inputs[2], "hong@example.com");
  await user.click(within(dialog).getByRole("button", { name: "알림 대상 추가" }));

  expect(screen.queryByRole("form", { name: "알림 대상 추가" })).not.toBeInTheDocument();
  expect(screen.getByText("총 12명")).toBeVisible();
  expect(screen.getByText("홍길동")).toBeVisible();
});

test("테스트 알림은 수신 채널을 하나 이상 요구한다", async () => {
  const user = userEvent.setup();
  const data = await createMockDashboardDataSource().getDashboardData();
  render(<AdminPage admin={data.admin} headerNotifications={[]} />);

  await user.click(screen.getByRole("checkbox", { name: "이메일" }));
  await user.click(screen.getByRole("checkbox", { name: "문자" }));
  await user.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  expect(screen.getByRole("alert")).toHaveTextContent("채널을 하나 이상 선택하세요.");
});

test("로그인 비밀번호 표시 상태를 전환한다", async () => {
  const user = userEvent.setup();
  render(<LoginPage />);

  const password = screen.getByLabelText("비밀번호");
  expect(password).toHaveAttribute("type", "password");
  await user.click(screen.getByRole("button", { name: "표시" }));
  expect(password).toHaveAttribute("type", "text");
});
