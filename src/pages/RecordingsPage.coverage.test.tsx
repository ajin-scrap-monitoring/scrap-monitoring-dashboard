import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import type { Recording, RecordingCoverageDetail } from "../domain/dashboard";
import { dailyRecording } from "../data/daily-recordings";
import { eventReplay, mapEventRecording } from "../data/event-recordings";
import { dailyRecordingFixture } from "../test/daily-recording-fixtures";
import { eventReplayFixture } from "../test/backend-contract-fixtures";

import { RecordingsPage } from "./RecordingsPage";

const id = "550e8400-e29b-41d4-a716-446655440000";
const detail: RecordingCoverageDetail = { requestedStart: "2026-09-09T00:00:00Z", requestedEnd: "2026-09-09T00:00:30Z", actualStart: "2026-09-09T00:00:05Z", actualEnd: "2026-09-09T00:00:25Z", coverage: "partial", gaps: [{ start: "2026-09-09T00:00:00Z", end: "2026-09-09T00:00:05Z" }], errorCode: null };

test("기존 부분 저장 표시를 선택한 경우에만 범위를 조회하고 닫을 때 focus를 복원한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const recording = { ...data.recordings[0], id, coverage: "partial", gaps: detail.gaps };
  const getRecordingCoverage = vi.fn().mockResolvedValue(detail);
  const source: DashboardDataSource = { getDashboardData: () => Promise.resolve(data), getRecordingCoverage };
  render(<RecordingsPage dataSource={source} recordings={[recording]} headerNotifications={[]} reception={data.reception} />);
  expect(getRecordingCoverage).not.toHaveBeenCalled();
  const opener = screen.getByRole("button", { name: "부분 저장" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: "녹화 범위 상세" });
  expect(await within(dialog).findByText(detail.requestedStart)).toBeVisible();
  expect(within(dialog).getByText(detail.actualStart!)).toBeVisible();
  expect(within(dialog).getByText("구간별 누락 원인은 API에서 제공하지 않습니다.")).toBeVisible();
  expect(getRecordingCoverage).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  expect(screen.getByRole("heading", { name: "녹화 정보" })).toBeVisible();
});

test("녹화 범위 조회 오류와 재시도를 기본 카드 밖에서 처리한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const getRecordingCoverage = vi.fn().mockRejectedValueOnce(new Error("Temporary failure")).mockResolvedValue(detail);
  const source: DashboardDataSource = { getDashboardData: () => Promise.resolve(data), getRecordingCoverage };
  render(<RecordingsPage dataSource={source} recordings={[{ ...data.recordings[0], id, coverage: "partial" }]} headerNotifications={[]} reception={data.reception} />);
  fireEvent.click(screen.getByRole("button", { name: "부분 저장" }));
  const dialog = screen.getByRole("dialog");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("조회 실패");
  expect(dialog).not.toHaveTextContent("Temporary failure");
  fireEvent.click(within(dialog).getByRole("button", { name: "다시 조회" }));
  expect(await within(dialog).findByText(detail.requestedStart)).toBeVisible();
});

test("최초 녹화 조회 실패를 빈 목록과 0건으로 표시하지 않는다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  render(<RecordingsPage recordings={[]} recordingsState={{ status: "error", message: "녹화 목록 조회 실패" }} headerNotifications={[]} reception={data.reception} />);
  expect(screen.getByRole("alert")).toHaveTextContent("녹화 목록 조회 실패");
  expect(screen.getByText("확인 불가", { exact: true })).toBeVisible();
  expect(screen.queryByText("0건")).not.toBeInTheDocument();
  expect(screen.queryByText("조회된 녹화 영상이 없습니다.")).not.toBeInTheDocument();
});

test("v2 이벤트 녹화의 누락 구간 상세 창 내용을 표시하고 추가 API 호출을 하지 않는다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const rawReplay = eventReplayFixture({
    state: "PARTIAL",
    requestedSeconds: 60,
    coveredSeconds: 45,
    playbackSeconds: 45,
    parts: [
      {
        recordingId: "11111111-1111-4111-8111-111111111111",
        recordingDate: "2026-10-12",
        playbackPath: "/media/daily-recordings/11111111-1111-4111-8111-111111111111/hls/index.m3u8",
        fromAt: "2026-10-12T00:59:30Z",
        toAt: "2026-10-12T01:00:15Z",
        startSeconds: 3570,
        endSeconds: 3615,
        relativeStartSeconds: 0,
        relativeEndSeconds: 45,
        mapping: "LINEAR",
      },
    ],
    unavailableIntervals: [
      { fromAt: "2026-10-12T01:00:00Z", toAt: "2026-10-12T01:00:05Z", kind: "GAP", reasonCode: "FRAME_DROP" },
      { fromAt: "2026-10-12T01:00:05Z", toAt: "2026-10-12T01:00:10Z", kind: "UNCONFIRMED", reasonCode: "" },
      { fromAt: "2026-10-12T01:00:10Z", toAt: "2026-10-12T01:00:15Z", kind: "FUTURE", reasonCode: "WAITING" },
      { fromAt: "2026-10-12T01:00:15Z", toAt: "2026-10-12T01:00:18Z", kind: "MISSING", reasonCode: "NO_MEDIA" },
      { fromAt: "2026-10-12T01:00:18Z", toAt: "2026-10-12T01:00:20Z", kind: "EXPIRED", reasonCode: "RETENTION_EXPIRED" },
    ],
  });
  const { item, replay } = eventReplay(rawReplay, rawReplay.event.eventId);
  const recording = mapEventRecording(item, replay);
  const getRecordingCoverage = vi.fn();
  const source: DashboardDataSource = { getDashboardData: () => Promise.resolve(data), getRecordingCoverage };
  render(<RecordingsPage dataSource={source} recordings={[recording]} headerNotifications={[]} reception={data.reception} />);
  const opener = screen.getByRole("button", { name: "부분 저장" });
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: "녹화 범위 상세" });
  expect(getRecordingCoverage).not.toHaveBeenCalled();
  expect(within(dialog).getByText("요청 구간")).toBeVisible();
  expect(within(dialog).getByText("2026-10-12 09:59:30 ~ 2026-10-12 10:00:30")).toBeVisible();
  expect(within(dialog).getByText("요청 길이")).toBeVisible();
  expect(within(dialog).getByText("60초")).toBeVisible();
  expect(within(dialog).getByText("확보 길이")).toBeVisible();
  expect(within(dialog).getByText("재생 길이")).toBeVisible();
  expect(within(dialog).getAllByText("45초")).toHaveLength(2);
  expect(within(dialog).getByText(/확인된 누락/)).toBeVisible();
  expect(within(dialog).getByText(/FRAME_DROP/)).toBeVisible();
  expect(within(dialog).getByText(/확보 여부 미확인/)).toBeVisible();
  expect(within(dialog).getByText(/아직 오지 않은 구간/)).toBeVisible();
  expect(within(dialog).getByText(/영상 없음/)).toBeVisible();
  expect(within(dialog).getByText(/보관 만료/)).toBeVisible();
  expect(within(dialog).queryByText("구간별 누락 원인은 API에서 제공하지 않습니다.")).not.toBeInTheDocument();
});

