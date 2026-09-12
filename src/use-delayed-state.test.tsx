import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { useDelayedState } from "./use-delayed-state";

function DelayedStateHarness() {
  const [state, , setStateAfter] = useDelayedState("idle");
  return <button type="button" onClick={() => setStateAfter("complete", 400)}>{state}</button>;
}

test("예약 상태를 반영하고 컴포넌트 해제 시 타이머를 정리한다", () => {
  vi.useFakeTimers();
  const first = render(<DelayedStateHarness />);
  first.getByRole("button").click();
  expect(vi.getTimerCount()).toBe(1);
  first.unmount();
  expect(vi.getTimerCount()).toBe(0);

  render(<DelayedStateHarness />);
  screen.getByRole("button").click();
  act(() => {
    vi.advanceTimersByTime(400);
  });
  expect(screen.getByRole("button")).toHaveTextContent("complete");
  vi.useRealTimers();
});
