import { describe, expect, test } from "vitest";

import { dailyPlaybackPosition, dailyPlaybackTimestamp, dailyRecording, dailyRecordingAvailability, dailyRecordingPage, dailyTimeState } from "./daily-recordings";

const id = "550e8400-e29b-41d4-a716-446655440000";
const fixture = {
  recording_id: id,
  camera_id: "camera-main",
  recording_date: "2026-10-14",
  timezone: "Asia/Seoul",
  window_start_at: "2026-10-13T15:00:00.000Z",
  window_end_at: "2026-10-14T15:00:00.000Z",
  status: "recording",
  coverage: null,
  has_gaps: true,
  coverage_as_of_at: "2026-10-13T15:01:00.000Z",
  playable_until_at: "2026-10-13T15:01:00.000Z",
  recorded_seconds: 50,
  gaps: [{ start_at: "2026-10-13T15:00:20.000Z", end_at: "2026-10-13T15:00:30.000Z", reason_code: "CAMERA_DISCONNECTED" }],
  available_intervals: [
    { start_at: "2026-10-13T15:00:00.000Z", end_at: "2026-10-13T15:00:20.000Z", playback_start_seconds: 0, playback_end_seconds: 20 },
    { start_at: "2026-10-13T15:00:30.000Z", end_at: "2026-10-13T15:01:00.000Z", playback_start_seconds: 20, playback_end_seconds: 50 },
  ],
  playback_state: "ready",
  playback_protocol: "hls",
  playback_path: `/api/v2/daily-recordings/${id}/hls/index.m3u8`,
  export_allowed: false,
  export_state: "not_requested",
  download_path: null,
  size_bytes: null,
  expires_at: null,
  export_expires_at: null,
  error: null,
};

function recording(overrides: Record<string, unknown> = {}) { return dailyRecording({ ...fixture, ...overrides }, "camera-main"); }
const afterClosure = Date.parse("2026-10-14T16:00:00.000Z");
function closed(overrides: Record<string, unknown> = {}) {
  return recording({ status: "closed", coverage: "partial", export_allowed: true, expires_at: "2026-11-13T15:00:00.000Z", ...overrides });
}

