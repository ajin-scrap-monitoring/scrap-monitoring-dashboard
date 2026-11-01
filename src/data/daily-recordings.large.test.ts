import { describe, expect, test } from "vitest";

import { largeDailyPage, largeDailyRecording } from "../test/large-daily-recordings";
import { createDailyRecordingApi } from "./daily-recording-api";
import { dailyRecordingPage } from "./daily-recordings";
import { rfc3339AtOffset, timestamp, timestampValue, wallClock } from "./contract-values";

const shift = (value: string, seconds: number) => new Date(Date.parse(value) + seconds * 1000).toISOString().replace(".000Z", "Z");
const failure = "Unexpected daily recording contract.";

// 출력 문자열의 53비트 해시(cyrb53)이다. 최적화 이전 구현의 출력과 같은 값을 고정한다.
function digest(text: string) {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return 4294967296 * (2097151 & second) + (first >>> 0);
}

function api(page: unknown) {
  return createDailyRecordingApi({
    ApiError: class extends Error { status = 0; } as never,
    cameraId: "camera-main",
    isAuthenticated: () => true,
    request: (() => Promise.resolve(page)) as never,
    serverNow: () => Date.parse("2026-10-17T00:00:00Z"),
  });
}

// 최적화 이전의 timestamp, timestampValue와 wallClock 구현이다.
function referenceTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  const date = value.slice(0, 10);
  const midnight = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(midnight) && new Date(midnight).toISOString().startsWith(date);
}
function referenceTimestampValue(value: string) {
  const fraction = value.match(/\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/i)?.[1];
  return fraction === undefined ? Date.parse(value)
    : Date.parse(value.replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/i, "")) + Number(`0.${fraction}`) * 1000;
}
function referenceWallClock(value: string | null, includeSeconds = false) {
  if (value === null) return "정보 없음";
  const instant = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : Number.NaN;
  const text = Number.isFinite(instant) ? rfc3339AtOffset(instant, "+09:00", true) : value;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return value;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}${includeSeconds ? `:${match[6] ?? "00"}` : ""}`;
}

const samples = [
  "2026-10-12T00:00:00Z", "2026-10-12T00:00:00z", "2026-10-12T23:59:59.999Z", "2026-10-12T09:00:00.1234567+09:00", "2026-10-12T09:00:00-05:30",
  "2026-10-12T24:00:00Z", "2026-10-12T00:60:00Z", "2026-10-12T00:00:60Z", "2026-10-12T00:00:00", "2026-10-12 00:00:00Z", "2026-10-12T00:00Z",
  "2026-02-29T00:00:00Z", "2024-02-29T00:00:00Z", "2100-02-29T00:00:00Z", "2000-02-29T12:00:00+09:00", "2026-04-31T00:00:00Z", "2026-13-01T00:00:00Z",
  "2026-00-10T00:00:00Z", "2026-10-00T00:00:00Z", "2026-10-32T00:00:00Z", "0000-01-01T00:00:00Z", "9999-12-31T23:59:59Z", "9999-12-31T23:59:59-23:59",
  "2026-10-12T00:00:00+24:00", "2026-10-12T00:00:00.Z", "2026-10-12T00:00:00.5", "2026.10.12", "", "garbage", "2026-10-12T00:00:00Z ",
];

describe("대용량 날짜 녹화 응답", () => {
  test("항목 5개, gaps 10,000개와 available_intervals 4,500개의 변환 결과가 최적화 이전과 같다", async () => {
    const page = largeDailyPage();
    expect(page.items.reduce((sum, item) => sum + item.gaps.length, 0)).toBe(10_000);
    expect(page.items.reduce((sum, item) => sum + item.available_intervals.length, 0)).toBe(4500);
    const recordings = await api(JSON.parse(JSON.stringify(page))).queryRecordings({ from: "2026-10-12", to: "2026-10-16" });
    const output = JSON.stringify(recordings);
    expect(recordings).toHaveLength(5);
    expect(recordings[0].gaps?.slice(0, 2)).toEqual([
      { start: "2026-10-12 00:00:20", end: "2026-10-12 00:00:30" },
      { start: "2026-10-12 00:00:40", end: "2026-10-12 00:00:50" },
    ]);
    expect(output.length).toBe(2_210_926);
    expect(digest(output)).toBe(1508558611163387);
  });

  test("timestamp, timestampValue와 wallClock은 최적화 이전 구현과 같은 값을 돌려준다", () => {
    const extra = [] as string[];
    for (let year = 1999; year <= 2101; year += 1) {
      for (const day of ["02-28", "02-29", "02-30", "04-30", "04-31", "12-31"]) extra.push(`${year}-${day}T08:30:15+09:00`);
    }
    for (const value of [...samples, ...extra]) {
      expect(timestamp(value), value).toBe(referenceTimestamp(value));
      for (const includeSeconds of [false, true]) expect(wallClock(value, includeSeconds), value).toBe(referenceWallClock(value, includeSeconds));
      if (referenceTimestamp(value)) expect(timestampValue(value), value).toBe(referenceTimestampValue(value));
    }
    for (const value of [null, undefined, 0, {}, []]) expect(timestamp(value)).toBe(false);
    expect(wallClock(null)).toBe("정보 없음");
  });

  test.each([
    ["겹치는 gap", (item: ReturnType<typeof largeDailyRecording>) => { item.gaps[1].start_at = shift(item.gaps[0].start_at, 5); }],
    ["역순 gap", (item: ReturnType<typeof largeDailyRecording>) => { [item.gaps[0], item.gaps[1]] = [item.gaps[1], item.gaps[0]]; }],
    ["gap 종료가 시작보다 이른 구간", (item: ReturnType<typeof largeDailyRecording>) => { item.gaps[5].end_at = shift(item.gaps[5].start_at, -5); }],
    ["확인 시각 이후의 gap", (item: ReturnType<typeof largeDailyRecording>) => { item.gaps.at(-1)!.end_at = "2026-10-12T14:59:59Z"; }],
    ["gap과 겹치는 확보 구간", (item: ReturnType<typeof largeDailyRecording>) => { item.available_intervals[3].start_at = item.gaps[10].start_at; item.available_intervals[3].end_at = item.gaps[10].end_at; }],
    ["끊긴 재생 위치", (item: ReturnType<typeof largeDailyRecording>) => { item.available_intervals[10].playback_start_seconds += 1; }],
    ["마지막 확보 구간과 다른 playable_until_at", (item: ReturnType<typeof largeDailyRecording>) => { item.playable_until_at = "2026-10-12T00:00:00Z"; }],
    ["존재하지 않는 달력 날짜", (item: ReturnType<typeof largeDailyRecording>) => { item.gaps[7].start_at = "2026-02-30T00:00:00Z"; }],
    ["형식이 잘못된 시각", (item: ReturnType<typeof largeDailyRecording>) => { item.available_intervals[7].end_at = "not-a-time"; }],
    ["has_gaps 불일치", (item: ReturnType<typeof largeDailyRecording>) => { (item as { has_gaps: boolean }).has_gaps = false; }],
  ])("잘못된 응답(%s)은 계속 거부한다", (_name, tamper) => {
    const valid = largeDailyPage(1, 40, 20);
    expect(() => dailyRecordingPage(valid, "camera-main")).not.toThrow();
    const broken = largeDailyPage(1, 40, 20);
    tamper(broken.items[0]);
    expect(() => dailyRecordingPage(broken, "camera-main")).toThrow(failure);
  });
});
