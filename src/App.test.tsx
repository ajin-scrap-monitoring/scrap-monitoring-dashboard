import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { App } from "./App";

test("대시보드 주 영역을 렌더링한다", () => {
  render(<App />);

  expect(
    screen.getByRole("main", { name: "스크랩 모니터링 대시보드" }),
  ).toBeInTheDocument();
});
