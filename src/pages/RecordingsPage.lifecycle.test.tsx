import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import type { Recording } from "../domain/dashboard";

import { RecordingsPage } from "./RecordingsPage";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function fixture() {
  const data = await createMockDashboardDataSource().getDashboardData();
  const ready: Recording = { ...data.recordings[0], sample: false, mediaStatus: "ready", contentUrl: "/media/first/content", downloadUrl: "/media/first/content?download=true" };
  const second: Recording = { ...data.recordings[1], sample: false, mediaStatus: "ready", contentUrl: "/media/second/content", downloadUrl: "/media/second/content?download=true" };
  return { data, ready, second };
}

test.each([new TypeError("Network unavailable"), ...[408, 429, 500, 502, 503, 504].map(status => Object.assign(new Error("Temporary failure"), { status }))])("일시적인 단건 조회 실패는 기존 player를 유지하고 자동 복구한다 (%s)", async (error) => {
  vi.useFakeTimers();
  const { data, ready } = await fixture();
  const processing: Recording = { ...ready, mediaStatus: "processing" };
  const getRecording = vi.fn().mockResolvedValueOnce(processing).mockRejectedValueOnce(error).mockResolvedValue(ready);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[processing]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  const video = view.container.querySelector("video");
  expect(video).not.toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(view.container.querySelector("video")).toBe(video);
  expect(screen.getByRole("button", { name: "다운로드 불가" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "확인 실패 상세" })).toBeInTheDocument();
  expect(view.container.querySelectorAll(".recordings-content .card")).toHaveLength(5);
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(getRecording).toHaveBeenCalledTimes(3);
  expect(view.container.querySelector("video")).toBe(video);
  expect(screen.queryByRole("button", { name: "확인 실패 상세" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "녹화 영상 다운로드" })).toBeEnabled();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(getRecording).toHaveBeenCalledTimes(3);
});

test("처음부터 조회에 실패한 녹화는 재확인 전 재생과 다운로드를 허용하지 않는다", async () => {
  vi.useFakeTimers();
  const { data, ready } = await fixture();
  const getRecording = vi.fn().mockRejectedValueOnce(Object.assign(new Error("Temporary failure"), { status: 503 })).mockResolvedValue(ready);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[ready]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  expect(view.container.querySelector("video")).toBeNull();
  expect(screen.getByRole("button", { name: "다운로드 불가" })).toBeDisabled();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(view.container.querySelector("video")).toHaveAttribute("src", ready.contentUrl);
});

test("연속 실패는 2초, 4초와 8초 간격으로 세 번만 재시도한다", async () => {
  vi.useFakeTimers();
  const { data, ready } = await fixture();
  const processing: Recording = { ...ready, mediaStatus: "processing" };
  const getRecording = vi.fn().mockResolvedValueOnce(processing).mockRejectedValue(Object.assign(new Error("Temporary failure"), { status: 503 }));
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[processing]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  const video = view.container.querySelector("video");
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(getRecording).toHaveBeenCalledTimes(2);
  for (const delay of [2000, 4000, 8000]) {
    const count = getRecording.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(delay - 1));
    expect(getRecording).toHaveBeenCalledTimes(count);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getRecording).toHaveBeenCalledTimes(count + 1);
  }
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(getRecording).toHaveBeenCalledTimes(5);
  expect(view.container.querySelector("video")).toBe(video);
  expect(screen.getByRole("button", { name: "다운로드 불가" })).toBeDisabled();
  expect(vi.getTimerCount()).toBe(0);
});

test.each([400, 401, 403, 404, 410, 501])("HTTP %s 오류는 재시도하거나 이전 player 및 다운로드를 유지하지 않는다", async (status) => {
  vi.useFakeTimers();
  const { data, ready } = await fixture();
  const processing: Recording = { ...ready, mediaStatus: "processing" };
  const getRecording = vi.fn().mockResolvedValueOnce(processing).mockRejectedValue(Object.assign(new Error("Unavailable"), { status }));
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[processing]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  expect(view.container.querySelector("video")).not.toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(view.container.querySelector("video")).toBeNull();
  expect(screen.getByRole("button", { name: "다운로드 불가" })).toBeDisabled();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(getRecording).toHaveBeenCalledTimes(2);
});

