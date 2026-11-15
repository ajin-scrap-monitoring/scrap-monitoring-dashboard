import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { dailyRecording, dailyRecordingMetadata } from "../data/daily-recordings";
import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { DailyRecordingMetadata } from "../domain/daily-recording";
import type { Recording } from "../domain/dashboard";
import { dailyRecordingFixture, dailyRecordingMetadataFixture } from "../test/daily-recording-fixtures";
import { RecordingsPage } from "./RecordingsPage";

vi.mock("../components/DailyRecordingVideo", () => ({
  default: ({ onError, onTimeUpdate }: { onError: () => void; onTimeUpdate?: (seconds: number) => void }) => (
    <video aria-label="날짜 녹화 영상" onError={onError} onTimeUpdate={(event) => onTimeUpdate?.(event.currentTarget.currentTime)} />
  ),
}));
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
  expect(view.container.querySelector(".recording-coverage-trigger")).not.toBeNull();
  expect(getRecordingCoverage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /^조회$/ }));
  await act(async () => { await Promise.resolve(); });
  expect(queryRecordings).toHaveBeenLastCalledWith(expect.objectContaining({ recordingSource: "daily", eventCategory: undefined }), expect.any(AbortSignal));
  expect(view.container.querySelectorAll(".recordings-content .card")).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "전체" }));
  fireEvent.click(screen.getByRole("button", { name: /^조회$/ }));
  await act(async () => { await Promise.resolve(); });
  expect(queryRecordings).toHaveBeenLastCalledWith(expect.objectContaining({ recordingSource: "all", eventCategory: undefined }), expect.any(AbortSignal));
});

test("전체는 날짜와 사건 녹화를 함께 표시하고 같은 ID도 source로 구분한다", async () => {
  const { data, recording, props } = await fixture();
  const event: Recording = { ...data.recordings[0], id: recording.id, source: "event", type: "알림", start: "2026-10-12 01:00:00", end: "2026-10-12 01:01:00" };
  const queryRecordings = vi.fn().mockResolvedValue([recording, event]);
  const source = { supportsDailyRecordings: true, getDashboardData: () => Promise.resolve(data), queryRecordings };
  const view = render(<RecordingsPage {...props} dataSource={source} />);
  const types = view.container.querySelectorAll(".query-type")[1];
  expect(Array.from(types.querySelectorAll("button"), button => button.textContent)).toEqual(["전체", "날짜", "수거", "알림", "오류"]);
  expect(screen.queryByRole("button", { name: "이벤트" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "전체" }));
  fireEvent.click(screen.getByRole("button", { name: /^조회$/ }));
  await act(async () => { await Promise.resolve(); });
  expect(view.container.querySelectorAll(".recording-item")).toHaveLength(2);
  expect(view.container.querySelectorAll(".recording-item.selected")).toHaveLength(1);
  fireEvent.click(view.container.querySelectorAll<HTMLButtonElement>(".recording-item")[1]);
  expect(view.container.querySelectorAll(".recording-item.selected")).toHaveLength(1);
  expect(view.container.querySelector(".recording-item.selected .recording-type")).toHaveTextContent("알림");
  expect(view.container.querySelectorAll(".recordings-content .card")).toHaveLength(5);
});

