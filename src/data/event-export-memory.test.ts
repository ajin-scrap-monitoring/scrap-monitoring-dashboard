import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  clearAllMemoryExports,
  clearStoredExport,
  getStoredExport,
  saveStoredExport,
} from "./event-export-memory";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";
const statusPathFor = (eventId: string, reqId: string) =>
  `/api/v2/recordings/events/${encodeURIComponent(eventId)}/exports/${reqId}`;

describe("이벤트 구간 다운로드 fallback 저장소", () => {
  beforeEach(() => {
    clearAllMemoryExports();
    localStorage.clear();
  });

  test("요청 정보를 저장하고 복구한다", () => {
    saveStoredExport("user-1", "evt-100", { requestId: validUuid, statusPath: statusPathFor("evt-100", validUuid) }, 30, 30, 1000);
    const restored = getStoredExport("user-1", "evt-100", 30, 30, 2000);
    expect(restored).toEqual({
      requestId: validUuid,
      statusPath: statusPathFor("evt-100", validUuid),
      savedAt: 1000,
    });
  });

  test("다른 사용자의 저장 정보는 읽지 않는다", () => {
    saveStoredExport("user-1", "evt-100", { requestId: validUuid, statusPath: statusPathFor("evt-100", validUuid) });
    expect(getStoredExport("user-2", "evt-100")).toBeNull();
  });

  test("7일이 지난 기록은 읽을 때 삭제하고 null을 반환한다", () => {
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    saveStoredExport("user-1", "evt-old", { requestId: validUuid, statusPath: statusPathFor("evt-old", validUuid) }, 30, 30, 1000);
    const result = getStoredExport("user-1", "evt-old", 30, 30, 1000 + SEVEN_DAYS + 1);
    expect(result).toBeNull();
    expect(localStorage.getItem("scrap-dashboard:event-export:v1:user-1:evt-old:30:30")).toBeNull();
  });

  test("requestId가 UUID 형식이 아니면 저장값을 지우고 null을 반환한다", () => {
    saveStoredExport("user-1", "evt-invalid-uuid", { requestId: "not-a-uuid", statusPath: statusPathFor("evt-invalid-uuid", "not-a-uuid") });
    expect(getStoredExport("user-1", "evt-invalid-uuid")).toBeNull();
    expect(localStorage.getItem("scrap-dashboard:event-export:v1:user-1:evt-invalid-uuid:30:30")).toBeNull();
  });

  test("statusPath가 일치하지 않으면 저장값을 지우고 null을 반환한다", () => {
    saveStoredExport("user-1", "evt-mismatch-path", { requestId: validUuid, statusPath: "/api/v2/recordings/events/other-id/exports/" + validUuid });
    expect(getStoredExport("user-1", "evt-mismatch-path")).toBeNull();
    expect(localStorage.getItem("scrap-dashboard:event-export:v1:user-1:evt-mismatch-path:30:30")).toBeNull();
  });

  test("clearStoredExport 호출 시 메모리와 localStorage에서 삭제한다", () => {
    saveStoredExport("user-1", "evt-200", { requestId: validUuid, statusPath: statusPathFor("evt-200", validUuid) });
    clearStoredExport("user-1", "evt-200");
    expect(getStoredExport("user-1", "evt-200")).toBeNull();
  });

  test("localStorage 접근 실패 시에도 메모리 캐시로 동작한다", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });

    saveStoredExport("user-1", "evt-300", { requestId: validUuid, statusPath: statusPathFor("evt-300", validUuid) });
    const restored = getStoredExport("user-1", "evt-300");
    expect(restored?.requestId).toBe(validUuid);
    expect(restored?.statusPath).toBe(statusPathFor("evt-300", validUuid));
  });
});
