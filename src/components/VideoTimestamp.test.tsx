import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { VideoTimestamp } from "./VideoTimestamp";

const capturedAt = "2026-10-15T09:00:01.123+09:00";
const receivedAt = "2026-10-15T00:00:02.456Z";

test("실제 촬영 시각이 있으면 영상 수신 시각보다 우선한다", () => {
  render(<VideoTimestamp capturedAt={capturedAt} receivedAt={receivedAt} />);
  const time = screen.getByText(/^촬영 /);
  expect(time).toHaveAttribute("datetime", new Date(capturedAt).toISOString());
  expect(time).toHaveTextContent("09:00:01");
  expect(screen.queryByText(/^영상 수신 /)).not.toBeInTheDocument();
});

test.each([undefined, null, "", "invalid-time"])("촬영 시각 %s은 마지막 영상 frame 수신 시각으로 fallback한다", (value) => {
  render(<VideoTimestamp capturedAt={value} receivedAt={receivedAt} />);
  const time = screen.getByText(/^영상 수신 /);
  expect(time).toHaveAttribute("datetime", receivedAt);
  expect(time).toHaveTextContent("09:00:02");
  expect(screen.queryByText(/^촬영 /)).not.toBeInTheDocument();
});

test("촬영 및 수신 시각이 없거나 유효하지 않으면 임의의 시각을 표시하지 않는다", () => {
  const { container, rerender } = render(<VideoTimestamp />);
  expect(container).toBeEmptyDOMElement();
  rerender(<VideoTimestamp capturedAt="invalid-capture" receivedAt="invalid-receipt" />);
  expect(container).toBeEmptyDOMElement();
});

test("촬영 시각의 제공 및 제거에 따라 표시 출처를 전환한다", () => {
  const { rerender } = render(<VideoTimestamp receivedAt={receivedAt} />);
  expect(screen.getByText(/^영상 수신 /)).toBeVisible();
  rerender(<VideoTimestamp capturedAt={capturedAt} receivedAt={receivedAt} />);
  expect(screen.getByText(/^촬영 /)).toBeVisible();
  rerender(<VideoTimestamp capturedAt={null} receivedAt={receivedAt} />);
  expect(screen.getByText(/^영상 수신 /)).toBeVisible();
});
