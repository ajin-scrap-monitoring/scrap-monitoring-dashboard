import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { Dropdown } from "./Dropdown";

test("키보드로 이동하고 확정하며 Escape는 기존 선택을 유지한다", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Dropdown label="반복 알림" options={["반복 안 함", "30분마다", "1시간마다"]} defaultValue="30분마다" onChange={onChange} />);
  const trigger = screen.getByRole("combobox", { name: "반복 알림" });
  await user.tab();
  await user.keyboard("{ArrowDown}{End}{Escape}");
  expect(trigger).toHaveTextContent("30분마다");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(onChange).not.toHaveBeenCalled();
  await user.keyboard("{ArrowDown}{End}{Enter}");
  expect(trigger).toHaveTextContent("1시간마다");
  expect(trigger).toHaveFocus();
  expect(onChange).toHaveBeenCalledWith("1시간마다");
});

test("마우스 선택과 바깥 클릭 및 Tab으로 목록을 닫는다", async () => {
  const user = userEvent.setup();
  render(<><Dropdown label="발송 시점" options={["즉시", "5분 후"]} defaultValue="즉시" /><button>다음 입력</button></>);
  const trigger = screen.getByRole("combobox");
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name: "5분 후" }));
  expect(trigger).toHaveTextContent("5분 후");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "다음 입력" }));
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.click(trigger);
  await user.tab();
  expect(screen.getByRole("button", { name: "다음 입력" })).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});
