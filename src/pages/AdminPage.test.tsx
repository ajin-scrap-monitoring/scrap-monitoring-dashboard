import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import type { AlertSettings, EmailDeliveryReceipt } from "../domain/dashboard";
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

test("전화번호가 없는 대상이어도 테스트 알림을 보낼 수 있고 sms는 전송하지 않는다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const recipient = { ...data.admin.recipients[0], phone: "-" };
  const send = vi.fn().mockResolvedValue(null);
  const user = userEvent.setup();
  render(<AdminPage admin={{ ...data.admin, recipients: [recipient] }} headerNotifications={[]} dataSource={{ ...source, sendTestNotification: send }} />);
  fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  await act(async () => { await Promise.resolve(); });
  expect(send).toHaveBeenCalledWith(recipient.id, ["email"]);
  await user.click(screen.getByRole("button", { name: "수신 설정" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByRole("checkbox", { name: "문자" })).not.toBeInTheDocument();
  expect(within(dialog).getByRole("checkbox", { name: "이메일" })).toBeInTheDocument();
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
  const send = vi.fn().mockResolvedValue(null);
  const view = render(<AdminPage admin={data.admin} headerNotifications={[]} dataSource={{ ...source, sendTestNotification: send }} />);
  const paragraphs = view.container.querySelectorAll(".test-alert-card p").length;
  fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  expect(await screen.findByText("테스트 알림 요청을 접수했습니다. 이메일 발송 상태 정보는 없습니다.")).toBeVisible();
  expect(view.container.querySelectorAll(".test-alert-card p")).toHaveLength(paragraphs);
  expect(screen.getByText("요청 접수와 Google 접수는 실제 이메일 수신을 보장하지 않습니다.")).toBeVisible();
  send.mockRejectedValueOnce(new Error("Synthetic failure"));
  fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("요청을 처리하지 못했습니다.");
  expect(screen.queryByText("테스트 알림 요청을 접수했습니다. 이메일 발송 상태 정보는 없습니다.")).not.toBeInTheDocument();
  expect(view.container.querySelectorAll(".test-alert-card p")).toHaveLength(paragraphs);
});

test("문자 선택이 없고 sms를 전송하지 않으며 비활성 대상도 테스트가 가능하다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const disabledRecipient = { ...data.admin.recipients[0], enabled: false };
  const send = vi.fn().mockResolvedValue(null);
  const create = vi.fn().mockResolvedValue({ recipient: disabledRecipient, settings: { email: true, sms: false, enabled: true, useGlobal: true, collection: true, error: true, device: true } });
  const user = userEvent.setup();

  const view = render(<AdminPage admin={{ ...data.admin, recipients: [disabledRecipient], recipientSettings: { [disabledRecipient.email]: { ...data.admin.recipientSettings[disabledRecipient.email], enabled: false } } }} headerNotifications={[]} dataSource={{ ...source, sendTestNotification: send, createNotificationRecipient: create }} />);

  // 테스트 카드에 문자 선택지가 없음
  const testCard = view.container.querySelector(".test-alert-card")!;
  expect(within(testCard as HTMLElement).queryByRole("checkbox", { name: "문자" })).not.toBeInTheDocument();
  expect(within(testCard as HTMLElement).getByRole("checkbox", { name: "이메일" })).toBeInTheDocument();

  // 비활성 대상도 테스트 가능하고 sms 미전송
  fireEvent.click(within(testCard as HTMLElement).getByRole("button", { name: "테스트 알림 보내기" }));
  await act(async () => { await Promise.resolve(); });
  expect(send).toHaveBeenCalledWith(disabledRecipient.id, ["email"]);

  // 대상 추가 모달에서도 문자 선택지가 없음
  await user.click(screen.getByRole("button", { name: "알림 대상 추가" }));
  const addModal = screen.getByRole("dialog", { name: "알림 대상 추가" });
  expect(within(addModal).queryByRole("checkbox", { name: "문자" })).not.toBeInTheDocument();
  expect(within(addModal).getByRole("checkbox", { name: "이메일" })).toBeInTheDocument();
  await user.click(within(addModal).getByRole("button", { name: "알림 대상 추가 닫기" }));
});

