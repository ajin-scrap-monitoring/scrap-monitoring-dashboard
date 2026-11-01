import { describe, expect, it } from "vitest";
import {
  EVENT_EXPORT_ERROR_MESSAGES,
  eventExportErrorCodeMessage,
  parseExportError,
} from "./event-export-error";

describe("구간 파일 준비 오류 안내 (parseExportError)", () => {
  describe("오류 code별 문구 우선 적용", () => {
    const minTargets: Record<string, string> = {
      RECORDING_NOT_FOUND_IN_RANGE: "이 구간에 녹화 영상이 없습니다.",
      INSUFFICIENT_STORAGE: "서버 저장 공간이 부족합니다.",
      RECORDING_STORAGE_ERROR: "저장소 오류로 영상에 접근할 수 없습니다.",
      CLIP_PREPARATION_FAILED: "구간 파일 준비에 실패했습니다.",
      RECORDING_BOUNDARY_UNAVAILABLE: "녹화 경계 시점을 자를 수 없습니다.",
      EXPORT_INCOMPATIBLE_MEDIA: "영상 형식이 달라 구간을 병합할 수 없습니다.",
      EVENT_EXPORT_NOT_FOUND: "구간 파일 요청을 찾을 수 없습니다.",
      EVENT_WINDOW_IN_FUTURE: "구간이 미래 시점이라 준비할 수 없습니다.",
      MEDIA_UNAVAILABLE: "미디어 서비스에 연결할 수 없습니다.",
      MEDIA_TIMEOUT: "미디어 서비스 응답 시간이 초과되었습니다.",
    };

    for (const [code, expectedMessage] of Object.entries(minTargets)) {
      it(`code ${code}에 맞는 사용자 안내 문구를 반환한다`, () => {
        const parsed = parseExportError({ status: 404, code });
        expect(parsed.code).toBe(code);
        expect(parsed.message).toBe(expectedMessage);
      });
    }

    it("HTTP status와 관계없이 오류 code를 우선한다", () => {
      const parsed404 = parseExportError({ status: 404, code: "RECORDING_NOT_FOUND_IN_RANGE" });
      expect(parsed404.message).toBe("이 구간에 녹화 영상이 없습니다.");

      const parsed500 = parseExportError({ status: 500, code: "INSUFFICIENT_STORAGE" });
      expect(parsed500.message).toBe("서버 저장 공간이 부족합니다.");

      const parsed409 = parseExportError({ status: 409, code: "EVENT_WINDOW_NOT_CLOSED" });
      expect(parsed409.message).toBe("수거가 끝난 뒤 준비할 수 있습니다.");

      const parsed422 = parseExportError({ status: 422, code: "EVENT_EXPORT_RANGE_TOO_LONG" });
      expect(parsed422.message).toBe("구간이 1시간을 넘어 준비할 수 없습니다.");
    });

    it("message 문자열에 알려진 코드가 포함된 경우도 인식한다", () => {
      const parsed = parseExportError({ status: 409, message: "Error: EVENT_EXPORT_REQUEST_CONFLICT occurred" });
      expect(parsed.code).toBe("EVENT_EXPORT_REQUEST_CONFLICT");
      expect(parsed.message).toBe("이전 요청과 충돌이 발생했습니다.");
    });
  });

  describe("모르는 오류 code인 경우", () => {
    it("status별 문구를 사용하고 title용 code를 보존한다", () => {
      const parsed404 = parseExportError({ status: 404, code: "UNKNOWN_SPECIAL_CODE" });
      expect(parsed404.code).toBe("UNKNOWN_SPECIAL_CODE");
      expect(parsed404.message).toBe("대상을 찾을 수 없습니다.");

      const parsed409 = parseExportError({ status: 409, code: "CUSTOM_CONFLICT" });
      expect(parsed409.code).toBe("CUSTOM_CONFLICT");
      expect(parsed409.message).toBe("요청 처리 중 충돌이 발생했습니다.");

      const parsed500 = parseExportError({ status: 500, code: "NEW_SERVER_CODE" });
      expect(parsed500.code).toBe("NEW_SERVER_CODE");
      expect(parsed500.message).toBe("구간 파일 준비에 실패했습니다.");

      const parsedCapacity = parseExportError({ status: 409, code: "EXPORT_CAPACITY_EXCEEDED" });
      expect(parsedCapacity.code).toBe("EXPORT_CAPACITY_EXCEEDED");
      expect(parsedCapacity.message).toBe("요청 처리 중 충돌이 발생했습니다.");
    });
  });

  describe("status만 있는 경우", () => {
    it("status별 기본 문구를 반환하고 code는 undefined다", () => {
      expect(parseExportError({ status: 401 })).toEqual({ status: 401, code: undefined, message: "로그인이 만료되었습니다." });
      expect(parseExportError({ status: 403 })).toEqual({ status: 403, code: undefined, message: "권한 또는 보안 토큰 오류입니다." });
      expect(parseExportError({ status: 404 })).toEqual({ status: 404, code: undefined, message: "대상을 찾을 수 없습니다." });
      expect(parseExportError({ status: 409 })).toEqual({ status: 409, code: undefined, message: "요청 처리 중 충돌이 발생했습니다." });
      expect(parseExportError({ status: 422 })).toEqual({ status: 422, code: undefined, message: "입력 오류가 발생했습니다." });
      expect(parseExportError({ status: 503 })).toEqual({ status: 503, code: undefined, message: "미디어 접속 또는 저장소 문제입니다." });
      expect(parseExportError({ status: 504 })).toEqual({ status: 504, code: undefined, message: "시간 초과가 발생했습니다." });
      expect(parseExportError({ status: 500 })).toEqual({ status: 500, code: undefined, message: "구간 파일 준비에 실패했습니다." });
    });

    it("객체가 아니거나 빈 값인 경우 기본 문구를 반환한다", () => {
      expect(parseExportError(null)).toEqual({ status: 0, code: undefined, message: "구간 파일 준비에 실패했습니다." });
      expect(parseExportError(undefined)).toEqual({ status: 0, code: undefined, message: "구간 파일 준비에 실패했습니다." });
    });
  });

  describe("상태 조회 응답용 eventExportErrorCodeMessage", () => {
    it("알려진 오류 코드에 대해 매핑된 문구를 반환한다", () => {
      expect(eventExportErrorCodeMessage("RECORDING_NOT_FOUND_IN_RANGE")).toBe("이 구간에 녹화 영상이 없습니다.");
      expect(eventExportErrorCodeMessage("INSUFFICIENT_STORAGE")).toBe("서버 저장 공간이 부족합니다.");
      expect(eventExportErrorCodeMessage("CLIP_PREPARATION_FAILED")).toBe("구간 파일 준비에 실패했습니다.");
      expect(eventExportErrorCodeMessage("EXPORT_CAPACITY_EXCEEDED")).toBeUndefined();
    });

    it("정의되지 않은 코드나 빈 값은 undefined를 반환한다", () => {
      expect(eventExportErrorCodeMessage("UNKNOWN_CODE")).toBeUndefined();
      expect(eventExportErrorCodeMessage(undefined)).toBeUndefined();
    });

    it("문구표의 모든 항목이 마침표로 끝나는 완결 문장이다", () => {
      for (const [code, msg] of Object.entries(EVENT_EXPORT_ERROR_MESSAGES)) {
        expect(msg.endsWith("."), `Code ${code} message should end with a period`).toBe(true);
      }
    });
  });
});
