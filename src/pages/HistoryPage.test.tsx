import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import type { AlertEvidence, AlertEvidencePage, DashboardData } from "../domain/dashboard";

import { HistoryPage } from "./HistoryPage";

async function renderHistory(historyOverrides: Partial<DashboardData["history"]> = {}, source?: DashboardDataSource) {
  const data = await createMockDashboardDataSource().getDashboardData();
  const history = { ...data.history, ...historyOverrides };
  const props = { history, headerNotifications: [], lastMeasuredAt: data.lastMeasuredAt, status: "fresh" as const };
  return { ...render(<HistoryPage {...props} dataSource={source} />), data, props };
}

function evidence(eventId = "event-2"): AlertEvidence {
  return { eventId, assessmentId: "assessment-for-selected-event", notificationId: "notification-for-selected-event", loadPercent: 0, observedAt: "2026-09-09T12:00:00+09:00", triggeredAt: "2026-09-09T12:00:01+09:00", readAt: null };
}

function evidenceSource(getAlertEvidencePage: NonNullable<DashboardDataSource["getAlertEvidencePage"]>) {
  const mock = createMockDashboardDataSource();
  return { ...mock, monitoringVersion: "v2" as const, getAlertEvidencePage };
}

test("이력 그래프는 null 구간을 연결하지 않고 단독 0%도 표시한다", async () => {
  const { container } = await renderHistory({ loadSamples: [{ hour: 0, value: 0 }, { hour: 1, value: null }, { hour: 2, value: 50 }] });
  expect(container.querySelectorAll(".history-load-line")).toHaveLength(2);
  expect(container.querySelector('circle[fill="#f58a07"]')).toHaveAttribute("cy", "192");
  for (const path of container.querySelectorAll(".history-load-line")) expect(path.getAttribute("d")).not.toContain("L");
});

test("조회 경계의 적재율을 보간해 만들지 않는다", async () => {
  const { container } = await renderHistory({ loadSamples: [{ hour: 0, value: 0 }, { hour: 1, value: null }, { hour: 2, value: 50 }, { hour: 3, value: 80 }] });
  fireEvent.change(screen.getByRole("textbox", { name: "시작 시각" }), { target: { value: "2026-09-03 00:30" } });
  fireEvent.change(screen.getByRole("textbox", { name: "종료 시각" }), { target: { value: "2026-09-03 02:30" } });
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  const path = container.querySelector(".history-load-line");
  expect(path).toHaveAttribute("d", `M${58 + 1842 * 1.5 / 2} 127`);
});

test("LIMITED와 현재 임계율 참고 의미를 표시하고 v1 marker를 v2 점에 연결하지 않는다", async () => {
  const mock = createMockDashboardDataSource();
  const { container } = await renderHistory({ loadSamples: [{ hour: 2, value: 54, generatedAt: "2026-09-03T02:00:00Z", observedAt: "2026-09-03T01:59:59Z", dataState: "LIMITED" }], loadState: { status: "ready", thresholdKind: "current" } }, { ...mock, monitoringVersion: "v2" });
  expect(screen.getByText("현재 임계율(참고)")).toBeVisible();
  const limited = screen.getByLabelText(/대표 적재율 54%, 입력 제한, 관측/);
  expect(limited).toBeInTheDocument();
  fireEvent.focus(limited);
  expect(container.querySelector(".history-chart-tooltip")).toHaveTextContent("대표 적재율 54% / 입력 제한");
  expect(container.querySelectorAll(".history-event-target")).toHaveLength(0);
});

test("30일과 90일 선택은 유지하고 v2 추이만 미지원으로 표시한다", async () => {
  const mock = createMockDashboardDataSource();
  const data = await mock.getDashboardData();
  const queryHistory = vi.fn().mockResolvedValue({ ...data.history, loadSamples: [], loadState: { status: "unsupported", message: "v2 적재율 추이는 최대 7일까지 조회할 수 있습니다." } });
  await renderHistory({}, { ...mock, monitoringVersion: "v2", queryHistory });
  expect(screen.getByRole("button", { name: "최근 90일" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "최근 30일" }));
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  await act(async () => { await Promise.resolve(); });
  expect(queryHistory).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "최근 30일" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("v2 적재율 추이는 최대 7일까지 조회할 수 있습니다.", { selector: "text" })).toBeVisible();
  expect(screen.getByText("총 9건")).toBeVisible();
  expect(screen.queryByText("조회된 적재율 데이터가 없습니다.")).not.toBeInTheDocument();
});

test("이벤트 조회 실패는 데이터 없음이나 총 0건으로 표시하지 않는다", async () => {
  await renderHistory({ events: [], eventsState: { status: "error" } });
  expect(screen.getByText("조회 실패")).toBeVisible();
  expect(screen.getByText("이벤트 이력을 조회하지 못했습니다.")).toBeVisible();
  expect(screen.queryByText("총 0건")).not.toBeInTheDocument();
});

