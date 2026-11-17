import { expect, test } from "vitest";

import {
  componentKindLabel,
  deviceStatusTitle,
  evidenceSourceLabel,
  formatLoadPercent,
  formatMonitoringReasonDetails,
  formatMonitoringReasonSummary,
  translateMonitoringReason,
} from "./monitoring-presentation";

test("formatLoadPercent는 정수와 한 자리 소수를 둘째 자리까지 채우고 세 자리 이상 소수는 반올림하지 않는다", () => {
  expect(formatLoadPercent(88)).toBe("88.00");
  expect(formatLoadPercent(88.5)).toBe("88.50");
  expect(formatLoadPercent(88.12)).toBe("88.12");
  expect(formatLoadPercent(0)).toBe("0.00");
  expect(formatLoadPercent(-0)).toBe("0.00");
  expect(formatLoadPercent(100)).toBe("100.00");
  expect(formatLoadPercent(72.123456)).toBe("72.123456");
  expect(formatLoadPercent(99.999999)).toBe("99.999999");
  expect(formatLoadPercent(0.000001)).toBe("0.000001");
});

test("알려진 사유 코드는 한국어로 변환하고 미등록 코드는 원문을 보존한다", () => {
  expect(translateMonitoringReason("CAMERA_FRAME_STALE")).toBe("카메라 프레임 수신 지연");
  expect(translateMonitoringReason("OUTBOX_DATA_LOSS")).toBe("전송 대기 데이터 유실");
  expect(translateMonitoringReason("UNKNOWN_FUTURE_CODE")).toBe("UNKNOWN_FUTURE_CODE");

  expect(formatMonitoringReasonSummary([])).toBeNull();
  expect(formatMonitoringReasonSummary(["CLOCK_DEGRADED"])).toBe("장치 시각 동기화 저하");
  expect(formatMonitoringReasonSummary(["CAMERA_FRAME_STALE", "OUTBOX_DATA_LOSS"])).toBe("카메라 프레임 수신 지연 외 1건");

  expect(formatMonitoringReasonDetails(["CAMERA_FRAME_STALE", "CUSTOM_REASON"])).toEqual([
    "카메라 프레임 수신 지연 (CAMERA_FRAME_STALE)",
    "CUSTOM_REASON",
  ]);
});

test("deviceStatusTitle은 사유가 없으면 원시 상태 코드만 유지하고 사유가 있으면 함께 표시한다", () => {
  expect(deviceStatusTitle("DEGRADED", undefined)).toBe("DEGRADED");
  expect(deviceStatusTitle("DEGRADED", [])).toBe("DEGRADED");
  expect(deviceStatusTitle("DEGRADED", ["CAMERA_FRAME_STALE", "OUTBOX_DATA_LOSS"])).toBe(
    "DEGRADED\n사유: 카메라 프레임 수신 지연 (CAMERA_FRAME_STALE)\n사유: 전송 대기 데이터 유실 (OUTBOX_DATA_LOSS)",
  );
  expect(componentKindLabel("EDGE")).toBe("엣지 장비");
  expect(evidenceSourceLabel("EDGE_STATUS")).toBe("Edge 장치 상태 보고");
});
