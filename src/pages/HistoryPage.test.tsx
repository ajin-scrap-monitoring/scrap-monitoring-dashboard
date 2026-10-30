import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import type { DashboardData } from "../domain/dashboard";

import { HistoryPage } from "./HistoryPage";

test.each([0, 80, 90, 100])("현재 임계율 %s%%는 점선과 분리한 그래프 위쪽 여백에 표시한다", async threshold => {
  const { container } = await renderHistory({ thresholds: [{ hour: 0, value: threshold }], loadState: { status: "ready", thresholdKind: "current" } });
  const label = screen.getByText(`현재 임계율 ${threshold}%`);
  expect(label).toHaveAttribute("y", "48");
  expect(label).toHaveAttribute("text-anchor", "end");
  expect(container.querySelector('path[stroke-dasharray="6 6"]')).toHaveAttribute("d", `M58 ${192 - threshold * 1.3}H1900`);
});

test("현재 임계율 값이 없으면 점선의 수치를 임의로 만들지 않는다", async () => {
  const { container } = await renderHistory({ thresholds: [], loadState: { status: "ready", thresholdKind: "current" } });
  expect(container.querySelector('path[stroke-dasharray="6 6"]')).not.toBeInTheDocument();
  expect(screen.queryByText(/^현재 임계율 \d/)).not.toBeInTheDocument();
});

async function renderHistory(historyOverrides: Partial<DashboardData["history"]> = {}, source?: DashboardDataSource) {
  const data = await createMockDashboardDataSource().getDashboardData();
  const history = { ...data.history, ...historyOverrides };
  const props = { history, headerNotifications: [], reception: data.reception };
  return { ...render(<HistoryPage {...props} dataSource={source} />), data, props };
}

function eventSource(getDashboardData: DashboardDataSource["getDashboardData"]) {
  const mock = createMockDashboardDataSource();
  return { ...mock, monitoringVersion: "v2" as const, getDashboardData };
}

test("이력 그래프는 null 구간을 연결하지 않고 단독 0%도 표시한다", async () => {
  const { container } = await renderHistory({ loadSamples: [{ hour: 0, value: 0 }, { hour: 1, value: null }, { hour: 2, value: 50 }] });
  expect(container.querySelectorAll(".history-load-line")).toHaveLength(2);
  expect(container.querySelector('circle[fill="#f58a07"]')).toHaveAttribute("cy", "192");
  for (const path of container.querySelectorAll(".history-load-line")) expect(path.getAttribute("d")).not.toContain("L");
  expect(screen.getByRole("columnheader", { name: "이벤트 유형" })).toBeVisible();
});

test("24시간 이력 눈금은 정각에 정렬하고 조회 기간 및 실제 표본 좌표는 유지한다", async () => {
  const { container } = await renderHistory({ startsAt: "2026-10-14 19:21", endsAt: "2026-10-15 19:21", loadSamples: [{ hour: 0.5, value: 50 }] });
  fireEvent.click(screen.getByRole("button", { name: "최근 24시간" }));
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  expect(screen.getByRole("textbox", { name: "시작 시각" })).toHaveValue("2026-10-14 19:21");
  expect(screen.getByRole("textbox", { name: "종료 시각" })).toHaveValue("2026-10-15 19:21");
  const labels = [...container.querySelectorAll('.history-chart text[y="218"]')].map(text => text.textContent);
  expect(labels).toEqual(["21:00", "00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00"]);
  expect(container.querySelector(".history-load-line")).toHaveAttribute("d", `M${58 + 1842 * 0.5 / 24} 127`);
});

test("1시간의 이력 조회 구간에도 정각 눈금을 표시한다", async () => {
  const { container } = await renderHistory({ startsAt: "2026-10-14 19:21", endsAt: "2026-10-15 19:21", loadSamples: [] });
  fireEvent.change(screen.getByRole("textbox", { name: "시작 시각" }), { target: { value: "2026-10-15 18:21" } });
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  expect([...container.querySelectorAll('.history-chart text[y="218"]')].map(text => text.textContent)).toEqual(["19:00"]);
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
  expect(screen.getByText("현재 임계율")).toBeVisible();
  expect(screen.queryByText("적재율은 v2 STATE 판단이며, 이벤트 목록은 v1 운영 기록입니다.")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "조회 조건" })).toBeVisible();
  const limited = screen.getByLabelText(/대표 적재율 54%, 입력 제한, 관측/);
  expect(limited).toBeInTheDocument();
  fireEvent.focus(limited);
  expect(container.querySelector(".history-chart-tooltip")).toHaveTextContent("대표 적재율 54% / 입력 제한");
  expect(container.querySelectorAll(".history-event-target")).toHaveLength(0);
});

