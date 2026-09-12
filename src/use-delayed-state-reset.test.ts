import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { useDelayedState } from "./use-delayed-state";

test("조회나 선택 변경으로 초기화한 상태를 이전 완료 타이머가 덮어쓰지 않는다", () => {
  vi.useFakeTimers();
  try {
    const { result, unmount } = renderHook(() => useDelayedState("idle"));
    act(() => { result.current[1]("processing"); result.current[2]("complete", 400); });
    act(() => result.current[1]("idle"));
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current[0]).toBe("idle");
    unmount();
  } finally {
    vi.useRealTimers();
  }
});