describe("날짜 녹화의 내부 계약 모델", () => {
  test("한국 날짜와 null 메타데이터 및 독립 상태를 보존한다", () => {
    expect(recording()).toMatchObject({ source: "daily", recordingDate: "2026-10-14", timezone: "Asia/Seoul", status: "recording", coverage: null, playbackState: "ready", exportState: "not_requested", sizeBytes: null, expiresAt: null });
    expect(recording()).not.toHaveProperty("category");
  });

  test("녹화 중에도 완료 조각은 재생할 수 있지만 전체 다운로드는 할 수 없다", () => {
    expect(dailyRecordingAvailability(recording(), Date.parse("2026-10-13T15:02:00.000Z"))).toMatchObject({ playbackReady: true, downloadReady: false, canPrepareExport: false });
    expect(dailyRecordingAvailability(recording({ export_allowed: true }), afterClosure).canPrepareExport).toBe(false);
  });

  test("실제 UTC 날짜가 다른 한국 날짜의 자정을 host timezone과 무관하게 검사한다", () => {
    expect(recording().windowStartsAt).toBe("2026-10-13T15:00:00.000Z");
    expect(() => recording({ window_start_at: "2026-10-14T00:00:00.000Z" })).toThrow();
    expect(() => recording({ recording_date: "2026-02-30" })).toThrow();
  });

  test.each([
    { status: "available" }, { coverage: "unknown" }, { coverage: undefined }, { has_gaps: "true" },
    { timezone: "UTC" }, { window_end_at: "2026-10-15T15:00:00.000Z" },
    { coverage_as_of_at: "2026-10-13T14:59:59.999Z" }, { recorded_seconds: -1 }, { recorded_seconds: "50" },
    { recorded_seconds: Number.NaN }, { size_bytes: 0.5 }, { camera_id: "another-camera" },
    { playback_state: "playing" }, { export_state: "done" }, { playback_protocol: "mp4" },
    { playback_path: "https://media.example/internal/index.m3u8" },
    { playback_path: "//media.example/index.m3u8" }, { download_path: "/api/v2/daily-recordings/other/content" },
    { playable_until_at: "2026-10-13T15:01:00" }, { gaps: null }, { available_intervals: undefined },
  ])("다른 계약과 타입 및 내부 경로를 거부한다: %j", (overrides) => {
    expect(() => recording(overrides)).toThrow("Unexpected daily recording contract.");
  });

  test("빈 날짜도 0초와 null 재생 시각으로 유지한다", () => {
    const empty = recording({ has_gaps: false, gaps: [], available_intervals: [], recorded_seconds: 0, playable_until_at: null, playback_state: "pending", playback_path: null });
    expect(empty.recordedSeconds).toBe(0);
    expect(dailyRecordingAvailability(empty, afterClosure).playbackReady).toBe(false);
    expect(dailyPlaybackTimestamp(empty, 0)).toBeNull();
  });

  test("뒤바뀐 구간과 재생 축 중복 및 알려진 누락과 겹치는 확보 구간을 거부한다", () => {
    expect(() => recording({ available_intervals: [...fixture.available_intervals].reverse() })).toThrow();
    expect(() => recording({ available_intervals: [{ ...fixture.available_intervals[0], playback_start_seconds: 1 }, fixture.available_intervals[1]] })).toThrow();
    expect(() => recording({ available_intervals: [fixture.available_intervals[0], { ...fixture.available_intervals[1], start_at: "2026-10-13T15:00:25.000Z" }] })).toThrow();
    expect(() => recording({ has_gaps: false })).toThrow();
    expect(() => recording({ recorded_seconds: 51 })).toThrow();
  });

  test("판정되지 않은 미래와 처리 중 구간을 누락으로 만들지 않는다", () => {
    const item = recording();
    const now = Date.parse("2026-10-13T15:01:10.000Z");
    expect(dailyTimeState(item, "2026-10-13T15:00:10.000Z", now)).toBe("available");
    expect(dailyTimeState(item, "2026-10-13T15:00:25.000Z", now)).toBe("gap");
    expect(dailyTimeState(item, "2026-10-13T15:01:05.000Z", now)).toBe("processing");
    expect(dailyTimeState(item, "2026-10-13T15:01:11.000Z", now)).toBe("future");
    expect(dailyTimeState(item, item.windowEndsAt, now)).toBe("outside");
    expect(() => recording({ gaps: [{ start_at: "2026-10-13T15:01:05.000Z", end_at: "2026-10-13T15:01:10.000Z", reason_code: "CAMERA_DISCONNECTED" }] })).toThrow();
  });

  test("cursor는 해석하거나 전체 페이지 수로 변환하지 않는다", () => {
    const cursor = "opaque+/cursor==";
    expect(dailyRecordingPage({ items: [fixture], next_cursor: cursor }, "camera-main").nextCursor).toBe(cursor);
    expect(dailyRecordingPage({ items: [], next_cursor: null }, "camera-main")).toEqual({ items: [], nextCursor: null });
    expect(() => dailyRecordingPage({ items: [], next_cursor: 1 }, "camera-main")).toThrow();
  });

  test("원인 없는 미분류 구간을 누락이나 인코딩 중으로 추정하지 않는다", () => {
    const item = recording({ gaps: [{ ...fixture.gaps[0], end_at: "2026-10-13T15:00:29.000Z" }] });
    expect(dailyTimeState(item, "2026-10-13T15:00:29.500Z", Date.parse("2026-10-13T15:01:10.000Z"))).toBe("unknown");
  });
});

describe("누락이 압축된 날짜 녹화의 재생 시각", () => {
  test("누락 이후 재생 위치를 자정 기준 경과 시간이 아닌 확보 구간으로 매핑한다", () => {
    const item = recording();
    expect(dailyPlaybackTimestamp(item, 19)).toBe("2026-10-13T15:00:19.000Z");
    expect(dailyPlaybackTimestamp(item, 20)).toBe("2026-10-13T15:00:30.000Z");
    expect(dailyPlaybackTimestamp(item, 25)).toBe("2026-10-13T15:00:35.000Z");
    expect(dailyPlaybackTimestamp(item, 50)).toBe("2026-10-13T15:01:00.000Z");
  });

  test("누락 구간 선택을 다음 영상으로 자동 이동하지 않는다", () => {
    const item = recording();
    expect(dailyPlaybackPosition(item, "2026-10-13T15:00:20.000Z")).toBeNull();
    expect(dailyPlaybackPosition(item, "2026-10-13T15:00:25.000Z")).toBeNull();
    expect(dailyPlaybackPosition(item, "2026-10-13T15:00:30.000Z")).toBe(20);
    expect(dailyPlaybackPosition(item, "2026-10-13T15:01:00.000Z")).toBe(50);
    expect(dailyPlaybackPosition(item, "2026-10-13T15:00:30")).toBeNull();
    expect(dailyPlaybackPosition(item, "invalid")).toBeNull();
  });

  test("원래 구간과 실제 영상 길이가 다르면 계약의 두 범위로 보간한다", () => {
    const item = recording({ recorded_seconds: 25, available_intervals: [
      { ...fixture.available_intervals[0], playback_end_seconds: 10 },
      { ...fixture.available_intervals[1], playback_start_seconds: 10, playback_end_seconds: 25 },
    ] });
    expect(dailyPlaybackTimestamp(item, 15)).toBe("2026-10-13T15:00:40.000Z");
    expect(dailyPlaybackPosition(item, "2026-10-13T15:00:40.000Z")).toBe(15);
  });

  test.each([-1, 50.001, Number.NaN, Number.POSITIVE_INFINITY])("재생 범위 밖 %s를 임의로 자르지 않는다", (seconds) => {
    expect(dailyPlaybackTimestamp(recording(), seconds)).toBeNull();
  });
});

