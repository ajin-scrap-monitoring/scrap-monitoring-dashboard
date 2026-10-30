import type { ValidationIssue } from "../data/error-body";

export type SettingsArea = "threshold" | "policy";
export type SettingsFailure = { area: SettingsArea; message: string };

const fields: Record<string, { area: SettingsArea; label: string }> = {
  collectionThresholdPercent: { area: "threshold", label: "수거 임계율" },
  preCollectionAlert: { area: "threshold", label: "사전 알림 기준" },
  sendDelayMinutes: { area: "policy", label: "발송 시점" },
  repeatIntervalMinutes: { area: "policy", label: "반복 간격" },
  maximumRepeatCount: { area: "policy", label: "최대 반복 횟수" },
  recoveryNotificationEnabled: { area: "policy", label: "복구 알림" },
  eventTypes: { area: "policy", label: "알림 이벤트" },
};
const formMessage = "서버가 입력값을 받아들이지 않았습니다. 입력 범위와 임계율 조합을 확인하세요.";

function field(issue: ValidationIssue) {
  const name = issue.loc[0] === "body" ? issue.loc[1] : issue.loc[0];
  return typeof name === "string" ? fields[name] : undefined;
}

// 422 검증 배열은 loc가 가리키는 입력 영역에 연결하고, loc가 없는 의미 검증 오류는 저장을 요청한 영역의 폼 수준 오류로 표시한다.
export function settingsFailures(error: unknown, requestedArea: SettingsArea, fallback: string): SettingsFailure[] {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  if (status === 412 || status === 428) return [{ area: requestedArea, message: "다른 변경이 있습니다. 새로고침 후 다시 시도하세요." }];
  if (status !== 422) return [{ area: requestedArea, message: fallback }];
  const issues: ValidationIssue[] = error && typeof error === "object" && "issues" in error && Array.isArray(error.issues) ? error.issues as ValidationIssue[] : [];
  const results: SettingsFailure[] = [];
  let unmapped = issues.length === 0;
  for (const issue of issues) {
    const target = field(issue);
    if (!target) { unmapped = true; continue; }
    const message = `${target.label} 값을 서버가 받아들이지 않았습니다.`;
    if (!results.some((item) => item.area === target.area && item.message === message)) results.push({ area: target.area, message });
  }
  if (unmapped) results.push({ area: requestedArea, message: formMessage });
  return results;
}

export function recipientFailure(error: unknown, fallback: string) {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  return status === 412 || status === 428 ? "다른 변경이 있습니다. 새로고침 후 다시 시도하세요."
    : status === 422 ? formMessage : fallback;
}
