import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import { mapEventRecording } from "../data/event-recordings";
import { clearAllMemoryExports } from "../data/event-export-memory";
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
  clearAllMemoryExports();
  clearAllMemoryMediaInfo();
  localStorage.clear();
});

const reception = { status: "connected" as const, lastReceivedAt: "2026-10-12T01:00:00Z" };

function createEventRecording(overrides: {
  id?: string;
  exportPath?: string | null;
  downloadReasonCode?: string | null;
  replayState?: "AVAILABLE" | "PARTIAL" | "PROCESSING" | "UNAVAILABLE";
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
    unavailableIntervals: [],
    reasonCodes: [],
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

const baseSource = createMockDashboardDataSource();

describe("이벤트 구간 다운로드 UI 및 요청 흐름", () => {
  test("exportPath가 있고 요청 전이면 준비 안내와 활성 버튼을 표시한다", () => {
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

    expect(screen.getByText("이벤트 구간만 담은 MP4 파일을 준비합니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "구간 파일 준비" })).toBeEnabled();
  });

  test("exportPath가 없고 이유 코드별로 비활성 안내를 표시한다", () => {
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

      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "다운로드 불가" })).toBeDisabled();
      unmount();
    }
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

    fireEvent.click(screen.getByRole("button", { name: "구간 파일 준비" }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText(message)).toBeInTheDocument();
  });

  test("localStorage에 저장된 fallback 기록이 있으면 마운트 시 상태를 복구한다", async () => {
    const eventId = "20261012-005930-alert";
    const requestId = "550e8400-e29b-41d4-a716-446655440000";
    const statusPath = `/api/v2/recordings/events/${encodeURIComponent(eventId)}/exports/${requestId}`;
    const recording = createEventRecording({
      id: eventId,
      exportPath: `/api/v2/recordings/events/${encodeURIComponent(eventId)}/exports`,
    });

    localStorage.setItem(
      `scrap-dashboard:event-export:v1:anonymous:${eventId}:30:30`,
      JSON.stringify({
        requestId,
        statusPath,
        savedAt: Date.now(),
      }),
    );

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

    await act(async () => { await Promise.resolve(); });

    expect(statusMock).toHaveBeenCalledWith(statusPath, expect.any(AbortSignal));
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
    fireEvent.click(screen.getByRole("button", { name: "구간 파일 준비" }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(clipMock).toHaveBeenCalledWith("clip-abc");
    expect(screen.getByText("hevc")).toBeInTheDocument();
    expect(screen.getByText("1280 x 720")).toBeInTheDocument();
    expect(screen.getByText("1.5 MB")).toBeInTheDocument();
  });
});
