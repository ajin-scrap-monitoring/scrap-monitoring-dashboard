import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { DailyRecording } from "../data/daily-recordings";
import { DailyRecordingTimeline } from "./DailyRecordingTimeline";

const item: DailyRecording = {
  source: "daily", id: "daily-01", cameraId: "camera-main", recordingDate: "2026-10-14", timezone: "Asia/Seoul",
  windowStartsAt: "2026-10-13T15:00:00.000Z", windowEndsAt: "2026-10-14T15:00:00.000Z", status: "recording", coverage: null,
  hasGaps: true, coverageAsOfAt: "2026-10-13T17:00:00.000Z", playableUntilAt: "2026-10-13T17:00:00.000Z", recordedSeconds: 5400,
  gaps: [{ startsAt: "2026-10-13T15:30:00.000Z", endsAt: "2026-10-13T16:00:00.000Z", reasonCode: "CAMERA_DISCONNECTED" }],
  availableIntervals: [
    { startsAt: "2026-10-13T15:00:00.000Z", endsAt: "2026-10-13T15:30:00.000Z", playbackStartsAtSeconds: 0, playbackEndsAtSeconds: 1800 },
    { startsAt: "2026-10-13T16:00:00.000Z", endsAt: "2026-10-13T17:00:00.000Z", playbackStartsAtSeconds: 1800, playbackEndsAtSeconds: 5400 },
  ],
  playbackState: "ready", playbackProtocol: "hls", playbackPath: "/media/daily-recordings/daily-01/hls/index.m3u8",
  exportAllowed: false, exportState: "not_requested", downloadPath: null, sizeBytes: null, expiresAt: null, exportExpiresAt: null, error: null,
};
const now = Date.parse("2026-10-13T17:10:00.000Z");

test("하루 범위에 확보와 누락 및 아직 확정되지 않은 구간과 미래를 분리한다", () => {
  render(<DailyRecordingTimeline recording={item} now={now} onSeek={vi.fn()} />);
  expect(screen.getByRole("region", { name: "날짜 녹화 범위" })).toBeInTheDocument();
  expect(screen.getByText("부분 저장")).toBeVisible();
  expect(screen.getByRole("button", { name: "확보 구간 00:00:00 ~ 00:30:00, 재생" })).toHaveStyle({ left: "0%", width: `${30 / (24 * 60) * 100}%` });
  expect(screen.getByRole("img", { name: "누락 구간 00:30:00 ~ 01:00:00" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "확인 중 구간 02:00:00 ~ 02:10:00" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "아직 도래하지 않은 구간 02:10:00 ~ 24:00:00" })).toBeInTheDocument();
  expect(screen.queryByText("전체 구간 확보")).not.toBeInTheDocument();
});

test("누락 이후의 확보 구간은 압축 재생 위치를 사용하며 누락 선택은 아무 영상으로도 이동하지 않는다", () => {
  const onSeek = vi.fn();
  render(<DailyRecordingTimeline recording={item} now={now} onSeek={onSeek} />);
  fireEvent.click(screen.getByRole("button", { name: "확보 구간 01:00:00 ~ 02:00:00, 재생" }));
  expect(onSeek).toHaveBeenCalledWith(1800);
  onSeek.mockClear();
  fireEvent.click(screen.getByRole("img", { name: "누락 구간 00:30:00 ~ 01:00:00" }));
  expect(onSeek).not.toHaveBeenCalled();
});

test("확보 구간의 pointer 위치는 실제 playback mapping으로 이동한다", () => {
  const onSeek = vi.fn();
  render(<DailyRecordingTimeline recording={item} now={now} onSeek={onSeek} />);
  const segment = screen.getByRole("button", { name: "확보 구간 01:00:00 ~ 02:00:00, 재생" });
  vi.spyOn(segment, "getBoundingClientRect").mockReturnValue({ x: 20, left: 20, width: 100, y: 0, top: 0, bottom: 10, height: 10, right: 120, toJSON: () => ({}) });
  fireEvent.click(segment, { detail: 1, clientX: 70 });
  expect(onSeek).toHaveBeenCalledWith(3600);
});

