import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { eventReplay, mapEventRecording } from "../data/event-recordings";
import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import { eventReplayFixture, eventReplayPartFixture } from "../test/backend-contract-fixtures";

import { RecordingsPage } from "./RecordingsPage";

type VideoProps = { path: string; label: string; initialTime?: number; videoRef: RefObject<HTMLVideoElement | null>; onTimeUpdate: (seconds: number) => void };
const players = vi.hoisted(() => ({ props: [] as VideoProps[] }));

vi.mock("../components/DailyRecordingVideo", () => ({
  default: (props: VideoProps) => {
    players.props.push(props);
    return <video ref={props.videoRef} aria-label={props.label} data-initial={props.initialTime} />;
  },
}));

const second = "22222222-2222-4222-8222-222222222222";

beforeEach(() => { players.props.length = 0; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function latest(label: string) { return players.props.filter((props) => props.label.endsWith(label)).at(-1)!; }

async function renderEventRecording() {
  const data = await createMockDashboardDataSource().getDashboardData();
  const raw = eventReplayFixture({
    playbackSeconds: 90, coveredSeconds: 90, state: "PARTIAL",
    parts: [
      eventReplayPartFixture(),
      eventReplayPartFixture({ recordingId: second, playbackPath: `/media/daily-recordings/${second}/hls/index.m3u8`, startSeconds: 100, endSeconds: 130, relativeStartSeconds: 60, relativeEndSeconds: 90 }),
    ],
  });
  const { item, replay } = eventReplay(raw, raw.event.eventId);
  const view = render(<RecordingsPage recordings={[mapEventRecording(item, replay)]} headerNotifications={[]} reception={data.reception} />);
  await act(async () => { await Promise.resolve(); });
  return view;
}

test("이벤트 녹화 확대는 원본을 정지하고 현재 이벤트 구간 위치에서 시작하며 닫을 때 마지막 위치를 원본에 복원한다", async () => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  const view = await renderEventRecording();
  fireEvent.click(await screen.findByRole("button", { name: "재생" }));
  expect(play).toHaveBeenCalledTimes(1);
  act(() => latest("이벤트 녹화 영상").onTimeUpdate(3590));
  expect(screen.getByText("0:20 / 1:30")).toBeInTheDocument();

  pause.mockClear();
  const base = view.container.querySelector<HTMLVideoElement>(".recording-frame video")!;
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 크게 보기" }));
  expect(pause.mock.instances).toContain(base);
  const modal = screen.getByRole("dialog", { name: "녹화 영상 크게 보기" });
  expect(latest("이벤트 녹화 영상 확대").initialTime).toBe(3590);
  expect(modal).toHaveTextContent("0:20 / 1:30");

  fireEvent.change(modal.querySelector<HTMLInputElement>("input[type=range]")!, { target: { value: "75" } });
  expect(latest("이벤트 녹화 영상 확대").path).toContain(second);
  expect(latest("이벤트 녹화 영상 확대").initialTime).toBe(115);
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 닫기" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(latest("이벤트 녹화 영상").path).toContain(second);
  expect(latest("이벤트 녹화 영상").initialTime).toBe(115);
  expect(screen.getByText("1:15 / 1:30")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "재생" })).toBeInTheDocument();
  expect(play).toHaveBeenCalledTimes(1);
});

test("이벤트 녹화 확대 중 원본 player의 시간 보고는 확대 위치를 덮어쓰지 않는다", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  await renderEventRecording();
  await screen.findByRole("button", { name: "재생" });
  const base = latest("이벤트 녹화 영상");
  fireEvent.click(screen.getByRole("button", { name: "녹화 영상 크게 보기" }));
  act(() => base.onTimeUpdate(3600));
  expect(screen.getByRole("dialog")).toHaveTextContent("0:00 / 1:30");
});
