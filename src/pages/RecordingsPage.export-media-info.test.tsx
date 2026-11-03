import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import { mapEventRecording } from "../data/event-recordings";
import { clearAllMemoryMediaInfo } from "../data/media-info-cache";
import type { Recording } from "../domain/dashboard";
import { dailyRecordingFixture } from "../test/daily-recording-fixtures";
import { dailyRecording } from "../data/daily-recordings";
import { RecordingsPage } from "./RecordingsPage";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  clearAllMemoryMediaInfo();
  localStorage.clear();
});

const reception = { status: "connected" as const, lastReceivedAt: "2026-10-12T01:00:00Z" };

function createEventRecording(overrides: {
  id?: string;
  exportPath?: string | null;
  downloadReasonCode?: string | null;
  replayState?: "AVAILABLE" | "PARTIAL" | "PROCESSING" | "UNAVAILABLE";
  reasonCodes?: string[];
  unavailableIntervals?: Array<{ startsAt: string; endsAt: string; kind: "GAP" | "UNCONFIRMED" | "FUTURE" | "MISSING" | "EXPIRED"; reasonCode: string }>;
} = {}): Recording {
  const item = {
    eventId: overrides.id ?? "20261012-005930-alert",
    category: "alert" as const,
    title: "수거 필요",
    occurredAt: "2026-10-12T01:00:00Z",
    windowFrom: "2026-10-12T00:59:30Z",
    windowTo: "2026-10-12T01:00:30Z",
    window: {
      windowKind: "EVENT_CONTEXT" as const,
      windowState: "POINT" as const,
      eventType: "collection_required",
      stateAtOccurrence: null,
      simulated: false,
      pitAttribution: "RECORDED" as const,
      reasonCodes: [],
      windowFrom: "2026-10-12T00:59:30Z",
      windowTo: "2026-10-12T01:00:30Z",
    },
    playback: null,
  };
  const replay = {
    state: overrides.replayState ?? ("AVAILABLE" as const),
    asOf: "2026-10-12T02:00:00Z",
    effectiveTo: "2026-10-12T01:00:30Z",
    requestedSeconds: 60,
    coveredSeconds: 60,
    playbackSeconds: 60,
    parts: [],
    unavailableIntervals: overrides.unavailableIntervals ?? [],
    reasonCodes: overrides.reasonCodes ?? [],
    downloadReasonCode: overrides.downloadReasonCode ?? null,
    exportPath: overrides.exportPath ?? null,
  };
  return mapEventRecording(item, replay, null, undefined, "+09:00");
}

function createDailyRecording(overrides: { id?: string; sizeBytes?: number | null; status?: string } = {}): Recording {
  const id = overrides.id ?? dailyRecordingFixture.recording_id;
  const daily = dailyRecording({
    ...dailyRecordingFixture,
    recording_id: id,
    playback_path: `/media/daily-recordings/${id}/hls/index.m3u8`,
    size_bytes: overrides.sizeBytes ?? null,
    status: overrides.status ?? "closed",
  }, "camera-main");
  return {
    id: daily.id,
    source: "daily",
    daily,
    date: daily.recordingDate,
    time: "00:00 - 24:00",
    start: "2026-10-12 00:00:00",
    end: "2026-10-12 24:00:00",
    duration: "24:00:00",
    type: "날짜 녹화",
    tone: "complete",
    sample: false,
    codec: "정보 없음",
    format: "HLS",
    frameRate: null,
    height: null,
    width: null,
    size: "정보 없음",
    retentionStartsAt: "정보 없음",
    retentionEndsAt: "2026-11-12 15:00:00",
    status: "available",
    detail: "2026-10-12 날짜 녹화",
  };
}

const baseSource: DashboardDataSource = { ...createMockDashboardDataSource(), findEventRecordingExport: () => Promise.resolve(null) };

