import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { EventReplay } from "../domain/dashboard";
import { eventReplayFixture, eventReplayPartFixture } from "../test/backend-contract-fixtures";
import { eventReplay } from "../data/event-recordings";
import { EventReplayPlayer } from "./EventReplayPlayer";

const video = vi.hoisted(() => ({ props: [] as Array<{ path: string; initialTime?: number; autoPlay?: boolean; controls?: boolean; onEnded?: () => void; onTimeUpdate: (seconds: number) => void }> }));

vi.mock("./DailyRecordingVideo", () => ({
  default: (props: { path: string; initialTime?: number; autoPlay?: boolean; controls?: boolean; onEnded?: () => void; onTimeUpdate: (seconds: number) => void }) => {
    video.props.push(props);
    return <video data-testid="part" data-path={props.path} data-initial={props.initialTime} />;
  },
}));

const second = "22222222-2222-4222-8222-222222222222";

function twoParts(): EventReplay {
  return eventReplay(eventReplayFixture({
    playbackSeconds: 90, coveredSeconds: 90, state: "PARTIAL",
    parts: [
      eventReplayPartFixture(),
      eventReplayPartFixture({ recordingId: second, playbackPath: `/media/daily-recordings/${second}/hls/index.m3u8`, startSeconds: 100, endSeconds: 130, relativeStartSeconds: 60, relativeEndSeconds: 90 }),
    ],
  }), "evt-alert-contract-1").replay;
}

function latest() { return video.props.at(-1)!; }

describe("EventReplayPlayer", () => {
  test("원본 video controls 대신 0초부터 재생 길이까지의 재생바를 제공한다", () => {
    video.props.length = 0;
    render(<EventReplayPlayer replay={twoParts()} label="이벤트" onError={vi.fn()} onPosition={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: "재생 위치" });
    expect(slider).toHaveAttribute("max", "90");
    expect(screen.getByText("0:00 / 1:30")).toBeInTheDocument();
    expect(latest().controls).toBe(false);
    expect(latest().initialTime).toBe(3570);
  });

  test("part 끝에서 다음 part의 시작 위치로 이동하고 마지막 끝에서 정지한다", () => {
    video.props.length = 0;
    const onPosition = vi.fn();
    render(<EventReplayPlayer replay={twoParts()} label="이벤트" onError={vi.fn()} onPosition={onPosition} />);
    fireEvent.click(screen.getByRole("button", { name: "재생" }));
    act(() => latest().onEnded?.());
    expect(screen.getByTestId("part")).toHaveAttribute("data-path", expect.stringContaining(second));
    expect(latest().initialTime).toBe(100);
    expect(onPosition).toHaveBeenLastCalledWith(60);
    act(() => latest().onTimeUpdate(130));
    expect(onPosition).toHaveBeenLastCalledWith(90);
    expect(screen.getByRole("button", { name: "재생" })).toBeInTheDocument();
    expect(screen.getByText("1:30 / 1:30")).toBeInTheDocument();
  });

  test("다른 part로 탐색하면 해당 part의 원본 시각으로 로드한다", () => {
    video.props.length = 0;
    const onPosition = vi.fn();
    render(<EventReplayPlayer replay={twoParts()} label="이벤트" onError={vi.fn()} onPosition={onPosition} />);
    fireEvent.change(screen.getByRole("slider", { name: "재생 위치" }), { target: { value: "75" } });
    expect(screen.getByTestId("part")).toHaveAttribute("data-path", expect.stringContaining(second));
    expect(latest().initialTime).toBe(115);
    expect(onPosition).toHaveBeenLastCalledWith(75);
  });

  test("initialSeconds로 확대 화면의 시작 위치를 이어받는다", () => {
    video.props.length = 0;
    render(<EventReplayPlayer replay={twoParts()} label="이벤트" initialSeconds={80} onError={vi.fn()} onPosition={vi.fn()} />);
    expect(latest().initialTime).toBe(120);
    expect(screen.getByText("1:20 / 1:30")).toBeInTheDocument();
  });
});
