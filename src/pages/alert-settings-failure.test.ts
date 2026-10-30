import { expect, test } from "vitest";

import { recipientFailure, settingsFailures } from "./alert-settings-failure";

const issue = (...loc: string[]) => ({ loc, message: "bad", type: "value_error" });
const unprocessable = (...issues: ReturnType<typeof issue>[]) => ({ status: 422, issues });

test("422 검증 배열은 loc가 가리키는 입력 영역으로 나눈다", () => {
  expect(settingsFailures(unprocessable(issue("body", "collectionThresholdPercent"), issue("body", "sendDelayMinutes")), "threshold", "실패")).toEqual([
    { area: "threshold", message: "수거 임계율 값을 서버가 받아들이지 않았습니다." },
    { area: "policy", message: "발송 시점 값을 서버가 받아들이지 않았습니다." },
  ]);
  expect(settingsFailures(unprocessable(issue("body", "preCollectionAlert", "thresholdPercent")), "policy", "실패")).toEqual([
    { area: "threshold", message: "사전 알림 기준 값을 서버가 받아들이지 않았습니다." },
  ]);
});

test("loc가 입력 필드를 가리키지 않는 의미 검증 오류는 저장을 요청한 영역의 폼 수준 오류이다", () => {
  expect(settingsFailures(unprocessable(issue("body")), "threshold", "실패")).toEqual([{ area: "threshold", message: expect.stringContaining("임계율 조합") as string }]);
  expect(settingsFailures({ status: 422 }, "policy", "실패")).toEqual([{ area: "policy", message: expect.stringContaining("임계율 조합") as string }]);
});

test("같은 영역의 같은 필드 오류는 한 번만 표시한다", () => {
  expect(settingsFailures(unprocessable(issue("body", "eventTypes", "0"), issue("body", "eventTypes", "1")), "policy", "실패")).toHaveLength(1);
});

test("412와 428은 새로고침 안내이고 다른 상태는 기본 문구이다", () => {
  expect(settingsFailures({ status: 412 }, "policy", "실패")[0].message).toContain("새로고침");
  expect(settingsFailures({ status: 428 }, "threshold", "실패")).toEqual([{ area: "threshold", message: expect.stringContaining("새로고침") as string }]);
  expect(settingsFailures({ status: 503 }, "threshold", "수거 설정을 저장하지 못했습니다.")).toEqual([{ area: "threshold", message: "수거 설정을 저장하지 못했습니다." }]);
  expect(recipientFailure({ status: 422 }, "실패")).toContain("입력값");
  expect(recipientFailure({ status: 500 }, "기본")).toBe("기본");
});
