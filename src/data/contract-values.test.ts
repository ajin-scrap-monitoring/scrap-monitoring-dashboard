import { expect, test } from "vitest";

import { nullableTimestamp, record, strings, timestamp } from "./contract-values";

test.each(["2026-10-15T03:00:00Z", "2026-10-15T12:00:00+09:00", "2026-10-15T12:00:00.123456+09:00", "2024-02-29T00:00:00Z"])("RFC3339 시각 %s를 허용한다", (value) => {
  expect(timestamp(value)).toBe(true);
});

test.each([null, undefined, 0, "", "2026-10-15", "2026-10-15T12:00:00", "2026-02-30T12:00:00Z", "2026-10-15T24:00:00Z", "2026-10-15T12:60:00Z", "2026-10-15T12:00:00+99:00", "2026-10-15T12:00:00+24:00", "2026-10-15T12:00:00-00:60"])("계약 밖 시각 %s를 거부한다", (value) => {
  expect(timestamp(value)).toBe(false);
});

test("nullable 허용은 명시적으로 구분한다", () => {
  expect(nullableTimestamp(null)).toBe(true);
  expect(nullableTimestamp(null, false)).toBe(false);
  expect(nullableTimestamp(undefined)).toBe(false);
  expect(nullableTimestamp("2026-10-15T03:00:00Z", false)).toBe(true);
});

test("object와 문자열 배열을 다른 JSON 값과 구분한다", () => {
  expect(record({})).toBe(true);
  expect(record([])).toBe(false);
  expect(record(null)).toBe(false);
  expect(strings([])).toBe(true);
  expect(strings(["A", "B"])).toBe(true);
  expect(strings(["A", 1])).toBe(false);
  expect(strings({})).toBe(false);
});
