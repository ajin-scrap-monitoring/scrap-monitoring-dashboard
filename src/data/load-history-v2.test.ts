import { describe, expect, test } from "vitest";

import { parseLoadHistoryV2 } from "./load-history-v2";

const scope = { pitId: "pit-example", siteId: "site-example", edgeId: "edge-example" };

function fixture() {
  const from = "2026-10-14T15:00:20Z";
  const to = "2026-10-14T15:03:10Z";
  return {
    schemaVersion: "2",
    pitId: scope.pitId,
    source: { pit_id: scope.pitId, site_id: scope.siteId, edge_id: scope.edgeId },
    from,
    to,
    bucketSeconds: 60,
    selectionPolicy: "LATEST_STATE_PER_BUCKET",
    samples: [0, 1, 2, 3].map((index) => ({
      bucketStartAt: index === 0 ? from : `2026-10-14T15:0${index}:00Z`,
      bucketEndAt: index === 3 ? to : `2026-10-14T15:0${index + 1}:00Z`,
      generatedAt: index === 3 ? null : `2026-10-14T15:0${index}:40Z`,
      observedAt: index === 3 ? null : `2026-10-14T15:0${index}:39Z`,
      assessmentId: index === 3 ? null : `assessment-${index}`,
      valuePercent: index === 1 || index === 3 ? null : index === 0 ? 0 : 68.5,
      valid: index !== 1 && index !== 3,
      dataState: index === 1 ? "UNAVAILABLE" : index === 2 ? "LIMITED" : index === 3 ? "NO_DATA" : "AVAILABLE",
      reasonCodes: index === 1 ? ["INPUT_UNAVAILABLE"] : index === 2 ? ["INPUT_LIMITED"] : [],
    })),
  };
}

test("v2 history는 실제 0과 LIMITED를 보존하고 결측은 null로 유지한다", () => {
  const result = parseLoadHistoryV2(fixture(), scope);
  expect(result.monitoringSamples.map((sample) => sample.value)).toEqual([0, null, 68.5, null]);
  expect(result.historySamples.map((sample) => sample.value)).toEqual([0, null, 68.5, null]);
  expect(result.monitoringSamples[2]).toMatchObject({ dataState: "LIMITED", reasonCodes: ["INPUT_LIMITED"], observedAt: "2026-10-14T15:02:39Z" });
  expect(result.monitoringSamples[0]).toMatchObject({ measuredAt: "2026-10-14T15:00:40Z", time: "00:00", bucketStartAt: "2026-10-14T15:00:20Z" });
  expect(result.historySamples[0].hour).toBeCloseTo(20 / 3600);
  expect(result.monitoringSamples.at(-1)).toMatchObject({ bucketEndAt: "2026-10-14T15:03:10Z", value: null });
});

test("compact 분 이력은 시각과 ID가 null인 유효한 표본을 bucket 위치로 보존한다", () => {
  const response = fixture();
  Object.assign(response.samples[2], {
    generatedAt: null, observedAt: null, assessmentId: null, valuePolicy: "MEDIAN_MINUTE", inputSource: "HEIGHT_SECTIONS",
    simulated: true, reasonCodes: ["COMPACT_SUBMINUTE_METADATA_NOT_RETAINED"],
  });
  const sample = parseLoadHistoryV2(response, scope).monitoringSamples[2];
  expect(sample).toMatchObject({ value: 68.5, measuredAt: "2026-10-14T15:02:00Z", generatedAt: null, observedAt: null,
    valuePolicy: "MEDIAN_MINUTE", inputSource: "HEIGHT_SECTIONS", simulated: true });
  Object.assign(response.samples[2], { inputSource: "UNKNOWN_SOURCE" });
  expect(() => parseLoadHistoryV2(response, scope)).toThrow();
});

test("valid=false 표본의 수치는 유효한 값으로 복원하지 않는다", () => {
  const response = fixture();
  response.samples[1].valuePercent = 90;
  expect(parseLoadHistoryV2(response, scope).monitoringSamples[1].value).toBeNull();
  response.samples[0].valuePercent = null;
  expect(parseLoadHistoryV2(response, scope).monitoringSamples[0].value).toBeNull();
});

