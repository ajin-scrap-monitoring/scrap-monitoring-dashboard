import { describe, expect, test } from "vitest";

import { eventRecordingFixture } from "../test/backend-contract-fixtures";
import { recordingStatus, recordingStatusReason } from "../recording-status";
import { eventRecordingItem, mapEventRecording } from "./event-recordings";

describe("이벤트 녹화의 표시 시각", () => {
  const item = eventRecordingItem(eventRecordingFixture({ windowFrom: "2026-10-12T00:59:30Z", windowTo: "2026-10-12T01:00:30Z" }));

  test("기본값은 한국 시각이다", () => {
    expect(mapEventRecording(item).start).toBe("2026-10-12 09:59:30");
  });

  test("지정한 offset의 시계로 변환한다", () => {
    expect(mapEventRecording(item, undefined, null, undefined, "Z")).toMatchObject({ start: "2026-10-12 00:59:30", end: "2026-10-12 01:00:30", date: "2026-10-12" });
    expect(mapEventRecording(item, undefined, null, undefined, "-05:00").start).toBe("2026-10-11 19:59:30");
  });
});

describe("목록의 재생 요약", () => {
  const withPlayback = (playback: unknown) => eventRecordingItem(eventRecordingFixture({ windowFrom: "2026-10-12T00:59:30Z", windowTo: "2026-10-12T01:00:30Z", playback }));

  test("playback이 없거나 null이면 요약을 만들지 않고 기존 구간 상태 동작을 유지한다", () => {
    for (const playback of [undefined, null]) {
      const recording = mapEventRecording(withPlayback(playback));
      expect(recording.playbackSummary).toBeUndefined();
      expect(recording).toMatchObject({ duration: "정보 없음", status: "processing", coverage: null });
      expect(recordingStatus(recording)).toBe("시점 이벤트");
    }
  });

  test.each([
    ["AVAILABLE", 60, "available", "재생 가능", "1:00", "complete"],
    ["PARTIAL", 25, "available", "일부 재생 가능", "0:25", "partial"],
    ["PROCESSING", null, "processing", "재생 준비 중", "정보 없음", null],
    ["UNAVAILABLE", 0, "unavailable", "영상 없음", "0:00", null],
    ["UNKNOWN", null, "processing", "확인 불가", "정보 없음", null],
  ] as const)("playback %s는 상태 %s와 길이를 목록 항목에 반영한다", (state, playbackSeconds, status, label, duration, coverage) => {
    const recording = mapEventRecording(withPlayback({ state, playbackSeconds, reasonCodes: ["R"] }));
    expect(recording.playbackSummary).toEqual({ state, playbackSeconds, reasonCodes: ["R"] });
    expect(recording).toMatchObject({ status, duration, coverage });
    expect(recordingStatus(recording)).toBe(label);
    expect(recording.contentUrl).toBeUndefined();
    expect(recording.replay).toBeUndefined();
  });

  test("UNKNOWN은 영상 없음으로 표시하지 않고 상태 안내에서 확인 불가를 설명한다", () => {
    const recording = mapEventRecording(withPlayback({ state: "UNKNOWN", playbackSeconds: null, reasonCodes: ["MEDIA_UNAVAILABLE"] }));
    expect(recordingStatus(recording)).not.toBe("영상 없음");
    expect(recordingStatusReason(recording)).toContain("확인하지 못했습니다");
  });

  test("상세 replay가 있으면 목록 요약보다 replay가 우선한다", () => {
    const item = withPlayback({ state: "UNAVAILABLE", playbackSeconds: 0, reasonCodes: [] });
    const recording = mapEventRecording(item, { state: "AVAILABLE", asOf: "2026-10-12T02:00:00Z", effectiveTo: "2026-10-12T01:00:30Z", requestedSeconds: 60, coveredSeconds: 60, playbackSeconds: 60, parts: [], unavailableIntervals: [], reasonCodes: [], downloadReasonCode: null });
    expect(recording.playbackSummary).toBeUndefined();
    expect(recordingStatus(recording)).toBe("재생 가능");
  });

  test.each([
    [{ state: "BROKEN", playbackSeconds: 1, reasonCodes: [] }],
    [{ state: "AVAILABLE", playbackSeconds: -1, reasonCodes: [] }],
    [{ state: "AVAILABLE", playbackSeconds: "60", reasonCodes: [] }],
    [{ state: "AVAILABLE", playbackSeconds: 1, reasonCodes: [1] }],
    ["AVAILABLE"],
  ])("잘못된 playback %j은 계약 오류로 처리한다", (playback) => {
    expect(() => withPlayback(playback)).toThrow("Unexpected event recording contract.");
  });
});
