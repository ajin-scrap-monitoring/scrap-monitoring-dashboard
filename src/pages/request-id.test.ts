import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateRequestId } from "./request-id";

describe("요청 ID 생성 (generateRequestId)", () => {
  const originalRandomUUID = crypto.randomUUID.bind(crypto);

  afterEach(() => {
    // 원래 randomUUID 복구
    Object.defineProperty(crypto, "randomUUID", {
      value: originalRandomUUID,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it("crypto.randomUUID가 있으면 해당 함수를 호출한다", () => {
    const mockUuid = "12345678-1234-4234-8234-123456789abc";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(mockUuid);
    expect(generateRequestId()).toBe(mockUuid);
  });

  describe("crypto.randomUUID가 없을 때 (HTTP 또는 비보안 컨텍스트)", () => {
    beforeEach(() => {
      Object.defineProperty(crypto, "randomUUID", {
        value: undefined,
        configurable: true,
        writable: true,
      });
    });

    it("RFC 4122 UUID v4 형식과 일치하는 36자 문자열을 반환한다", () => {
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      for (let i = 0; i < 50; i += 1) {
        const id = generateRequestId();
        expect(id).toMatch(uuidV4Regex);
      }
    });

    it("version 4와 variant 비트가 올바르게 설정된다", () => {
      const id = generateRequestId();
      const parts = id.split("-");
      expect(parts).toHaveLength(5);
      expect(parts[0]).toHaveLength(8);
      expect(parts[1]).toHaveLength(4);
      expect(parts[2]).toHaveLength(4);
      expect(parts[3]).toHaveLength(4);
      expect(parts[4]).toHaveLength(12);

      // version 4
      expect(parts[2][0]).toBe("4");
      // variant RFC 4122 (10xx in binary -> 8, 9, a, b in hex)
      expect(["8", "9", "a", "b"]).toContain(parts[3][0]);
    });

    it("호출마다 서로 다른 값을 생성한다", () => {
      const generated = new Set<string>();
      const iterations = 100;
      for (let i = 0; i < iterations; i += 1) {
        generated.add(generateRequestId());
      }
      expect(generated.size).toBe(iterations);
    });

    it("crypto.getRandomValues를 사용해 16바이트를 채운다", () => {
      const getRandomValuesSpy = vi.spyOn(crypto, "getRandomValues");
      generateRequestId();
      expect(getRandomValuesSpy).toHaveBeenCalled();
      const calledArg = getRandomValuesSpy.mock.calls[0][0];
      expect(calledArg).toBeInstanceOf(Uint8Array);
      expect((calledArg as Uint8Array).length).toBe(16);
    });
  });
});
