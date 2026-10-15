import { expect, test } from "vitest";

import { parseClipCoverage } from "./recording-coverage";

const recordingId = "550e8400-e29b-41d4-a716-446655440000";
const fixture = () => ({
  clip_id: recordingId, camera_id: "camera-demo",
  requested_start_at: "2026-10-14T00:00:00Z", requested_end_at: "2026-10-14T00:00:30Z",
  actual_start_at: "2026-10-14T00:00:05Z", actual_end_at: "2026-10-14T00:00:25Z",
  coverage: "partial", gaps: [{ start_at: "2026-10-14T00:00:00Z", end_at: "2026-10-14T00:00:05Z" }], error: null,
});

test("요청 구간과 확보 구간을 구분하고 누락 원인을 만들지 않는다", () => {
  const result = parseClipCoverage(fixture(), recordingId, "camera-demo");
  expect(result.requestedStart).not.toBe(result.actualStart);
  expect(result.gaps).toEqual([{ start: "2026-10-14T00:00:00Z", end: "2026-10-14T00:00:05Z" }]);
  expect(result.errorCode).toBeNull();
});

test.each([
  { clip_id: "550e8400-e29b-41d4-a716-446655440001" }, { camera_id: "other-camera" },
  { actual_start_at: "invalid" }, { requested_start_at: "2026-10-14T00:00:00" },
  { actual_start_at: "2026-10-14T00:01:00Z" }, { coverage: "unsupported" },
  { gaps: [{ start_at: "2026-10-14T00:00:05Z", end_at: "2026-10-14T00:00:00Z" }] }, { error: {} },
])("식별자와 시각 및 응답 계약 위반을 거부한다 %j", patch => {
  expect(() => parseClipCoverage({ ...fixture(), ...patch }, recordingId, "camera-demo")).toThrow();
});

test("미확정 확보 구간과 coverage는 null로 유지한다", () => {
  const result = parseClipCoverage({ ...fixture(), actual_start_at: null, actual_end_at: null, coverage: null, gaps: [] }, recordingId, "camera-demo");
  expect(result.actualStart).toBeNull();
  expect(result.actualEnd).toBeNull();
  expect(result.coverage).toBeNull();
});

test("밀리초보다 짧은 유효 구간을 보존한다", () => {
  const start = "2026-10-14T00:00:00.000001Z";
  const end = "2026-10-14T00:00:00.000002Z";
  const result = parseClipCoverage({ ...fixture(), requested_start_at: start, requested_end_at: end,
    actual_start_at: start, actual_end_at: end, gaps: [{ start_at: start, end_at: end }] }, recordingId, "camera-demo");
  expect(result.requestedStart).toBe(start);
  expect(result.gaps).toEqual([{ start, end }]);
});

test("같은 밀리초 안에서도 역순 확보 구간을 거부한다", () => {
  expect(() => parseClipCoverage({ ...fixture(), actual_start_at: "2026-10-14T00:00:00.000002Z",
    actual_end_at: "2026-10-14T00:00:00.000001Z" }, recordingId, "camera-demo")).toThrow();
});