describe("이벤트 구간 다운로드 UI 및 요청 흐름", () => {
  test("exportPath가 있고 요청 전이면 준비 안내와 활성 버튼을 표시한다", async () => {
    const recording = createEventRecording({
      exportPath: "/api/v2/recordings/events/20261012-005930-alert/exports",
      downloadReasonCode: "EVENT_EXPORT_NOT_REQUESTED",
    });
    const dataSource: DashboardDataSource = {
      ...baseSource,
      getRecording: () => Promise.resolve(recording),
    };

    render(
      <RecordingsPage
        dataSource={dataSource}
        recordings={[recording]}
        headerNotifications={[]}
        reception={reception}
      />,
    );

    expect(await screen.findByText("이벤트 구간만 담은 MP4 파일을 준비합니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "구간 파일 준비" })).toBeEnabled();
  });

  test("exportPath가 없고 이유 코드별로 비활성 안내를 표시한다", async () => {
    const reasons = [
      { code: "EVENT_RANGE_EXPORT_UNSUPPORTED", text: "이벤트 구간 다운로드를 지원하지 않습니다." },
      { code: "EVENT_WINDOW_NOT_CLOSED", text: "수거가 끝난 뒤 준비할 수 있습니다." },
      { code: "EVENT_EXPORT_RANGE_TOO_LONG", text: "구간이 1시간을 넘어 준비할 수 없습니다." },
    ];

    for (const { code, text } of reasons) {
      const recording = createEventRecording({ exportPath: null, downloadReasonCode: code });
      const dataSource: DashboardDataSource = {
        ...baseSource,
        getRecording: () => Promise.resolve(recording),
      };

      const { unmount } = render(
        <RecordingsPage
          dataSource={dataSource}
          recordings={[recording]}
          headerNotifications={[]}
          reception={reception}
        />,
      );

      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "다운로드 불가" })).toBeDisabled();
      unmount();
    }
  });

  test("EVENT_RECORDING_UNAVAILABLE: 안내 문구, 비활성 버튼, reasonCodes와 unavailableIntervals title, POST 0회 확인", async () => {
    const prepareMock = vi.fn();
    const recording = createEventRecording({
      exportPath: null,
      downloadReasonCode: "EVENT_RECORDING_UNAVAILABLE",
      replayState: "UNAVAILABLE",
      reasonCodes: ["NO_VIDEO_RECORDED", "CAMERA_OFFLINE"],
      unavailableIntervals: [
        { startsAt: "2026-10-12T00:59:30Z", endsAt: "2026-10-12T01:00:00Z", kind: "MISSING", reasonCode: "NO_FRAME" },
        { startsAt: "2026-10-12T01:00:00Z", endsAt: "2026-10-12T01:00:30Z", kind: "GAP", reasonCode: "NETWORK_DROP" },
      ],
    });
    const dataSource: DashboardDataSource = {
      ...baseSource,
      getRecording: () => Promise.resolve(recording),
      prepareEventRecordingExport: prepareMock,
    };

    render(
      <RecordingsPage
        dataSource={dataSource}
        recordings={[recording]}
        headerNotifications={[]}
        reception={reception}
      />,
    );

    expect(await screen.findByText("이 구간에 확보된 녹화 영상이 없어 구간 파일을 준비할 수 없습니다.")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "다운로드 불가" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringContaining("NO_VIDEO_RECORDED"));
    expect(button).toHaveAttribute("title", expect.stringContaining("CAMERA_OFFLINE"));
    expect(button).toHaveAttribute("title", expect.stringContaining("2개"));
    expect(button).toHaveAttribute("title", expect.stringContaining("MISSING"));
    expect(button).toHaveAttribute("title", expect.stringContaining("GAP"));
    expect(prepareMock).not.toHaveBeenCalled();
  });

  test("PARTIAL이고 exportPath가 있으면 구간 파일 준비 버튼이 활성화된다", async () => {
    const recording = createEventRecording({
      exportPath: "/api/v2/recordings/events/20261012-005930-alert/exports",
      replayState: "PARTIAL",
      downloadReasonCode: null,
    });
    const dataSource: DashboardDataSource = {
      ...baseSource,
      getRecording: () => Promise.resolve(recording),
    };

    render(
      <RecordingsPage
        dataSource={dataSource}
        recordings={[recording]}
        headerNotifications={[]}
        reception={reception}
      />,
    );

    const button = await screen.findByRole("button", { name: "구간 파일 준비" });
    expect(button).not.toBeDisabled();
    expect(screen.getByText("이벤트 구간만 담은 MP4 파일을 준비합니다.")).toBeInTheDocument();
  });

  test("구간 파일 준비 클릭 시 POST 호출 및 3초 폴링으로 ready 전환 후 다운로드 버튼을 제공한다", async () => {
    vi.useFakeTimers();
    const recording = createEventRecording({
      exportPath: "/api/v2/recordings/events/20261012-005930-alert/exports",
    });

    const prepareMock = vi.fn().mockResolvedValue({
      requestId: "req-uuid-1",
      eventId: recording.id,
      statusPath: "/api/v2/recordings/events/20261012-005930-alert/exports/req-uuid-1",
      status: "pending",
      clipId: null,
      coverage: null,
      sizeBytes: null,
      downloadPath: null,
      expiresAt: null,
      actualFrom: null,
      actualTo: null,
      errorCode: null,
      gaps: [],
    });

    const statusMock = vi.fn().mockResolvedValue({
      requestId: "req-uuid-1",
      eventId: recording.id,
      statusPath: "/api/v2/recordings/events/20261012-005930-alert/exports/req-uuid-1",
      status: "ready",
      clipId: "clip-uuid-10",
      coverage: "partial",
      sizeBytes: 1048576,
      downloadPath: "/media/clips/clip-uuid-10/content?download=true",
      expiresAt: "2026-11-05T00:00:00Z",
      actualFrom: "2026-10-12T00:59:30Z",
      actualTo: "2026-10-12T01:00:30Z",
      errorCode: null,
      gaps: [{ start: "2026-10-12T00:59:40Z", end: "2026-10-12T00:59:50Z" }],
    });

    const dataSource: DashboardDataSource = {
      ...baseSource,
      getRecording: () => Promise.resolve(recording),
      prepareEventRecordingExport: prepareMock,
      getEventRecordingExportStatus: statusMock,
    };

    render(
      <RecordingsPage
        dataSource={dataSource}
        recordings={[recording]}
        headerNotifications={[]}
        reception={reception}
      />,
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const prepareBtn = screen.getByRole("button", { name: "구간 파일 준비" });
    fireEvent.click(prepareBtn);

    await act(async () => { await Promise.resolve(); });
    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect(prepareMock.mock.calls[0][1]).toMatchObject({
      beforeSeconds: 30,
      afterSeconds: 30,
      retryFailed: false,
    });

    expect(screen.getByText("구간 파일을 준비하고 있습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "준비 중" })).toBeDisabled();

    // 3초 후 폴링 실행
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(statusMock).toHaveBeenCalledTimes(1);
    expect(statusMock).toHaveBeenCalledWith("/api/v2/recordings/events/20261012-005930-alert/exports/req-uuid-1", expect.any(AbortSignal));
    const options = prepareMock.mock.calls[0][1] as { requestId: string };
    expect(options.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(options.requestId).not.toBe("req-uuid-1");
    expect(screen.getByText("구간 파일이 준비되었습니다. (1.0 MB), 일부 구간 누락")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다운로드" })).toBeEnabled();
  });

  test("failed 상태면 '구간 파일 준비에 실패했습니다'와 '다시 추출' 버튼(retryFailed: true)을 제공한다", async () => {
    const recording = createEventRecording({
      exportPath: "/api/v2/recordings/events/20261012-005930-alert/exports",
    });

    const prepareMock = vi.fn().mockResolvedValue({
      requestId: "req-fail-1",
      eventId: recording.id,
      statusPath: "/status/req-fail-1",
      status: "failed",
      clipId: null,
      coverage: null,
      sizeBytes: null,
      downloadPath: null,
      expiresAt: null,
      actualFrom: null,
      actualTo: null,
      errorCode: "MEDIA_PROBE_ERROR",
      gaps: [],
    });

    const dataSource: DashboardDataSource = {
      ...baseSource,
      getRecording: () => Promise.resolve(recording),
      prepareEventRecordingExport: prepareMock,
    };

    render(
      <RecordingsPage
        dataSource={dataSource}
        recordings={[recording]}
        headerNotifications={[]}
        reception={reception}
      />,
    );

    await act(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0); else await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "구간 파일 준비" }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("구간 파일 준비에 실패했습니다.")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: "다시 추출" });
    expect(retryBtn).toBeEnabled();

    // 다시 추출 클릭 시 같은 requestId와 retryFailed: true 전달
    fireEvent.click(retryBtn);
    await act(async () => { await Promise.resolve(); });

    expect(prepareMock).toHaveBeenCalledTimes(2);
    expect(prepareMock.mock.calls[1][1]).toMatchObject({
      requestId: "req-fail-1",
      retryFailed: true,
    });
  });

  test("deleted 또는 expired 응답 시 '새로 준비' 버튼을 제공하고 클릭 시 새 requestId를 사용한다", async () => {
    const recording = createEventRecording({
      exportPath: "/api/v2/recordings/events/20261012-005930-alert/exports",
    });

    let count = 0;
    const prepareMock = vi.fn().mockImplementation(() => {
      count += 1;
      return Promise.resolve({
        requestId: `req-cycle-${count}`,
        eventId: recording.id,
        statusPath: `/status/req-cycle-${count}`,
        status: count === 1 ? "expired" : "processing",
        clipId: null,
        coverage: null,
        sizeBytes: null,
        downloadPath: null,
        expiresAt: null,
        actualFrom: null,
        actualTo: null,
        errorCode: null,
        gaps: [],
      });
    });

    const dataSource: DashboardDataSource = {
      ...baseSource,
      getRecording: () => Promise.resolve(recording),
      prepareEventRecordingExport: prepareMock,
    };

    render(
      <RecordingsPage
        dataSource={dataSource}
        recordings={[recording]}
        headerNotifications={[]}
        reception={reception}
      />,
    );

    await act(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0); else await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "구간 파일 준비" }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("준비한 파일이 삭제되었거나 만료되었습니다.")).toBeInTheDocument();
    const newBtn = screen.getByRole("button", { name: "새로 준비" });
    expect(newBtn).toBeEnabled();

    fireEvent.click(newBtn);
    await act(async () => { await Promise.resolve(); });

    expect(prepareMock).toHaveBeenCalledTimes(2);
    const firstCall = prepareMock.mock.calls[0] as [string, { requestId: string }];
    const secondCall = prepareMock.mock.calls[1] as [string, { requestId: string }];
    expect(firstCall[1].requestId).not.toBe(secondCall[1].requestId);
  });

  test.each([
    [401, "UNAUTHORIZED", "로그인이 만료되었습니다."],
    [403, "FORBIDDEN", "권한 또는 보안 토큰 오류입니다."],
    [404, "NOT_FOUND", "대상을 찾을 수 없습니다."],
    [409, "EVENT_WINDOW_NOT_CLOSED", "수거가 끝난 뒤 준비할 수 있습니다."],
    [409, "EVENT_EXPORT_REQUEST_CONFLICT", "이전 요청과 충돌이 발생했습니다."],
    [422, "EVENT_EXPORT_RANGE_TOO_LONG", "구간이 1시간을 넘어 준비할 수 없습니다."],
    [503, "SERVICE_UNAVAILABLE", "미디어 접속 또는 저장소 문제입니다."],
    [504, "GATEWAY_TIMEOUT", "시간 초과가 발생했습니다."],
  ])("HTTP %i (%s) 오류 시 적절한 안내 문구를 상태 문장에 표시한다", async (status, code, message) => {
    const recording = createEventRecording({
      exportPath: "/api/v2/recordings/events/20261012-005930-alert/exports",
    });

    const error = Object.assign(new Error(code), { status, code });
    const prepareMock = vi.fn().mockRejectedValue(error);

    const dataSource: DashboardDataSource = {
      ...baseSource,
      getRecording: () => Promise.resolve(recording),
      prepareEventRecordingExport: prepareMock,
    };

    render(
      <RecordingsPage
        dataSource={dataSource}
        recordings={[recording]}
        headerNotifications={[]}
        reception={reception}
      />,
    );

    await act(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0); else await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "구간 파일 준비" }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText(message)).toBeInTheDocument();
  });

  test("서버 조회로 기존 작업을 복구하고 localStorage를 사용하지 않는다", async () => {
    const eventId = "20261012-005930-alert";
    const requestId = "550e8400-e29b-41d4-a716-446655440000";
    const statusPath = `/api/v2/recordings/events/${encodeURIComponent(eventId)}/exports/${requestId}`;
    const recording = createEventRecording({
      id: eventId,
      exportPath: `/api/v2/recordings/events/${encodeURIComponent(eventId)}/exports`,
    });

    const storageGet = vi.spyOn(Storage.prototype, "getItem");
    const storageSet = vi.spyOn(Storage.prototype, "setItem");
    const statusMock = vi.fn().mockResolvedValue({
      requestId,
      eventId: recording.id,
      statusPath,
      status: "ready",
      clipId: "clip-saved-1",
      coverage: "complete",
      sizeBytes: 2048,
      downloadPath: "/media/clips/clip-saved-1/content?download=true",
      expiresAt: null,
      actualFrom: null,
      actualTo: null,
      errorCode: null,
      gaps: [],
    });

    const dataSource: DashboardDataSource = {
      ...baseSource,
      getRecording: () => Promise.resolve(recording),
      findEventRecordingExport: statusMock,
    };

    render(
      <RecordingsPage
        dataSource={dataSource}
        recordings={[recording]}
        headerNotifications={[]}
        reception={reception}
      />,
    );

    await act(async () => { await Promise.resolve(); });

    expect(statusMock).toHaveBeenCalledExactlyOnceWith(eventId, { beforeSeconds: 30, afterSeconds: 30 }, expect.any(AbortSignal));
    expect(storageGet.mock.calls.some(([key]) => key.includes("event-export"))).toBe(false);
    expect(storageSet.mock.calls.some(([key]) => key.includes("event-export"))).toBe(false);
    expect(screen.getByText("구간 파일이 준비되었습니다. (2.0 KB)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다운로드" })).toBeEnabled();
  });
});

