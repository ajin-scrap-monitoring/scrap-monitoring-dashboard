import { describe, expect, test } from "vitest";

import { parseCameraStatusV2 } from "./camera-status-v2";

describe("CameraStatusV2 파서", () => {
  const validResponse = {
    pitId: "pit-01",
    cameraId: "cam-main",
    state: "HEALTHY",
    connectionState: "CONNECTED",
    statusBasis: "ACCEPTED_JPEG_RECEIPT",
    computedAt: "2026-11-01T09:00:00Z",
    assessedAt: "2026-11-01T08:59:59Z",
    validUntilAt: "2026-11-01T09:00:05Z",
    validForSeconds: 5.0,
    lastFrameReceivedAt: "2026-11-01T08:59:58Z",
    reasonCodes: [],
  };

  test("정상 응답을 올바르게 파싱한다", () => {
    const result = parseCameraStatusV2(validResponse, "pit-01");
    expect(result.pitId).toBe("pit-01");
    expect(result.cameraId).toBe("cam-main");
    expect(result.state).toBe("HEALTHY");
    expect(result.connectionState).toBe("CONNECTED");
    expect(result.statusBasis).toBe("ACCEPTED_JPEG_RECEIPT");
    expect(result.computedAt).toBe("2026-11-01T09:00:00Z");
    expect(result.assessedAt).toBe("2026-11-01T08:59:59Z");
    expect(result.validUntilAt).toBe("2026-11-01T09:00:05Z");
    expect(result.validForSeconds).toBe(5.0);
    expect(result.lastFrameReceivedAt).toBe("2026-11-01T08:59:58Z");
    expect(result.reasonCodes).toEqual([]);
  });

  test("INTERRUPTED, UNKNOWN, UNSUPPORTED 상태를 정상 파싱한다", () => {
    for (const state of ["INTERRUPTED", "UNKNOWN", "UNSUPPORTED"] as const) {
      const result = parseCameraStatusV2({ ...validResponse, state }, "pit-01");
      expect(result.state).toBe(state);
    }
  });

  test("pitId가 일치하지 않으면 계약 오류를 던진다", () => {
    expect(() => parseCameraStatusV2(validResponse, "pit-other")).toThrow(
      "Unexpected v2 camera-status contract.",
    );
  });

  test("잘못된 state enum이면 계약 오류를 던진다", () => {
    expect(() =>
      parseCameraStatusV2({ ...validResponse, state: "INVALID" }, "pit-01"),
    ).toThrow("Unexpected v2 camera-status contract.");
  });

  test("validForSeconds가 5초를 초과하거나 음수이면 계약 오류를 던진다", () => {
    expect(() =>
      parseCameraStatusV2({ ...validResponse, validForSeconds: 5.1 }, "pit-01"),
    ).toThrow("Unexpected v2 camera-status contract.");
    expect(() =>
      parseCameraStatusV2({ ...validResponse, validForSeconds: -0.1 }, "pit-01"),
    ).toThrow("Unexpected v2 camera-status contract.");
  });

  test("잘못된 statusBasis이면 계약 오류를 던진다", () => {
    expect(() =>
      parseCameraStatusV2(
        { ...validResponse, statusBasis: "UNKNOWN_BASIS" },
        "pit-01",
      ),
    ).toThrow("Unexpected v2 camera-status contract.");
  });

  test("reasonCodes가 배열이 아니면 계약 오류를 던진다", () => {
    expect(() =>
      parseCameraStatusV2(
        { ...validResponse, reasonCodes: "NOT_AN_ARRAY" },
        "pit-01",
      ),
    ).toThrow("Unexpected v2 camera-status contract.");
  });

  test("선택 필드가 null인 경우를 정상 처리한다", () => {
    const nullableResponse = {
      pitId: "pit-01",
      cameraId: null,
      state: "UNKNOWN",
      connectionState: "UNKNOWN",
      statusBasis: null,
      computedAt: "2026-11-01T09:00:00Z",
      assessedAt: null,
      validUntilAt: null,
      validForSeconds: null,
      lastFrameReceivedAt: null,
      reasonCodes: ["CAMERA_STATUS_UNAVAILABLE"],
    };
    const result = parseCameraStatusV2(nullableResponse, "pit-01");
    expect(result.cameraId).toBeNull();
    expect(result.assessedAt).toBeNull();
    expect(result.validForSeconds).toBeNull();
    expect(result.lastFrameReceivedAt).toBeNull();
    expect(result.reasonCodes).toEqual(["CAMERA_STATUS_UNAVAILABLE"]);
  });
});