test.each([["수거", "collection"], ["알림", "alert"], ["오류", "error"]])("%s 필터는 날짜 녹화를 제외하고 해당 유형만 표시한다", async (type, category) => {
  const { data, recording, props } = await fixture();
  const events = ["수거", "알림", "오류"].map((type, index) => ({ ...data.recordings[0], id: `event-${index}`, source: "event" as const, type, start: "2026-10-12 01:00:00", end: "2026-10-12 01:01:00" }));
  const queryRecordings = vi.fn().mockResolvedValue([recording, ...events]);
  const source = { supportsDailyRecordings: true, getDashboardData: () => Promise.resolve(data), queryRecordings };
  const view = render(<RecordingsPage {...props} dataSource={source} />);
  fireEvent.click(screen.getByRole("button", { name: type }));
  fireEvent.click(screen.getByRole("button", { name: /^조회$/ }));
  await act(async () => { await Promise.resolve(); });
  expect(queryRecordings).toHaveBeenCalledWith(expect.objectContaining({ eventCategory: category }), expect.any(AbortSignal));
  expect(queryRecordings.mock.calls[0][0]).not.toHaveProperty("recordingSource");
  expect(view.container.querySelectorAll(".recording-item")).toHaveLength(1);
  expect(view.container.querySelector(".recording-item .recording-type")).toHaveTextContent(type);
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

const administrator = { expiresAt: "2026-10-14T00:00:00Z", user: { displayName: "관리자", id: "admin", role: "administrator" as const } };

test("관리자는 날짜 녹화 삭제 전에 공유 이벤트 재생 불가를 확인받고 삭제 뒤 목록에서 제거한다", async () => {
  const { data, recording, props } = await fixture();
  const getRecording = vi.fn().mockResolvedValue(recording);
  const deleteDailyRecording = vi.fn().mockResolvedValue({ outcome: "deleted" });
  const dataSource = { supportsDailyRecordings: true, getDashboardData: () => Promise.resolve(data), getRecording, deleteDailyRecording };
  const view = render(<RecordingsPage {...props} dataSource={dataSource} session={administrator} />);
  fireEvent.click(await screen.findByRole("button", { name: "날짜 녹화 삭제" }));
  expect(screen.getByRole("dialog", { name: "날짜 녹화 삭제" })).toHaveTextContent("이벤트 구간도 재생할 수 없게");
  expect(deleteDailyRecording).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "영구 삭제" }));
  await act(async () => { await Promise.resolve(); });
  expect(deleteDailyRecording).toHaveBeenCalledWith(recording.id);
  expect(view.container.querySelectorAll(".recording-item")).toHaveLength(0);
});

