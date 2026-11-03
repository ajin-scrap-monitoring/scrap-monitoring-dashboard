import { describe, expect, test, vi } from "vitest";

import { createRecordingsApi } from "./http-recordings-api";
import { ApiError } from "./http-dashboard-data-source";
import type { DataAreaState, HistoryLoadSample } from "../domain/dashboard";

describe("http-recordings-api: v2 queryHistory 메모리 캐시", () => {
  const dummySamples: HistoryLoadSample[] = [
    { hour: 9, value: 50 },
  ];

  function createTestApi(options: {
    onRequest?: (from: string, to: string) => Promise<{ historySamples: HistoryLoadSample[] }>;
    monitoringScope?: () => { pitId?: string; siteId?: string; edgeId?: string } | null;
  } = {}) {
    const requestV2LoadHistory = vi.fn().mockImplementation(
      options.onRequest ?? (() => Promise.resolve({ historySamples: dummySamples })),
    );
    const optionalArea = async <T>(
      operation: Promise<T>,
      fallback: T,
      message: string,
    ): Promise<{ value: T; state: DataAreaState }> => {
      try {
        const value = await operation;
        return { value, state: { status: "ready" } };
      } catch {
        return { value: fallback, state: { status: "error", message } };
      }
    };

    const api = createRecordingsApi({
      ApiError,
      backendContract: true,
      cameraId: "cam-01",
      collectionThreshold: () => 80,
      isAuthenticated: () => true,
      monitoringScope: options.monitoringScope ?? (() => ({ pitId: "pit-01", siteId: "site-01", edgeId: "edge-01" })),
      optionalArea,
      pitId: "pit-01",
      request: vi.fn(),
      requestV2LoadHistory,
      serverNow: () => Date.now(),
      supportsDailyRecordings: false,
      useV2Monitoring: true,
    });

    return { api, requestV2LoadHistory };
  }

  test("같은 기간 조회의 load-history는 1회만 요청하고 결과를 재사용한다", async () => {
    const { api, requestV2LoadHistory } = createTestApi();
    const query = { from: "2026-10-15T00:00", to: "2026-10-15T12:00" };

    const first = await api.queryHistory(query);
    expect(requestV2LoadHistory).toHaveBeenCalledTimes(1);
    expect(first.loadSamples).toEqual(dummySamples);

    const second = await api.queryHistory(query);
    expect(requestV2LoadHistory).toHaveBeenCalledTimes(1); // 재요청 없음
    expect(second.loadSamples).toEqual(dummySamples);
  });

  test("이벤트 유형만 변경한 조회는 같은 기간이면 load-history 요청 없이 즉시 끝난다", async () => {
    const { api, requestV2LoadHistory } = createTestApi();
    const baseQuery = { from: "2026-10-15T00:00", to: "2026-10-15T12:00" };

    await api.queryHistory({ ...baseQuery, eventCategory: "collection" });
    expect(requestV2LoadHistory).toHaveBeenCalledTimes(1);

    await api.queryHistory({ ...baseQuery, eventCategory: "alert" });
    expect(requestV2LoadHistory).toHaveBeenCalledTimes(1); // 0회 추가

    await api.queryHistory({ ...baseQuery, eventCategory: "error" });
    expect(requestV2LoadHistory).toHaveBeenCalledTimes(1); // 0회 추가
  });

  test("60초 뒤에는 캐시가 만료되어 다시 요청한다", async () => {
    let now = 1000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const { api, requestV2LoadHistory } = createTestApi();
      const query = { from: "2026-10-15T00:00", to: "2026-10-15T12:00" };

      await api.queryHistory(query);
      expect(requestV2LoadHistory).toHaveBeenCalledTimes(1);

      now += 30_000; // 30초 경과
      await api.queryHistory(query);
      expect(requestV2LoadHistory).toHaveBeenCalledTimes(1); // 아직 유효

      now += 30_001; // 총 60.001초 경과
      await api.queryHistory(query);
      expect(requestV2LoadHistory).toHaveBeenCalledTimes(2); // 만료되어 재요청
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("요청 실패와 취소는 캐시에 보관하지 않는다", async () => {
    let shouldFail = true;
    const { api, requestV2LoadHistory } = createTestApi({
      onRequest: () => {
        if (shouldFail) return Promise.reject(new Error("Network error"));
        return Promise.resolve({ historySamples: dummySamples });
      },
    });
    const query = { from: "2026-10-15T00:00", to: "2026-10-15T12:00" };

    const failedResult = await api.queryHistory(query);
    expect(failedResult.loadState?.status).toBe("error");
    expect(requestV2LoadHistory).toHaveBeenCalledTimes(1);

    // 실패 후 재시도
    shouldFail = false;
    const successResult = await api.queryHistory(query);
    expect(requestV2LoadHistory).toHaveBeenCalledTimes(2); // 실패가 캐시되지 않아 재호출됨
    expect(successResult.loadSamples).toEqual(dummySamples);
  });

  test("캐시는 최대 4개까지 보관하며 초과 시 가장 오래된 항목이 제거된다", async () => {
    const { api, requestV2LoadHistory } = createTestApi();

    const q1 = { from: "2026-10-10T00:00", to: "2026-10-11T00:00" };
    const q2 = { from: "2026-10-11T00:00", to: "2026-10-12T00:00" };
    const q3 = { from: "2026-10-12T00:00", to: "2026-10-13T00:00" };
    const q4 = { from: "2026-10-13T00:00", to: "2026-10-14T00:00" };
    const q5 = { from: "2026-10-14T00:00", to: "2026-10-15T00:00" };

    await api.queryHistory(q1); // 1
    await api.queryHistory(q2); // 2
    await api.queryHistory(q3); // 3
    await api.queryHistory(q4); // 4
    expect(requestV2LoadHistory).toHaveBeenCalledTimes(4);

    // 5번째 항목 조회 -> 가장 오래된 q1이 제거되어야 함
    await api.queryHistory(q5); // 5
    expect(requestV2LoadHistory).toHaveBeenCalledTimes(5);

    // q2, q3, q4, q5는 캐시되어 있으므로 요청 발생 안 함
    await api.queryHistory(q2);
    await api.queryHistory(q3);
    await api.queryHistory(q4);
    await api.queryHistory(q5);
    expect(requestV2LoadHistory).toHaveBeenCalledTimes(5);

    // q1은 캐시에서 제거되었으므로 재요청 발생
    await api.queryHistory(q1);
    expect(requestV2LoadHistory).toHaveBeenCalledTimes(6);
  });
});

describe("이벤트 export 서버 복구", () => {
  function apiWith(request: <T>(path: string, init?: RequestInit) => Promise<T>) {
    return createRecordingsApi({ ApiError, backendContract: true, cameraId: "camera-main", pitId: "pit-01",
      collectionThreshold: () => undefined, isAuthenticated: () => true,
      optionalArea: async (operation) => ({ value: await operation, state: { status: "ready" } }),
      request, requestV2LoadHistory: () => Promise.resolve({ historySamples: [] }), serverNow: () => 0,
      supportsDailyRecordings: false, useV2Monitoring: true });
  }
  test("JSON null과 작업 객체를 구분하고 eventId 불일치를 거절한다", async () => {
    const request = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ eventId: "event", requestId: "server", statusPath: "/status/server", status: "collecting" })
      .mockResolvedValueOnce({ eventId: "other", requestId: "server", statusPath: "/status/server", status: "ready" });
    const api = apiWith(request); const signal = new AbortController().signal;
    expect(await api.findEventRecordingExport("event", { beforeSeconds: 30, afterSeconds: 30 }, signal)).toBeNull();
    expect(request).toHaveBeenCalledWith("/api/v2/recordings/events/event/exports?before_seconds=30&after_seconds=30", { signal });
    expect(await api.findEventRecordingExport("event", { beforeSeconds: 30, afterSeconds: 30 })).toMatchObject({ requestId: "server", status: "collecting" });
    await expect(api.findEventRecordingExport("event", { beforeSeconds: 30, afterSeconds: 30 })).rejects.toThrow("identifier");
  });
  test("404는 작업 없음으로 바꾸지 않고 이벤트 없음 오류로 전달한다", async () => {
    const request = vi.fn().mockRejectedValue(new ApiError(404, "EVENT_NOT_FOUND", "EVENT_NOT_FOUND"));
    await expect(apiWith(request).findEventRecordingExport("event", { beforeSeconds: 30, afterSeconds: 30 })).rejects.toMatchObject({ status: 404, code: "EVENT_NOT_FOUND" });
  });
});

