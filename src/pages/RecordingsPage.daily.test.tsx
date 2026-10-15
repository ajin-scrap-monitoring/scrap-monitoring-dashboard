import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { dailyRecording } from "../data/daily-recordings";
import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import type { Recording } from "../domain/dashboard";
import { dailyRecordingFixture } from "../test/daily-recording-fixtures";
import { RecordingsPage } from "./RecordingsPage";

vi.mock("../components/DailyRecordingVideo", () => ({ default: ({ onError }: { onError: () => void }) => <video aria-label="날짜 녹화 영상" onError={onError} /> }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function fixture() {
  const data = await createMockDashboardDataSource().getDashboardData();
  const daily = dailyRecording(dailyRecordingFixture, "camera-main");
  const recording: Recording = {
    ...data.recordings[0], id: daily.id, source: "daily", daily, sample: false,
    date: daily.recordingDate, start: "2026-10-12 00:00:00", end: "2026-10-13 00:00:00",
    type: "날짜 녹화", time: "00:00 - 24:00", duration: "00:00:50", status: "available",
    mediaStatus: "closed", coverage: "partial", contentUrl: daily.playbackPath ?? undefined,
    downloadUrl: undefined, format: "정보 없음", codec: "정보 없음", width: null, height: null,
    frameRate: null, size: "정보 없음",
  };
  const props = { recordings: [recording], recordingsSource: "daily" as const, serverTime: "2026-10-13T01:00:00Z", headerNotifications: [], reception: data.reception };
  return { data, recording, props };
}

test("날짜 녹화는 날짜 source로 조회하며 이벤트 clip 상세를 요청하지 않는다", async () => {
  const { data, recording, props } = await fixture();
  const getRecording = vi.fn().mockResolvedValue(recording);
  const getRecordingCoverage = vi.fn();
  const queryRecordings = vi.fn().mockResolvedValue([]);
  const dataSource = { supportsDailyRecordings: true, getDashboardData: () => Promise.resolve(data), getRecording, getRecordingCoverage, queryRecordings };
  const view = render(<RecordingsPage {...props} dataSource={dataSource} />);
  await screen.findByLabelText("날짜 녹화 영상");
  expect(getRecording).toHaveBeenCalledWith(recording.id, expect.any(AbortSignal), "daily");
  expect(view.container.querySelector(".recording-coverage-trigger")).toBeNull();
  expect(getRecordingCoverage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /^조회$/ }));
  await act(async () => { await Promise.resolve(); });
  expect(queryRecordings).toHaveBeenLastCalledWith(expect.objectContaining({ recordingSource: "daily", eventCategory: undefined }), expect.any(AbortSignal));
  expect(view.container.querySelectorAll(".recordings-content .card")).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "이벤트" }));
  fireEvent.click(screen.getByRole("button", { name: /^조회$/ }));
  await act(async () => { await Promise.resolve(); });
  expect(queryRecordings).toHaveBeenLastCalledWith(expect.not.objectContaining({ recordingSource: "daily" }), expect.any(AbortSignal));
});

test("지난 날짜 MP4 준비와 polling은 재생을 유지하며 ready 응답에서만 다운로드한다", async () => {
  vi.useFakeTimers();
  const { data, recording, props } = await fixture();
  const daily = recording.daily!;
  const processing: Recording = { ...recording, daily: { ...daily, exportState: "processing" } };
  const ready: Recording = { ...recording, daily: { ...daily, exportState: "ready", downloadPath: `/media/daily-recordings/${recording.id}/content?download=true` }, downloadUrl: `/media/daily-recordings/${recording.id}/content?download=true` };
  const getRecording = vi.fn().mockResolvedValueOnce(recording).mockResolvedValueOnce(processing).mockResolvedValue(ready);
  const prepareDailyRecordingExport = vi.fn().mockResolvedValue(processing);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const dataSource = { getDashboardData: () => Promise.resolve(data), getRecording, prepareDailyRecordingExport };
  const view = render(<RecordingsPage {...props} dataSource={dataSource} />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: "MP4 다운로드 준비" }));
  await act(async () => { await Promise.resolve(); });
  expect(prepareDailyRecordingExport).toHaveBeenCalledWith(recording.id, expect.any(AbortSignal));
  expect(screen.getByRole("button", { name: "다운로드 준비 중" })).toBeDisabled();
  expect(view.container.querySelector("video")).not.toBeNull();
  expect(click).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 다운로드" }));
  await act(async () => { await Promise.resolve(); });
  expect(click).toHaveBeenCalledTimes(1);
  const anchor = click.mock.instances[0];
  expect(anchor).toHaveAttribute("href", ready.downloadUrl);
  expect(anchor).toHaveAttribute("download", "2026-10-12.mp4");
});

