import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { App } from "./App";

test("대시보드 주 영역을 렌더링한다", () => {
  render(<App />);

  expect(
    screen.getByRole("main", { name: "스크랩 모니터링 대시보드" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "스크랩 모니터링" })).toBeVisible();
  expect(
    screen.getByRole("img", { name: "최근 24시간 대표 적재율 그래프" }),
  ).toBeVisible();
  expect(screen.getByText("LiDAR 2 일부 측정 불가")).toBeVisible();
  expect(screen.getByText("1 / 2")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "다음 알림 페이지" }));
  expect(screen.getByText("2 / 2")).toBeVisible();
  expect(screen.getByText("안정성 경보")).toBeVisible();

  fireEvent.pointerEnter(
    screen.getByLabelText("08:00 대표 적재율 72%"),
  );
  expect(screen.getByText("대표 적재율 72%")).toBeVisible();
});
