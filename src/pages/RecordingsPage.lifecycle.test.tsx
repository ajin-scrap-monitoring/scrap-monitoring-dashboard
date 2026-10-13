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

test.each(["ready", "failed"] as const)("collecting과 processing 이후 %s에서 polling을 중단한다", async (terminal) => {
  vi.useFakeTimers();
  const { data, ready } = await fixture();
  const collecting: Recording = { ...ready, status: "processing", mediaStatus: "collecting", contentUrl: undefined, downloadUrl: undefined };
  const processing = { ...collecting, mediaStatus: "processing" };
  const completed: Recording = terminal === "ready" ? ready : { ...ready, status: "unavailable", mediaStatus: "failed", contentUrl: undefined, downloadUrl: undefined, errorCode: "SYNTHETIC_FAILURE" };
  const getRecording = vi.fn<(id: string, signal?: AbortSignal) => Promise<Recording | null>>()
    .mockResolvedValueOnce(collecting).mockResolvedValueOnce(processing).mockResolvedValue(completed);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[collecting]} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="fresh" />);
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

test("새로고침과 종료는 단건 요청을 취소하고 늦은 응답을 무시한다", async () => {
  const { data, ready } = await fixture();
  const pending: ((value: Recording) => void)[] = [];
  const getRecording = vi.fn<(id: string, signal?: AbortSignal) => Promise<Recording | null>>()
    .mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[ready]} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="fresh" />);
  fireEvent.click(screen.getByRole("button", { name: "녹화 정보 새로고침" }));
  expect(getRecording.mock.calls[0][1]?.aborted).toBe(true);
  await act(() => { pending[0](ready); return Promise.resolve(); });
  expect(view.container.querySelector("video")).toBeNull();
  view.unmount();
  expect(getRecording.mock.calls[1][1]?.aborted).toBe(true);
  await act(() => { pending[1](ready); return Promise.resolve(); });
});

test.each(["deleted", "expired"])("다운로드 직전 %s 상태는 새 메타데이터를 표시하고 anchor click을 차단한다", async (mediaStatus) => {
  const { data, ready } = await fixture();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const unavailable: Recording = { ...ready, status: "unavailable", mediaStatus, contentUrl: undefined, downloadUrl: undefined };
  const getRecording = vi.fn<(id: string, signal?: AbortSignal) => Promise<Recording | null>>().mockResolvedValueOnce(ready).mockResolvedValue(unavailable);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[ready]} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="fresh" />);
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
  render(<RecordingsPage dataSource={source} recordings={[ready]} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="fresh" />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 다운로드" }));
  await act(async () => { await Promise.resolve(); });
  expect(click).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("확인하지 못했습니다");
});

test("다운로드 재조회 중 선택 변경은 이전 다운로드를 취소한다", async () => {
  const { data, ready, second } = await fixture();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  let resolveDownload: (value: Recording) => void = () => undefined;
  const getRecording = vi.fn<(id: string, signal?: AbortSignal) => Promise<Recording | null>>().mockResolvedValueOnce(ready)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveDownload = resolve; })).mockResolvedValue(second);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording };
  const view = render(<RecordingsPage dataSource={source} recordings={[ready, second]} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="fresh" />);
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
  const view = render(<RecordingsPage dataSource={source} recordings={[ready]} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="fresh" />);
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
  const view = render(<RecordingsPage dataSource={source} recordings={[pending]} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="fresh" />);
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
  const props = { recordings: [ready], headerNotifications: [], lastMeasuredAt: data.lastMeasuredAt, status: "fresh" as const };
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
  const view = render(<RecordingsPage dataSource={source} recordings={[ready]} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="fresh" />);
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
