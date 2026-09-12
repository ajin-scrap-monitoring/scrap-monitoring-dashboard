import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { Pagination } from "./Pagination";

test("페이지 범위를 보정하고 유효한 다음 페이지를 전달한다", () => {
  const onPageChange = vi.fn();
  const { rerender } = render(
    <Pagination ariaLabel="목록 페이지" currentPage={7} itemLabel="목록" onPageChange={onPageChange} totalPages={0} />,
  );

  expect(screen.getByText("1 / 1")).toBeVisible();
  expect(screen.getByRole("button", { name: "이전 목록 페이지" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "다음 목록 페이지" })).toBeDisabled();

  rerender(
    <Pagination ariaLabel="목록 페이지" currentPage={0} itemLabel="목록" onPageChange={onPageChange} totalPages={2} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "다음 목록 페이지" }));
  expect(onPageChange).toHaveBeenCalledWith(1);
});