test("원인 없는 과거 구간은 누락으로 추측하지 않고 미확인 상태로 표시한다", () => {
  render(<DailyRecordingTimeline recording={{ ...item, gaps: [{ ...item.gaps[0], endsAt: "2026-10-13T15:59:00.000Z" }] }} now={now} onSeek={vi.fn()} />);
  expect(screen.getByRole("img", { name: "확보 여부 미확인 구간 00:59:00 ~ 01:00:00" })).toBeInTheDocument();
});

test("wall-clock 길이가 없는 관측점은 확보 시간으로 늘리지 않고 재생 시작점만 연결한다", () => {
  const observed = { ...item, availableIntervals: [{ startsAt: "2026-10-13T15:10:00.000Z", endsAt: "2026-10-13T15:10:00.000Z", playbackStartsAtSeconds: 0, playbackEndsAtSeconds: 2 }], recordedSeconds: 2, playableUntilAt: "2026-10-13T15:10:00.000Z", gaps: [], hasGaps: false } satisfies DailyRecording;
  const onSeek = vi.fn();
  render(<DailyRecordingTimeline recording={observed} now={now} onSeek={onSeek} />);
  const point = screen.getByRole("button", { name: "확보 시점 00:10:00, 재생" });
  expect(point.style.width).toBe("");
  fireEvent.click(point);
  expect(onSeek).toHaveBeenCalledWith(0);
  expect(screen.queryByRole("button", { name: /^확보 구간/ })).not.toBeInTheDocument();
});

test.each(["expired", "deleted"] as const)("%s 녹화는 남은 구간 정보를 재생 가능한 것으로 표시하지 않는다", status => {
  const onSeek = vi.fn();
  render(<DailyRecordingTimeline recording={{ ...item, status }} now={now} onSeek={onSeek} />);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.getByRole("img", { name: "재생 불가 구간 00:00:00 ~ 24:00:00" })).toBeInTheDocument();
  expect(onSeek).not.toHaveBeenCalled();
});

test("재생 준비 중에는 확보된 범위를 표시하되 seek를 제공하지 않는다", () => {
  render(<DailyRecordingTimeline recording={{ ...item, playbackState: "pending" }} now={now} onSeek={vi.fn()} />);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.getByRole("img", { name: "확보 구간 00:00:00 ~ 00:30:00" })).toBeInTheDocument();
});

test("많은 확보 및 누락 구간도 시각을 반복 파싱하지 않고 모두 유지한다", () => {
  const count = 600;
  const start = Date.parse(item.windowStartsAt);
  const at = (seconds: number) => new Date(start + seconds * 1000).toISOString();
  const recording: DailyRecording = { ...item, status: "closed", coverage: "partial", coverageAsOfAt: item.windowEndsAt,
    availableIntervals: Array.from({ length: count }, (_, index) => ({ startsAt: at(index * 3), endsAt: at(index * 3 + 1), playbackStartsAtSeconds: index, playbackEndsAtSeconds: index + 1 })),
    gaps: Array.from({ length: count }, (_, index) => ({ startsAt: at(index * 3 + 1), endsAt: at(index * 3 + 3), reasonCode: "SYNTHETIC_GAP" })),
    recordedSeconds: count, playableUntilAt: at((count - 1) * 3 + 1) };
  const parse = vi.spyOn(Date, "parse");
  try {
    const view = render(<DailyRecordingTimeline recording={recording} now={Date.parse(item.windowEndsAt)} onSeek={vi.fn()} />);
    expect(view.container.querySelectorAll(".daily-recording-timeline-track .daily-recording-range-available")).toHaveLength(count);
    expect(view.container.querySelectorAll(".daily-recording-timeline-track .daily-recording-range-gap")).toHaveLength(count);
    expect(parse.mock.calls.length).toBeLessThan(count * 8 + 100);
  } finally { parse.mockRestore(); }
});
