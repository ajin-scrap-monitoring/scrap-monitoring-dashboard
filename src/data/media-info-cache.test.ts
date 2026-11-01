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
    expect(localStorage.getItem("scrap-dashboard:media-info:v1:daily:rec-recording")).toBeNull();

    const readyDaily = parseDailyMediaInfo({
      recording_id: "rec-ready",
      file: { status: "ready", size_bytes: 1000 },
      segments: { status: "ready", total: 1, measured: 1, formats: [], mixed: false },
    }, "rec-ready");

    setCachedDailyMediaInfo("rec-ready", readyDaily, "completed");
    expect(getCachedDailyMediaInfo("rec-ready")?.file?.status).toBe("ready");
    // 완성된 파일은 localStorage에도 저장됨
    expect(localStorage.getItem("scrap-dashboard:media-info:v1:daily:rec-ready")).not.toBeNull();
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
});