test("오늘 녹화의 다운로드 불가는 오류가 아니며 MP4 준비를 요청하지 않는다", async () => {
  const { data, recording, props } = await fixture();
  const today: Recording = { ...recording, daily: { ...recording.daily!, status: "recording", exportAllowed: false } };
  const prepareDailyRecordingExport = vi.fn();
  render(<RecordingsPage {...props} serverTime="2026-10-12T01:00:00Z" recordings={[today]} dataSource={{ getDashboardData: () => Promise.resolve(data), getRecording: () => Promise.resolve(today), prepareDailyRecordingExport }} />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText("오늘 녹화는 재생만 가능합니다. 날짜가 종료된 뒤 다운로드할 수 있습니다.")).toBeVisible();
  expect(screen.getByRole("button", { name: "다운로드 불가" })).toBeDisabled();
  expect(document.querySelector(".recording-item .status-text")).toHaveTextContent(/^녹화 중$/);
  expect(screen.queryByText(/누락 있음|부분 녹화/)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(prepareDailyRecordingExport).not.toHaveBeenCalled();
});

test("MP4 준비 실패도 기존 재생과 5개 카드를 유지한다", async () => {
  const { data, recording, props } = await fixture();
  const source = { getDashboardData: () => Promise.resolve(data), getRecording: () => Promise.resolve(recording), prepareDailyRecordingExport: vi.fn().mockRejectedValue(new Error("Synthetic export failure")) };
  const view = render(<RecordingsPage {...props} dataSource={source} />);
  fireEvent.click(await screen.findByRole("button", { name: "MP4 다운로드 준비" }));
  await act(async () => { await Promise.resolve(); });
  expect(view.container.querySelectorAll(".recordings-content .card")).toHaveLength(5);
  expect(view.container.querySelector("video")).not.toBeNull();
  expect(view.container.querySelector(".recording-download [role=alert]")).toHaveTextContent("다운로드 파일을 준비하지 못했습니다.");
  expect(screen.getByRole("button", { name: "MP4 다운로드 준비" })).toBeEnabled();
});

test.each(["not_requested", "ready"] as const)("HLS 재생 실패도 독립적인 MP4 %s 경로를 유지한다", async (exportState) => {
  const { data, recording, props } = await fixture();
  const downloadPath = `/media/daily-recordings/${recording.id}/content?download=true`;
  const item: Recording = { ...recording, daily: { ...recording.daily!, exportState, downloadPath: exportState === "ready" ? downloadPath : null }, downloadUrl: exportState === "ready" ? downloadPath : undefined };
  const source = { getDashboardData: () => Promise.resolve(data), getRecording: () => Promise.resolve(item), prepareDailyRecordingExport: vi.fn() };
  const view = render(<RecordingsPage {...props} recordings={[item]} dataSource={source} />);
  fireEvent.error(await screen.findByLabelText("날짜 녹화 영상"));
  expect(screen.getByRole("button", { name: exportState === "ready" ? "녹화 영상 다운로드" : "MP4 다운로드 준비" })).toBeEnabled();
  expect(view.container.querySelectorAll(".recordings-content .card")).toHaveLength(5);
  expect(view.container.querySelector("video")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "확인 실패 상세" }));
  expect(screen.getByRole("dialog", { name: "녹화 상태 상세" })).toHaveTextContent("영상을 재생하지 못했습니다.");
});

test("MP4 비동기 준비 실패와 재진입은 오류를 표시하지만 HLS 재생을 유지한다", async () => {
  vi.useFakeTimers();
  const { data, recording, props } = await fixture();
  const processing: Recording = { ...recording, daily: { ...recording.daily!, exportState: "processing" } };
  const code = `2_${"A".repeat(98)}`;
  const failed: Recording = { ...recording, errorCode: code, daily: { ...recording.daily!, exportState: "failed", error: { code, message: "PRIVATE_EXPORT_DETAILS" } } };
  const getRecording = vi.fn().mockResolvedValueOnce(recording).mockResolvedValueOnce(processing).mockResolvedValue(failed);
  const prepareDailyRecordingExport = vi.fn().mockResolvedValue(processing);
  const source = { getDashboardData: () => Promise.resolve(data), getRecording, prepareDailyRecordingExport };
  const view = render(<RecordingsPage {...props} dataSource={source} />);
  await act(async () => { await Promise.resolve(); });
  const player = view.container.querySelector("video");
  fireEvent.click(screen.getByRole("button", { name: "MP4 다운로드 준비" }));
  await act(async () => { await Promise.resolve(); });
  await act(() => vi.advanceTimersByTimeAsync(2000));
  const assertFailure = () => {
    expect(view.container.querySelector(".recording-download [role=alert]")).toHaveTextContent("MP4 파일 준비에 실패했습니다.");
    expect(view.container.querySelector(".recording-download [role=alert]")).toHaveAttribute("title", `오류 코드: ${code}`);
    expect(screen.getByRole("button", { name: "MP4 다운로드 준비" })).toBeEnabled();
    expect(view.container.querySelectorAll(".recordings-content .card")).toHaveLength(5);
    expect(view.container.querySelector("video")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "MP4 준비 실패 상세" }));
    expect(screen.getByRole("dialog", { name: "녹화 상태 상세" })).toHaveTextContent("MP4 다운로드 파일을 준비하지 못했습니다.");
    expect(screen.getByRole("dialog", { name: "녹화 상태 상세" })).toHaveTextContent(code);
    expect(view.container).not.toHaveTextContent("PRIVATE_EXPORT_DETAILS");
  };
  assertFailure();
  expect(view.container.querySelector("video")).toBe(player);
  view.unmount();
  const reentry = render(<RecordingsPage {...props} recordings={[failed]} dataSource={{ ...source, getRecording: () => Promise.resolve(failed) }} />);
  await act(async () => { await Promise.resolve(); });
  expect(reentry.container.querySelector(".recording-download [role=alert]")).toHaveTextContent("MP4 파일 준비에 실패했습니다.");
  expect(reentry.container.querySelector("video")).not.toBeNull();
  expect(screen.getByRole("button", { name: "MP4 다운로드 준비" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "MP4 준비 실패 상세" }));
  expect(screen.getByRole("dialog", { name: "녹화 상태 상세" })).toHaveTextContent(code);
});
