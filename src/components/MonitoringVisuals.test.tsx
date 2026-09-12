import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { LoadChart, ProfileChart } from "./MonitoringVisuals";

test("최근 적재율 눈금은 표본 누락과 무관하게 3시간 간격을 유지한다", () => {
  render(<LoadChart threshold={80} samples={[
    { measuredAt: "2026-09-09T09:00:00+09:00", time: "09:00", value: 44 },
    { measuredAt: "2026-09-09T15:00:00+09:00", time: "15:00", value: 56 },
  ]} />);

  expect(screen.getByText("09:00")).toBeVisible();
  expect(screen.getByText("12:00")).toBeVisible();
  expect(screen.getByText("15:00")).toBeVisible();
});

test("최근 적재율과 LiDAR profile은 유효하지 않은 표본에서 선을 끊는다", () => {
  const { container, rerender } = render(<LoadChart threshold={80} samples={[
    { measuredAt: "2026-09-09T09:00:00+09:00", time: "09:00", value: 44 },
    { measuredAt: "2026-09-09T10:00:00+09:00", time: "10:00", value: null },
    { measuredAt: "2026-09-09T11:00:00+09:00", time: "11:00", value: 48 },
  ]} />);

  expect(container.querySelectorAll(".load-chart-line")).toHaveLength(2);

  rerender(<ProfileChart average="1.8 m" color="blue" label="LiDAR 1" maximum="2.4 m" minimum="1.2 m" samples={[
    { height: 1.2, positionRatio: 0 },
    { height: null, positionRatio: 0.5 },
    { height: 2.4, positionRatio: 1 },
  ]} />);

  expect(container.querySelectorAll(".profile-chart-line")).toHaveLength(2);
});