test("90일 선택은 그대로 조회하고 조회 중 상태를 표시한다", async () => {
  const mock = createMockDashboardDataSource();
  const data = await mock.getDashboardData();
  let finish!: (value: DashboardData["history"]) => void;
  const queryHistory = vi.fn(() => new Promise<DashboardData["history"]>((resolve) => { finish = resolve; }));
  const { container } = await renderHistory({}, { ...mock, monitoringVersion: "v2", queryHistory });
  fireEvent.click(screen.getByRole("button", { name: "최근 90일" }));
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  expect(queryHistory).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "조회 중" })).toBeDisabled();
  expect(container.querySelector("#history-query-status")).toHaveTextContent("조회 중입니다.");
  await act(async () => { finish({ ...data.history, loadState: { status: "ready" } }); await Promise.resolve(); });
  expect(screen.getByRole("button", { name: "최근 90일" })).toHaveAttribute("aria-pressed", "true");
  expect(container.querySelector("#history-query-status")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("90일을 넘는 기간은 요청 전에 안내하고 요청하지 않는다", async () => {
  const mock = createMockDashboardDataSource();
  const queryHistory = vi.fn();
  await renderHistory({}, { ...mock, monitoringVersion: "v2", queryHistory });
  fireEvent.click(screen.getByRole("button", { name: "최근 90일" }));
  fireEvent.change(screen.getByRole("textbox", { name: "시작 시각" }), { target: { value: "2000-01-01 00:00" } });
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  expect(screen.getByRole("alert")).toHaveTextContent("최대 90일");
  expect(queryHistory).not.toHaveBeenCalled();
});

test.each([
  ["HISTORY_QUERY_TIMEOUT", "서버의 조회 처리 시간이 초과되었습니다. 기간을 줄여 다시 조회하세요."],
  ["HISTORY_TOO_MANY_POINTS", "조회 구간 수가 응답 한도를 넘습니다. 기간을 줄여 다시 조회하세요."],
])("%s 오류는 빈 그래프로 대체하지 않고 코드별 안내를 그래프 영역에 표시한다", async (code, message) => {
  const mock = createMockDashboardDataSource();
  const data = await mock.getDashboardData();
  const queryHistory = vi.fn().mockResolvedValue({ ...data.history, loadSamples: [], loadState: { status: "error", code, message, httpStatus: 503, stale: false } });
  const { container } = await renderHistory({}, { ...mock, monitoringVersion: "v2", queryHistory });
  fireEvent.click(screen.getByRole("button", { name: "조회" }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText(message, { selector: "text" })).toBeVisible();
  expect(container.querySelectorAll(".history-load-line")).toHaveLength(0);
  expect(queryHistory).toHaveBeenCalledOnce();
});

test("이벤트 조회 실패는 데이터 없음이나 총 0건으로 표시하지 않는다", async () => {
  await renderHistory({ events: [], eventsState: { status: "error" } });
  expect(screen.getByText("조회 실패")).toBeVisible();
  expect(screen.getByText("이벤트 이력을 조회하지 못했습니다.")).toBeVisible();
  expect(screen.queryByText("총 0건")).not.toBeInTheDocument();
});

test("입력과 조회 오류는 기존 조회 조건 제목 안에서 안내하고 성공하면 제거한다", async () => {
  const source = createMockDashboardDataSource();
  const data = await source.getDashboardData();
  const queryHistory = vi.fn().mockRejectedValueOnce(new Error("Synthetic query failure")).mockResolvedValue(data.history);
  const view = await renderHistory({}, { ...source, queryHistory });
  const query = view.container.querySelector(".history-query")!;
  const form = query.querySelector("form")!;
  const start = screen.getByRole("textbox", { name: "시작 시각" });
  const originalStart = (start as HTMLInputElement).value;
  fireEvent.change(start, { target: { value: "invalid" } });
  fireEvent.submit(form);
  const invalid = screen.getByRole("alert");
  expect(invalid.parentElement).toHaveClass("history-query-head");
  expect(invalid).toHaveAttribute("title", invalid.textContent);
  expect(form).toHaveAccessibleDescription(invalid.textContent);
  expect(query.querySelector(":scope > p")).toBeNull();
  expect(queryHistory).not.toHaveBeenCalled();
  fireEvent.change(start, { target: { value: originalStart } });
  fireEvent.submit(form);
  await act(async () => { await Promise.resolve(); });
  const failed = screen.getByRole("alert");
  expect(failed).toHaveTextContent("기존 조회 결과를 유지");
  expect(failed.parentElement).toHaveClass("history-query-head");
  expect(form).toHaveAccessibleDescription(failed.textContent);
  expect(screen.getByText("총 9건")).toBeVisible();
  fireEvent.submit(form);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(form).not.toHaveAttribute("aria-describedby");
});

test("알림 API와 무관하게 이벤트 제목과 서버 설명을 상세 모달에 분리한다", async () => {
  await renderHistory({ events: [{ id: "event-error", type: "오류", title: "측정 정보 확인 필요", content: "서버 상세 설명", detail: "서버 상세 설명", time: "2026-09-09 12:00", tone: "error", status: null, recordingId: null }] });
  expect(screen.queryByText("서버 상세 설명")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /측정 정보 확인 필요 상세 보기/ }));
  const modal = screen.getByRole("dialog", { name: "이벤트 상세" });
  expect(modal).toHaveAttribute("aria-modal", "true");
  expect(within(modal).getByText("서버 상세 설명")).toBeVisible();
  expect(within(modal).getByText("발생 시각")).toBeVisible();
  expect(within(modal).queryByText("경보 판단 정보")).not.toBeInTheDocument();
  expect(within(modal).queryByRole("link", { name: "관련 녹화 확인" })).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test.each([
  "Synthetic camera integration check; not a field alert",
  "Unknown backend description: event-987 <script>not executable</script>",
  "서버가 제공하는 임의의 설명",
])("설명 %s를 해석하지 않고 Backend 제목과 설명을 보존한다", async (detail) => {
  const getDashboardData = vi.fn<DashboardDataSource["getDashboardData"]>();
  await renderHistory({ events: [{ id: "event-camera-check", type: "알림", title: "수거 필요", content: detail, detail, time: "2026-09-09 12:00", tone: "warning", status: null, recordingId: "recording-camera-check" }] }, eventSource(getDashboardData));
  expect(screen.queryByText(detail)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /알림 수거 필요 상세 보기/ }));
  await act(async () => { await Promise.resolve(); });
  const modal = screen.getByRole("dialog", { name: "이벤트 상세" });
  expect(within(modal).getByRole("heading", { name: "수거 필요" })).toBeVisible();
  expect(within(modal).getByText(detail)).toBeVisible();
  expect(modal.querySelector("script")).toBeNull();
  expect(within(modal).queryByText(/실제 현장 경보가 아닙니다/)).not.toBeInTheDocument();
  expect(within(modal).queryByText("상태", { selector: "dt" })).not.toBeInTheDocument();
  expect(getDashboardData).not.toHaveBeenCalled();
  expect(within(modal).getByRole("link", { name: "관련 녹화 확인" })).toHaveAttribute("href", "/recordings?recordingId=recording-camera-check");
});

