import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { MjpegVideo } from "./MjpegVideo";
import { MjpegResponseError, readMjpeg } from "./mjpeg-client";

vi.mock("./mjpeg-client", async (original) => ({
  ...await original<typeof import("./mjpeg-client")>(), readMjpeg: vi.fn(),
}));

type ReadOptions = Parameters<typeof readMjpeg>[0];
let reads: { options: ReadOptions; reject: (error: unknown) => void }[];
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

beforeEach(() => {
  reads = [];
  vi.useFakeTimers();
  createObjectURL.mockReset().mockImplementation(() => `blob:frame-${createObjectURL.mock.calls.length}`);
  revokeObjectURL.mockReset();
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
  vi.mocked(readMjpeg).mockReset().mockImplementation((options) => new Promise<void>((_resolve, reject) => reads.push({ options, reject })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function frame(index = reads.length - 1) {
  act(() => reads[index].options.onFrame(new Blob([new Uint8Array([255, 216, 255, 217])], { type: "image/jpeg" })));
}

test("image decode 이후 LIVE를 표시하고 frame 교체 및 종료 시 Blob URL을 회수한다", () => {
  const view = render(<MjpegVideo alt="live" url="/live" />);
  const image = screen.getByAltText("live");
  frame();
  expect(image).not.toBeVisible();
  expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  fireEvent.load(image);
  expect(image).toBeVisible();
  expect(screen.getByText("LIVE")).toBeVisible();
  frame();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:frame-1");
  view.unmount();
  expect(reads[0].options.signal.aborted).toBe(true);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:frame-2");
  expect(vi.getTimerCount()).toBe(0);
});

test("유효한 frame을 표시한 뒤 수신 시각을 표시하며 새 frame 없이 시각을 갱신하지 않는다", async () => {
  vi.setSystemTime(new Date("2026-10-15T00:00:01Z"));
  render(<MjpegVideo alt="live" url="/live" />);
  expect(screen.queryByText(/^영상 수신 /)).not.toBeInTheDocument();
  frame();
  expect(screen.queryByText(/^영상 수신 /)).not.toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  fireEvent.load(screen.getByAltText("live"));
  expect(screen.getByText(/^영상 수신 /)).toHaveAttribute("datetime", "2026-10-15T00:00:01.000Z");
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByText(/^영상 수신 /)).toHaveAttribute("datetime", "2026-10-15T00:00:01.000Z");
  frame();
  fireEvent.load(screen.getByAltText("live"));
  expect(screen.getByText(/^영상 수신 /)).toHaveAttribute("datetime", "2026-10-15T00:00:05.000Z");
});

test("촬영 시각은 수신 시각보다 우선하며 값 변경만으로 stream을 재연결하지 않는다", () => {
  const capturedAt = "2026-10-15T00:00:01Z";
  vi.setSystemTime(new Date("2026-10-15T00:00:05Z"));
  const view = render(<MjpegVideo alt="live" url="/live" capturedAt={capturedAt} />);
  frame();
  fireEvent.load(screen.getByAltText("live"));
  expect(screen.getByText(/^촬영 /)).toHaveAttribute("datetime", "2026-10-15T00:00:01.000Z");
  view.rerender(<MjpegVideo alt="live" url="/live" capturedAt={null} />);
  expect(screen.getByText(/^영상 수신 /)).toHaveAttribute("datetime", "2026-10-15T00:00:05.000Z");
  expect(reads).toHaveLength(1);
});

test("URL 변경과 종료 뒤 이전 frame이나 오류를 적용하지 않는다", async () => {
  const view = render(<MjpegVideo alt="live" url="/first" />);
  frame();
  view.rerender(<MjpegVideo alt="live" url="/second" />);
  expect(screen.queryByText(/^영상 수신 /)).not.toBeInTheDocument();
  expect(reads[0].options.signal.aborted).toBe(true);
  frame(0);
  await act(() => { reads[0].reject(new Error("late error")); return Promise.resolve(); });
  expect(createObjectURL).toHaveBeenCalledOnce();
  frame(1);
  fireEvent.load(screen.getByAltText("live"));
  expect(screen.getByText("LIVE")).toBeVisible();
  view.unmount();
  frame(1);
  expect(createObjectURL).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

test("250ms, 500ms와 1000ms 간격으로 자동 재연결하며 이후에도 1초 상한을 유지한다", async () => {
  render(<MjpegVideo alt="live" url="/live" />);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await act(() => { reads[attempt].reject(new Error("stream ended")); return Promise.resolve(); });
    await act(() => vi.advanceTimersByTimeAsync([250, 500, 1000][Math.min(attempt, 2)] - 1));
    expect(reads).toHaveLength(attempt + 1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(reads).toHaveLength(attempt + 2);
  }
  expect(screen.getByText("영상 연결 중")).toBeVisible();
  expect(screen.queryByText("영상 연결 불가")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "영상 다시 연결" })).not.toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(0);
  frame();
  fireEvent.load(screen.getByAltText("live"));
  expect(screen.getByText("LIVE")).toBeVisible();
});

test("연결 오류는 마지막 frame을 숨기고 예약한 재연결은 종료 시 취소한다", async () => {
  const view = render(<MjpegVideo alt="live" url="/live" />);
  frame();
  fireEvent.load(screen.getByAltText("live"));
  await act(() => { reads[0].reject(new Error("timeout")); return Promise.resolve(); });
  expect(screen.getByAltText("live")).not.toHaveAttribute("src");
  expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  expect(screen.queryByText(/^영상 수신 /)).not.toBeInTheDocument();
  expect(revokeObjectURL).toHaveBeenCalledOnce();
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(reads).toHaveLength(1);
});

test.each([401, 403])("HTTP %s는 로그인으로 이동하고 재연결을 하지 않는다", async (status) => {
  const onSessionExpired = vi.fn();
  render(<MjpegVideo alt="live" url="/live" onSessionExpired={onSessionExpired} />);
  await act(() => { reads[0].reject(new MjpegResponseError(status)); return Promise.resolve(); });
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(onSessionExpired).toHaveBeenCalledOnce();
  expect(reads).toHaveLength(1);
  expect(reads[0].options.signal.aborted).toBe(true);
});

test("JPEG decode 실패는 연결을 취소하고 재연결 후 정상 frame으로 복구한다", async () => {
  render(<MjpegVideo alt="live" url="/live" />);
  frame();
  fireEvent.error(screen.getByAltText("live"));
  expect(reads[0].options.signal.aborted).toBe(true);
  expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  expect(revokeObjectURL).toHaveBeenCalledOnce();
  frame(0);
  expect(createObjectURL).toHaveBeenCalledOnce();
  await act(() => { reads[0].reject(new DOMException("aborted", "AbortError")); return Promise.resolve(); });
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(reads).toHaveLength(2);
  frame();
  fireEvent.load(screen.getByAltText("live"));
  expect(screen.getByText("LIVE")).toBeVisible();
});

test("StrictMode에서도 활성 연결은 하나이며 cleanup한 연결은 재사용하지 않는다", () => {
  const view = render(<StrictMode><MjpegVideo alt="live" url="/live" /></StrictMode>);
  expect(reads).toHaveLength(2);
  expect(reads.filter(({ options }) => !options.signal.aborted)).toHaveLength(1);
  frame(0);
  expect(createObjectURL).not.toHaveBeenCalled();
  frame(1);
  fireEvent.load(screen.getByAltText("live"));
  expect(screen.getByText("LIVE")).toBeVisible();
  view.unmount();
  expect(reads.every(({ options }) => options.signal.aborted)).toBe(true);
});

test("정상 frame 복구는 연결을 유지하며 다음 수신 중단의 재시도 간격을 250ms로 초기화한다", async () => {
  render(<MjpegVideo alt="live" url="/live" />);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await act(() => { reads[attempt].reject(new Error("stream ended")); return Promise.resolve(); });
    await act(() => vi.advanceTimersByTimeAsync([250, 500, 1000][attempt]));
  }
  expect(reads).toHaveLength(4);
  expect(screen.getByText("영상 연결 중")).toBeVisible();
  expect(screen.queryByRole("button", { name: "영상 다시 연결" })).not.toBeInTheDocument();
  frame();
  fireEvent.load(screen.getByAltText("live"));
  expect(screen.getByText("LIVE")).toBeVisible();
  expect(reads).toHaveLength(4);
  await act(() => { reads[3].reject(new Error("final failure")); return Promise.resolve(); });
  expect(screen.getByText("영상 연결 중")).toBeVisible();
  expect(screen.queryByRole("button", { name: "영상 다시 연결" })).not.toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(249));
  expect(reads).toHaveLength(4);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(reads).toHaveLength(5);
});
