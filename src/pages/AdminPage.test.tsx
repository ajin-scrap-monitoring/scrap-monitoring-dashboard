import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import type { AlertSettings } from "../domain/dashboard";
import { AdminPage } from "./AdminPage";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("긴 대상 정보는 셀 안에서 생략하고 전체 원문과 관리 버튼을 유지한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const original = data.admin.recipients[0];
  const recipient = { ...original, name: "검증 담당자".repeat(20), team: "현장 관리 부서".repeat(20), email: `${"recipient".repeat(6)}@${"department".repeat(5)}.example.com`, phone: "010-0000-0000" };
  const admin = { ...data.admin, recipients: [recipient], recipientSettings: { [recipient.email]: data.admin.recipientSettings[original.email] } };
  const view = render(<AdminPage admin={admin} headerNotifications={[]} />);
  const cells = view.container.querySelectorAll(".recipients-table-wrap tbody td");
  for (const [index, value] of [recipient.name, recipient.team, recipient.email, recipient.phone].entries()) {
    expect(cells[index].firstElementChild).toHaveClass("recipient-cell-text");
    expect(cells[index].firstElementChild).toHaveAttribute("title", value);
    expect(cells[index]).toHaveTextContent(value);
  }
  const button = within(cells[7] as HTMLElement).getByRole("button", { name: "수신 설정" });
  expect(button.closest(".recipient-cell-text")).toBeNull();
  const selected = `${recipient.name} (${recipient.email})`;
  const dropdown = screen.getByRole("combobox", { name: "등록 대상" });
  expect(dropdown.firstElementChild).toHaveAttribute("title", selected);
  fireEvent.click(dropdown);
  const option = screen.getByRole("option", { name: selected });
  expect(option.firstElementChild).toHaveAttribute("title", selected);
  fireEvent.click(option);
  expect(dropdown).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(button);
  const panel = screen.getByRole("dialog", { name: `${recipient.name} 수신 설정` });
  expect(panel).toBeVisible();
  expect(within(panel).getByRole("heading", { name: recipient.name })).toHaveAttribute("title", recipient.name);
  expect(panel.querySelector(".recipient-panel-head p")).toHaveAttribute("title", `${recipient.team} | ${recipient.email}`);
  fireEvent.click(within(panel).getByRole("button", { name: "수신 설정 닫기" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("같은 설정을 사용하는 두 저장 버튼은 응답까지 잠그고 중복 요청을 막는다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const pending = deferred<AlertSettings>();
  const save = vi.fn(() => pending.promise);
  render(<AdminPage admin={data.admin} headerNotifications={[]} dataSource={{ ...source, replaceAlertSettings: save }} />);
  const button = screen.getByRole("button", { name: "수거 설정 저장" });
  fireEvent.click(button);
  fireEvent.click(button);
  fireEvent.click(screen.getByRole("button", { name: "정책 저장" }));
  expect(button).toBeDisabled();
  expect(screen.getByRole("button", { name: "정책 저장" })).toBeDisabled();
  expect(screen.getByLabelText("변경값")).toBeDisabled();
  await act(async () => { pending.resolve({ ...data.admin.alertSettings, collectionThreshold: 84 }); await pending.promise; });
  expect(save).toHaveBeenCalledTimes(1);
  expect(button).toBeEnabled();
  expect(screen.getByLabelText("변경값")).toHaveValue(84);
});

test("설정 충돌은 성공으로 표시하지 않고 기존 적용값과 입력값을 유지한다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const save = vi.fn().mockRejectedValue({ status: 412 });
  render(<AdminPage admin={data.admin} headerNotifications={[]} dataSource={{ ...source, replaceAlertSettings: save }} />);
  fireEvent.change(screen.getByLabelText("변경값"), { target: { value: "85" } });
  fireEvent.click(screen.getByRole("button", { name: "수거 설정 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("다른 변경이 있습니다.");
  expect(document.querySelector(".threshold-applied strong")).toHaveTextContent(`${data.admin.alertSettings.collectionThreshold}%`);
  expect(screen.getByLabelText("변경값")).toHaveValue(85);
  expect(document.querySelectorAll(".threshold-change p")).toHaveLength(1);
});

test("서버의 422 검증 실패는 기존 적용값을 유지하고 입력 확인을 안내한다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const save = vi.fn().mockRejectedValue({ status: 422 });
  render(<AdminPage admin={data.admin} headerNotifications={[]} dataSource={{ ...source, replaceAlertSettings: save }} />);
  fireEvent.change(screen.getByLabelText("변경값"), { target: { value: "90" } });
  fireEvent.click(screen.getByRole("button", { name: "수거 설정 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("임계율 조합을 확인하세요");
  expect(document.querySelector(".threshold-applied strong")).toHaveTextContent(`${data.admin.alertSettings.collectionThreshold}%`);
});

test("422 검증 배열의 loc는 수거 설정과 정책 영역에 나누어 표시한다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const issue = (...loc: string[]) => ({ loc, message: "bad", type: "value_error" });
  const save = vi.fn().mockRejectedValue({ status: 422, issues: [issue("body", "preCollectionAlert", "thresholdPercent"), issue("body", "repeatIntervalMinutes")] });
  render(<AdminPage admin={data.admin} headerNotifications={[]} dataSource={{ ...source, replaceAlertSettings: save }} />);
  fireEvent.click(screen.getByRole("button", { name: "수거 설정 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("사전 알림 기준 값을 서버가 받아들이지 않았습니다.");
  expect(document.querySelector(".policy-feedback")).toHaveTextContent("반복 간격 값을 서버가 받아들이지 않았습니다.");
  expect(document.querySelector(".threshold-change")).not.toHaveTextContent("반복 간격");
});

test("data source가 바뀌면 이전 저장 응답을 화면에 적용하지 않는다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const pending = deferred<AlertSettings>();
  const view = render(<AdminPage admin={data.admin} headerNotifications={[]} dataSource={{ ...source, replaceAlertSettings: () => pending.promise }} />);
  fireEvent.click(screen.getByRole("button", { name: "수거 설정 저장" }));
  view.rerender(<AdminPage admin={data.admin} headerNotifications={[]} dataSource={source} />);
  await act(async () => { pending.resolve({ ...data.admin.alertSettings, collectionThreshold: 99 }); await pending.promise; });
  expect(document.querySelector(".threshold-applied strong")).not.toHaveTextContent("99%");
  expect(screen.getByRole("button", { name: "수거 설정 저장" })).toBeEnabled();
});

test("없는 API 동작은 로컬 저장 성공으로 대체하지 않는다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  render(<AdminPage admin={data.admin} headerNotifications={[]} dataSource={{ getDashboardData: () => source.getDashboardData() }} />);
  fireEvent.click(screen.getByRole("button", { name: "수거 설정 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("저장하지 못했습니다.");
  expect(screen.queryByText("수거 설정을 저장했습니다.")).not.toBeInTheDocument();
});

test("등록 대상이 없으면 테스트 요청을 보낼 수 없다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const send = vi.fn();
  render(<AdminPage admin={{ ...data.admin, recipients: [] }} headerNotifications={[]} dataSource={{ ...source, sendTestNotification: send }} />);
  expect(screen.getByRole("button", { name: "테스트 알림 보내기" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "등록 대상" })).toBeDisabled();
  expect(send).not.toHaveBeenCalled();
});

test("전화번호 없는 대상에게 SMS 테스트와 SMS 수신 설정을 요청하지 않는다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const recipient = { ...data.admin.recipients[0], phone: "-" };
  const send = vi.fn();
  const update = vi.fn();
  const user = userEvent.setup();
  render(<AdminPage admin={{ ...data.admin, recipients: [recipient] }} headerNotifications={[]} dataSource={{ ...source, sendTestNotification: send, updateNotificationRecipient: update }} />);
  fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  expect(screen.getByRole("alert")).toHaveTextContent("전화번호가 필요합니다.");
  expect(send).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "수신 설정" }));
  const dialog = screen.getByRole("dialog");
  const sms = within(dialog).getByRole("checkbox", { name: "문자" });
  if (!(sms as HTMLInputElement).checked) await user.click(sms);
  await user.click(within(dialog).getByRole("button", { name: "수신 설정 저장" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("전화번호가 필요합니다.");
  expect(update).not.toHaveBeenCalled();
});

test("대상 생성은 빈 이벤트 목록을 서버에 보내지 않는다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const create = vi.fn();
  const user = userEvent.setup();
  render(<AdminPage admin={data.admin} headerNotifications={[]} dataSource={{ ...source, createNotificationRecipient: create }} />);
  await user.click(screen.getByRole("button", { name: "알림 대상 추가" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("이름"), "검증 담당자");
  await user.type(within(dialog).getByLabelText("소속"), "검증팀");
  await user.type(within(dialog).getByRole("textbox", { name: "이메일" }), "validation@example.com");
  await user.click(within(dialog).getByRole("radio", { name: /개별 이벤트 설정/ }));
  for (const name of ["수거 필요", "측정 오류", "장비 장애"]) await user.click(within(dialog).getByRole("checkbox", { name }));
  await user.click(within(dialog).getByRole("button", { name: "알림 대상 추가" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("수신 이벤트를 하나 이상 선택하세요.");
  expect(create).not.toHaveBeenCalled();
});

test("수신 설정 저장 중에는 닫지 않고 성공 응답의 최신 값과 version을 적용한다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const recipient = data.admin.recipients[0];
  const pending = deferred<{ recipient: typeof recipient; settings: typeof data.admin.recipientSettings[string] }>();
  const update = vi.fn(() => pending.promise);
  const user = userEvent.setup();
  render(<AdminPage admin={data.admin} headerNotifications={[]} dataSource={{ ...source, updateNotificationRecipient: update }} />);
  await user.click(screen.getAllByRole("button", { name: "수신 설정" })[0]);
  await user.click(screen.getByRole("button", { name: "수신 설정 저장" }));
  expect(screen.getByRole("button", { name: "저장 중" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "수신 설정 닫기" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toHaveAccessibleName(`${recipient.name} 수신 설정`);
  await act(async () => { pending.resolve({ recipient: { ...recipient, version: '"saved"' }, settings: { ...data.admin.recipientSettings[recipient.email], enabled: false } }); await pending.promise; });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "수신 설정" })[0]);
  expect(within(screen.getByRole("dialog")).getByRole("checkbox", { name: /수신 상태/ })).not.toBeChecked();
  expect(update).toHaveBeenCalledTimes(1);
});

test("테스트 접수와 실패는 같은 안내 위치를 사용하고 실제 전달 완료를 주장하지 않는다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const send = vi.fn().mockResolvedValue(undefined);
  const view = render(<AdminPage admin={data.admin} headerNotifications={[]} dataSource={{ ...source, sendTestNotification: send }} />);
  const paragraphs = view.container.querySelectorAll(".test-alert-card p").length;
  fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  expect(await screen.findByText("테스트 알림 요청을 접수했습니다.")).toBeVisible();
  expect(view.container.querySelectorAll(".test-alert-card p")).toHaveLength(paragraphs);
  expect(screen.getByText("요청 접수는 실제 이메일이나 문자 수신을 보장하지 않습니다.")).toBeVisible();
  send.mockRejectedValueOnce(new Error("Synthetic failure"));
  fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("요청을 처리하지 못했습니다.");
  expect(screen.queryByText("테스트 알림 요청을 접수했습니다.")).not.toBeInTheDocument();
  expect(view.container.querySelectorAll(".test-alert-card p")).toHaveLength(paragraphs);
});
