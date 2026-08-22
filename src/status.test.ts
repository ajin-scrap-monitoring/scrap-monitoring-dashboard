import { describe, expect, it } from "vitest";

import { getExecutionStatus } from "./status";

describe("getExecutionStatus", () => {
  it("준비된 실행 상태를 반환한다", () => {
    expect(getExecutionStatus(true)).toBe("애플리케이션이 정상적으로 실행되었습니다.");
  });

  it("준비되지 않은 실행 상태를 반환한다", () => {
    expect(getExecutionStatus(false)).toBe("애플리케이션을 준비하고 있습니다.");
  });
});
