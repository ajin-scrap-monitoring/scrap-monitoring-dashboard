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