describe("이벤트 녹화 보관 만료일 조회", () => {
  test("구간 배열이 큰 날짜 상세 대신 같은 날짜의 요약 목록에서 보관 만료일을 읽는다", async () => {
    const { eventReplayFixture, eventReplayPartFixture } = await import("../test/backend-contract-fixtures");
    const { dailyRecordingFixture, dailyRecordingId } = await import("../test/daily-recording-fixtures");
    const { gaps: _gaps, available_intervals: _intervals, ...summaryBase } = dailyRecordingFixture;
    void _gaps; void _intervals;
    const summary = { ...summaryBase, gap_count: 1, available_interval_count: 2 };
    const paths: string[] = [];
    const request = vi.fn((path: string) => {
      paths.push(path);
      if (path.startsWith("/api/v2/recordings/events/")) return Promise.resolve(eventReplayFixture({
        parts: [eventReplayPartFixture({ recordingId: dailyRecordingId, playbackPath: `/media/daily-recordings/${dailyRecordingId}/hls/index.m3u8` })],
      }));
      if (path.startsWith("/api/v2/recordings/daily?")) return Promise.resolve({ view: "summary", items: [summary], next_cursor: null });
      return Promise.reject(new ApiError(404, "unexpected"));
    });
    const api = createRecordingsApi({ ApiError, backendContract: true, cameraId: "camera-main", pitId: "pit-01",
      collectionThreshold: () => undefined, isAuthenticated: () => true,
      optionalArea: async (operation) => ({ value: await operation, state: { status: "ready" } }),
      request: request as unknown as <T>(path: string, init?: RequestInit) => Promise<T>,
      requestV2LoadHistory: () => Promise.resolve({ historySamples: [] }),
      serverNow: () => Date.parse("2026-10-13T00:00:00Z"), supportsDailyRecordings: true, useV2Monitoring: true });
    const recording = await api.getRecording("evt-alert-contract-1");
    expect(recording?.retentionEndsAt).toBe("2026-11-13 00:00:00");
    expect(paths.some((path) => path.startsWith(`/api/v2/recordings/daily/${dailyRecordingId}`))).toBe(false);
    const list = new URL(paths.find((path) => path.startsWith("/api/v2/recordings/daily?"))!, "https://dashboard.example");
    expect(Object.fromEntries(list.searchParams)).toMatchObject({ from_date: "2026-10-12", to_date: "2026-10-13", view: "summary" });
  });
});