test("단건 조회 재시도 대기 중 선택 변경과 unmount는 이전 재시도를 취소한다", async () => {
  vi.useFakeTimers();
  const { data, ready, second } = await fixture();
  const getRecording = vi.fn<(id: string, signal?: AbortSignal) => Promise<Recording | null>>().mockRejectedValue(new TypeError("Network unavailable"));
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[ready, second]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(view.container.querySelectorAll<HTMLButtonElement>(".recording-item")[1]);
  await act(async () => { await Promise.resolve(); });
  expect(getRecording.mock.calls[0][1]?.aborted).toBe(true);
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(getRecording).toHaveBeenCalledTimes(2);
});

test("단건 조회 복구 후 다음 실패는 기본 재시도 간격을 사용한다", async () => {
  vi.useFakeTimers();
  const { data, ready } = await fixture();
  const processing: Recording = { ...ready, mediaStatus: "processing" };
  const error = Object.assign(new Error("Temporary failure"), { status: 503 });
  const getRecording = vi.fn().mockResolvedValueOnce(processing).mockRejectedValueOnce(error)
    .mockResolvedValueOnce(processing).mockRejectedValueOnce(error).mockResolvedValue(ready);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  render(<RecordingsPage dataSource={source} recordings={[processing]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  for (let count = 2; count <= 5; count += 1) {
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(getRecording).toHaveBeenCalledTimes(count);
  }
  expect(screen.getByRole("button", { name: "녹화 영상 다운로드" })).toBeEnabled();
  expect(vi.getTimerCount()).toBe(0);
});

test.each([null, new SyntaxError("Invalid response")])("삭제 응답과 잘못된 단건 응답은 기존 재생을 유지하거나 재시도하지 않는다 (%s)", async (failure) => {
  vi.useFakeTimers();
  const { data, ready } = await fixture();
  const processing: Recording = { ...ready, mediaStatus: "processing" };
  const getRecording = vi.fn().mockResolvedValueOnce(processing);
  if (failure === null) getRecording.mockResolvedValue(null);
  else getRecording.mockRejectedValue(failure);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[processing]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  expect(view.container.querySelector("video")).not.toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(view.container.querySelector("video")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(getRecording).toHaveBeenCalledTimes(2);
});

test("실패한 녹화 목록에는 길이의 결측 문구를 숨기고 정보 카드에는 서버 값을 유지한다", async () => {
  const { data, ready } = await fixture();
  const failed: Recording = { ...ready, mediaStatus: "failed", status: "unavailable", duration: "정보 없음", contentUrl: undefined, downloadUrl: undefined };
  const view = render(<RecordingsPage recordings={[failed]} headerNotifications={[]} reception={data.reception} />);
  expect(view.container.querySelector(".recording-item")).toHaveTextContent("녹화 실패");
  expect(view.container.querySelector(".recording-item")).not.toHaveTextContent("정보 없음");
  expect(view.container.querySelector(".recording-info")).toHaveTextContent("정보 없음");
  expect(view.container.querySelector(".recording-info")).toHaveTextContent("MP4");
  expect(view.container.querySelector(".recording-info")).toHaveTextContent("H.264");
});

test.each([undefined, { status: "error" as const, message: "목록 조회 실패" }])("빈 녹화 목록에도 조회, 목록, 영상, 정보와 다운로드 카드가 유지된다 (%j)", async (recordingsState) => {
  const { data } = await fixture();
  const view = render(<RecordingsPage recordings={[]} recordingsState={recordingsState} headerNotifications={[]} reception={data.reception} />);
  expect(view.container.querySelectorAll(".recordings-content .card")).toHaveLength(5);
  expect(view.container.querySelector(".recording-frame")).toHaveTextContent("선택할 수 있는 녹화 영상이 없습니다.");
  expect(view.container.querySelector(".recording-info dl")?.children).toHaveLength(11);
  expect(view.container.querySelector(".recording-info")).not.toHaveTextContent("undefined");
  expect(screen.getByRole("button", { name: "다운로드 불가" })).toBeDisabled();
  expect(view.container.querySelector("video")).toBeNull();
});

test("녹화 조회 실패는 안내를 추가하지 않고 기존 결과와 카드 구조를 유지한다", async () => {
  const { data, ready } = await fixture();
  const queryRecordings = vi.fn().mockRejectedValue(new Error("Synthetic query failure"));
  const source = { getDashboardData: () => Promise.resolve(data), queryRecordings };
  const view = render(<RecordingsPage dataSource={source} recordings={[ready]} headerNotifications={[]} reception={data.reception} />);
  const cards = Array.from(view.container.querySelectorAll(".recordings-content .card"));
  fireEvent.click(screen.getByRole("button", { name: /^조회$/ }));
  await act(async () => { await Promise.resolve(); });
  expect(queryRecordings).toHaveBeenCalledTimes(1);
  expect(Array.from(view.container.querySelectorAll(".recordings-content .card"))).toEqual(cards);
  expect(view.container.querySelectorAll(".recording-item")).toHaveLength(1);
  expect(view.container.querySelector("video")).toHaveAttribute("src", ready.contentUrl);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText("녹화 영상을 조회하지 못했습니다. 기존 조회 결과를 유지합니다.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^조회$/ })).toBeEnabled();
});

test("파일 형식이 없으면 다운로드 파일명에 확장자를 임의로 추가하지 않는다", async () => {
  const { data, ready } = await fixture();
  const recording = { ...ready, format: "정보 없음" };
  let filename: string | undefined;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  const source = { getDashboardData: () => Promise.resolve(data), getRecording: () => Promise.resolve(recording) };
  render(<RecordingsPage dataSource={source} recordings={[recording]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 다운로드" }));
  await act(async () => { await Promise.resolve(); });
  expect(filename).toBe(recording.id);
});

test.each(["ready", "failed"] as const)("collecting과 processing 이후 %s에서 polling을 중단한다", async (terminal) => {
  vi.useFakeTimers();
  const { data, ready } = await fixture();
  const collecting: Recording = { ...ready, status: "processing", mediaStatus: "collecting", contentUrl: undefined, downloadUrl: undefined };
  const processing = { ...collecting, mediaStatus: "processing" };
  const completed: Recording = terminal === "ready" ? ready : { ...ready, status: "unavailable", mediaStatus: "failed", contentUrl: undefined, downloadUrl: undefined, errorCode: "SYNTHETIC_FAILURE" };
  const getRecording = vi.fn<(id: string, signal?: AbortSignal) => Promise<Recording | null>>()
    .mockResolvedValueOnce(collecting).mockResolvedValueOnce(processing).mockResolvedValue(completed);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[collecting]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  expect(view.container.querySelector("video")).toBeNull();
  expect(screen.getByRole("button", { name: "다운로드 불가" })).toBeDisabled();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(view.container.querySelector("video")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(getRecording).toHaveBeenCalledTimes(3);
  expect(Boolean(view.container.querySelector("video"))).toBe(terminal === "ready");
  expect(vi.getTimerCount()).toBe(0);
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(getRecording).toHaveBeenCalledTimes(3);
});

test("목록 선택과 종료는 단건 요청을 취소하고 늦은 응답을 무시한다", async () => {
  const { data, ready, second } = await fixture();
  const pending: ((value: Recording) => void)[] = [];
  const getRecording = vi.fn<(id: string, signal?: AbortSignal) => Promise<Recording | null>>()
    .mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[ready, second]} headerNotifications={[]} reception={data.reception} />);
  expect(screen.queryByRole("button", { name: "녹화 정보 새로고침" })).not.toBeInTheDocument();
  fireEvent.click(view.container.querySelectorAll<HTMLButtonElement>(".recording-item")[1]);
  expect(getRecording.mock.calls[0][1]?.aborted).toBe(true);
  await act(() => { pending[0](ready); return Promise.resolve(); });
  expect(view.container.querySelector("video")).toBeNull();
  view.unmount();
  expect(getRecording.mock.calls[1][1]?.aborted).toBe(true);
  await act(() => { pending[1](ready); return Promise.resolve(); });
});

test("알 수 없는 미디어 상태는 긴 서버 원문 대신 확인 불가로 표시한다", async () => {
  const { data, ready } = await fixture();
  const mediaStatus = "UNRECOGNIZED_".repeat(100);
  const unknown: Recording = { ...ready, status: "unavailable", mediaStatus, contentUrl: undefined, downloadUrl: undefined };
  const source = { getDashboardData: () => Promise.resolve(data), getRecording: () => Promise.resolve(unknown) };
  const view = render(<RecordingsPage dataSource={source} recordings={[unknown]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  expect(view.container.querySelector(".recording-item .status-text")).toHaveTextContent("상태 확인 불가");
  expect(view.container).not.toHaveTextContent(mediaStatus);
  expect(screen.queryByRole("button", { name: "녹화 정보 새로고침" })).not.toBeInTheDocument();
});

test.each(["deleted", "expired"])("다운로드 직전 %s 상태는 새 메타데이터를 표시하고 anchor click을 차단한다", async (mediaStatus) => {
  const { data, ready } = await fixture();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const unavailable: Recording = { ...ready, status: "unavailable", mediaStatus, contentUrl: undefined, downloadUrl: undefined };
  const getRecording = vi.fn<(id: string, signal?: AbortSignal) => Promise<Recording | null>>().mockResolvedValueOnce(ready).mockResolvedValue(unavailable);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[ready]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 다운로드" }));
  await act(async () => { await Promise.resolve(); });
  expect(click).not.toHaveBeenCalled();
  expect(view.container.querySelector("video")).toBeNull();
  expect(view.container.querySelector(".recording-item .status-text")).toHaveTextContent(mediaStatus === "deleted" ? "삭제됨" : "보관 만료");
  expect(screen.getByRole("button", { name: "다운로드 불가" })).toBeDisabled();
});

test.each([404, 410])("다운로드 재조회 HTTP %s는 파일 접근을 시작하지 않는다", async (status) => {
  const { data, ready } = await fixture();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const getRecording = vi.fn<(id: string, signal?: AbortSignal) => Promise<Recording | null>>().mockResolvedValueOnce(ready)
    .mockRejectedValue(Object.assign(new Error("Unavailable"), { status }));
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[ready]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 다운로드" }));
  await act(async () => { await Promise.resolve(); });
  expect(click).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("다운로드 전에 녹화 정보를 확인하지 못했습니다.");
  expect(view.container.querySelector("video")).toHaveAttribute("src", ready.contentUrl);
});

test("다운로드 재조회 중 선택 변경은 이전 다운로드를 취소한다", async () => {
  const { data, ready, second } = await fixture();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  let resolveDownload: (value: Recording) => void = () => undefined;
  const getRecording = vi.fn<(id: string, signal?: AbortSignal) => Promise<Recording | null>>().mockResolvedValueOnce(ready)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveDownload = resolve; })).mockResolvedValue(second);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[ready, second]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 다운로드" }));
  fireEvent.click(view.container.querySelectorAll<HTMLButtonElement>(".recording-item")[1]);
  expect(getRecording.mock.calls[1][1]?.aborted).toBe(true);
  await act(() => { resolveDownload(ready); return Promise.resolve(); });
  expect(click).not.toHaveBeenCalled();
  expect(view.container.querySelector("video")).toHaveAttribute("src", second.contentUrl);
});

test("녹화 목록의 후속 조회와 종료는 이전 조회를 취소한다", async () => {
  const { data, ready } = await fixture();
  const pending: ((value: Recording[]) => void)[] = [];
  const queryRecordings = vi.fn<(query: unknown, signal?: AbortSignal) => Promise<Recording[]>>()
    .mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const source = { getDashboardData: () => Promise.resolve(data), queryRecordings };
  const view = render(<RecordingsPage dataSource={source} recordings={[ready]} headerNotifications={[]} reception={data.reception} />);
  const form = view.container.querySelector("form");
  if (!form) throw new Error("Query form missing.");
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(queryRecordings.mock.calls[0][1]?.aborted).toBe(true);
  await act(() => { pending[1]([]); return Promise.resolve(); });
  await act(() => { pending[0]([ready]); return Promise.resolve(); });
  expect(screen.getByText("조회된 녹화 영상이 없습니다.")).toBeVisible();
  fireEvent.submit(form);
  view.unmount();
  expect(queryRecordings.mock.calls[2][1]?.aborted).toBe(true);
  await act(() => { pending[2]([ready]); return Promise.resolve(); });
});

test.each(["collecting", "processing"])("접근 불가 상태의 mediaStatus=%s도 ready까지 polling한다", async (mediaStatus) => {
  vi.useFakeTimers();
  const { data, ready } = await fixture();
  const pending: Recording = { ...ready, status: "unavailable", mediaStatus, contentUrl: undefined, downloadUrl: undefined };
  const getRecording = vi.fn().mockResolvedValueOnce(pending).mockResolvedValue(ready);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[pending]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  expect(view.container.querySelector("video")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(getRecording).toHaveBeenCalledTimes(2);
  expect(view.container.querySelector("video")).toHaveAttribute("src", ready.contentUrl);
  expect(vi.getTimerCount()).toBe(0);
});

test("data source 변경은 진행 중 다운로드와 늦은 응답을 취소한다", async () => {
  const { data, ready } = await fixture();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  let complete: (value: Recording) => void = () => undefined;
  const getRecording = vi.fn<(id: string, signal?: AbortSignal) => Promise<Recording | null>>()
    .mockResolvedValueOnce(ready).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const props = { recordings: [ready], headerNotifications: [], reception: data.reception };
  const view = render(<RecordingsPage {...props} dataSource={source} />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 다운로드" }));
  view.rerender(<RecordingsPage {...props} dataSource={{ getDashboardData: source.getDashboardData, getRecording: () => Promise.resolve(ready) }} />);
  expect(getRecording.mock.calls[1][1]?.aborted).toBe(true);
  await act(() => { complete(ready); return Promise.resolve(); });
  expect(click).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "녹화 영상 다운로드" })).toBeEnabled();
});

test("MP4 확대는 기본 video를 pause하고 재생 위치 및 촬영 시각을 이전한다", async () => {
  const { data, ready } = await fixture();
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording: () => Promise.resolve(ready) };
  const view = render(<RecordingsPage dataSource={source} recordings={[ready]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  const base = view.container.querySelector("video");
  if (!base) throw new Error("Base video missing.");
  base.currentTime = 10;
  fireEvent.timeUpdate(base);
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 크게 보기" }));
  expect(pause.mock.instances).toContain(base);
  const expanded = view.container.querySelector<HTMLVideoElement>(".video-modal video");
  if (!expanded) throw new Error("Expanded video missing.");
  fireEvent.loadedMetadata(expanded);
  expect(expanded.currentTime).toBe(10);
  expanded.currentTime = 20;
  Object.defineProperty(expanded, "readyState", { value: HTMLMediaElement.HAVE_CURRENT_DATA });
  fireEvent.timeUpdate(expanded);
  const expandedTime = view.container.querySelector(".video-modal .recorded-time")?.textContent;
  base.currentTime = 11;
  fireEvent.timeUpdate(base);
  expect(view.container.querySelector(".video-modal .recorded-time")).toHaveTextContent(expandedTime ?? "");
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 닫기" }));
  expect(pause.mock.instances).toContain(expanded);
  expect(base.currentTime).toBe(20);
  expect(view.container.querySelector(".recording-frame .recorded-time")).toHaveTextContent(expandedTime ?? "");
});

test.each([[0, false], [1, false], [2, true]])("확대 player가 readyState=%s, seeking=%s이면 닫을 때 원래 위치를 유지한다", async (readyState, seeking) => {
  const { data, ready } = await fixture();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording: () => Promise.resolve(ready) };
  const view = render(<RecordingsPage dataSource={source} recordings={[ready]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  const base = view.container.querySelector("video")!;
  base.currentTime = 31;
  fireEvent.timeUpdate(base);
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 크게 보기" }));
  const expanded = view.container.querySelector<HTMLVideoElement>(".video-modal video")!;
  Object.defineProperties(expanded, { readyState: { value: readyState }, seeking: { value: seeking } });
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 닫기" }));
  expect(base.currentTime).toBe(31);
});
