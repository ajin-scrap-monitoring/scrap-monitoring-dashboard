import { expect, test, vi } from "vitest";

import type { LoadHistorySample } from "../domain/dashboard";
import { monitoringV2StateFixture } from "../test/backend-contract-fixtures";
import { monitoringV2Data } from "./monitoring-v2";
import { updateLoadOneHourAgo } from "./load-one-hour-ago";

function sample(overrides: Partial<LoadHistorySample> = {}): LoadHistorySample {
  return { measuredAt: "2026-10-12T23:00:08Z", generatedAt: "2026-10-12T23:00:08Z",
    observedAt: "2026-10-12T23:00:08Z", bucketStartAt: "2026-10-12T23:00:00Z", bucketEndAt: "2026-10-12T23:01:00Z",
    assessmentId: "synthetic-past-load", time: "08:00", value: 68.5, dataState: "AVAILABLE", reasonCodes: [], ...overrides };
}

function monitoring() {
  const result = monitoringV2Data(monitoringV2StateFixture("FRESH", 72.5), "pit-01");
  result.loadHistoryState = { status: "ready", from: "2026-10-12T00:00:10Z", to: "2026-10-13T00:00:10Z" };
  result.loadHistory = [sample()];
  return result;
}

test("서버 시각 기준 1시간 전의 실제 관측값을 선택하며 현재 값에서 역산하지 않는다", () => {
  const data = monitoring();
  data.loadHistory[0].generatedAt = "2026-10-12T23:00:58Z";
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo).toEqual({ value: 68.5, observedAt: "2026-10-12T23:00:08Z", dataState: "AVAILABLE" });
  expect(data.summary.loadPercent).toBe(72.5);
  expect(data.alarmState).toBeNull();
  expect(data.loadHistory[0].value).toBe(68.5);
});

test.each([0, 100, 68.123456])("과거 값 %s는 0과 원본 정밀도를 보존한다", value => {
  const data = monitoring();
  data.loadHistory[0].value = value;
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo?.value).toBe(value);
});

test.each(["FRESH", "STALE", "UNAVAILABLE", "UNKNOWN", "NO_DATA"] as const)("현재 %s와 독립적으로 과거 관측을 표시한다", state => {
  const data = monitoring();
  data.v2 = monitoringV2Data(monitoringV2StateFixture(state), "pit-01").v2;
  data.summary.loadPercent = null;
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo?.value).toBe(68.5);
  expect(data.summary.loadPercent).toBeNull();
});

test.each<Partial<LoadHistorySample>>([
  { value: null }, { value: Number.NaN }, { value: Number.POSITIVE_INFINITY }, { value: -1 }, { value: 101 },
  { dataState: "UNAVAILABLE" }, { dataState: "STALE" }, { dataState: "UNKNOWN" }, { dataState: "NO_DATA" },
  { observedAt: null }, { observedAt: "2026-10-12T23:00:08" }, { observedAt: "invalid" },
  { generatedAt: null }, { generatedAt: "2026-10-13T00:00:11Z" },
  { observedAt: "2026-10-12T23:00:10.000001Z" }, { observedAt: "2026-10-12T22:59:09.999999Z" },
])("과거 표본이 없거나 유효하지 않으면 선택하지 않는다 %j", invalid => {
  const data = monitoring();
  data.loadHistory = [sample(invalid)];
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo).toBeNull();
});

test("기준 시각 이전 1분 경계까지 허용하고 미래 관측을 사용하지 않는다", () => {
  const data = monitoring();
  data.loadHistory = [sample({ observedAt: "2026-10-12T22:59:10Z" }), sample({ observedAt: "2026-10-12T23:00:11Z", value: 1 })];
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo).toMatchObject({ value: 68.5, observedAt: "2026-10-12T22:59:10Z" });
});

test("가장 가까운 관측이 무효이면 이전의 유효한 표본으로 대체하지 않는다", () => {
  const data = monitoring();
  data.loadHistory.push(sample({ observedAt: "2026-10-12T23:00:09Z", value: null, dataState: "UNAVAILABLE" }));
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo).toBeNull();
});

test("동일 관측 시각의 새 판단이 무효이면 이전 판단으로 복구하지 않는다", () => {
  const data = monitoring();
  data.loadHistory.unshift(sample({ generatedAt: "2026-10-12T23:00:10Z", value: null, dataState: "UNAVAILABLE" }));
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo).toBeNull();
});

test("LIMITED의 유효한 수치에는 제한 상태를 유지한다", () => {
  const data = monitoring();
  data.loadHistory[0].dataState = "LIMITED";
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo).toMatchObject({ value: 68.5, dataState: "LIMITED" });
});

test("UTC offset과 브라우저 시각은 관측 선택을 바꾸지 않는다", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const data = monitoring();
    data.loadHistory[0].observedAt = "2026-10-13T08:00:08+09:00";
    updateLoadOneHourAgo(data);
    expect(data.summary.loadOneHourAgo?.value).toBe(68.5);
  } finally { vi.useRealTimers(); }
});

test("현재 연결 오류는 과거 관측을 무효화하지 않지만 이력 조회 오류는 이전 값을 지운다", () => {
  const data = monitoring();
  data.v2!.streamState = "reconnecting";
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo?.value).toBe(68.5);
  data.loadHistoryState = { ...data.loadHistoryState, status: "error", stale: true };
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo).toBeNull();
});

test("이력 자동 갱신의 종료 시각으로 기준 시각을 진행하고 별도 현재 시각을 사용하지 않는다", () => {
  const data = monitoring();
  data.loadHistoryState!.to = "2026-10-13T00:01:10Z";
  data.loadHistory.push(sample({ observedAt: "2026-10-12T23:01:08Z", generatedAt: "2026-10-12T23:01:08Z", value: 70 }));
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo?.value).toBe(70);
});

test("새 snapshot의 시각이 이력 범위보다 앞서면 해당 관측이 조회될 때까지 정보 없음이다", () => {
  const data = monitoring();
  data.v2!.serverTime = "2026-10-13T00:02:10Z";
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo).toBeNull();
  data.v2!.serverTime = "2026-10-13T02:00:10Z";
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo).toBeNull();
});

test("조회 source의 표본이 비어 있으면 이전에 선택한 값을 유지하지 않는다", () => {
  const data = monitoring();
  updateLoadOneHourAgo(data);
  data.loadHistory = [];
  updateLoadOneHourAgo(data);
  expect(data.summary.loadOneHourAgo).toBeNull();
});
