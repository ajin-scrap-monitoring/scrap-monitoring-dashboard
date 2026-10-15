import assert from "node:assert/strict";
import { test } from "node:test";

import { redact, summarizeReport, summarizeServices } from "./integration-artifacts.ts";

await test("artifact은 실행 결과만 추출하고 request, Cookie 및 오류 원문을 제외한다", () => {
  const token = "synthetic-session-secret-abcdef0123456789";
  const report = { config: { password: token }, suites: [{ specs: [{ title: "session case", file: "integration/services.spec.ts", tests: [{ results: [{ status: "failed", duration: 20, error: { message: `Cookie: scrap_session=${token}` }, stdout: [token], attachments: [{ path: "trace.zip" }] }] }] }] }] };
  const result = summarizeReport(report, [token]);
  assert.deepEqual(result, [{ file: "integration/services.spec.ts", title: "session case", status: "failed", duration: 20 }]);
  assert.ok(!JSON.stringify(result).includes(token));
});

await test("공개 요약에 들어가는 문자열의 비밀번호와 session 및 CSRF 값을 정제한다", () => {
  const value = "password=example-password scrap_session=abcdef csrfToken=abc123 standalone-012345678901234567890123456789";
  const result = redact(value, ["example-password"]);
  for (const secret of ["example-password", "abcdef", "abc123", "standalone-012345678901234567890123456789"]) assert.ok(!result.includes(secret));
});

await test("실패 위치는 양의 정수 행 번호만 공개하고 오류 경로와 원문은 제외한다", () => {
  for (const line of [301, -1, 1.5, Number.POSITIVE_INFINITY, "password=secret"]) {
    const report = { suites: [{ specs: [{ title: "media case", file: "integration/services.spec.ts", tests: [{ results: [{
      status: "failed", duration: 10, errors: [{ message: "password=secret", location: { file: "/private/secret", line, column: 3 } }],
    }] }] }] }] };
    assert.deepEqual(summarizeReport(report), [{ file: "integration/services.spec.ts", title: "media case", status: "failed", duration: 10,
      ...(line === 301 ? { failureLine: 301 } : {}) }]);
  }
});

await test("service 상태는 환경변수, 주소, label과 healthcheck 원문을 포함하지 않는다", () => {
  assert.deepEqual(summarizeServices([{ Service: "backend", State: "running", Health: "healthy", ExitCode: 0, Labels: "password=secret", Environment: "token", Status: "secret" }]),
    [{ service: "backend", state: "running", health: "healthy", exitCode: 0 }]);
});