test("확인된 완료만 표와 상세에 표시하고 모호한 상태는 원과 항목을 함께 생략한다", async () => {
  const { container } = await renderHistory({ events: [
    { id: "event-alert", type: "알림", title: "확인용 알림", content: "알림 설명", time: "2026-09-09 12:00", tone: "error", status: null, recordingId: null },
    { id: "event-complete", type: "수거", title: "완료된 수거", content: "수거 설명", time: "2026-09-09 13:00", tone: "complete", status: "완료", recordingId: null },
  ] });
  const rows = container.querySelectorAll(".history-events tbody tr");
  expect(rows[0].children[2]).toBeEmptyDOMElement();
  expect(rows[1].children[2]).toHaveTextContent("완료");
  expect(rows[1].querySelector(".event-dot.complete")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /확인용 알림 상세 보기$/ }));
  expect(within(screen.getByRole("dialog")).queryByText("상태", { selector: "dt" })).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: /완료된 수거 상세 보기$/ }));
  const modal = screen.getByRole("dialog");
  expect(within(modal).getByText("상태", { selector: "dt" }).parentElement).toHaveTextContent("완료");
  expect(within(modal).getByText("이벤트 유형", { selector: "dt" }).parentElement).toHaveTextContent("수거");
});

test("이벤트 변경, 닫기와 source 변경은 선택한 상세를 분리하고 판단 목록을 조회하지 않는다", async () => {
  const getDashboardData = vi.fn<DashboardDataSource["getDashboardData"]>();
  const source = eventSource(getDashboardData);
  const view = await renderHistory({}, source);
  const triggers = screen.getAllByRole("button", { name: /알림 .* 상세 보기/ });
  fireEvent.click(triggers[0]);
  expect(screen.getByRole("dialog")).not.toHaveTextContent("경보 판단 정보");
  expect(screen.getByRole("dialog")).not.toHaveTextContent("조회 범위");
  expect(screen.queryByRole("button", { name: "다음 범위 조회" })).not.toBeInTheDocument();
  fireEvent.click(triggers[1]);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "이벤트 상세" })).not.toBeInTheDocument();
  fireEvent.click(triggers[0]);
  view.rerender(<HistoryPage {...view.props} dataSource={{ ...source }} />);
  expect(screen.queryByRole("dialog", { name: "이벤트 상세" })).not.toBeInTheDocument();
  expect(getDashboardData).not.toHaveBeenCalled();
});