test("삭제 409는 확인창에 안내하고 목록을 유지하며 일반 사용자에게는 버튼이 없다", async () => {
  const { data, recording, props } = await fixture();
  const getRecording = vi.fn().mockResolvedValue(recording);
  const deleteDailyRecording = vi.fn().mockRejectedValue(Object.assign(new Error("conflict"), { status: 409 }));
  const dataSource = { supportsDailyRecordings: true, getDashboardData: () => Promise.resolve(data), getRecording, deleteDailyRecording };
  const view = render(<RecordingsPage {...props} dataSource={dataSource} session={administrator} />);
  fireEvent.click(await screen.findByRole("button", { name: "날짜 녹화 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "영구 삭제" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("삭제할 수 없습니다");
  expect(view.container.querySelectorAll(".recording-item")).toHaveLength(1);
  cleanup();
  render(<RecordingsPage {...props} dataSource={dataSource} session={{ expiresAt: "2026-10-14T00:00:00Z", user: { displayName: "조회자", id: "viewer", role: "viewer" } }} />);
  await screen.findByLabelText("날짜 녹화 영상");
  expect(screen.queryByRole("button", { name: "날짜 녹화 삭제" })).not.toBeInTheDocument();
});

test("메타데이터 항목 선택 시 상세 /summary 뒤에만 구간 페이지를 조회해 timeline과 누락 구간을 표시한다", async () => {
  const { data, recording: fullRecording, props } = await fixture();
  const metadataDaily: DailyRecordingMetadata = dailyRecordingMetadata(dailyRecordingMetadataFixture, "camera-main");
  const metadataRecording: Recording = {
    ...fullRecording,
    daily: metadataDaily,
    gaps: undefined,
  };

  let resolveDetail!: (value: Recording) => void;
  const detailPromise = new Promise<Recording>((resolve) => {
    resolveDetail = resolve;
  });
  const getRecording = vi.fn().mockImplementation(() => detailPromise);
  const getDailyRecordingAvailableIntervals = vi.fn().mockResolvedValue({
    recordingId: metadataDaily.id,
    revision: metadataDaily.revision,
    snapshot: "snap-1",
    items: [
      { startsAt: "2026-10-11T15:00:00Z", endsAt: "2026-10-11T15:00:20Z", playbackStartsAtSeconds: 0, playbackEndsAtSeconds: 20 },
    ],
    total: 2,
    nextCursor: "avail-c2",
  });
  const getDailyRecordingGaps = vi.fn().mockResolvedValue({
    recordingId: metadataDaily.id,
    revision: metadataDaily.revision,
    snapshot: "snap-1",
    items: [
      { startsAt: "2026-10-11T15:00:20Z", endsAt: "2026-10-11T15:00:30Z", reasonCode: "CAMERA_DISCONNECTED" },
    ],
    total: 1,
    nextCursor: null,
  });
  const dataSource: DashboardDataSource = {
    supportsDailyRecordings: true,
    getDashboardData: () => Promise.resolve(data),
    getRecording,
    getDailyRecordingAvailableIntervals,
    getDailyRecordingGaps,
  };

  render(
    <RecordingsPage
      {...props}
      recordings={[metadataRecording]}
      dataSource={dataSource}
    />,
  );

  expect(getRecording).toHaveBeenCalledWith(metadataRecording.id, expect.any(AbortSignal), "daily");
  expect(getDailyRecordingAvailableIntervals).not.toHaveBeenCalled();
  expect(getDailyRecordingGaps).not.toHaveBeenCalled();

  expect(screen.queryByRole("region", { name: "날짜 녹화 범위" })).not.toBeInTheDocument();
  expect(screen.queryByText("누락 없음")).not.toBeInTheDocument();
  expect(screen.queryByText("영상 없음")).not.toBeInTheDocument();
  expect(screen.queryByText("전체 구간 확보")).not.toBeInTheDocument();
  expect(screen.queryByText("재생 가능한 영상이 없습니다.")).not.toBeInTheDocument();
  expect(screen.getByText("영상을 준비 중입니다.")).toBeInTheDocument();

  await act(async () => {
    resolveDetail(metadataRecording);
    await Promise.resolve();
  });

  const timeline = await screen.findByRole("region", { name: "날짜 녹화 범위" });
  expect(timeline).toBeVisible();
  expect(getDailyRecordingAvailableIntervals).toHaveBeenCalledWith(metadataDaily.id, { limit: 100 }, expect.any(AbortSignal));
  expect(getDailyRecordingGaps).toHaveBeenCalledWith(metadataDaily.id, { limit: 100 }, expect.any(AbortSignal));
  expect(await within(timeline).findByRole("button", { name: /확보 구간 00:00:00 ~ 00:00:20, 재생/ })).toBeVisible();
  expect(within(timeline).getByText("구간 1페이지")).toBeVisible();
  expect(screen.getByRole("button", { name: "누락 구간" })).toBeVisible();
});

test("구간 페이지 cursor 이전/다음 이동, 실제 시각 미확인 표시, 누락 구간 dialog 페이징을 처리한다", async () => {
  const { data, recording: fullRecording, props } = await fixture();
  const metadataDaily = dailyRecordingMetadata(dailyRecordingMetadataFixture, "camera-main");
  const metadataRecording: Recording = { ...fullRecording, daily: metadataDaily, gaps: undefined };

  const availPage1 = {
    recordingId: metadataDaily.id,
    revision: 1,
    snapshot: "snap-1",
    items: [{ startsAt: "2026-10-11T15:00:00Z", endsAt: "2026-10-11T15:00:20Z", playbackStartsAtSeconds: 0, playbackEndsAtSeconds: 20 }],
    total: 2,
    nextCursor: "avail-2",
  };
  const availPage2 = {
    recordingId: metadataDaily.id,
    revision: 1,
    snapshot: "snap-1",
    items: [{ startsAt: "2026-10-11T15:00:30Z", endsAt: "2026-10-11T15:01:00Z", playbackStartsAtSeconds: 20, playbackEndsAtSeconds: 50 }],
    total: 2,
    nextCursor: null,
  };
  const gapsPage1 = {
    recordingId: metadataDaily.id,
    revision: 1,
    snapshot: "snap-1",
    items: [{ startsAt: "2026-10-11T15:00:20Z", endsAt: "2026-10-11T15:00:30Z", reasonCode: "CAMERA_DISCONNECTED" }],
    total: 2,
    nextCursor: "gap-2",
  };
  const gapsPage2 = {
    recordingId: metadataDaily.id,
    revision: 1,
    snapshot: "snap-1",
    items: [{ startsAt: "2026-10-11T15:01:00Z", endsAt: "2026-10-11T15:01:20Z", reasonCode: "NETWORK_TIMEOUT" }],
    total: 2,
    nextCursor: null,
  };

  const getDailyRecordingAvailableIntervals = vi.fn((_id: string, opts?: { cursor?: string }) =>
    Promise.resolve(opts?.cursor === "avail-2" ? availPage2 : availPage1));
  const getDailyRecordingGaps = vi.fn((_id: string, opts?: { cursor?: string }) =>
    Promise.resolve(opts?.cursor === "gap-2" ? gapsPage2 : gapsPage1));

  render(
    <RecordingsPage
      {...props}
      recordings={[metadataRecording]}
      dataSource={{
        supportsDailyRecordings: true,
        getDashboardData: () => Promise.resolve(data),
        getRecording: () => Promise.resolve(metadataRecording),
        getDailyRecordingAvailableIntervals,
        getDailyRecordingGaps,
      }}
    />,
  );

  const timeline = await screen.findByRole("region", { name: "날짜 녹화 범위" });
  expect(await within(timeline).findByRole("button", { name: /확보 구간 00:00:00 ~ 00:00:20, 재생/ })).toBeVisible();

  const video = screen.getByLabelText("날짜 녹화 영상");
  Object.defineProperty(video, "currentTime", { value: 30, writable: true, configurable: true });
  fireEvent.timeUpdate(video);
  expect(screen.getByText("실제 시각 미확인")).toBeVisible();

  fireEvent.click(within(timeline).getByRole("button", { name: "다음" }));
  expect(await within(timeline).findByRole("button", { name: /확보 구간 00:00:30 ~ 00:01:00, 재생/ })).toBeVisible();
  expect(within(timeline).getByText("구간 2페이지")).toBeVisible();
  expect(screen.getByText("2026-10-12 00:00:40")).toBeVisible();

  fireEvent.click(within(timeline).getByRole("button", { name: "이전" }));
  expect(await within(timeline).findByRole("button", { name: /확보 구간 00:00:00 ~ 00:00:20, 재생/ })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "누락 구간" }));
  const dialog = screen.getByRole("dialog", { name: "녹화 범위 상세" });
  expect(await within(dialog).findByText("2개")).toBeVisible();
  expect(within(dialog).getByText(/CAMERA_DISCONNECTED/)).toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "다음" }));
  expect(await within(dialog).findByText(/NETWORK_TIMEOUT/)).toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "이전" }));
  expect(await within(dialog).findByText(/CAMERA_DISCONNECTED/)).toBeVisible();
});

