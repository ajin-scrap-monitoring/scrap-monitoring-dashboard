import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { DataReceptionMeta } from "./DataReceptionMeta";

test.each([
  ["waiting", "수신 대기"], ["connected", "연결 정상"], ["error", "연결 문제"],
] as const)("수신 상태 %s와 최근 수신 시각을 표시한다", (status, label) => {
  const lastReceivedAt = "2026-10-15T05:23:41.123Z";
  const view = render(<DataReceptionMeta reception={{ status, lastReceivedAt }} />);
  expect(screen.getByRole("status")).toHaveTextContent(label);
  const time = view.container.querySelector("time");
  expect(time).toHaveAttribute("datetime", lastReceivedAt);
  const date = new Date(lastReceivedAt);
  expect(time).toHaveTextContent([date.getHours(), date.getMinutes(), date.getSeconds()].map(value => String(value).padStart(2, "0")).join(":"));
  expect(time).toHaveAttribute("title", new Date(lastReceivedAt).toString());
});

test("수신 전에는 시각을 생성하지 않는다", () => {
  const view = render(<DataReceptionMeta reception={{ status: "waiting", lastReceivedAt: null }} />);
  expect(screen.getByText("마지막 수신 없음")).toBeVisible();
  expect(view.container.querySelector("time")).toBeNull();
});