describe("녹화 정보 영상 파일 정보 연결", () => {
  test("날짜 녹화에서 file이 ready면 codec, width x height, fps, 크기를 채운다", async () => {
    const dailyRec = createDailyRecording({ id: "550e8400-e29b-41d4-a716-446655440001", sizeBytes: 2097152 });
    const getMediaInfoMock = vi.fn().mockResolvedValue({
      kind: "daily",
      recordingId: "550e8400-e29b-41d4-a716-446655440001",
      file: {
        status: "ready",
        codec: "h264",
        width: 1920,
        height: 1080,
        fps: 29.97,
        fpsNum: 30000,
        fpsDen: 1001,
        sizeBytes: 2097152,
        reasonCode: null,
      },
      segments: {
        status: "ready",
        total: 24,
        measured: 24,
        formats: [{ codec: "h264", width: 1920, height: 1080, segmentCount: 24 }],
        mixed: false,
      },
      storedSizeBytes: 2097152,
    });

    const dataSource: DashboardDataSource = {
      ...baseSource,
      getRecording: () => Promise.resolve(dailyRec),
      getDailyRecordingMediaInfo: getMediaInfoMock,
    };

    render(
      <RecordingsPage
        dataSource={dataSource}
        recordings={[dailyRec]}
        headerNotifications={[]}
        reception={reception}
      />,
    );

    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("h264")).toBeInTheDocument();
    expect(screen.getByText("1920 x 1080")).toBeInTheDocument();
    expect(screen.getByText("16:9")).toBeInTheDocument();
    expect(screen.getByText("29.97 fps")).toBeInTheDocument();
    expect(screen.getByText("2.0 MB")).toBeInTheDocument();
  });

  test("날짜 녹화에서 file이 null이면 5개 줄 모두 '날짜 MP4 준비 전'을 표시한다", async () => {
    const dailyRec = createDailyRecording({ id: "550e8400-e29b-41d4-a716-446655440002" });
    const getMediaInfoMock = vi.fn().mockResolvedValue({
      kind: "daily",
      recordingId: "550e8400-e29b-41d4-a716-446655440002",
      file: null,
      segments: {
        status: "partial",
        total: 10,
        measured: 5,
        formats: [],
        mixed: null,
      },
      storedSizeBytes: null,
    });

    const dataSource: DashboardDataSource = {
      ...baseSource,
      getRecording: () => Promise.resolve(dailyRec),
      getDailyRecordingMediaInfo: getMediaInfoMock,
    };

    render(
      <RecordingsPage
        dataSource={dataSource}
        recordings={[dailyRec]}
        headerNotifications={[]}
        reception={reception}
      />,
    );

    await act(async () => { await Promise.resolve(); });

    expect(screen.getAllByText("날짜 MP4 준비 전")).toHaveLength(5);
  });

  test("이벤트 녹화는 구간 파일이 ready이고 clipId가 있을 때만 clip media-info를 조회한다", async () => {
    const eventRec = createEventRecording({
      exportPath: "/api/v2/recordings/events/20261012-005930-alert/exports",
    });

    const clipMock = vi.fn().mockResolvedValue({
      kind: "clip",
      clipId: "clip-abc",
      sizeBytes: 1572864,
      mediaInfo: {
        status: "ready",
        codec: "hevc",
        width: 1280,
        height: 720,
        fps: 30,
        sizeBytes: 1572864,
      },
      storedSizeBytes: 1572864,
    });

    const prepareMock = vi.fn().mockResolvedValue({
      requestId: "req-ready",
      eventId: eventRec.id,
      statusPath: "/status/req-ready",
      status: "ready",
      clipId: "clip-abc",
      coverage: "complete",
      sizeBytes: 1572864,
      downloadPath: "/media/clips/clip-abc/content?download=true",
      expiresAt: null,
      actualFrom: null,
      actualTo: null,
      errorCode: null,
      gaps: [],
    });

    const dataSource: DashboardDataSource = {
      ...baseSource,
      getRecording: () => Promise.resolve(eventRec),
      prepareEventRecordingExport: prepareMock,
      getClipMediaInfo: clipMock,
    };

    render(
      <RecordingsPage
        dataSource={dataSource}
        recordings={[eventRec]}
        headerNotifications={[]}
        reception={reception}
      />,
    );

    // 준비 전에는 "구간 파일 준비 후 확인" 5개
    expect(screen.getAllByText("구간 파일 준비 후 확인")).toHaveLength(5);
    expect(clipMock).not.toHaveBeenCalled();

    // 준비 요청 실행
    await act(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0); else await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "구간 파일 준비" }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(clipMock).toHaveBeenCalledWith("clip-abc");
    expect(screen.getByText("hevc")).toBeInTheDocument();
    expect(screen.getByText("1280 x 720")).toBeInTheDocument();
    expect(screen.getByText("1.5 MB")).toBeInTheDocument();
  });
});

