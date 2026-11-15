import { describe, expect, test, vi } from "vitest";

import { createDailyRecordingApi } from "./daily-recording-api";

const cameraId = "camera-main";
const id1 = "550e8400-e29b-41d4-a716-446655440001";
const id2 = "550e8400-e29b-41d4-a716-446655440002";

function metadataItem(id: string, date: string, hasGaps: boolean) {
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
    revision: 2,
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

describe("daily-recording-api /summary 및 구간 페이지 API", () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  test("목록 요청은 /daily/summary와 cursor 페이징을 사용하고 view 쿼리 없이 메타데이터를 반환한다", async () => {
    const requestedUrls: string[] = [];
    const request = vi.fn((path: string) => {
      requestedUrls.push(path);
      const url = new URL(path, "https://example.com");
      const cursor = url.searchParams.get("cursor");
      if (!cursor) {
        return Promise.resolve({
          items: [metadataItem(id1, "2026-10-14", true)],
          next_cursor: "cursor-token-page2",
        });
      }
      return Promise.resolve({
        items: [metadataItem(id2, "2026-10-15", false)],
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
    expect(firstUrl.pathname).toBe("/api/v2/recordings/daily/summary");
    expect(firstUrl.searchParams.has("view")).toBe(false);
    expect(firstUrl.searchParams.get("from_date")).toBe("2026-10-14");
    expect(firstUrl.searchParams.get("to_date")).toBe("2026-10-16");
    expect(firstUrl.searchParams.get("limit")).toBe("100");
    expect(firstUrl.searchParams.get("cursor")).toBeNull();

    const secondUrl = new URL(requestedUrls[1], "https://example.com");
    expect(secondUrl.pathname).toBe("/api/v2/recordings/daily/summary");
    expect(secondUrl.searchParams.has("view")).toBe(false);
    expect(secondUrl.searchParams.get("cursor")).toBe("cursor-token-page2");

    expect(recordings).toHaveLength(2);
    expect(recordings[0].gaps).toBeUndefined();
    expect(recordings[1].gaps).toBeUndefined();
    expect(recordings[0].tone).toBe("warning");
    expect(recordings[1].tone).toBe("complete");
    expect(recordings[0].daily?.view).toBe("metadata");
    if (recordings[0].daily?.view === "metadata") expect(recordings[0].daily.revision).toBe(2);
    expect(recordings[0].status).toBe("available");
  });

  test("메타데이터의 playable_until_at이 null이거나 recorded_seconds가 0이면 재생 가능으로 표시하지 않는다", async () => {
    const cases = [
      { ...metadataItem(id1, "2026-10-14", false), playable_until_at: null },
      { ...metadataItem(id1, "2026-10-14", false), recorded_seconds: 0 },
    ];
    for (const item of cases) {
      const api = createDailyRecordingApi({
        ApiError,
        cameraId,
        isAuthenticated: () => true,
        request: (() => Promise.resolve({ items: [item], next_cursor: null })) as unknown as <T>(path: string, init: RequestInit) => Promise<T>,
        serverNow: () => Date.parse("2026-10-16T12:00:00.000Z"),
      });
      const [recording] = await api.queryRecordings({ from: "2026-10-14", to: "2026-10-14" });
      expect(recording.status).not.toBe("available");
      expect(recording.contentUrl).toBeUndefined();
    }
  });

  test("상세 요약, 구간 cursor 단일 페이지 조회, 오류 코드 보존, 내보내기 사전확인을 수행한다", async () => {
    const requestedUrls: string[] = [];
    const api = createDailyRecordingApi({
      ApiError,
      cameraId,
      isAuthenticated: () => true,
      request: vi.fn((path: string, init?: RequestInit) => {
        requestedUrls.push(`${init?.method ?? "GET"} ${path}`);
        if (path === `/api/v2/recordings/daily/${id1}/summary`) {
          return Promise.resolve(metadataItem(id1, "2026-10-14", true));
        }
        if (path === `/api/v2/recordings/daily/${id1}/gaps?limit=50&cursor=bad-cursor`) {
          return Promise.reject(new ApiError(400, "invalid", "INVALID_CURSOR"));
        }
        if (path === `/api/v2/recordings/daily/${id1}/gaps?limit=100`) {
          return Promise.resolve({
            recording_id: id1,
            revision: 2,
            snapshot: "snap-v2",
            items: [{ start_at: "2026-10-13T15:00:20Z", end_at: "2026-10-13T15:00:30Z", reason_code: "CAMERA_DISCONNECTED" }],
            total: 3,
            next_cursor: "gap-next",
          });
        }
        if (path === `/api/v2/recordings/daily/${id1}/available-intervals?limit=100&cursor=int-c2`) {
          return Promise.resolve({
            recording_id: id1,
            revision: 2,
            snapshot: "snap-v2",
            items: [{ start_at: "2026-10-13T15:00:30Z", end_at: "2026-10-13T15:01:00Z", playback_start_seconds: 20, playback_end_seconds: 50 }],
            total: 2,
            next_cursor: null,
          });
        }
        if (path === `/api/v2/recordings/daily/${id1}/exports` && init?.method === "POST") {
          return Promise.resolve({ ...metadataItem(id1, "2026-10-14", true), export_state: "processing" });
        }
        return Promise.reject(new ApiError(404, "unexpected"));
      }) as unknown as <T>(path: string, init: RequestInit) => Promise<T>,
      serverNow: () => Date.parse("2026-10-16T12:00:00.000Z"),
    });

    const detail = await api.getRecording(id1);
    expect(detail.daily?.view).toBe("metadata");

    await expect(api.getGaps(id1, { cursor: "bad-cursor", limit: 50 })).rejects.toMatchObject({
      status: 400,
      code: "INVALID_CURSOR",
    });

    const gaps = await api.getGaps(id1);
    expect(gaps.total).toBe(3);
    expect(gaps.nextCursor).toBe("gap-next");
    expect(gaps.snapshot).toBe("snap-v2");

    const intervals = await api.getAvailableIntervals(id1, { cursor: "int-c2" });
    expect(intervals.items[0].playbackStartsAtSeconds).toBe(20);
    expect(intervals.nextCursor).toBeNull();

    const exported = await api.prepareExport(id1);
    expect(exported.daily?.exportState).toBe("processing");
    expect(requestedUrls).not.toContain(`GET /api/v2/recordings/daily/${id1}`);
    expect(requestedUrls).toContain(`POST /api/v2/recordings/daily/${id1}/exports`);
  });
});
