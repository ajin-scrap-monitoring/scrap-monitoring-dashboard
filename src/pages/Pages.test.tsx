import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

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
  expect(screen.getByText("총 9건")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  expect(screen.getByText("총 1건")).toBeVisible();
  expect(screen.getByText("LiDAR 2 측정값 제외")).toBeVisible();
});

test("이력 빠른 기간 선택은 최근 7일이 기본이며 직접 입력하면 선택이 해제된다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  render(<HistoryPage history={data.history} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="normal" />);
  const start = screen.getByLabelText<HTMLInputElement>("시작 시각");
  const end = screen.getByLabelText<HTMLInputElement>("종료 시각");
  const durationHours = () => (new Date(end.value).getTime() - new Date(start.value).getTime()) / 3_600_000;

  expect(screen.getByRole("button", { name: "최근 7일" })).toHaveAttribute("aria-pressed", "true");
  expect(durationHours()).toBe(168);
  fireEvent.click(screen.getByRole("button", { name: "최근 24시간" }));
  expect(durationHours()).toBe(24);
  expect(screen.getByRole("button", { name: "최근 24시간" })).toHaveAttribute("aria-pressed", "true");
  for (const [label, hours] of [["최근 30일", 720], ["최근 90일", 2160]] as const) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(durationHours()).toBe(hours);
    expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
  }
  fireEvent.change(start, { target: { value: "2026-09-01T12:00" } });
  expect(start.value).toBe("2026-09-01 12:00");
  expect(screen.getByRole("button", { name: "최근 24시간" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "최근 7일" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "최근 90일" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "최근 7일" }));
  expect(durationHours()).toBe(168);
});

test("이력 조회는 기간과 유형을 함께 적용하고 범례와 빈 결과를 갱신한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  render(<HistoryPage history={data.history} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="normal" />);
  fireEvent.click(screen.getByRole("button", { name: "최근 24시간" }));
  fireEvent.click(screen.getByRole("button", { name: "수거" }));
  expect(screen.getByText("총 9건")).toBeVisible();
  const legend = screen.getByLabelText("그래프 범례");
  expect(within(legend).getByText("오류")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  expect(screen.getByText("총 1건")).toBeVisible();
  expect(within(legend).queryByText("오류")).not.toBeInTheDocument();
  expect(within(legend).queryByText("수거 필요")).not.toBeInTheDocument();
  expect(within(legend).getByText("수거 완료")).toBeVisible();
  expect(within(legend).getByText("수거 임계율")).toBeVisible();
  expect(screen.getByLabelText("조회 기간 대표 적재율 변화 그래프").querySelectorAll(".history-event-target")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("시작 시각"), { target: { value: "2026-09-11T00:00" } });
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.getByText("총 1건")).toBeVisible();
  fireEvent.change(screen.getByLabelText("종료 시각"), { target: { value: "2026-09-12T00:00" } });
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  expect(screen.getByText("조회된 이벤트가 없습니다.")).toBeVisible();
  expect(screen.getByText("조회된 적재율 데이터가 없습니다.")).toBeVisible();
});

test("녹화 목록을 필터링하고 다음 페이지에서 영상을 선택한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  render(<RecordingsPage recordings={data.recordings} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="normal" />);

  expect(screen.getByText("8건")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "다음 녹화 목록 페이지" }));
  expect(screen.getByText("2 / 2")).toBeVisible();
  expect(screen.getByRole("img", { name: "2026-09-03 녹화 영상" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "오류" }));
  expect(screen.getByText("8건")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  expect(screen.getByText("2건")).toBeVisible();
  expect(screen.getByRole("img", { name: "2026-09-07 녹화 영상" })).toBeVisible();
});

test("녹화 조회는 겹치는 기간을 찾고 잘못된 기간에서는 기존 결과를 유지한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  render(<RecordingsPage recordings={data.recordings} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="normal" />);
  expect(screen.getByRole("button", { name: "최근 7일" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "최근 24시간" }));
  expect(screen.getByText("8건")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  expect(screen.getByText("2건")).toBeVisible();
  fireEvent.change(screen.getByLabelText("시작 시각"), { target: { value: "2026-09-09T12:00" } });
  fireEvent.change(screen.getByLabelText("종료 시각"), { target: { value: "2026-09-09T13:00" } });
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  expect(screen.getByText("1건")).toBeVisible();
  fireEvent.change(screen.getByLabelText("시작 시각"), { target: { value: "2026-09-10T00:00" } });
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.getByText("1건")).toBeVisible();
  fireEvent.change(screen.getByLabelText("종료 시각"), { target: { value: "2026-09-11T00:00" } });
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  expect(screen.getByText("조회된 녹화 영상이 없습니다.")).toBeVisible();
});

