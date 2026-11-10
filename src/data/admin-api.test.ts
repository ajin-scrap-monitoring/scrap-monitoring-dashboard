import { describe, expect, test, vi } from "vitest";

import {
  getEmailDelivery,
  parseEmailDeliveryReceipt,
  sendTestNotification,
} from "./admin-api";

describe("admin-api: sendTestNotification 202 본문 emailDeliveryId 파싱", () => {
  const adminContext = (responseBody: unknown) => ({
    pitPath: (p: string) => p,
    request: vi.fn().mockResolvedValue(responseBody),
  });

  test("202 본문에 올바른 36자 emailDeliveryId가 있으면 해당 문자열을 반환한다", async () => {
    const validId = "550e8400-e29b-41d4-a716-446655440000";
    const context = adminContext({ emailDeliveryId: validId });
    const result = await sendTestNotification(context, "rec-1", ["email"]);
    expect(result).toBe(validId);
  });

  test("202 본문이 없거나 emailDeliveryId 키가 없으면 null을 반환한다", async () => {
    expect(await sendTestNotification(adminContext(undefined), "rec-1", ["email"])).toBeNull();
    expect(await sendTestNotification(adminContext({}), "rec-1", ["email"])).toBeNull();
    expect(await sendTestNotification(adminContext(null), "rec-1", ["email"])).toBeNull();
  });

  test("202 본문의 emailDeliveryId 형식이 잘못되었으면 null을 반환한다", async () => {
    const invalidIds = [
      "short-id",
      "550e8400-e29b-41d4-a716-446655440000-too-long",
      "550e8400_e29b_41d4_a716_446655440000",
      12345,
      true,
      {},
    ];
    for (const invalid of invalidIds) {
      const context = adminContext({ emailDeliveryId: invalid });
      expect(await sendTestNotification(context, "rec-1", ["email"])).toBeNull();
    }
  });
});

describe("admin-api: parseEmailDeliveryReceipt 검증", () => {
  const validReceipt = {
    id: "deliv-1",
    status: "QUEUED",
    attempts: 0,
    error_code: null,
    due_at: "2026-11-10T04:00:00Z",
    attempted_at: null,
    completed_at: null,
    phase: "TEST",
    pit_id: "pit-1",
    recipient_id: "rec-1",
  };

  test("정상 영수증을 파싱하여 도메인 모델로 반환한다", () => {
    const parsed = parseEmailDeliveryReceipt(validReceipt);
    expect(parsed).toEqual({
      id: "deliv-1",
      status: "QUEUED",
      attempts: 0,
      errorCode: null,
      dueAt: "2026-11-10T04:00:00Z",
      attemptedAt: null,
      completedAt: null,
      phase: "TEST",
      pitId: "pit-1",
      recipientId: "rec-1",
    });
  });

  test("status 6개 enum을 모두 허용하고 그 외는 계약 오류로 거부한다", () => {
    const validStatuses = ["QUEUED", "SENDING", "SENT", "FAILED", "UNCERTAIN", "CANCELLED"] as const;
    for (const status of validStatuses) {
      expect(parseEmailDeliveryReceipt({ ...validReceipt, status }).status).toBe(status);
    }
    expect(() => parseEmailDeliveryReceipt({ ...validReceipt, status: "INVALID" })).toThrow();
    expect(() => parseEmailDeliveryReceipt({ ...validReceipt, status: "queued" })).toThrow();
  });

  test("attempts 0 이상 정수 허용 및 음수/소수 거부", () => {
    expect(parseEmailDeliveryReceipt({ ...validReceipt, attempts: 5 }).attempts).toBe(5);
    expect(() => parseEmailDeliveryReceipt({ ...validReceipt, attempts: -1 })).toThrow();
    expect(() => parseEmailDeliveryReceipt({ ...validReceipt, attempts: 1.5 })).toThrow();
    expect(() => parseEmailDeliveryReceipt({ ...validReceipt, attempts: "1" })).toThrow();
  });

  test("error_code: string 또는 null 허용 및 다른 타입 거부", () => {
    expect(parseEmailDeliveryReceipt({ ...validReceipt, error_code: "GMAIL_RATE_LIMIT" }).errorCode).toBe("GMAIL_RATE_LIMIT");
    expect(parseEmailDeliveryReceipt({ ...validReceipt, error_code: null }).errorCode).toBeNull();
    expect(() => parseEmailDeliveryReceipt({ ...validReceipt, error_code: 123 })).toThrow();
    expect(() => parseEmailDeliveryReceipt({ ...validReceipt, error_code: false })).toThrow();
  });

  test("시각 필드(due_at, attempted_at, completed_at) UTC ISO 검증", () => {
    const validTimeZ = "2026-11-10T04:00:00Z";
    const validTimeOffset = "2026-11-10T04:00:00+00:00";
    const nonUtcTime = "2026-11-10T13:00:00+09:00";

    // due_at 검증 (필수)
    expect(parseEmailDeliveryReceipt({ ...validReceipt, due_at: validTimeOffset }).dueAt).toBe(validTimeOffset);
    expect(() => parseEmailDeliveryReceipt({ ...validReceipt, due_at: nonUtcTime })).toThrow();
    expect(() => parseEmailDeliveryReceipt({ ...validReceipt, due_at: null })).toThrow();

    // attempted_at 검증 (null 가능)
    expect(parseEmailDeliveryReceipt({ ...validReceipt, attempted_at: validTimeZ }).attemptedAt).toBe(validTimeZ);
    expect(() => parseEmailDeliveryReceipt({ ...validReceipt, attempted_at: nonUtcTime })).toThrow();

    // completed_at 검증 (null 가능)
    expect(parseEmailDeliveryReceipt({ ...validReceipt, completed_at: validTimeZ }).completedAt).toBe(validTimeZ);
    expect(() => parseEmailDeliveryReceipt({ ...validReceipt, completed_at: nonUtcTime })).toThrow();
  });

  test("phase 3개 enum 허용 및 그 외 거부", () => {
    for (const phase of ["ALERT", "RECOVERY", "TEST"]) {
      expect(parseEmailDeliveryReceipt({ ...validReceipt, phase }).phase).toBe(phase);
    }
    expect(() => parseEmailDeliveryReceipt({ ...validReceipt, phase: "UNKNOWN" })).toThrow();
  });

  test("getEmailDelivery는 경로를 호출하고 검증된 영수증을 반환한다", async () => {
    const context = {
      pitPath: (p: string) => p,
      request: vi.fn().mockResolvedValue(validReceipt),
    };
    const receipt = await getEmailDelivery(context, "deliv-1");
    expect(receipt.id).toBe("deliv-1");
    expect(context.request).toHaveBeenCalledWith(
      "/api/v1/notifications/email-deliveries/deliv-1",
      expect.objectContaining({}),
    );
  });
});
