import { afterEach, describe, expect, test, vi } from "vitest";

import { createHttpDashboardDataSource } from "./http-dashboard-data-source";
import type { createDailyRecordingApi } from "./daily-recording-api";
import { notificationPageFixture, recordingPageFixture, sessionFixture } from "../test/api-contract-fixtures";
import { monitoringV2StateFixture } from "../test/backend-contract-fixtures";

const daily = vi.hoisted(() => {
  const queryRecordings = vi.fn(() => Promise.resolve([]));
  const getRecording = vi.fn(() => Promise.resolve(null));
  const prepareExport = vi.fn(() => Promise.resolve(null));
  return { queryRecordings, getRecording, prepareExport,
    create: vi.fn((options: Parameters<typeof createDailyRecordingApi>[0]) => {
      void options;
      return { queryRecordings, getRecording, prepareExport };
    }) };
});

vi.mock("./daily-recording-api", () => ({ createDailyRecordingApi: daily.create }));

const range = { from: "2026-10-12", to: "2026-10-12" };

function requestPath(input: RequestInfo | URL) {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://dashboard.example").pathname;
}

function eventFetch(input: RequestInfo | URL) {
  const path = requestPath(input);
  const value = path === "/api/v1/recordings" ? recordingPageFixture : recordingPageFixture.items[0];
  return Promise.resolve(new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }));
}

afterEach(() => { vi.clearAllMocks(); });

describe("날짜 녹화 API의 지연 로딩 경계", () => {
  test("Backend v2 현황 초기 조회도 날짜 module을 초기화하지 않는다", async () => {
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", route: () => "/",
      fetchImplementation: input => {
        const path = requestPath(input);
        const value = path === "/api/v1/session" ? sessionFixture
          : path === "/api/v2/monitoring/snapshot" ? monitoringV2StateFixture("FRESH", 72)
            : path === "/api/v1/notifications" ? notificationPageFixture : { items: [] };
        return Promise.resolve(new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }));
      },
    });
    expect((await source.getDashboardData()).monitoring.summary.loadPercent).toBe(72);
    expect(daily.create).not.toHaveBeenCalled();
  });

  test.each([
    { apiContract: "backend", monitoringVersion: "v1" },
    { apiContract: "proposal", monitoringVersion: "v1" },
    { apiContract: "proposal", monitoringVersion: "v2" },
    { apiContract: "backend", monitoringVersion: "v2" },
  ] as const)("$apiContract $monitoringVersion의 event 조회는 날짜 module을 초기화하지 않는다", async options => {
    const source = createHttpDashboardDataSource({ ...options, fetchImplementation: eventFetch });
    expect(daily.create).not.toHaveBeenCalled();
    await source.queryRecordings?.(range);
    await source.getRecording?.(recordingPageFixture.items[0].id);
    expect(daily.create).not.toHaveBeenCalled();
  });

  test.each([
    { apiContract: "backend", monitoringVersion: "v1" },
    { apiContract: "proposal", monitoringVersion: "v2" },
  ] as const)("지원하지 않는 $apiContract $monitoringVersion은 날짜 요청 전 지연 경계를 차단한다", async options => {
    const source = createHttpDashboardDataSource({ ...options, fetchImplementation: eventFetch });
    await expect(source.queryRecordings?.({ ...range, recordingSource: "daily" })).rejects.toMatchObject({ status: 404 });
    expect(await source.getRecording?.("daily-id", undefined, "daily")).toBeNull();
    expect(daily.create).not.toHaveBeenCalled();
  });

  test("v2 날짜 조회에 진입한 뒤 동시에 호출해도 하나의 factory를 재사용한다", async () => {
    const source = createHttpDashboardDataSource({ apiContract: "backend", monitoringVersion: "v2", fetchImplementation: eventFetch });
    expect(daily.create).not.toHaveBeenCalled();
    const signal = new AbortController().signal;
    await Promise.all([
      source.queryRecordings?.({ ...range, recordingSource: "daily" }, signal),
      source.getRecording?.("daily-id", signal, "daily"),
    ]);
    await source.prepareDailyRecordingExport?.("daily-id", signal);
    expect(daily.create).toHaveBeenCalledOnce();
    const options = daily.create.mock.calls[0]?.[0];
    expect(options?.cameraId).toBe("camera-main");
    expect(typeof options?.request).toBe("function");
    expect(typeof options?.serverNow).toBe("function");
    expect(typeof options?.isAuthenticated).toBe("function");
    expect(daily.queryRecordings).toHaveBeenCalledWith({ ...range, recordingSource: "daily" }, signal);
    expect(daily.getRecording).toHaveBeenCalledWith("daily-id", signal);
    expect(daily.prepareExport).toHaveBeenCalledWith("daily-id", signal);
  });
});