test("재생 또는 다운로드 경로가 없는 녹화 상태를 명시한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const recording = {
    ...data.recordings[0],
    contentUrl: undefined,
    downloadUrl: undefined,
    sample: false,
    status: "expired" as const,
    thumbnailUrl: undefined,
  };

  render(<RecordingsPage recordings={[recording]} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="normal" />);

  expect(screen.getByText("재생 가능한 영상이 없습니다.")).toBeVisible();
  expect(screen.getByRole("button", { name: "다운로드 불가" })).toBeDisabled();
  expect(screen.getByText("이 녹화 영상은 다운로드할 수 없습니다.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "녹화 영상 크게 보기" })).not.toBeInTheDocument();
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
  const dialog = screen.getByRole("dialog", { name: "알림 대상 추가" });
  await user.click(within(dialog).getByRole("button", { name: "알림 대상 추가" }));
  expect(screen.getByRole("alert")).toHaveTextContent("이름, 소속, 이메일을 입력하세요.");

  const inputs = within(dialog).getAllByRole("textbox");
  await user.type(inputs[0], "홍길동");
  await user.type(inputs[1], "생산관리팀");
  await user.type(inputs[2], "hong@example.com");
  await user.click(within(dialog).getByRole("button", { name: "알림 대상 추가" }));

  expect(screen.queryByRole("dialog", { name: "알림 대상 추가" })).not.toBeInTheDocument();
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

test("관리자 임계율은 범위 밖 값과 사전 알림 기준 역전을 적용하지 않는다", async () => {
  const user = userEvent.setup();
  const data = await createMockDashboardDataSource().getDashboardData();
  render(<AdminPage admin={data.admin} headerNotifications={[]} />);
  fireEvent.change(screen.getByLabelText("변경값"), { target: { value: "150" } });
  await user.click(screen.getByRole("button", { name: "수거 설정 저장" }));
  expect(screen.getByRole("alert")).toHaveTextContent("1~100");
  expect(document.querySelector(".threshold-applied strong")).toHaveTextContent("80%");
  fireEvent.change(screen.getByLabelText("변경값"), { target: { value: "60" } });
  await user.click(screen.getByRole("button", { name: "수거 설정 저장" }));
  expect(screen.getByRole("alert")).toHaveTextContent("수거 임계율 미만");
  fireEvent.change(screen.getByLabelText("변경값"), { target: { value: "85" } });
  await user.click(screen.getByRole("button", { name: "수거 설정 저장" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(document.querySelector(".threshold-applied strong")).toHaveTextContent("85%");
});

test("관리자 설정 저장은 서버가 정규화한 응답을 화면 기준으로 사용한다", async () => {
  const user = userEvent.setup();
  const dataSource = createMockDashboardDataSource();
  const data = await dataSource.getDashboardData();
  dataSource.replaceAlertSettings = vi.fn((settings) => Promise.resolve({
    ...settings,
    collectionThreshold: 84,
    preCollectionAlert: { enabled: true, threshold: 69 },
    sendDelayMinutes: 0,
    version: '"settings-v2"',
  }));
  render(<AdminPage admin={data.admin} dataSource={dataSource} headerNotifications={[]} />);

  fireEvent.change(screen.getByLabelText("변경값"), { target: { value: "85" } });
  await user.click(screen.getByRole("button", { name: "수거 설정 저장" }));
  expect(await screen.findByText("수거 설정을 저장했습니다.")).toBeVisible();
  expect(screen.getByLabelText("변경값")).toHaveValue(84);
  expect(document.querySelector(".threshold-applied strong")).toHaveTextContent("84%");

  const timing = screen.getByRole("combobox", { name: "발송 시점" });
  await user.click(timing);
  await user.click(screen.getByRole("option", { name: "5분 후" }));
  await user.click(screen.getByRole("button", { name: "정책 저장" }));
  expect(await screen.findByText("알림 정책을 저장했습니다.")).toBeVisible();
  expect(timing).toHaveTextContent("즉시");
});

test("정책 취소는 저장값을 복원하고 테스트 대상은 등록된 전체 인원을 제공한다", async () => {
  const user = userEvent.setup();
  const data = await createMockDashboardDataSource().getDashboardData();
  render(<AdminPage admin={data.admin} headerNotifications={[]} />);
  const timing = screen.getByRole("combobox", { name: "발송 시점" });
  await user.click(timing);
  await user.click(screen.getByRole("option", { name: "5분 후" }));
  await user.click(screen.getByRole("button", { name: "취소" }));
  expect(timing).toHaveTextContent("즉시");
  await user.click(timing);
  await user.click(screen.getByRole("option", { name: "5분 후" }));
  await user.click(screen.getByRole("button", { name: "정책 저장" }));
  await user.click(timing);
  await user.click(screen.getByRole("option", { name: "즉시" }));
  await user.click(screen.getByRole("button", { name: "취소" }));
  expect(timing).toHaveTextContent("5분 후");
  await user.click(screen.getByRole("combobox", { name: "등록 대상" }));
  expect(screen.getAllByRole("option")).toHaveLength(data.admin.recipients.length);
});

test("로그인 비밀번호 표시 상태를 전환한다", async () => {
  const user = userEvent.setup();
  render(<LoginPage />);

  const password = screen.getByLabelText("비밀번호");
  expect(password).toHaveAttribute("type", "password");
  await user.click(screen.getByRole("button", { name: "표시" }));
  expect(password).toHaveAttribute("type", "text");
});
