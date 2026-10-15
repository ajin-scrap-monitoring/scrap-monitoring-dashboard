import { expect, test } from "vitest";

import { timeAxisTicks } from "./chart-time-axis";

test("분과 초가 있는 조회 구간의 눈금은 정각에 정렬하고 구간을 변경하지 않는다", () => {
  const from = Date.parse("2026-10-14T19:21:34.567Z");
  const to = Date.parse("2026-10-15T19:21:34.567Z");
  const ticks = timeAxisTicks(from, to, 3);
  expect(ticks).toHaveLength(8);
  expect(new Date(ticks[0]).toISOString()).toBe("2026-10-14T21:00:00.000Z");
  expect(new Date(ticks.at(-1)!).toISOString()).toBe("2026-10-15T18:00:00.000Z");
  expect(ticks.every(tick => tick >= from && tick <= to && tick % 3_600_000 === 0)).toBe(true);
});

test.each([540, 330, -210])("시간대 offset %s분의 현지 정각에 눈금을 배치한다", (offset) => {
  const from = Date.parse("2026-10-14T19:21:34.567Z");
  const to = from + 86_400_000;
  const ticks = timeAxisTicks(from, to, 3, offset);
  expect(ticks).toHaveLength(8);
  expect(ticks.every(tick => (tick + offset * 60_000) % (3 * 3_600_000) === 0 && tick >= from && tick <= to)).toBe(true);
});

test("정각과 일치하는 조회 경계는 눈금에 포함한다", () => {
  const from = Date.parse("2026-10-14T00:00:00Z");
  expect(timeAxisTicks(from, from + 86_400_000, 3)).toHaveLength(9);
});

test("최소 간격은 1시간이며 하루 간격은 자정에 정렬한다", () => {
  const from = Date.parse("2026-10-14T19:21:34Z");
  expect(timeAxisTicks(from, from + 2 * 3_600_000, 0.5).map(tick => new Date(tick).getUTCHours())).toEqual([20, 21]);
  expect(timeAxisTicks(from, from + 7 * 86_400_000, 24).every(tick => tick % 86_400_000 === 0)).toBe(true);
});

test.each([[Number.NaN, 1], [0, Number.NaN], [100, 0]])("유효한 조회 구간이 없으면 눈금을 만들지 않는다 %j", (from, to) => {
  expect(timeAxisTicks(from, to, 3)).toEqual([]);
});