test("has_gaps=false 또는 originalUnavailable일 때 불필요한 구간 조회를 생략하고 400/409/503 오류를 복구한다", async () => {
  const { data, recording: fullRecording, props } = await fixture();
  const baseMeta = dailyRecordingMetadata(dailyRecordingMetadataFixture, "camera-main");
  const noGapMeta: DailyRecordingMetadata = { ...baseMeta, hasGaps: false, coverage: "complete" };
  const noGapRecording: Recording = { ...fullRecording, daily: noGapMeta, gaps: undefined };

  const getDailyRecordingAvailableIntervals = vi.fn().mockResolvedValue({
    recordingId: baseMeta.id,
    revision: 1,
    snapshot: "snap-1",
    items: [{ startsAt: "2026-10-11T15:00:00Z", endsAt: "2026-10-11T15:00:50Z", playbackStartsAtSeconds: 0, playbackEndsAtSeconds: 50 }],
    total: 2,
    nextCursor: "bad-next",
  });
  const getDailyRecordingGaps = vi.fn();

  const view = render(
    <RecordingsPage
      {...props}
      recordings={[noGapRecording]}
      dataSource={{
        supportsDailyRecordings: true,
        getDashboardData: () => Promise.resolve(data),
        getRecording: () => Promise.resolve(noGapRecording),
        getDailyRecordingAvailableIntervals,
        getDailyRecordingGaps,
      }}
    />,
  );
  const timeline = await screen.findByRole("region", { name: "날짜 녹화 범위" });
  expect(await within(timeline).findByRole("button", { name: /확보 구간 00:00:00 ~ 00:00:50, 재생/ })).toBeVisible();
  expect(getDailyRecordingGaps).not.toHaveBeenCalled();

  class HttpError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  getDailyRecordingAvailableIntervals.mockRejectedValueOnce(new HttpError(400, "bad cursor", "INVALID_CURSOR"));
  fireEvent.click(within(timeline).getByRole("button", { name: "다음" }));
  expect(await within(timeline).findByText("구간 1페이지")).toBeVisible();
  expect(getDailyRecordingAvailableIntervals).toHaveBeenCalledTimes(3);
  view.unmount();

  let rev = 1;
  const gappedRecording = (revision: number): Recording => ({ ...fullRecording, daily: { ...baseMeta, revision }, gaps: undefined });
  const snapshotIntervals = vi.fn((_id: string, opts?: { cursor?: string }) => {
    if (opts?.cursor === "stale-c") return Promise.reject(new HttpError(409, "changed", "DAILY_SNAPSHOT_CHANGED"));
    return Promise.resolve({
      recordingId: baseMeta.id,
      revision: rev,
      snapshot: `snap-${rev}`,
      items: [{ startsAt: "2026-10-11T15:00:00Z", endsAt: "2026-10-11T15:00:20Z", playbackStartsAtSeconds: 0, playbackEndsAtSeconds: 20 }],
      total: 2,
      nextCursor: rev === 1 ? "stale-c" : null,
    });
  });
  const snapshotGaps = vi.fn(() => Promise.resolve({
    recordingId: baseMeta.id,
    revision: rev,
    snapshot: `snap-${rev}`,
    items: [{ startsAt: "2026-10-11T15:00:20Z", endsAt: "2026-10-11T15:00:30Z", reasonCode: "CAMERA_DISCONNECTED" }],
    total: 1,
    nextCursor: null,
  }));
  const getSummary = vi.fn(() => {
    const res = gappedRecording(rev);
    return Promise.resolve(res);
  });

  const view2 = render(
    <RecordingsPage
      {...props}
      recordings={[gappedRecording(1)]}
      dataSource={{
        supportsDailyRecordings: true,
        getDashboardData: () => Promise.resolve(data),
        getRecording: getSummary,
        getDailyRecordingAvailableIntervals: snapshotIntervals,
        getDailyRecordingGaps: snapshotGaps,
      }}
    />,
  );
  const timeline2 = await screen.findByRole("region", { name: "날짜 녹화 범위" });
  await within(timeline2).findByRole("button", { name: /확보 구간 00:00:00 ~ 00:00:20, 재생/ });
  rev = 2;
  fireEvent.click(within(timeline2).getByRole("button", { name: "다음" }));
  await vi.waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(snapshotIntervals).toHaveBeenLastCalledWith(baseMeta.id, { limit: 100 }, expect.any(AbortSignal)));
  expect(within(timeline2).queryByRole("button", { name: "다음" })).not.toBeInTheDocument();
  view2.unmount();

  const failingGaps = vi.fn()
    .mockRejectedValueOnce(new HttpError(503, "busy", "SERVICE_BUSY"))
    .mockResolvedValue({
      recordingId: baseMeta.id,
      revision: 1,
      snapshot: "snap-1",
      items: [{ startsAt: "2026-10-11T15:00:20Z", endsAt: "2026-10-11T15:00:30Z", reasonCode: "CAMERA_DISCONNECTED" }],
      total: 3,
      nextCursor: null,
    });
  render(
    <RecordingsPage
      {...props}
      recordings={[gappedRecording(1)]}
      dataSource={{
        supportsDailyRecordings: true,
        getDashboardData: () => Promise.resolve(data),
        getRecording: () => Promise.resolve(gappedRecording(1)),
        getDailyRecordingAvailableIntervals: () => Promise.resolve({
          recordingId: baseMeta.id,
          revision: 1,
          snapshot: "snap-1",
          items: [{ startsAt: "2026-10-11T15:00:00Z", endsAt: "2026-10-11T15:00:20Z", playbackStartsAtSeconds: 0, playbackEndsAtSeconds: 20 }],
          total: 1,
          nextCursor: null,
        }),
        getDailyRecordingGaps: failingGaps,
      }}
    />,
  );
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("일시적으로 녹화 구간을 조회할 수 없습니다.");
  fireEvent.click(screen.getByRole("button", { name: "재생 가능 상세" }));
  expect(screen.getByText("확인 불가")).toBeVisible();
  expect(screen.queryByText("0개")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
  await vi.waitFor(() => expect(screen.getByText("3개")).toBeVisible());
});

