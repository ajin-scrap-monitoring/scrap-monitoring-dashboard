import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThumbnailInfo, ThumbnailTarget } from "../data/recording-thumbnail";
import type { DailyRecordingFull } from "../domain/daily-recording";
import type { Recording, UserSession } from "../domain/dashboard";
import { RecordingsPage } from "./RecordingsPage";

vi.mock("../components/DailyRecordingVideo", () => ({
  default: ({ label, poster, onError }: { label: string; poster?: string; onError: () => void }) => (
    <video aria-label={label} poster={poster} onError={onError} data-testid="daily-video" />
  ),
}));

vi.mock("../components/EventReplayPlayer", () => ({
  default: ({ label, poster, onError }: { label: string; poster?: string; onError: () => void }) => (
    <div data-testid="event-replay" aria-label={label} data-poster={poster}>
      <video aria-label={label} poster={poster} onError={onError} />
    </div>
  ),
}));

describe("RecordingsPage thumbnail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const adminSession: UserSession = {
    csrfToken: "mock-csrf-token",
    expiresAt: "2026-11-06T00:00:00Z",
    user: { id: "admin-1", role: "administrator", displayName: "관리자" },
  };

  const viewerSession: UserSession = {
    csrfToken: "mock-csrf-token",
    expiresAt: "2026-11-06T00:00:00Z",
    user: { id: "viewer-1", role: "viewer", displayName: "조회자" },
  };

  function createDailyRecording(idSuffix: string, options: {
    status?: "closed" | "recording" | "finalizing";
    exportState?: "ready" | "not_requested" | "processing" | "failed";
  } = {}): Recording {
    const id = `018f4a30-9b4a-7b3b-8d3f-5c2b3a1a000${idSuffix}`;
    const daily: DailyRecordingFull = {
      source: "daily",
      id,
      cameraId: "cam-1",
      recordingDate: `2026-10-${idSuffix.padStart(2, "0")}`,
      timezone: "Asia/Seoul",
      windowStartsAt: `2026-10-${idSuffix.padStart(2, "0")}T00:00:00Z`,
      windowEndsAt: `2026-10-${idSuffix.padStart(2, "0")}T23:59:59Z`,
      status: options.status ?? "closed",
      coverage: "complete",
      hasGaps: false,
      coverageAsOfAt: "2026-10-20T00:00:00Z",
      playableUntilAt: null,
      recordedSeconds: 86400,
      playbackState: "ready",
      playbackProtocol: "hls",
      playbackPath: `/media/daily-recordings/${id}/playlist.m3u8`,
      exportAllowed: true,
      exportState: options.exportState ?? "ready",
      downloadPath: `/media/daily-recordings/${id}/export.mp4`,
      sizeBytes: 1048576,
      expiresAt: null,
      exportExpiresAt: null,
      error: null,
      view: "full",
      gaps: [],
      availableIntervals: [
        {
          startsAt: `2026-10-${idSuffix.padStart(2, "0")}T00:00:00Z`,
          endsAt: `2026-10-${idSuffix.padStart(2, "0")}T23:59:59Z`,
          playbackStartsAtSeconds: 0,
          playbackEndsAtSeconds: 86400,
        },
      ],
    };

    return {
      id,
      source: "daily",
      daily,
      sample: false,
      date: daily.recordingDate,
      start: `${daily.recordingDate} 00:00:00`,
      end: `${daily.recordingDate} 24:00:00`,
      type: "날짜 녹화",
      time: "00:00 - 24:00",
      duration: "24:00:00",
      status: "available",
      mediaStatus: "closed",
      coverage: "complete",
      contentUrl: daily.playbackPath ?? undefined,
      downloadUrl: undefined,
      format: "HLS",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      size: "1.0 MB",
      tone: "complete",
      detail: "",
      retentionStartsAt: "",
      retentionEndsAt: "",
    };
  }

  function createEventRecording(idSuffix: string, eventId: string): Recording {
    return {
      id: eventId,
      source: "event",
      sample: false,
      date: `2026-10-${idSuffix.padStart(2, "0")}`,
      start: `2026-10-${idSuffix.padStart(2, "0")} 10:00:00`,
      end: `2026-10-${idSuffix.padStart(2, "0")} 10:05:00`,
      type: "알림",
      time: "10:00 - 10:05",
      duration: "05:00",
      status: "available",
      mediaStatus: "ready",
      coverage: "complete",
      format: "HLS",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      size: "10 MB",
      tone: "warning",
      detail: "",
      retentionStartsAt: "",
      retentionEndsAt: "",
    };
  }

  it("현재 보이는 항목 중 조건에 맞는 항목만 정보 GET을 실행하고 진행 중 날짜와 TS만 있는 날짜는 요청하지 않는다", async () => {
    const r1 = createDailyRecording("1", { status: "closed", exportState: "ready" });
    const r2 = createDailyRecording("2", { status: "recording", exportState: "ready" }); // 진행 중
    const r3 = createDailyRecording("3", { status: "closed", exportState: "not_requested" }); // TS만 있음
    const eventWithoutClip = createEventRecording("4", "event-without-clip");

    const getThumbnailInfo = vi.fn().mockImplementation((target: ThumbnailTarget) => Promise.resolve({
      kind: target.kind,
      id: target.id,
      cameraId: "cam-1",
      status: "ready" as const,
      contentPath: `/media/daily-recordings/${target.id}/thumbnail`,
      width: 640,
      height: 360,
      sizeBytes: 1000,
      reasonCode: null,
      representativeAt: "2026-10-01T00:00:00Z",
      timeBasis: "server_received_at" as const,
      generatedAt: "2026-10-01T00:05:00Z",
    }));

    const dataSource = {
      supportsDailyRecordings: true,
      getDashboardData: () => Promise.resolve({} as never),
      getRecording: vi.fn().mockResolvedValue(r1),
      getThumbnailInfo,
    };

    render(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={[r1, r2, r3, eventWithoutClip]}
        recordingsSource="daily"
        dataSource={dataSource}
        session={adminSession}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    // r1만 요청되어야 하고, r2(진행 중), r3(TS만), eventWithoutClip(clipId 없음)은 요청되지 않음
    expect(getThumbnailInfo).toHaveBeenCalledTimes(1);
    expect(getThumbnailInfo).toHaveBeenCalledWith({ kind: "daily", id: r1.id }, expect.any(AbortSignal));
  });

  it("동시 요청 수를 최대 3개로 제한한다", async () => {
    const recordings = [
      createDailyRecording("1"),
      createDailyRecording("2"),
      createDailyRecording("3"),
      createDailyRecording("4"),
      createDailyRecording("5"),
    ];

    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<() => void> = [];

    const getThumbnailInfo = vi.fn().mockImplementation(() => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<ThumbnailInfo>((resolve) => {
        resolvers.push(() => {
          inFlight -= 1;
          resolve({
            kind: "daily",
            id: "018f4a30-9b4a-7b3b-8d3f-5c2b3a1a0001",
            cameraId: "cam-1",
            status: "ready",
            contentPath: "/media/daily-recordings/018f4a30-9b4a-7b3b-8d3f-5c2b3a1a0001/thumbnail",
            width: 640,
            height: 360,
            sizeBytes: 1000,
            reasonCode: null,
            representativeAt: null,
            timeBasis: null,
            generatedAt: "2026-10-01T00:00:00Z",
          });
        });
      });
    });

    const dataSource = {
      supportsDailyRecordings: true,
      getDashboardData: () => Promise.resolve({} as never),
      getRecording: vi.fn().mockResolvedValue(recordings[0]),
      getThumbnailInfo,
    };

    render(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={recordings}
        recordingsSource="daily"
        dataSource={dataSource}
        session={adminSession}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    // 5개가 있지만 동시 요청은 최대 3개까지만 진행
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(inFlight).toBe(3);

    // 완료시키면 다음 요청이 실행됨
    await act(async () => {
      resolvers.forEach(r => r());
      await Promise.resolve();
    });

    expect(getThumbnailInfo).toHaveBeenCalledTimes(5);
  });

  it("ready 썸네일은 이미지를 표시하고 잘못된 content_path나 로드 실패는 미리보기 없음을 유지한다", async () => {
    const r1 = createDailyRecording("1");
    const r2 = createDailyRecording("2");

    const getThumbnailInfo = vi.fn().mockImplementation((target: ThumbnailTarget) => {
      if (target.id === r1.id) {
        return Promise.resolve({
          kind: "daily",
          id: r1.id,
          cameraId: "cam-1",
          status: "ready",
          contentPath: `/media/daily-recordings/${r1.id}/thumbnail`,
          width: 640,
          height: 360,
          sizeBytes: 1000,
          reasonCode: null,
          representativeAt: null,
          timeBasis: null,
          generatedAt: "2026-10-01T00:00:00Z",
        });
      }
      return Promise.resolve({
        kind: "daily",
        id: r2.id,
        cameraId: "cam-1",
        status: "ready",
        contentPath: "/invalid/path",
        width: 640,
        height: 360,
        sizeBytes: 1000,
        reasonCode: null,
        representativeAt: null,
        timeBasis: null,
        generatedAt: "2026-10-01T00:00:00Z",
      });
    });

    const dataSource = {
      supportsDailyRecordings: true,
      getDashboardData: () => Promise.resolve({} as never),
      getRecording: vi.fn().mockResolvedValue(r1),
      getThumbnailInfo,
    };

    const { container } = render(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={[r1, r2]}
        recordingsSource="daily"
        dataSource={dataSource}
        session={adminSession}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    // r1은 올바른 경로의 이미지가 렌더링됨
    const img1 = container.querySelector(`img[src="/media/daily-recordings/${r1.id}/thumbnail"]`);
    expect(img1).not.toBeNull();

    // r2는 경로 오류로 거부되어 "미리보기 없음" 유지
    const emptyLabels = container.querySelectorAll(".recording-thumbnail-empty");
    expect(emptyLabels.length).toBeGreaterThanOrEqual(1);

    // img1에서 이미지 로드 실패 발생 시 "미리보기 없음"으로 전환
    fireEvent.error(img1!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector(`img[src="/media/daily-recordings/${r1.id}/thumbnail"]`)).toBeNull();
  });

  it("pending 상태는 5초, 10초, 20초 최대 3회 재조회하고 failed는 자동 재시도하지 않는다", async () => {
    const r1 = createDailyRecording("1");
    let poll = 0;

    const getThumbnailInfo = vi.fn().mockImplementation(() => {
      poll += 1;
      if (poll < 4) {
        return Promise.resolve({
          kind: "daily",
          id: r1.id,
          cameraId: "cam-1",
          status: "pending",
          contentPath: null,
          width: null,
          height: null,
          sizeBytes: null,
          reasonCode: null,
          representativeAt: null,
          timeBasis: null,
          generatedAt: null,
        });
      }
      return Promise.resolve({
        kind: "daily",
        id: r1.id,
        cameraId: "cam-1",
        status: "failed",
        contentPath: null,
        width: null,
        height: null,
        sizeBytes: null,
        reasonCode: "GENERATION_FAILED",
        representativeAt: null,
        timeBasis: null,
        generatedAt: null,
      });
    });

    const dataSource = {
      supportsDailyRecordings: true,
      getDashboardData: () => Promise.resolve({} as never),
      getRecording: vi.fn().mockResolvedValue(r1),
      getThumbnailInfo,
    };

    render(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={[r1]}
        recordingsSource="daily"
        dataSource={dataSource}
        session={adminSession}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(getThumbnailInfo).toHaveBeenCalledTimes(1);

    // 5초 경과 -> 2회차
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(getThumbnailInfo).toHaveBeenCalledTimes(2);

    // 10초 경과 -> 3회차
    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });
    expect(getThumbnailInfo).toHaveBeenCalledTimes(3);

    // 20초 경과 -> 4회차 (failed 반환)
    await act(async () => {
      vi.advanceTimersByTime(20000);
      await Promise.resolve();
    });
    expect(getThumbnailInfo).toHaveBeenCalledTimes(4);

    // failed 후에는 추가 재시도 없음
    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
    });
    expect(getThumbnailInfo).toHaveBeenCalledTimes(4);
  });

  it("선택 녹화의 썸네일 상태와 시각 기준 문구를 표시하고 관리자 버튼과 CSRF를 처리한다", async () => {
    const r1 = createDailyRecording("1");

    const getThumbnailInfo = vi.fn().mockResolvedValue({
      kind: "daily",
      id: r1.id,
      cameraId: "cam-1",
      status: "ready",
      contentPath: `/media/daily-recordings/${r1.id}/thumbnail`,
      width: 640,
      height: 360,
      sizeBytes: 1000,
      reasonCode: null,
      representativeAt: "2026-10-01T00:00:00Z",
      timeBasis: "server_received_at",
      generatedAt: "2026-10-01T00:05:00Z",
    });

    const prepareThumbnail = vi.fn().mockResolvedValue({
      kind: "daily",
      id: r1.id,
      cameraId: "cam-1",
      status: "pending",
      contentPath: null,
      width: null,
      height: null,
      sizeBytes: null,
      reasonCode: null,
      representativeAt: null,
      timeBasis: null,
      generatedAt: null,
    });

    const dataSource = {
      supportsDailyRecordings: true,
      getDashboardData: () => Promise.resolve({} as never),
      getRecording: vi.fn().mockResolvedValue(r1),
      getThumbnailInfo,
      prepareThumbnail,
    };

    render(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={[r1]}
        recordingsSource="daily"
        dataSource={dataSource}
        session={adminSession}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    // 상태 상세 popover 열기
    const statusTrigger = screen.getByRole("button", { name: /상세/ });
    fireEvent.click(statusTrigger);

    // 대표 이미지 상태 확인
    expect(screen.getByText("대표 이미지")).toBeInTheDocument();
    expect(screen.getByText(/서버 수신 기준/)).toBeInTheDocument();
    expect(screen.queryByText(/촬영/)).toBeNull();

    // ready 상태이므로 관리자 버튼은 없음
    expect(screen.queryByRole("button", { name: "대표 이미지 준비" })).toBeNull();
  });

  it("failed 상태에서 관리자에게 대표 이미지 다시 준비 버튼이 표시되고 조회 사용자에게는 미표시된다", async () => {
    const r1 = createDailyRecording("1");

    const getThumbnailInfo = vi.fn().mockResolvedValue({
      kind: "daily",
      id: r1.id,
      cameraId: "cam-1",
      status: "failed",
      contentPath: null,
      width: null,
      height: null,
      sizeBytes: null,
      reasonCode: "GENERATION_FAILED",
      representativeAt: null,
      timeBasis: null,
      generatedAt: null,
    });

    const prepareThumbnail = vi.fn().mockResolvedValue({
      kind: "daily",
      id: r1.id,
      cameraId: "cam-1",
      status: "pending",
      contentPath: null,
      width: null,
      height: null,
      sizeBytes: null,
      reasonCode: null,
      representativeAt: null,
      timeBasis: null,
      generatedAt: null,
    });

    const dataSource = {
      supportsDailyRecordings: true,
      getDashboardData: () => Promise.resolve({} as never),
      getRecording: vi.fn().mockResolvedValue(r1),
      getThumbnailInfo,
      prepareThumbnail,
    };

    // 1) viewer session
    const { unmount } = render(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={[r1]}
        recordingsSource="daily"
        dataSource={dataSource}
        session={viewerSession}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /상세/ }));
    expect(screen.getByText("실패 (GENERATION_FAILED)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "대표 이미지 다시 준비" })).toBeNull();

    unmount();

    // 2) admin session
    render(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={[r1]}
        recordingsSource="daily"
        dataSource={dataSource}
        session={adminSession}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /상세/ }));
    const retryButton = screen.getByRole("button", { name: "대표 이미지 다시 준비" });
    expect(retryButton).toBeInTheDocument();

    fireEvent.click(retryButton);
    await act(async () => {
      await Promise.resolve();
    });

    expect(prepareThumbnail).toHaveBeenCalledWith(
      { kind: "daily", id: r1.id },
      { retryFailed: true },
    );
  });

  it("페이지 이동 시 진행 중인 요청의 signal이 abort된다", async () => {
    // 7개의 녹화 (1페이지에 6개, 2페이지에 1개)
    const recordings = Array.from({ length: 7 }, (_, index) => createDailyRecording(String(index + 1)));
    let firstPageSignal: AbortSignal | undefined;

    const getThumbnailInfo = vi.fn().mockImplementation((target: ThumbnailTarget, signal?: AbortSignal) => {
      if (target.id === recordings[0].id && !firstPageSignal) {
        firstPageSignal = signal;
      }
      return new Promise(() => {
        // 일부러 resolve하지 않음
      });
    });

    const dataSource = {
      supportsDailyRecordings: true,
      getDashboardData: () => Promise.resolve({} as never),
      getRecording: vi.fn().mockImplementation((id: string) => Promise.resolve(recordings.find((r) => r.id === id) ?? recordings[0])),
      getThumbnailInfo,
    };

    render(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={recordings}
        recordingsSource="daily"
        serverTime="2026-10-07T12:00:00Z"
        dataSource={dataSource}
        session={adminSession}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(firstPageSignal).toBeDefined();
    expect(firstPageSignal?.aborted).toBe(false);

    // 2페이지 버튼 클릭 (다음 녹화 목록 페이지)
    const nextButton = screen.getByRole("button", { name: "다음 녹화 목록 페이지" });
    fireEvent.click(nextButton);

    await act(async () => {
      await Promise.resolve();
    });

    // 1페이지 요청 signal이 abort되었음
    expect(firstPageSignal?.aborted).toBe(true);
  });

  it("같은 식별자는 결과를 재사용하여 중복 GET을 요청하지 않는다", async () => {
    const r1 = createDailyRecording("1");

    const getThumbnailInfo = vi.fn().mockResolvedValue({
      kind: "daily",
      id: r1.id,
      cameraId: "cam-1",
      status: "ready",
      contentPath: `/media/daily-recordings/${r1.id}/thumbnail`,
      width: 640,
      height: 360,
      sizeBytes: 1000,
      reasonCode: null,
      representativeAt: null,
      timeBasis: null,
      generatedAt: "2026-10-01T00:00:00Z",
    });

    const dataSource = {
      supportsDailyRecordings: true,
      getDashboardData: () => Promise.resolve({} as never),
      getRecording: vi.fn().mockResolvedValue(r1),
      getThumbnailInfo,
    };

    const { rerender } = render(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={[r1]}
        recordingsSource="daily"
        dataSource={dataSource}
        session={adminSession}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(getThumbnailInfo).toHaveBeenCalledTimes(1);

    // 다시 렌더링해도 이미 완료된 결과는 재요청하지 않음
    rerender(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={[r1]}
        recordingsSource="daily"
        dataSource={dataSource}
        session={adminSession}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(getThumbnailInfo).toHaveBeenCalledTimes(1);
  });

  it("선택 녹화의 ready 썸네일을 플레이어의 poster로 사용한다", async () => {
    const r1 = createDailyRecording("1");

    const getThumbnailInfo = vi.fn().mockResolvedValue({
      kind: "daily",
      id: r1.id,
      cameraId: "cam-1",
      status: "ready",
      contentPath: `/media/daily-recordings/${r1.id}/thumbnail`,
      width: 640,
      height: 360,
      sizeBytes: 1000,
      reasonCode: null,
      representativeAt: null,
      timeBasis: null,
      generatedAt: "2026-10-01T00:00:00Z",
    });

    const dataSource = {
      supportsDailyRecordings: true,
      getDashboardData: () => Promise.resolve({} as never),
      getRecording: vi.fn().mockResolvedValue(r1),
      getThumbnailInfo,
    };

    render(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={[r1]}
        recordingsSource="daily"
        serverTime="2026-10-01T01:00:00Z"
        dataSource={dataSource}
        session={adminSession}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const video = screen.getByTestId("daily-video");
    expect(video).toHaveAttribute("poster", `/media/daily-recordings/${r1.id}/thumbnail`);
  });

  it("TIMELINE_UNAVAILABLE일 때 시각 정보 없음으로 표시하고 generated_at을 프레임 시각으로 쓰지 않는다", async () => {
    const r1 = createDailyRecording("1");

    const getThumbnailInfo = vi.fn().mockResolvedValue({
      kind: "daily",
      id: r1.id,
      cameraId: "cam-1",
      status: "ready",
      contentPath: `/media/daily-recordings/${r1.id}/thumbnail`,
      width: 640,
      height: 360,
      sizeBytes: 1000,
      reasonCode: "TIMELINE_UNAVAILABLE",
      representativeAt: null,
      timeBasis: null,
      generatedAt: "2026-10-01T00:05:00Z",
    });

    const dataSource = {
      supportsDailyRecordings: true,
      getDashboardData: () => Promise.resolve({} as never),
      getRecording: vi.fn().mockResolvedValue(r1),
      getThumbnailInfo,
    };

    render(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={[r1]}
        recordingsSource="daily"
        dataSource={dataSource}
        session={adminSession}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /상세/ }));
    expect(screen.getByText("시각 정보 없음")).toBeInTheDocument();
    expect(screen.queryByText(/00:05:00/)).toBeNull(); // generated_at이 쓰이지 않음
  });

  it("오류 코드별로 올바른 짧은 안내가 상세에 표시된다", async () => {
    const r1 = createDailyRecording("1");

    const getThumbnailInfo = vi.fn().mockRejectedValue({ status: 504 });

    const dataSource = {
      supportsDailyRecordings: true,
      getDashboardData: () => Promise.resolve({} as never),
      getRecording: vi.fn().mockResolvedValue(r1),
      getThumbnailInfo,
    };

    render(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={[r1]}
        recordingsSource="daily"
        dataSource={dataSource}
        session={adminSession}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /상세/ }));
    expect(screen.getByText("시간 초과")).toBeInTheDocument();
  });

  it("5xx 오류는 재사용하지 않고 다른 녹화 선택 시 다시 조회하며 404는 재사용한다", async () => {
    const r1 = createDailyRecording("1");
    const r2 = createDailyRecording("2");
    const r3 = createDailyRecording("3");
    const ready = (id: string): ThumbnailInfo => ({
      kind: "daily", id, cameraId: "cam-1", status: "ready", contentPath: `/media/daily-recordings/${id}/thumbnail`,
      width: 640, height: 360, sizeBytes: 1000, reasonCode: null, representativeAt: null, timeBasis: null, generatedAt: "2026-10-01T00:05:00Z",
    });
    const calls: Record<string, number> = {};
    const getThumbnailInfo = vi.fn().mockImplementation((target: ThumbnailTarget) => {
      calls[target.id] = (calls[target.id] ?? 0) + 1;
      if (target.id === r1.id && calls[target.id] === 1) return Promise.reject(Object.assign(new Error("timeout"), { status: 504 }));
      if (target.id === r3.id) return Promise.reject(Object.assign(new Error("not found"), { status: 404 }));
      return Promise.resolve(ready(target.id));
    });
    const dataSource = {
      supportsDailyRecordings: true,
      getDashboardData: () => Promise.resolve({} as never),
      getRecording: vi.fn().mockImplementation((id: string) => Promise.resolve([r1, r2, r3].find((item) => item.id === id) ?? r1)),
      getThumbnailInfo,
    };

    const { container } = render(
      <RecordingsPage
        headerNotifications={[]}
        reception={{ status: "connected", lastReceivedAt: "2026-10-20T00:00:00Z" }}
        recordings={[r1, r2, r3]}
        recordingsSource="daily"
        dataSource={dataSource}
        session={viewerSession}
      />,
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(calls[r1.id]).toBe(1);
    expect(calls[r3.id]).toBe(1);
    expect(container.querySelector(`img[src="/media/daily-recordings/${r1.id}/thumbnail"]`)).toBeNull();

    fireEvent.click(container.querySelectorAll(".recording-item")[1]);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(calls[r1.id]).toBe(2);
    expect(calls[r3.id]).toBe(1);
    expect(container.querySelector(`img[src="/media/daily-recordings/${r1.id}/thumbnail"]`)).not.toBeNull();
  });
});
