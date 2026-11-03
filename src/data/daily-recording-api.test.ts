import { describe, expect, test, vi } from "vitest";

import { createDailyRecordingApi } from "./daily-recording-api";

const cameraId = "camera-main";
const id1 = "550e8400-e29b-41d4-a716-446655440001";
const id2 = "550e8400-e29b-41d4-a716-446655440002";

function summaryItem(id: string, date: string, hasGaps: boolean) {
  const nextDate = new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  return {
    recording_id: id,
    camera_id: cameraId,
    recording_date: date,
    timezone: "Asia/Seoul",
    window_start_at: `${date}T00:00:00.000+09:00`,
    window_end_at: `${nextDate}T00:00:00.000+09:00`,
    status: "closed",
    coverage: hasGaps ? "partial" : "complete",
    has_gaps: hasGaps,
    gap_count: hasGaps ? 1 : 0,
    available_interval_count: 2,
    coverage_as_of_at: `${nextDate}T00:00:00.000+09:00`,
    playable_until_at: `${nextDate}T00:00:00.000+09:00`,
    recorded_seconds: 86400,
    playback_state: "ready",
    playback_protocol: "hls",
    playback_path: `/media/daily-recordings/${id}/hls/index.m3u8`,
    export_allowed: true,
    export_state: "not_requested",
    download_path: null,
    size_bytes: null,
    expires_at: null,
    export_expires_at: null,
    error: null,
  };
}

describe("daily-recording-api view=summary 및 cursor 페이징", () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  test("목록 요청 첫 페이지와 cursor 페이지 모두 view=summary를 유지하고 gaps는 undefined이다", async () => {
    const requestedUrls: string[] = [];
    const request = vi.fn((path: string) => {
      requestedUrls.push(path);
      const url = new URL(path, "https://example.com");
      const cursor = url.searchParams.get("cursor");
      if (!cursor) {
        return Promise.resolve({
          view: "summary",
          items: [summaryItem(id1, "2026-10-14", true)],
          next_cursor: "cursor-token-page2",
        });
      }
      return Promise.resolve({
        view: "summary",
        items: [summaryItem(id2, "2026-10-15", false)],
        next_cursor: null,
      });
    });

    const api = createDailyRecordingApi({
      ApiError,
      cameraId,
      isAuthenticated: () => true,
      request: request as unknown as <T>(path: string, init: RequestInit) => Promise<T>,
      serverNow: () => Date.parse("2026-10-16T12:00:00.000Z"),
    });

    const recordings = await api.queryRecordings({ from: "2026-10-14", to: "2026-10-15" });

    expect(requestedUrls).toHaveLength(2);
    const firstUrl = new URL(requestedUrls[0], "https://example.com");
    expect(firstUrl.searchParams.get("view")).toBe("summary");
    expect(firstUrl.searchParams.get("from_date")).toBe("2026-10-14");
    expect(firstUrl.searchParams.get("to_date")).toBe("2026-10-16");
    expect(firstUrl.searchParams.get("cursor")).toBeNull();

    const secondUrl = new URL(requestedUrls[1], "https://example.com");
    expect(secondUrl.searchParams.get("view")).toBe("summary");
    expect(secondUrl.searchParams.get("cursor")).toBe("cursor-token-page2");

    expect(recordings).toHaveLength(2);
    // 요약 항목에서 gaps는 빈 배열 대신 undefined
    expect(recordings[0].gaps).toBeUndefined();
    expect(recordings[1].gaps).toBeUndefined();
    // tone은 has_gaps에 따라 결정
    expect(recordings[0].tone).toBe("warning");
    expect(recordings[1].tone).toBe("complete");
    // daily.view는 summary
    expect(recordings[0].daily?.view).toBe("summary");
    // 목록 상태는 확보 구간 개수로 판정하고 재생 경로는 상세 조회 뒤에 쓴다.
    expect(recordings[0].status).toBe("available");
  });

  test("요약 항목의 확보 구간 개수가 0이면 재생 가능으로 표시하지 않는다", async () => {
    const item = { ...summaryItem(id1, "2026-10-14", false), available_interval_count: 0, playable_until_at: null };
    const api = createDailyRecordingApi({
      ApiError,
      cameraId,
      isAuthenticated: () => true,
      request: (() => Promise.resolve({ view: "summary", items: [item], next_cursor: null })) as unknown as <T>(path: string, init: RequestInit) => Promise<T>,
      serverNow: () => Date.parse("2026-10-16T12:00:00.000Z"),
    });
    const [recording] = await api.queryRecordings({ from: "2026-10-14", to: "2026-10-14" });
    expect(recording.status).not.toBe("available");
    expect(recording.contentUrl).toBeUndefined();
  });
});