describe("v2 history source 및 schema 검증", () => {
  test.each([
    ["schemaVersion", (value: ReturnType<typeof fixture>) => { value.schemaVersion = "1"; }],
    ["pit", (value: ReturnType<typeof fixture>) => { value.pitId = "another-pit"; }],
    ["source pit", (value: ReturnType<typeof fixture>) => { value.source.pit_id = "another-pit"; }],
    ["site", (value: ReturnType<typeof fixture>) => { value.source.site_id = "another-site"; }],
    ["edge", (value: ReturnType<typeof fixture>) => { value.source.edge_id = "another-edge"; }],
    ["selectionPolicy", (value: ReturnType<typeof fixture>) => { value.selectionPolicy = "AVERAGE"; }],
    ["bucketSeconds", (value: ReturnType<typeof fixture>) => { value.bucketSeconds = 120; }],
    ["timezone", (value: ReturnType<typeof fixture>) => { value.from = "2026-10-14T15:00:20"; }],
    ["calendar date", (value: ReturnType<typeof fixture>) => { value.samples[0].observedAt = "2026-02-30T15:00:20Z"; }],
    ["dataState", (value: ReturnType<typeof fixture>) => { value.samples[0].dataState = "FRESH"; }],
    ["percent", (value: ReturnType<typeof fixture>) => { value.samples[0].valuePercent = 101; }],
    ["number", (value: ReturnType<typeof fixture>) => { value.samples[0].valuePercent = Number.NaN; }],
    ["valid state", (value: ReturnType<typeof fixture>) => { value.samples[0].dataState = "STALE"; }],
    ["generatedAt", (value: ReturnType<typeof fixture>) => { value.samples[0].generatedAt = "2026-10-14T15:01:00Z"; }],
    ["bucket gap", (value: ReturnType<typeof fixture>) => { value.samples.splice(1, 1); }],
    ["bucket overlap", (value: ReturnType<typeof fixture>) => { value.samples[1].bucketStartAt = "2026-10-14T15:00:59Z"; }],
    ["reverse bucket", (value: ReturnType<typeof fixture>) => { value.samples.reverse(); }],
    ["range", (value: ReturnType<typeof fixture>) => { value.to = value.from; }],
    ["90 day maximum", (value: ReturnType<typeof fixture>) => { value.to = "2027-01-12T15:00:21Z"; }],
    ["1441 maximum", (value: ReturnType<typeof fixture>) => { value.samples = Array.from({ length: 1442 }, () => value.samples[0]); }],
  ])("%s 위반 응답은 표시하지 않는다", (_name, mutate) => {
    const response = fixture();
    mutate(response);
    expect(() => parseLoadHistoryV2(response, scope)).toThrow("Unexpected v2 load history");
  });
});

test("다른 UTC offset과 microsecond 부분 구간을 보존한다", () => {
  const response = fixture();
  response.from = "2026-10-15T00:00:20.000123+09:00";
  response.samples[0].bucketStartAt = response.from;
  response.samples[0].generatedAt = "2026-10-15T00:00:40.000456+09:00";
  response.to = "2026-10-15T00:03:10.000321+09:00";
  response.samples[3].bucketEndAt = response.to;
  const result = parseLoadHistoryV2(response, scope);
  expect(result.from).toBe(response.from);
  expect(result.historySamples[0].hour).toBeCloseTo(20.000333 / 3600, 8);
});

test("현재 상태 없이 과거의 유효한 판정을 독립적으로 표시한다", () => {
  expect(parseLoadHistoryV2(fixture(), scope).historySamples[0].value).toBe(0);
});

test("최대 1441개 bucket과 정확히 90일까지의 조회 범위와 긴 집계 간격을 허용한다", () => {
  const response = fixture();
  const from = Date.parse("2026-10-14T15:00:20Z");
  for (const [duration, bucketSeconds, expectedCount] of [[24 * 3_600_000, 60, 1441], [7 * 24 * 3_600_000, 900, 673], [30 * 24 * 3_600_000, 3600, 721], [90 * 24 * 3_600_000, 7200, 1081], [90 * 24 * 3_600_000, 21600, 361], [90 * 24 * 3_600_000, 86400, 91]]) {
    response.from = new Date(from).toISOString();
    response.to = new Date(from + duration).toISOString();
    response.bucketSeconds = bucketSeconds;
    const interval = bucketSeconds * 1000;
    const first = Math.floor(from / interval) * interval;
    response.samples = Array.from({ length: expectedCount }, (_, index) => ({
      bucketStartAt: new Date(Math.max(from, first + index * interval)).toISOString(),
      bucketEndAt: new Date(Math.min(from + duration, first + (index + 1) * interval)).toISOString(),
      generatedAt: null,
      observedAt: null,
      assessmentId: null,
      valuePercent: null,
      valid: false,
      dataState: "NO_DATA",
      reasonCodes: ["STATE_NOT_RECEIVED"],
    }));
    expect(parseLoadHistoryV2(response, scope).monitoringSamples).toHaveLength(expectedCount);
  }
});
