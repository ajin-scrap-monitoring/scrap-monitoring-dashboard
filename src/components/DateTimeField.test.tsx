import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { DateTimeField } from "./DateTimeField";
import { isValidDateTime, recentRange } from "../date-range";

function Example() {
  const [value, setValue] = useState("2026-09-03T12:30");
  return <><DateTimeField label="시작 시각" value={value} onChange={setValue} /><button>다른 입력</button></>;
}

test("달력과 시간 선택을 입력칸에 반영하고 완료하면 포커스를 복원한다", async () => {
  const user = userEvent.setup();
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "시작 시각 선택기 열기" });
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "2026-09-05" }));
  expect(screen.getByLabelText("시작 시각")).toHaveValue("2026-09-05 12:30");
  await user.clear(screen.getByRole("spinbutton", { name: "시" }));
  await user.type(screen.getByRole("spinbutton", { name: "시" }), "9");
  expect(screen.getByLabelText("시작 시각")).toHaveValue("2026-09-05 09:30");
  await user.click(screen.getByRole("button", { name: "선택 완료" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("방향키로 날짜를 이동하며 Escape와 바깥 클릭으로 닫는다", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "시작 시각 선택기 열기" }));
  await user.keyboard("{ArrowRight}{Enter}");
  expect(screen.getByLabelText("시작 시각")).toHaveValue("2026-09-04 12:30");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "시작 시각 선택기 열기" }));
  await user.click(screen.getByRole("button", { name: "다른 입력" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("직접 입력한 날짜의 형식과 실제 존재 여부를 검증한다", () => {
  expect(isValidDateTime("2026-02-30T12:30")).toBe(false);
  expect(isValidDateTime("2026-09-03T25:00")).toBe(false);
  expect(isValidDateTime("2026-09-03T12:30")).toBe(true);
});

test("빠른 기간은 브라우저 시간대와 무관한 벽시계 간격을 유지한다", () => {
  expect(recentRange(24, "2026-03-09 01:30:45")).toEqual({
    start: "2026-03-08T01:30",
    end: "2026-03-09T01:30",
  });
});
