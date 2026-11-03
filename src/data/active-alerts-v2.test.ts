import { describe, expect, test } from "vitest";

import { activeAlertsFixture } from "../test/backend-contract-fixtures";
import { parseActiveAlertsV2 } from "./active-alerts-v2";

describe("parseActiveAlertsV2", () => {
  test("CAMERA 컴포넌트와 MEDIA_CAMERA_STATUS 항목을 허용하고 카메라 이름을 지정한다", () => {
    const raw = activeAlertsFixture({
      items: [{
        id: "alert-camera-1",
        type: "device_error",
        severity: "warning",
        title: "카메라 수신 이상",
        componentKind: "CAMERA",
        componentId: "camera-main",
        state: "INTERRUPTED",
        evaluatedAt: "2026-10-13T00:00:05Z",
        measuredAt: "2026-10-12T23:59:00Z",
        startedAt: null,
        startBasis: "UNKNOWN",
        evidenceSource: "MEDIA_CAMERA_STATUS",
        validUntilAt: "2026-10-13T00:00:10Z",
      }],
      coverage: [{
        componentKind: "CAMERA",
        componentId: "camera-main",
        state: "CHECKED",
        evaluatedAt: "2026-10-13T00:00:05Z",
        evidenceSource: "MEDIA_CAMERA_STATUS",
        validUntilAt: "2026-10-13T00:00:10Z",
        reasonCodes: [],
      }],
    });
    const parsed = parseActiveAlertsV2(raw, "pit-01");
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      id: "alert-camera-1",
      title: "카메라 수신 이상",
      detail: "카메라 INTERRUPTED",
      time: "2026-10-13T00:00:05Z",
      startedAt: null,
      validUntilAt: "2026-10-13T00:00:10Z",
      health: {
        componentKind: "CAMERA",
        componentName: "카메라",
        componentId: "camera-main",
        state: "INTERRUPTED",
        evidenceSource: "MEDIA_CAMERA_STATUS",
        validUntilAt: "2026-10-13T00:00:10Z",
      },
    });
    expect(parsed.coverage[0]).toMatchObject({
      componentKind: "CAMERA",
      componentName: "카메라",
      componentId: "camera-main",
      state: "CHECKED",
      evaluatedAt: "2026-10-13T00:00:05Z",
      evidenceSource: "MEDIA_CAMERA_STATUS",
      validUntilAt: "2026-10-13T00:00:10Z",
    });
  });

  test("coverage가 누락되었거나 null이면 계약 오류로 처리한다", () => {
    const missingCoverage = activeAlertsFixture({ coverage: undefined });
    expect(() => parseActiveAlertsV2(missingCoverage, "pit-01")).toThrow("Unexpected v2 active alert contract.");

    const nullCoverage = activeAlertsFixture({ coverage: null });
    expect(() => parseActiveAlertsV2(nullCoverage, "pit-01")).toThrow("Unexpected v2 active alert contract.");
  });

  test("basis가 누락되었거나 필수 필드가 없으면 계약 오류로 처리한다", () => {
    const missingBasis = activeAlertsFixture({ basis: undefined });
    expect(() => parseActiveAlertsV2(missingBasis, "pit-01")).toThrow("Unexpected v2 active alert contract.");

    const invalidBasis = activeAlertsFixture({ basis: { snapshotId: "snap-1" } });
    expect(() => parseActiveAlertsV2(invalidBasis, "pit-01")).toThrow("Unexpected v2 active alert contract.");
  });

  test("basis의 필수 필드를 모두 파싱하여 domain에 보존한다", () => {
    const raw = activeAlertsFixture({
      basis: {
        snapshotId: "snap-test-123",
        dataState: "FRESH",
        filterState: "WARMING",
        inputSource: "EDGE_STATE",
        measuredAt: "2026-10-13T00:00:05Z",
        lastEvaluatedAt: "2026-10-13T00:00:06Z",
        evaluationSource: "CURRENT_OBSERVATION",
        lastKnownState: "NORMAL",
        reasonCodes: ["NOTE_1"],
      },
    });
    const parsed = parseActiveAlertsV2(raw, "pit-01");
    expect(parsed.basis).toEqual({
      snapshotId: "snap-test-123",
      dataState: "FRESH",
      filterState: "WARMING",
      inputSource: "EDGE_STATE",
      measuredAt: "2026-10-13T00:00:05Z",
      lastEvaluatedAt: "2026-10-13T00:00:06Z",
      evaluationSource: "CURRENT_OBSERVATION",
      lastKnownState: "NORMAL",
      reasonCodes: ["NOTE_1"],
    });
  });
});