describe("날짜 마감과 export 및 보관 만료의 분리", () => {
  test("마감은 다운로드 준비 완료가 아니며 202 처리 중에는 중복 준비를 막는다", () => {
    expect(dailyRecordingAvailability(closed(), afterClosure)).toMatchObject({ playbackReady: true, canPrepareExport: true, downloadReady: false, exportProcessing: false });
    expect(dailyRecordingAvailability(closed({ export_state: "processing" }), afterClosure)).toMatchObject({ playbackReady: true, canPrepareExport: false, downloadReady: false, exportProcessing: true });
    expect(dailyRecordingAvailability(recording({ status: "finalizing", export_allowed: true }), afterClosure).canPrepareExport).toBe(false);
  });

  test("과거 날짜도 서버가 준비를 허용한 경우에만 요청할 수 있다", () => {
    expect(dailyRecordingAvailability(closed({ export_allowed: false }), afterClosure).canPrepareExport).toBe(false);
    expect(dailyRecordingAvailability(closed(), Date.parse("2026-10-14T14:59:59.999Z")).canPrepareExport).toBe(false);
  });

  test("준비된 MP4의 캐시 만료는 원본 만료와 다르며 다시 준비할 수 있다", () => {
    const ready = closed({ export_state: "ready", download_path: `/api/v2/daily-recordings/${id}/content`, size_bytes: 1024, export_expires_at: "2026-10-15T16:00:00.000Z" });
    expect(dailyRecordingAvailability(ready, afterClosure)).toMatchObject({ downloadReady: true, canPrepareExport: false });
    expect(dailyRecordingAvailability(ready, Date.parse("2026-10-15T16:00:00.000Z"))).toMatchObject({ originalUnavailable: false, exportCacheExpired: true, playbackReady: true, downloadReady: false, canPrepareExport: true });
    expect(dailyRecordingAvailability(ready, Date.parse("2026-11-13T15:00:00.000Z"))).toMatchObject({ originalUnavailable: true, playbackReady: false, downloadReady: false, canPrepareExport: false });
  });

  test("export 실패는 부분 원본의 재생 가능 여부를 바꾸지 않는다", () => {
    const failed = closed({ export_state: "failed", error: { code: "EXPORT_FAILED", message: "Preparation failed." } });
    expect(failed).toMatchObject({ status: "closed", coverage: "partial", exportState: "failed", error: { code: "EXPORT_FAILED" } });
    expect(dailyRecordingAvailability(failed, afterClosure)).toMatchObject({ playbackReady: true, canPrepareExport: true, downloadReady: false });
  });

  test.each(["deleted", "expired"])("%s는 과거 export 상태와 시간 구간을 남겨도 사용할 수 없다", (status) => {
    const item = closed({ status, playback_state: "unavailable", playback_path: null, export_state: "ready", download_path: null, export_allowed: false });
    expect(item.exportState).toBe("ready");
    expect(dailyRecordingAvailability(item, afterClosure)).toMatchObject({ originalUnavailable: true, playbackReady: false, downloadReady: false, canPrepareExport: false });
    expect(dailyPlaybackTimestamp(item, 10)).toBeNull();
    expect(dailyPlaybackPosition(item, "2026-10-13T15:00:10.000Z")).toBeNull();
    expect(dailyTimeState(item, "2026-10-13T15:00:10.000Z", afterClosure)).toBe("unavailable");
  });
});