test("발송 상태별 문구 및 error_code title 표시", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const deliveryId = "550e8400-e29b-41d4-a716-446655440099";

  const statuses = [
    { status: "QUEUED", text: "이메일 발송 대기 중입니다.", role: "status" },
    { status: "SENDING", text: "이메일 발송 처리 중입니다.", role: "status" },
    { status: "SENT", text: "Google이 이메일 발송을 접수했습니다. 받은편지함 도착 확인은 아닙니다.", role: "status" },
    { status: "FAILED", text: "이메일 발송에 실패했습니다.", role: "alert", errorCode: "AUTH_REVOKED" },
    { status: "CANCELLED", text: "이메일 발송이 취소되었습니다.", role: "alert" },
    { status: "UNCERTAIN", text: "이메일 발송 접수 여부를 확인할 수 없습니다.", role: "alert" },
  ] as const;

  for (const item of statuses) {
    const send = vi.fn().mockResolvedValue(deliveryId);
    const getDelivery = vi.fn().mockResolvedValue({
      id: deliveryId,
      status: item.status,
      attempts: 1,
      errorCode: "errorCode" in item ? item.errorCode : null,
      dueAt: "2026-11-10T04:00:00Z",
      attemptedAt: "2026-11-10T04:00:00Z",
      completedAt: null,
      phase: "TEST",
      pitId: "pit-1",
      recipientId: "rec-1",
    });

    const { unmount } = render(
      <AdminPage
        admin={data.admin}
        headerNotifications={[]}
        dataSource={{ ...source, sendTestNotification: send, getEmailDelivery: getDelivery }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
    const element = await screen.findByText(item.text);
    expect(element).toBeVisible();
    if ("errorCode" in item && item.errorCode) {
      expect(element).toHaveAttribute("title", item.errorCode);
    }
    unmount();
  }
});

test("QUEUED -> SENT 3초 재조회 및 상한 20회 도달", async () => {
  vi.useFakeTimers();
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const deliveryId = "550e8400-e29b-41d4-a716-446655440088";

  // 1) QUEUED -> SENT 재조회 흐름
  const getDelivery = vi.fn()
    .mockResolvedValueOnce({
      id: deliveryId, status: "QUEUED", attempts: 0, errorCode: null,
      dueAt: "2026-11-10T04:00:00Z", attemptedAt: null, completedAt: null,
      phase: "TEST", pitId: "pit-1", recipientId: "rec-1",
    })
    .mockResolvedValueOnce({
      id: deliveryId, status: "SENT", attempts: 1, errorCode: null,
      dueAt: "2026-11-10T04:00:00Z", attemptedAt: "2026-11-10T04:00:01Z", completedAt: "2026-11-10T04:00:02Z",
      phase: "TEST", pitId: "pit-1", recipientId: "rec-1",
    });

  const view = render(
    <AdminPage
      admin={data.admin}
      headerNotifications={[]}
      dataSource={{ ...source, sendTestNotification: vi.fn().mockResolvedValue(deliveryId), getEmailDelivery: getDelivery }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText("이메일 발송 대기 중입니다.")).toBeVisible();
  expect(getDelivery).toHaveBeenCalledTimes(1);

  // 3초 후 다음 조회
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(getDelivery).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Google이 이메일 발송을 접수했습니다. 받은편지함 도착 확인은 아닙니다.")).toBeVisible();

  // 추가 시간 경과해도 완료 상태이므로 더 이상 호출하지 않음
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(getDelivery).toHaveBeenCalledTimes(2);
  view.unmount();

  // 2) 20회 상한 도달 흐름
  const poll20 = vi.fn().mockResolvedValue({
    id: deliveryId, status: "QUEUED", attempts: 0, errorCode: null,
    dueAt: "2026-11-10T04:00:00Z", attemptedAt: null, completedAt: null,
    phase: "TEST", pitId: "pit-1", recipientId: "rec-1",
  });
  render(
    <AdminPage
      admin={data.admin}
      headerNotifications={[]}
      dataSource={{ ...source, sendTestNotification: vi.fn().mockResolvedValue(deliveryId), getEmailDelivery: poll20 }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  await act(async () => { await Promise.resolve(); });
  expect(poll20).toHaveBeenCalledTimes(1);

  // 19번 추가 폴링 (총 20회)
  for (let i = 0; i < 19; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  }
  expect(poll20).toHaveBeenCalledTimes(20);
  expect(screen.getByText("이메일 발송 상태를 계속 확인하지 못했습니다.")).toBeVisible();

  // 상한 도달 후에는 추가 폴링 없음
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(poll20).toHaveBeenCalledTimes(20);
});

test("조회 실패 시 POST 1회 유지, 이탈 시 timer 정리, 새 요청 시 이전 조회 무시", async () => {
  vi.useFakeTimers();
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const send = vi.fn().mockResolvedValue("550e8400-e29b-41d4-a716-446655440077");

  // 1) 조회 실패 시 안내 문구 표시 및 POST 자동 재요청 없음
  const failDelivery = vi.fn().mockRejectedValue(new Error("Network failed"));
  const view1 = render(
    <AdminPage
      admin={data.admin}
      headerNotifications={[]}
      dataSource={{ ...source, sendTestNotification: send, getEmailDelivery: failDelivery }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText("이메일 발송 상태를 확인하지 못했습니다.")).toBeVisible();
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(send).toHaveBeenCalledTimes(1);
  view1.unmount();

  // 2) 이탈 시 timer 정리 및 AbortSignal 전달
  const pendingDeferred = deferred<EmailDeliveryReceipt>();
  let capturedSignal: AbortSignal | undefined;
  const slowDelivery = vi.fn((_id: string, signal?: AbortSignal) => {
    capturedSignal = signal;
    return pendingDeferred.promise;
  });

  const view2 = render(
    <AdminPage
      admin={data.admin}
      headerNotifications={[]}
      dataSource={{ ...source, sendTestNotification: send, getEmailDelivery: slowDelivery }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  await act(async () => { await Promise.resolve(); });
  expect(slowDelivery).toHaveBeenCalledTimes(1);
  expect(capturedSignal?.aborted).toBe(false);

  view2.unmount();
  expect(capturedSignal?.aborted).toBe(true);

  // 3) 새 요청 시 이전 조회 무시
  const delivery1 = deferred<EmailDeliveryReceipt>();
  const delivery2 = deferred<EmailDeliveryReceipt>();
  let callCount = 0;
  const multiDelivery = vi.fn(() => {
    callCount += 1;
    return callCount === 1 ? delivery1.promise : delivery2.promise;
  });

  render(
    <AdminPage
      admin={data.admin}
      headerNotifications={[]}
      dataSource={{ ...source, sendTestNotification: send, getEmailDelivery: multiDelivery }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  await act(async () => { await Promise.resolve(); });
  expect(multiDelivery).toHaveBeenCalledTimes(1);

  // 이전 조회가 끝나기 전에 새 요청 클릭
  fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));
  await act(async () => { await Promise.resolve(); });
  expect(multiDelivery).toHaveBeenCalledTimes(2);

  // 이전 조회가 늦게 도착해도 무시됨
  await act(async () => {
    delivery1.resolve({
      id: "deliv-1", status: "FAILED", attempts: 1, errorCode: "OLD_ERROR",
      dueAt: "2026-11-10T04:00:00Z", attemptedAt: null, completedAt: null,
      phase: "TEST", pitId: "pit-1", recipientId: "rec-1",
    });
    await Promise.resolve();
  });
  expect(screen.queryByText("이메일 발송에 실패했습니다.")).not.toBeInTheDocument();

  // 두 번째 조회가 해결되면 반영됨
  await act(async () => {
    delivery2.resolve({
      id: "deliv-2", status: "SENT", attempts: 1, errorCode: null,
      dueAt: "2026-11-10T04:00:00Z", attemptedAt: null, completedAt: null,
      phase: "TEST", pitId: "pit-1", recipientId: "rec-1",
    });
    await Promise.resolve();
  });
  expect(screen.getByText("Google이 이메일 발송을 접수했습니다. 받은편지함 도착 확인은 아닙니다.")).toBeVisible();
});
