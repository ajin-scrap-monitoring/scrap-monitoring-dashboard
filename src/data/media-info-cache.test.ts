import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  clearAllMemoryMediaInfo,
  getCachedClipMediaInfo,
  getCachedDailyMediaInfo,
  parseClipMediaInfo,
  parseDailyMediaInfo,
  scheduleMediaInfoRequest,
  setCachedClipMediaInfo,
  setCachedDailyMediaInfo,
} from "./media-info-cache";

describe("영상 파일 정보 캐시와 동시성 제어", () => {
  beforeEach(() => {
    clearAllMemoryMediaInfo();
    localStorage.clear();
  });

  test("날짜 녹화 응답 파싱 (file과 segments)", () => {
    const raw = {
      recording_id: "rec-1",
      file: {
        status: "ready",
        source: "file_probe",
        codec: "h264",
        width: 1920,
        height: 1080,
        fps: 30,
        fps_num: 30,
        fps_den: 1,
        size_bytes: 1048576,
        reason_code: null,
      },
      segments: {
        status: "ready",
        total: 10,
        measured: 10,
        formats: [{ codec: "h264", width: 1920, height: 1080, segment_count: 10 }],
        mixed: false,
      },
      timestamp_info: { time_basis: "server_received_at", capture_timestamp_supported: false },
      thumbnail: { status: "unsupported" },
    };
    const parsed = parseDailyMediaInfo(raw, "rec-1");
    expect(parsed.file?.status).toBe("ready");
    expect(parsed.file?.codec).toBe("h264");
    expect(parsed.file?.width).toBe(1920);
    expect(parsed.file?.height).toBe(1080);
    expect(parsed.segments.status).toBe("ready");
    expect(parsed.segments.mixed).toBe(false);
  });

  test("file이 null이면 준비 전 상태로 파싱한다", () => {
    const raw = {
      recording_id: "rec-2",
      file: null,
      segments: {
        status: "unknown",
        total: 0,
        measured: 0,
        formats: [],
        mixed: null,
      },
    };
    const parsed = parseDailyMediaInfo(raw, "rec-2");
    expect(parsed.file).toBeNull();
    expect(parsed.segments.status).toBe("unknown");
    expect(parsed.segments.mixed).toBeNull();
  });

  test("클립 응답 파싱", () => {
    const raw = {
      clip_id: "clip-1",
      size_bytes: 524288,
      media_info: {
        status: "ready",
        source: "file_probe",
        codec: "h264",
        width: 1280,
        height: 720,
        fps: 29.97,
        size_bytes: 524288,
      },
    };
    const parsed = parseClipMediaInfo(raw, "clip-1");
    expect(parsed.mediaInfo.status).toBe("ready");
    expect(parsed.sizeBytes).toBe(524288);
    expect(parsed.mediaInfo.width).toBe(1280);
  });

  test("동일 ID 중복 요청은 하나로 합치고 Promise를 공유한다", async () => {
    let callCount = 0;
    const fetcher = vi.fn(async () => {
      callCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `result-${callCount}`;
    });

    const [r1, r2] = await Promise.all([
      scheduleMediaInfoRequest("daily:rec-1", fetcher),
      scheduleMediaInfoRequest("daily:rec-1", fetcher),
    ]);
    expect(r1).toBe("result-1");
    expect(r2).toBe("result-1");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("동시에 최대 2개만 요청하고 나머지는 대기한다", async () => {
    let active = 0;
    let maxActive = 0;

    const createTask = (id: string) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return id;
    };

    const promises = [
      scheduleMediaInfoRequest("t1", createTask("t1")),
      scheduleMediaInfoRequest("t2", createTask("t2")),
      scheduleMediaInfoRequest("t3", createTask("t3")),
    ];

    await Promise.all(promises);
    expect(maxActive).toBe(2);
  });

  test("미완성 파일도 메모리에는 보관되어 다시 조회하지 않고 localStorage에는 완성된 파일만 보관한다", () => {
    const recordingDaily = parseDailyMediaInfo({
      recording_id: "rec-recording",
      file: null,
      segments: { status: "partial", total: 10, measured: 5, formats: [], mixed: null },
    }, "rec-recording");

    setCachedDailyMediaInfo("rec-recording", recordingDaily, "recording");
    // 메모리 캐시에는 보관되어 재조회 방지
    expect(getCachedDailyMediaInfo("rec-recording", "recording")).not.toBeNull();
    expect(getCachedDailyMediaInfo("rec-recording", "recording")?.segments.measured).toBe(5);
    // localStorage에는 저장되지 않음
    expect(localStorage.getItem("scrap-dashboard:media-info:v2:daily:rec-recording")).toBeNull();

    const readyDaily = parseDailyMediaInfo({
      recording_id: "rec-ready",
      file: { status: "ready", size_bytes: 1000 },
      segments: { status: "ready", total: 1, measured: 1, formats: [], mixed: false },
    }, "rec-ready");

    setCachedDailyMediaInfo("rec-ready", readyDaily, "completed");
    expect(getCachedDailyMediaInfo("rec-ready")?.file?.status).toBe("ready");
    // 완성된 파일은 localStorage에도 저장됨
    expect(localStorage.getItem("scrap-dashboard:media-info:v2:daily:rec-ready")).not.toBeNull();
  });

  test("파일 검사 시각이 없는 v1 보관값은 읽지 않고 지운다", () => {
    localStorage.setItem("scrap-dashboard:media-info:v1:daily:rec-legacy", JSON.stringify({ result: { kind: "daily", recordingId: "rec-legacy", file: { status: "ready" }, segments: { status: "ready", total: 1, measured: 1, formats: [], mixed: false }, storedSizeBytes: null }, storedSizeBytes: null }));
    localStorage.setItem("scrap-dashboard:media-info:v1:clip:clip-legacy", JSON.stringify({ result: { kind: "clip", clipId: "clip-legacy" }, storedSizeBytes: null }));

    expect(getCachedDailyMediaInfo("rec-legacy")).toBeNull();
    expect(getCachedClipMediaInfo("clip-legacy")).toBeNull();
    expect(localStorage.getItem("scrap-dashboard:media-info:v1:daily:rec-legacy")).toBeNull();
    expect(localStorage.getItem("scrap-dashboard:media-info:v1:clip:clip-legacy")).toBeNull();
  });

  test("보관된 크기와 화면이 이미 가진 크기가 다르면 보관값을 버린다", () => {
    const readyDaily = parseDailyMediaInfo({
      recording_id: "rec-size",
      file: { status: "ready", size_bytes: 1000 },
      segments: { status: "ready", total: 1, measured: 1, formats: [], mixed: false },
    }, "rec-size");

    setCachedDailyMediaInfo("rec-size", readyDaily, "completed");
    // 동일한 크기(1000)면 캐시 반환
    expect(getCachedDailyMediaInfo("rec-size", "completed", 1000)).not.toBeNull();
    // 다른 크기(2000)면 캐시 무효화 및 null 반환
    expect(getCachedDailyMediaInfo("rec-size", "completed", 2000)).toBeNull();
    expect(getCachedDailyMediaInfo("rec-size")).toBeNull();
  });

  test("deleted 또는 expired 상태면 보관값을 사용하지 않는다", () => {
    const readyDaily = parseDailyMediaInfo({
      recording_id: "rec-del",
      file: { status: "ready", size_bytes: 1000 },
      segments: { status: "ready", total: 1, measured: 1, formats: [], mixed: false },
    }, "rec-del");

    setCachedDailyMediaInfo("rec-del", readyDaily, "completed");
    expect(getCachedDailyMediaInfo("rec-del", "deleted")).toBeNull();
    expect(getCachedDailyMediaInfo("rec-del", "expired")).toBeNull();
  });

  test("클립 캐시 보관과 조회 및 삭제", () => {
    const readyClip = parseClipMediaInfo({
      clip_id: "clip-c1",
      size_bytes: 5000,
      media_info: { status: "ready", size_bytes: 5000 },
    }, "clip-c1");

    setCachedClipMediaInfo("clip-c1", readyClip, "ready");
    expect(getCachedClipMediaInfo("clip-c1", "ready", 5000)?.sizeBytes).toBe(5000);
    // 크기 불일치 시 null
    expect(getCachedClipMediaInfo("clip-c1", "ready", 9999)).toBeNull();
  });

  describe("Q7 파일 검사 시각과 출처 계약 검증", () => {
    test("필드 없음 호환: measured_at 누락 시 null, metadata_origin 누락 시 unknown (날짜와 클립 모두)", () => {
      const dailyRaw = {
        recording_id: "rec-compat",
        file: { status: "ready", source: "file_probe", codec: "h264", width: 1920, height: 1080, fps: 30, fps_num: 30, fps_den: 1, size_bytes: 1000, reason_code: null },
        segments: { status: "ready", total: 1, measured: 1, formats: [{ codec: "h264", width: 1920, height: 1080, segment_count: 1 }], mixed: false },
      };
      const daily = parseDailyMediaInfo(dailyRaw, "rec-compat");
      expect(daily.file?.measuredAt).toBeNull();
      expect(daily.file?.metadataOrigin).toBe("unknown");

      const clipRaw = {
        clip_id: "clip-compat",
        size_bytes: 1000,
        media_info: { status: "ready", source: "file_probe", codec: "h264", width: 1920, height: 1080, fps: 30, fps_num: 30, fps_den: 1, size_bytes: 1000, reason_code: null },
      };
      const clip = parseClipMediaInfo(clipRaw, "clip-compat");
      expect(clip.mediaInfo.measuredAt).toBeNull();
      expect(clip.mediaInfo.metadataOrigin).toBe("unknown");
    });

    test("measured_at: null 및 유효한 UTC 시각(Z, +00:00)과 origin 4종 허용 및 원문 보존 (날짜와 클립 모두)", () => {
      const origins = ["request_probe", "memory_cache", "persisted_probe", "unknown"] as const;
      for (const origin of origins) {
        const utcZ = "2026-11-10T04:00:00Z";
        const daily = parseDailyMediaInfo({
          recording_id: "rec-utc",
          file: { status: "ready", codec: "h264", width: 1920, height: 1080, fps: 30, size_bytes: 1000, measured_at: utcZ, metadata_origin: origin },
          segments: { status: "ready", total: 1, measured: 1, formats: [{ codec: "h264", width: 1920, height: 1080, segment_count: 1 }], mixed: false },
        }, "rec-utc");
        expect(daily.file?.measuredAt).toBe(utcZ);
        expect(daily.file?.metadataOrigin).toBe(origin);

        const utcOffset = "2026-11-10T04:00:00+00:00";
        const clip = parseClipMediaInfo({
          clip_id: "clip-utc",
          size_bytes: 1000,
          media_info: { status: "ready", codec: "h264", width: 1920, height: 1080, fps: 30, size_bytes: 1000, measured_at: utcOffset, metadata_origin: origin },
        }, "clip-utc");
        expect(clip.mediaInfo.measuredAt).toBe(utcOffset);
        expect(clip.mediaInfo.metadataOrigin).toBe(origin);
      }

      const dailyNull = parseDailyMediaInfo({
        recording_id: "rec-null",
        file: { status: "ready", codec: "h264", width: 1920, height: 1080, fps: 30, size_bytes: 1000, measured_at: null, metadata_origin: "memory_cache" },
        segments: { status: "ready", total: 1, measured: 1, formats: [], mixed: false },
      }, "rec-null");
      expect(dailyNull.file?.measuredAt).toBeNull();
      expect(dailyNull.file?.metadataOrigin).toBe("memory_cache");
    });

    test("비UTC 시각 거부 (날짜와 클립 모두)", () => {
      const invalidTimes = ["2026-11-10T13:00:00+09:00", "2026-11-10T04:00:00", "not-a-date", 123456789];
      for (const time of invalidTimes) {
        expect(() => parseDailyMediaInfo({
          recording_id: "rec-inv",
          file: { status: "ready", size_bytes: 1000, measured_at: time as unknown as string },
          segments: { status: "ready", total: 0, measured: 0, formats: [], mixed: null },
        }, "rec-inv")).toThrow();

        expect(() => parseClipMediaInfo({
          clip_id: "clip-inv",
          size_bytes: 1000,
          media_info: { status: "ready", size_bytes: 1000, measured_at: time as unknown as string },
        }, "clip-inv")).toThrow();
      }
    });

    test("잘못된 origin 거부 (날짜와 클립 모두)", () => {
      expect(() => parseDailyMediaInfo({
        recording_id: "rec-inv-origin",
        file: { status: "ready", size_bytes: 1000, metadata_origin: "invalid_origin" as unknown as "unknown" },
        segments: { status: "ready", total: 0, measured: 0, formats: [], mixed: null },
      }, "rec-inv-origin")).toThrow();

      expect(() => parseClipMediaInfo({
        clip_id: "clip-inv-origin",
        size_bytes: 1000,
        media_info: { status: "ready", size_bytes: 1000, metadata_origin: "invalid_origin" as unknown as "unknown" },
      }, "clip-inv-origin")).toThrow();
    });

    test("status=unknown인데 measured_at이 null이 아니거나 metadata_origin이 unknown이 아니면 계약 오류 (날짜와 클립 모두)", () => {
      expect(() => parseDailyMediaInfo({
        recording_id: "rec-unk-time",
        file: { status: "unknown", size_bytes: null, reason_code: "file_unavailable", measured_at: "2026-11-10T04:00:00Z", metadata_origin: "unknown" },
        segments: { status: "unknown", total: 0, measured: 0, formats: [], mixed: null },
      }, "rec-unk-time")).toThrow();

      expect(() => parseDailyMediaInfo({
        recording_id: "rec-unk-origin",
        file: { status: "unknown", size_bytes: null, reason_code: "file_unavailable", measured_at: null, metadata_origin: "request_probe" },
        segments: { status: "unknown", total: 0, measured: 0, formats: [], mixed: null },
      }, "rec-unk-origin")).toThrow();

      expect(() => parseClipMediaInfo({
        clip_id: "clip-unk-time",
        size_bytes: null,
        media_info: { status: "unknown", size_bytes: null, reason_code: "file_unavailable", measured_at: "2026-11-10T04:00:00Z", metadata_origin: "unknown" },
      }, "clip-unk-time")).toThrow();

      expect(() => parseClipMediaInfo({
        clip_id: "clip-unk-origin",
        size_bytes: null,
        media_info: { status: "unknown", size_bytes: null, reason_code: "file_unavailable", measured_at: null, metadata_origin: "persisted_probe" },
      }, "clip-unk-origin")).toThrow();
    });

    test("status=unknown이고 measured_at=null이며 metadata_origin=unknown이면 정상 허용", () => {
      const daily = parseDailyMediaInfo({
        recording_id: "rec-unk-ok",
        file: { status: "unknown", size_bytes: null, reason_code: "file_unavailable", measured_at: null, metadata_origin: "unknown" },
        segments: { status: "unknown", total: 0, measured: 0, formats: [], mixed: null },
      }, "rec-unk-ok");
      expect(daily.file?.status).toBe("unknown");
      expect(daily.file?.measuredAt).toBeNull();
      expect(daily.file?.metadataOrigin).toBe("unknown");
    });
  });
});