describe("서버 export 복구 수명", () => {
  const recording = createEventRecording({ exportPath: "/api/v2/recordings/events/20261012-005930-alert/exports" });
  const status = (overrides: Partial<import("../data/event-recordings").EventExportStatus> = {}) => ({
    requestId: "server-request", eventId: recording.id, statusPath: "/status/server-request", status: "ready",
    downloadPath: "/media/clips/server/content?download=true", clipId: null, coverage: null,
    sizeBytes: null, expiresAt: null, actualFrom: null, actualTo: null, errorCode: null, gaps: [], ...overrides,
  });
  const props = { recordings: [recording], headerNotifications: [], reception };

  test("상태 조회의 5xx와 네트워크 오류는 2초, 4초, 8초 뒤 재시도하고 ready를 표시한다", async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockRejectedValueOnce({ status: 504, code: "MEDIA_TIMEOUT" })
      .mockRejectedValueOnce({ status: 503 }).mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(status());
    const source = { ...baseSource, getRecording: () => Promise.resolve(recording),
      findEventRecordingExport: vi.fn().mockResolvedValue(status({ status: "processing", downloadPath: null })),
      getEventRecordingExportStatus: poll };
    render(<RecordingsPage {...props} dataSource={source} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(poll).toHaveBeenCalledTimes(1);
    for (const [index, delay] of [2000, 4000, 8000].entries()) {
      expect(screen.getByRole("button", { name: "준비 중" })).toBeDisabled();
      expect(screen.queryByText("미디어 서비스 응답 시간이 초과되었습니다.")).not.toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(delay - 1));
      expect(poll).toHaveBeenCalledTimes(index + 1);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(poll).toHaveBeenCalledTimes(index + 2);
    }
    expect(screen.getByRole("button", { name: "다운로드" })).toBeEnabled();
    expect(poll).toHaveBeenLastCalledWith("/status/server-request", expect.any(AbortSignal));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(poll).toHaveBeenCalledTimes(4);
  });

  test("상태 조회가 계속 실패하면 세 번 재시도한 뒤 오류를 표시하고 자동 조회를 중단한다", async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockRejectedValue({ status: 504, code: "MEDIA_TIMEOUT" });
    const source = { ...baseSource, getRecording: () => Promise.resolve(recording),
      findEventRecordingExport: vi.fn().mockResolvedValue(status({ status: "collecting", downloadPath: null })),
      getEventRecordingExportStatus: poll };
    render(<RecordingsPage {...props} dataSource={source} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    for (const delay of [3000, 2000, 4000, 8000]) await act(() => vi.advanceTimersByTimeAsync(delay));
    expect(poll).toHaveBeenCalledTimes(4);
    expect(screen.getByText("미디어 서비스 응답 시간이 초과되었습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다운로드" })).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(poll).toHaveBeenCalledTimes(4);
  });

  test("상태 조회 성공은 연속 실패 횟수를 초기화하고 정상 3초 간격을 복원한다", async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockRejectedValueOnce({ status: 504 })
      .mockResolvedValueOnce(status({ status: "processing", downloadPath: null }))
      .mockRejectedValueOnce({ status: 504 }).mockResolvedValue(status());
    const source = { ...baseSource, getRecording: () => Promise.resolve(recording),
      findEventRecordingExport: vi.fn().mockResolvedValue(status({ status: "processing", downloadPath: null })),
      getEventRecordingExportStatus: poll };
    render(<RecordingsPage {...props} dataSource={source} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    for (const delay of [3000, 2000, 3000, 2000]) await act(() => vi.advanceTimersByTimeAsync(delay));
    expect(poll).toHaveBeenCalledTimes(4);
    expect(screen.getByRole("button", { name: "다운로드" })).toBeEnabled();
  });

  test.each([401, 403, 404, 409, 422, 429])("상태 조회의 %s 응답은 자동 재시도하지 않는다", async (code) => {
    vi.useFakeTimers();
    const poll = vi.fn().mockRejectedValue({ status: code });
    const source = { ...baseSource, getRecording: () => Promise.resolve(recording),
      findEventRecordingExport: vi.fn().mockResolvedValue(status({ status: "pending", downloadPath: null })),
      getEventRecordingExportStatus: poll };
    render(<RecordingsPage {...props} dataSource={source} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(poll).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "다운로드" })).not.toBeInTheDocument();
  });

  test.each(["deleted", "expired", "failed", "blocked"])("재시도 뒤 %s 상태는 자동 조회를 중단한다", async (nextStatus) => {
    vi.useFakeTimers();
    const poll = vi.fn().mockRejectedValueOnce({ status: 504 })
      .mockResolvedValue(status({ status: nextStatus, downloadPath: null }));
    const source = { ...baseSource, getRecording: () => Promise.resolve(recording),
      findEventRecordingExport: vi.fn().mockResolvedValue(status({ status: "processing", downloadPath: null })),
      getEventRecordingExportStatus: poll };
    render(<RecordingsPage {...props} dataSource={source} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(poll).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "준비 중" })).not.toBeInTheDocument();
  });

  test.each(["선택 변경", "화면 종료"])("재시도 대기 중 %s은 timer와 이전 요청을 취소한다", async (change) => {
    vi.useFakeTimers();
    const next = createEventRecording({ id: "20261012-005931-alert", exportPath: "/export/next" });
    const poll = vi.fn().mockRejectedValue({ status: 504 });
    const source = { ...baseSource, getRecording: (id: string) => Promise.resolve(id === recording.id ? recording : next),
      findEventRecordingExport: vi.fn().mockResolvedValueOnce(status({ status: "processing", downloadPath: null })).mockResolvedValue(null),
      getEventRecordingExportStatus: poll };
    const view = render(<RecordingsPage {...props} recordings={[recording, next]} dataSource={source} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    const signal = poll.mock.calls[0][1] as AbortSignal;
    if (change === "화면 종료") view.unmount();
    else fireEvent.click(document.querySelectorAll<HTMLButtonElement>(".recording-item")[1]);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(signal.aborted).toBe(true);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  test("준비 요청이 504로 응답을 잃으면 기존 작업 조회로 서버가 접수한 작업을 이어서 표시한다", async () => {
    const lookup = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(status({ requestId: "accepted", statusPath: "/status/accepted", status: "processing", downloadPath: null }));
    const post = vi.fn().mockRejectedValue({ status: 504, code: "MEDIA_TIMEOUT" });
    const poll = vi.fn(() => new Promise<never>(() => undefined));
    const source = { ...baseSource, getRecording: () => Promise.resolve(recording), findEventRecordingExport: lookup, prepareEventRecordingExport: post, getEventRecordingExportStatus: poll };
    render(<RecordingsPage {...props} dataSource={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "구간 파일 준비" }));
    expect(await screen.findByText("구간 파일을 준비하고 있습니다.")).toBeInTheDocument();
    expect(screen.queryByText("미디어 서비스 응답 시간이 초과되었습니다.")).not.toBeInTheDocument();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["작업 없음", null],
    ["삭제된 이전 작업", { status: "deleted", downloadPath: null }],
  ])("준비 요청 504 뒤 조회 결과가 %s이면 오류를 안내하고 다시 준비를 허용한다", async (_, recovered) => {
    const lookup = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(recovered && status(recovered));
    const post = vi.fn().mockRejectedValue({ status: 504, code: "MEDIA_TIMEOUT" });
    const source = { ...baseSource, getRecording: () => Promise.resolve(recording), findEventRecordingExport: lookup, prepareEventRecordingExport: post };
    render(<RecordingsPage {...props} dataSource={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "구간 파일 준비" }));
    expect(await screen.findByText("미디어 서비스 응답 시간이 초과되었습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "구간 파일 준비" })).toBeEnabled();
  });

  test("준비 요청의 4xx 거절은 기존 작업 조회를 다시 하지 않는다", async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const post = vi.fn().mockRejectedValue({ status: 409, code: "EVENT_EXPORT_REQUEST_CONFLICT" });
    const source = { ...baseSource, getRecording: () => Promise.resolve(recording), findEventRecordingExport: lookup, prepareEventRecordingExport: post };
    render(<RecordingsPage {...props} dataSource={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "구간 파일 준비" }));
    expect(await screen.findByText("이전 요청과 충돌이 발생했습니다.")).toBeInTheDocument();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test("선택 시 조회는 한 번이고 POST는 없으며 null 응답 뒤 준비를 허용한다", async () => {
    let resolve!: (value: null) => void;
    const lookup = vi.fn(() => new Promise<null>(done => { resolve = done; }));
    const post = vi.fn();
    const source = { ...baseSource, getRecording: () => Promise.resolve({ ...recording }), findEventRecordingExport: lookup, prepareEventRecordingExport: post };
    render(<RecordingsPage {...props} dataSource={source} />);
    expect(screen.getByRole("button", { name: "확인 중" })).toBeDisabled();
    await act(async () => { resolve(null); await Promise.resolve(); });
    expect(screen.getByRole("button", { name: "구간 파일 준비" })).toBeEnabled();
    expect(lookup).toHaveBeenCalledExactlyOnceWith(recording.id, { beforeSeconds: 30, afterSeconds: 30 }, expect.any(AbortSignal));
    expect(post).not.toHaveBeenCalled();
  });

  test.each([404, 503])("조회 실패 %s의 안내와 준비 허용을 구분한다", async (code) => {
    const source = { ...baseSource, getRecording: () => Promise.resolve(recording),
      findEventRecordingExport: vi.fn().mockRejectedValue({ status: code }), prepareEventRecordingExport: vi.fn() };
    render(<RecordingsPage {...props} dataSource={source} />);
    expect(await screen.findByText(code === 404 ? "이벤트를 찾을 수 없습니다." : "기존 구간 파일 작업을 확인하지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: code === 404 ? "다운로드 불가" : "구간 파일 준비" })).toHaveProperty("disabled", code === 404);
    expect(source.prepareEventRecordingExport).not.toHaveBeenCalled();
  });

  test("조회 실패 뒤에도 서버가 새 요청 경로를 주지 않은 이벤트는 준비를 허용하지 않는다", async () => {
    const unavailable = createEventRecording({ exportPath: null, downloadReasonCode: "EVENT_RECORDING_UNAVAILABLE" });
    const source = { ...baseSource, getRecording: () => Promise.resolve(unavailable),
      findEventRecordingExport: vi.fn().mockRejectedValue({ status: 503 }), prepareEventRecordingExport: vi.fn() };
    render(<RecordingsPage {...props} recordings={[unavailable]} dataSource={source} />);
    expect(await screen.findByText("기존 구간 파일 작업을 확인하지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "구간 파일 준비" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다운로드 불가" })).toBeDisabled();
    expect(source.prepareEventRecordingExport).not.toHaveBeenCalled();
  });

  test("선택 변경은 조회를 abort하고 늦은 응답을 무시한다", async () => {
    const next = createEventRecording({ id: "20261012-005931-alert", exportPath: "/export/next" });
    let resolve!: (value: ReturnType<typeof status>) => void;
    const lookup = vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(null);
    const source = { ...baseSource, getRecording: (id: string) => Promise.resolve(id === recording.id ? recording : next), findEventRecordingExport: lookup };
    render(<RecordingsPage {...props} recordings={[recording, next]} dataSource={source} />);
    const signal = lookup.mock.calls[0][2] as AbortSignal;
    fireEvent.click(document.querySelectorAll<HTMLButtonElement>(".recording-item")[1]);
    await act(async () => { await Promise.resolve(); });
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(status()); await Promise.resolve(); });
    expect(screen.getByRole("button", { name: "구간 파일 준비" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "다운로드" })).not.toBeInTheDocument();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test("같은 이벤트에서 data source가 바뀌면 이전 다운로드를 숨기고 다시 확인한다", async () => {
    const first = { ...baseSource, getRecording: () => Promise.resolve(recording), findEventRecordingExport: vi.fn().mockResolvedValue(status()) };
    const view = render(<RecordingsPage {...props} dataSource={first} />);
    expect(await screen.findByRole("button", { name: "다운로드" })).toBeEnabled();
    const next = { ...first, findEventRecordingExport: vi.fn(() => new Promise<null>(() => {})) };
    view.rerender(<RecordingsPage {...props} dataSource={next} />);
    expect(screen.getByRole("button", { name: "확인 중" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "다운로드" })).not.toBeInTheDocument();
  });

  test("collecting을 복구하면 응답 statusPath를 polling하고 failed 재시도에 응답 requestId를 쓴다", async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockResolvedValue(status({ requestId: "reused-request", statusPath: "/status/reused", status: "collecting", downloadPath: null }));
    const poll = vi.fn().mockResolvedValue(status({ requestId: "latest-request", statusPath: "/status/latest", status: "failed", downloadPath: null }));
    const source = { ...baseSource, getRecording: () => Promise.resolve(recording),
      findEventRecordingExport: vi.fn().mockResolvedValue(status({ status: "collecting", downloadPath: null })),
      getEventRecordingExportStatus: poll, prepareEventRecordingExport: post };
    render(<RecordingsPage {...props} dataSource={source} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("button", { name: "준비 중" })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(poll).toHaveBeenCalledWith("/status/server-request", expect.any(AbortSignal));
    fireEvent.click(screen.getByRole("button", { name: "다시 추출" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(post.mock.calls[0][1]).toMatchObject({ requestId: "latest-request", retryFailed: true });
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(poll).toHaveBeenLastCalledWith("/status/reused", expect.any(AbortSignal));
  });
});