test("녹화 항목 전환 시 이전 진행 중인 구간 요청을 중단하고 상태를 초기화한다", async () => {
  const { data, recording: fullRecording, props } = await fixture();
  const baseMeta = dailyRecordingMetadata(dailyRecordingMetadataFixture, "camera-main");
  const secondId = "550e8400-e29b-41d4-a716-446655440099";
  const secondMeta: DailyRecordingMetadata = {
    ...baseMeta,
    id: secondId,
    recordingDate: "2026-10-13",
    windowStartsAt: "2026-10-12T15:00:00Z",
    windowEndsAt: "2026-10-13T15:00:00Z",
    coverageAsOfAt: "2026-10-12T15:01:00Z",
    playableUntilAt: "2026-10-12T15:01:00Z",
    playbackPath: `/media/daily-recordings/${secondId}/hls/index.m3u8`,
    hasGaps: false,
    coverage: "complete",
  };
  const r1: Recording = { ...fullRecording, daily: baseMeta, gaps: undefined };
  const r2: Recording = { ...fullRecording, id: secondId, date: "2026-10-13", start: "2026-10-13 00:00:00", end: "2026-10-14 00:00:00", daily: secondMeta, gaps: undefined };

  const signals: AbortSignal[] = [];
  const getDailyRecordingAvailableIntervals = vi.fn((recordingId: string, _opts?: { cursor?: string }, signal?: AbortSignal) => {
    if (signal) signals.push(signal);
    if (recordingId === baseMeta.id) {
      return new Promise<never>(() => undefined);
    }
    return Promise.resolve({
      recordingId: secondId,
      revision: 1,
      snapshot: "snap-2",
      items: [{ startsAt: "2026-10-12T15:00:00Z", endsAt: "2026-10-12T15:00:30Z", playbackStartsAtSeconds: 0, playbackEndsAtSeconds: 30 }],
      total: 1,
      nextCursor: null,
    });
  });

  render(
    <RecordingsPage
      {...props}
      recordings={[r1, r2]}
      dataSource={{
        supportsDailyRecordings: true,
        getDashboardData: () => Promise.resolve(data),
        getRecording: (id) => Promise.resolve(id === secondId ? r2 : r1),
        getDailyRecordingAvailableIntervals,
        getDailyRecordingGaps: () => Promise.resolve({ recordingId: baseMeta.id, revision: 1, snapshot: "snap-1", items: [], total: 0, nextCursor: null }),
      }}
    />,
  );

  await vi.waitFor(() => expect(signals).toHaveLength(1));
  expect(signals[0].aborted).toBe(false);

  const secondButton = screen.getByRole("button", { name: /2026-10-13/ });
  fireEvent.click(secondButton);
  expect(signals[0].aborted).toBe(true);
  const timeline = await screen.findByRole("region", { name: "날짜 녹화 범위" });
  expect(await within(timeline).findByRole("button", { name: /확보 구간 00:00:00 ~ 00:00:30, 재생/ })).toBeVisible();
});

