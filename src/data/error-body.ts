import { record } from "./contract-values";

// Backend 오류 본문은 3형식이며 같은 경로가 둘 이상을 낼 수 있다.
// HTTPErrorResponse {detail: string}, 요청 검증 {detail: [{loc, msg, type}]}, MediaErrorResponse {error: {code, message}}.
export type ValidationIssue = { loc: ReadonlyArray<string | number>; message: string; type: string };

export type ParsedErrorBody = {
  code?: string;
  issues?: ValidationIssue[];
  message?: string;
};

const detailCode = /^[A-Z][A-Z0-9_]{2,99}$/;

function validationIssues(detail: unknown[]) {
  const issues: ValidationIssue[] = [];
  for (const item of detail) {
    if (!record(item) || !Array.isArray(item.loc) || !item.loc.every((part) => typeof part === "string" || typeof part === "number")) return undefined;
    issues.push({ loc: item.loc, message: typeof item.msg === "string" ? item.msg : "", type: typeof item.type === "string" ? item.type : "" });
  }
  return issues;
}

export function parseErrorBody(payload: unknown): ParsedErrorBody {
  if (!record(payload)) return {};
  const { detail, error } = payload;
  if (typeof detail === "string") {
    const code = typeof payload.code === "string" ? payload.code : detailCode.test(detail) ? detail : undefined;
    return { message: detail, ...(code !== undefined && { code }) };
  }
  if (Array.isArray(detail)) {
    const issues = validationIssues(detail);
    return issues ? { code: "REQUEST_VALIDATION_FAILED", issues } : {};
  }
  if (record(error)) {
    return {
      ...(typeof error.code === "string" && { code: error.code }),
      ...(typeof error.message === "string" && { message: error.message }),
    };
  }
  return {
    ...(typeof payload.code === "string" && { code: payload.code }),
    ...(typeof payload.title === "string" && { message: payload.title }),
  };
}