test("v2 날짜 녹화의 누락 구간 상세 창 내용을 표시하고 추가 API 호출을 하지 않는다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const daily = dailyRecording(dailyRecordingFixture, "camera-main");
  const recording: Recording = {
    ...data.recordings[0],
    id: daily.id,
    source: "daily",
    daily,
    coverage: "partial",
  };
  const getRecordingCoverage = vi.fn();
  const source: DashboardDataSource = { getDashboardData: () => Promise.resolve(data), getRecordingCoverage };
  render(<RecordingsPage dataSource={source} recordings={[recording]} headerNotifications={[]} reception={data.reception} />);
  const opener = screen.getByRole("button", { name: "부분 저장" });
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: "녹화 범위 상세" });
  expect(getRecordingCoverage).not.toHaveBeenCalled();
  expect(within(dialog).getByText("녹화 날짜")).toBeVisible();
  expect(within(dialog).getByText("2026-10-12")).toBeVisible();
  expect(within(dialog).getByText(/CAMERA_DISCONNECTED/)).toBeVisible();
  expect(within(dialog).getByText(/2026-10-12 00:00:20 ~ 2026-10-12 00:00:30/)).toBeVisible();
  expect(within(dialog).queryByText("구간별 누락 원인은 API에서 제공하지 않습니다.")).not.toBeInTheDocument();
});

test("누락 구간 유무에 따른 버튼 표시 조건을 검증한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const rawReplayWithGaps = eventReplayFixture({
    state: "PARTIAL",
    unavailableIntervals: [{ fromAt: "2026-10-12T01:00:00Z", toAt: "2026-10-12T01:00:05Z", kind: "GAP", reasonCode: "FRAME_DROP" }],
  });
  const eventWithGaps = mapEventRecording(eventReplay(rawReplayWithGaps, rawReplayWithGaps.event.eventId).item, eventReplay(rawReplayWithGaps, rawReplayWithGaps.event.eventId).replay);

  const rawReplayNoGaps = eventReplayFixture({ state: "AVAILABLE", unavailableIntervals: [] });
  const eventNoGaps = mapEventRecording(eventReplay(rawReplayNoGaps, rawReplayNoGaps.event.eventId).item, eventReplay(rawReplayNoGaps, rawReplayNoGaps.event.eventId).replay);

  const dailyWithGapsData = dailyRecording(dailyRecordingFixture, "camera-main");
  const dailyWithGaps: Recording = { ...data.recordings[0], id: dailyWithGapsData.id, source: "daily", daily: dailyWithGapsData };

  const dailyNoGapsData = { ...dailyWithGapsData, gaps: [] };
  const dailyNoGaps: Recording = { ...data.recordings[0], id: "daily-no-gaps", source: "daily", daily: dailyNoGapsData };

  const view1 = render(<RecordingsPage recordings={[eventWithGaps]} headerNotifications={[]} reception={data.reception} />);
  expect(screen.getByRole("button", { name: "부분 저장" })).toBeInTheDocument();
  view1.unmount();

  const view2 = render(<RecordingsPage recordings={[eventNoGaps]} headerNotifications={[]} reception={data.reception} />);
  expect(screen.queryByRole("button", { name: "부분 저장" })).not.toBeInTheDocument();
  view2.unmount();

  const view3 = render(<RecordingsPage recordings={[dailyWithGaps]} headerNotifications={[]} reception={data.reception} />);
  expect(screen.getByRole("button", { name: "부분 저장" })).toBeInTheDocument();
  view3.unmount();

  const view4 = render(<RecordingsPage recordings={[dailyNoGaps]} headerNotifications={[]} reception={data.reception} />);
  expect(screen.queryByRole("button", { name: "부분 저장" })).not.toBeInTheDocument();
  view4.unmount();
});