test("타임라인 2페이지 전환 중 gaps만 400 INVALID_CURSOR가 발생하면 available도 1페이지로 되돌린다", async () => {
  const { data, recording: fullRecording, props } = await fixture();
  const baseMeta = dailyRecordingMetadata(dailyRecordingMetadataFixture, "camera-main");
  const recording: Recording = { ...fullRecording, daily: baseMeta, gaps: undefined };

  const getDailyRecordingAvailableIntervals = vi.fn((_id: string, opts?: { cursor?: string }) => Promise.resolve({
    recordingId: baseMeta.id,
    revision: 1,
    snapshot: "snap-1",
    items: opts?.cursor === "avail-2"
      ? [{ startsAt: "2026-10-11T15:01:00Z", endsAt: "2026-10-11T15:01:20Z", playbackStartsAtSeconds: 60, playbackEndsAtSeconds: 80 }]
      : [{ startsAt: "2026-10-11T15:00:00Z", endsAt: "2026-10-11T15:00:50Z", playbackStartsAtSeconds: 0, playbackEndsAtSeconds: 50 }],
    total: 2,
    nextCursor: opts?.cursor === "avail-2" ? null : "avail-2",
  }));
  const getDailyRecordingGaps = vi.fn((_id: string, opts?: { cursor?: string }) => {
    if (opts?.cursor === "gap-2") {
      return Promise.reject(Object.assign(new Error("bad cursor"), { status: 400, code: "INVALID_CURSOR" }));
    }
    return Promise.resolve({
      recordingId: baseMeta.id,
      revision: 1,
      snapshot: "snap-1",
      items: [{ startsAt: "2026-10-11T15:00:50Z", endsAt: "2026-10-11T15:01:00Z", reasonCode: "CAMERA_DISCONNECTED" }],
      total: 2,
      nextCursor: "gap-2",
    });
  });

  render(
    <RecordingsPage
      {...props}
      recordings={[recording]}
      dataSource={{
        supportsDailyRecordings: true,
        getDashboardData: () => Promise.resolve(data),
        getRecording: () => Promise.resolve(recording),
        getDailyRecordingAvailableIntervals,
        getDailyRecordingGaps,
      }}
    />,
  );

  const timeline = await screen.findByRole("region", { name: "날짜 녹화 범위" });
  expect(await within(timeline).findByRole("button", { name: /확보 구간 00:00:00 ~ 00:00:50, 재생/ })).toBeVisible();

  fireEvent.click(within(timeline).getByRole("button", { name: "다음" }));

  await vi.waitFor(() => {
    expect(within(timeline).getByText("구간 1페이지")).toBeVisible();
    expect(within(timeline).getByRole("button", { name: "이전" })).toBeDisabled();
    expect(within(timeline).getByRole("button", { name: "다음" })).toBeEnabled();
  });
  expect(within(timeline).getByRole("button", { name: /확보 구간 00:00:00 ~ 00:00:50, 재생/ })).toBeVisible();
  expect(getDailyRecordingAvailableIntervals).toHaveBeenLastCalledWith(baseMeta.id, { limit: 100 }, expect.any(AbortSignal));
  expect(getDailyRecordingGaps).toHaveBeenLastCalledWith(baseMeta.id, { limit: 100 }, expect.any(AbortSignal));
});