test("경보 근거는 선택할 때 한 페이지만 조회하고 event ID가 일치하는 기록만 표시한다", async () => {
  const getAlertEvidencePage = vi.fn<NonNullable<DashboardDataSource["getAlertEvidencePage"]>>()
    .mockResolvedValueOnce({ items: [{ ...evidence("another-event"), assessmentId: "must-not-be-shown" }], offset: 0, limit: 1, totalItems: 2 })
    .mockResolvedValueOnce({ items: [evidence()], offset: 1, limit: 1, totalItems: 2 });
  const source = evidenceSource(getAlertEvidencePage);
  await renderHistory({}, source);
  expect(getAlertEvidencePage).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: /경보 근거 보기/ })[0]);
  await act(async () => { await Promise.resolve(); });
  const dialog = screen.getByRole("dialog", { name: "경보 근거" });
  expect(within(dialog).getByText("현재 조회 범위에서 이 기록의 근거를 확인할 수 없습니다.")).toBeVisible();
  expect(within(dialog).getByText("조회 범위 1-1 / 총 2건")).toBeVisible();
  expect(screen.queryByText("must-not-be-shown")).not.toBeInTheDocument();
  expect(getAlertEvidencePage).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "다음 범위 조회" }));
  await act(async () => { await Promise.resolve(); });
  expect(getAlertEvidencePage.mock.calls[1][0]).toBe(1);
  expect(within(dialog).getByText("assessment-for-selected-event")).toBeVisible();
  expect(within(dialog).getByText("0%")).toBeVisible();
  expect(within(dialog).getByText("미읽음")).toBeVisible();
  expect(within(dialog).queryByText(/경보 해제/)).not.toBeInTheDocument();
});

test("경보 상세 조회 실패는 근거 없음으로 확정하지 않고 재시도한다", async () => {
  const getAlertEvidencePage = vi.fn<NonNullable<DashboardDataSource["getAlertEvidencePage"]>>()
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValueOnce({ items: [evidence()], offset: 0, limit: 20, totalItems: 1 });
  await renderHistory({}, evidenceSource(getAlertEvidencePage));
  fireEvent.click(screen.getAllByRole("button", { name: /경보 근거 보기/ })[0]);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByRole("alert")).toHaveTextContent("근거가 없는 것으로 확정할 수 없습니다.");
  expect(screen.queryByText("현재 조회 범위에서 이 기록의 근거를 확인할 수 없습니다.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText("assessment-for-selected-event")).toBeVisible();
});

test("경보 변경, 상세 닫기와 source 변경은 이전 요청을 취소하고 늦은 응답을 무시한다", async () => {
  const pending: Array<(value: AlertEvidencePage) => void> = [];
  const getAlertEvidencePage = vi.fn<NonNullable<DashboardDataSource["getAlertEvidencePage"]>>()
    .mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
  const source = evidenceSource(getAlertEvidencePage);
  const view = await renderHistory({}, source);
  const triggers = screen.getAllByRole("button", { name: /경보 근거 보기/ });
  fireEvent.click(triggers[0]);
  fireEvent.click(triggers[1]);
  expect(getAlertEvidencePage.mock.calls[0][1]?.aborted).toBe(true);
  await act(() => { pending[0]({ items: [evidence()], offset: 0, limit: 20, totalItems: 1 }); return Promise.resolve(); });
  expect(screen.queryByText("assessment-for-selected-event")).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(getAlertEvidencePage.mock.calls[1][1]?.aborted).toBe(true);
  expect(screen.queryByRole("dialog", { name: "경보 근거" })).not.toBeInTheDocument();
  fireEvent.click(triggers[0]);
  view.rerender(<HistoryPage {...view.props} dataSource={{ ...source }} />);
  expect(getAlertEvidencePage.mock.calls[2][1]?.aborted).toBe(true);
  expect(screen.queryByRole("dialog", { name: "경보 근거" })).not.toBeInTheDocument();
});

test("근거 조회의 offset 한도를 넘는 다음 페이지를 만들지 않는다", async () => {
  const getAlertEvidencePage = vi.fn<NonNullable<DashboardDataSource["getAlertEvidencePage"]>>()
    .mockResolvedValue({ items: [evidence("another-event")], offset: 10000, limit: 20, totalItems: 20000 });
  await renderHistory({}, evidenceSource(getAlertEvidencePage));
  fireEvent.click(screen.getAllByRole("button", { name: /경보 근거 보기/ })[0]);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText("이후 범위는 서버의 조회 한도를 초과합니다.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "다음 범위 조회" })).not.toBeInTheDocument();
});
