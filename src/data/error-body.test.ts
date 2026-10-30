import { describe, expect, test } from "vitest";

import { parseErrorBody } from "./error-body";

describe("Backend 오류 본문 3형식", () => {
  test("HTTPErrorResponse의 detail 문자열은 메시지로 쓰고 코드 형식이면 코드로도 쓴다", () => {
    expect(parseErrorBody({ detail: "Invalid or missing CSRF token" })).toEqual({ message: "Invalid or missing CSRF token" });
    expect(parseErrorBody({ detail: "HISTORY_QUERY_TIMEOUT" })).toEqual({ message: "HISTORY_QUERY_TIMEOUT", code: "HISTORY_QUERY_TIMEOUT" });
    expect(parseErrorBody({ code: "EXPLICIT_CODE", detail: "text" })).toEqual({ message: "text", code: "EXPLICIT_CODE" });
  });

  test("요청 검증의 detail 배열은 loc와 type을 보존하고 메시지를 detail로 쓰지 않는다", () => {
    const parsed = parseErrorBody({ detail: [{ loc: ["body", "preCollectionAlert", "thresholdPercent"], msg: "bad", type: "value_error", input: 1 }] });
    expect(parsed).toEqual({ code: "REQUEST_VALIDATION_FAILED", issues: [{ loc: ["body", "preCollectionAlert", "thresholdPercent"], message: "bad", type: "value_error" }] });
    expect(parsed.message).toBeUndefined();
  });

  test("MediaErrorResponse의 error 객체는 코드와 메시지를 사용한다", () => {
    expect(parseErrorBody({ error: { code: "MEDIA_UNAVAILABLE", message: "Media service request failed" } })).toEqual({ code: "MEDIA_UNAVAILABLE", message: "Media service request failed" });
  });

  test.each([[null], ["text"], [[]], [{}], [{ detail: [{ msg: "no loc" }] }], [{ detail: 3 }]])("알 수 없는 본문 %j는 빈 결과이다", (payload) => {
    expect(parseErrorBody(payload).issues).toBeUndefined();
    expect(parseErrorBody(payload).code).toBeUndefined();
  });
});