function historyEvent(index: number): DashboardData["history"]["events"][number] {
  return { id: `evt-${index}`, content: `내용 ${index}`, title: `이벤트 ${index}`, recordingId: null, status: null, time: "2026-10-15 12:00", tone: "warning", type: "알림" };
}

function pagedSource() {
  const mock = createMockDashboardDataSource();
  const pending: Array<{ page: number; resolve: (items: number[]) => void; signal?: AbortSignal }> = [];
  let finishLoad!: (value: DashboardData["history"]) => void;
  const queryHistory = vi.fn(() => new Promise<DashboardData["history"]>((resolve) => { finishLoad = resolve; }));
  const queryHistoryEvents = vi.fn((query: { page: number; pageSize: number }, signal?: AbortSignal) => new Promise<{ events: DashboardData["history"]["events"]; totalItems: number; totalPages: number; page: number }>((resolve) => {
    pending.push({ page: query.page, signal, resolve: (items) => resolve({ events: items.map(historyEvent), totalItems: 1811, totalPages: 227, page: query.page }) });
  }));
  return { source: { ...mock, monitoringVersion: "v2" as const, queryHistory, queryHistoryEvents }, queryHistory, queryHistoryEvents, pending, finishLoad: (value: DashboardData["history"]) => finishLoad(value) };
}

test("이벤트 표는 적재율 그래프를 기다리지 않고 보이는 페이지만 서버에서 조회한다", async () => {
  const { source, queryHistory, queryHistoryEvents, pending, finishLoad } = pagedSource();
  const data = await createMockDashboardDataSource().getDashboardData();
  const loading = { ...data.history, events: [], loadSamples: [], loadState: { status: "loading" as const }, eventsState: { status: "loading" as const } };
  const { container } = await renderHistory(loading, source);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  expect(queryHistory).toHaveBeenCalledOnce();
  expect(queryHistoryEvents).toHaveBeenCalledOnce();
  expect(queryHistoryEvents.mock.calls[0][0]).toMatchObject({ page: 0, pageSize: 8 });
  expect(screen.getByText("불러오는 중")).toBeVisible();
  await act(async () => { pending[0].resolve([1, 2, 3, 4, 5, 6, 7, 8]); await Promise.resolve(); });
  expect(screen.getByText("총 1811건")).toBeVisible();
  expect(container.querySelectorAll(".history-events tbody tr")).toHaveLength(8);
  expect(screen.getByText("1 / 227")).toBeVisible();
  expect(container.querySelector("#history-query-status")).toHaveTextContent("조회 중입니다.");
  expect(screen.getByText("적재율 이력을 불러오는 중입니다.", { selector: "text" })).toBeVisible();
  await act(async () => { finishLoad({ ...data.history, events: [], loadState: { status: "ready" } }); await Promise.resolve(); });
  expect(container.querySelector("#history-query-status")).toBeNull();
});

test("표 페이지 이동은 해당 서버 페이지만 요청하고 이전 요청의 늦은 응답은 적용하지 않는다", async () => {
  const { source, queryHistoryEvents, pending, finishLoad } = pagedSource();
  const data = await createMockDashboardDataSource().getDashboardData();
  const loading = { ...data.history, events: [], loadSamples: [], loadState: { status: "loading" as const }, eventsState: { status: "loading" as const } };
  await renderHistory(loading, source);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  await act(async () => { pending[0].resolve([1, 2, 3, 4, 5, 6, 7, 8]); finishLoad({ ...data.history, events: [], loadState: { status: "ready" } }); await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: "다음 이벤트 페이지" }));
  fireEvent.click(screen.getByRole("button", { name: "다음 이벤트 페이지" }));
  expect(queryHistoryEvents).toHaveBeenCalledTimes(3);
  expect(queryHistoryEvents.mock.calls.slice(1).map(([query]) => query.page)).toEqual([1, 2]);
  expect(pending[1].signal?.aborted).toBe(true);
  await act(async () => { pending[2].resolve([21, 22]); await Promise.resolve(); });
  await act(async () => { pending[1].resolve([11, 12, 13]); await Promise.resolve(); });
  expect(screen.getByText("이벤트 21")).toBeVisible();
  expect(screen.queryByText("이벤트 11")).toBeNull();
  expect(screen.getByText("3 / 227")).toBeVisible();
});
