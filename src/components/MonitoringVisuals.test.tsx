import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { LoadChart, MeasurementDiagram, ProfileChart } from "./MonitoringVisuals";

test("측정 참고도의 SVG 태그, 좌표, 색상과 순서를 고정한다", () => {
  render(<MeasurementDiagram lidar1Color="#1677e8" lidar2Color="#0ba58f" />);
  const markup = screen.getByRole("img", { name: "LiDAR 1과 LiDAR 2 측정선 배치" }).outerHTML;
  let checksum = 2166136261;
  for (const character of markup) checksum = Math.imul(checksum ^ character.charCodeAt(0), 16777619);
  expect((checksum >>> 0).toString(16)).toBe("4bc82566");
});

test("최근 적재율 눈금은 표본 누락과 무관하게 3시간 간격을 유지한다", () => {
  render(<LoadChart threshold={80} samples={[
    { measuredAt: "2026-09-09T09:00:00+09:00", time: "09:00", value: 44 },
    { measuredAt: "2026-09-09T18:00:00+09:00", time: "18:00", value: 56 },
  ]} />);

  expect(screen.getByText("09:00")).toBeVisible();
  expect(screen.getByText("12:00")).toBeVisible();
  expect(screen.getByText("15:00")).toBeVisible();
});

test("최근 24시간 눈금은 정각을 표시하고 표본 좌표와 실제 분 단위 시각은 유지한다", () => {
  const { container } = render(<LoadChart threshold={80} samples={[
    { measuredAt: "2026-10-14T19:21:34+09:00", time: "19:21", value: 44 },
    { measuredAt: "2026-10-15T19:21:34+09:00", time: "19:21", value: 56 },
  ]} />);
  const labels = [...container.querySelectorAll('text[y="166"]')].map(text => text.textContent);
  expect(labels).toEqual(["21:00", "00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00"]);
  const targets = container.querySelectorAll(".chart-point-target");
  expect(targets[0]).toHaveAttribute("cx", "40");
  expect(targets[1]).toHaveAttribute("cx", "410");
  fireEvent.focus(targets[0]);
  expect(container.querySelector(".chart-tooltip")).toHaveTextContent("19:21");
});

test("표본 offset과 무관하게 한국 표준시 정각에 눈금을 배치한다", () => {
  const { container } = render(<LoadChart threshold={80} samples={[
    { measuredAt: "2026-10-14T19:21:34+05:30", time: "19:21", value: 44 },
    { measuredAt: "2026-10-15T19:21:34+05:30", time: "19:21", value: 56 },
  ]} />);
  expect([...container.querySelectorAll('text[y="166"]')].map(text => text.textContent)).toEqual(["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]);
});

test("조회 범위를 알 수 없는 단독 표본은 분 단위 눈금을 임의로 배치하지 않는다", () => {
  const { container } = render(<LoadChart threshold={80} samples={[
    { measuredAt: "2026-10-14T19:21:34Z", time: "19:21", value: 44 },
  ]} />);
  expect(container.querySelectorAll('text[y="166"]')).toHaveLength(0);
  expect(container.querySelector(".chart-point-target")).toHaveAttribute("cx", "225");
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

  rerender(<ProfileChart average="1.8 m" color="blue" label="LiDAR 1" maximum="2.4 m" minimum="1.2 m" samples={[
    { height: 2.4, positionRatio: 0.9 },
    { height: 2.2, positionRatio: 0.8 },
    { height: null, positionRatio: null },
    { height: 1.9, positionRatio: 0.3 },
    { height: 1.8, positionRatio: 0.2 },
  ]} />);

  expect(container.querySelectorAll(".profile-chart-line")).toHaveLength(2);
});

test("v2 그래프는 bucket 범위를 유지하고 실제 점을 판단 생성 시각에 배치한다", () => {
  const { container } = render(<LoadChart threshold={85} thresholdKind="current" samples={[
    { bucketStartAt: "2026-10-14T00:00:00Z", bucketEndAt: "2026-10-14T01:00:00Z", measuredAt: "2026-10-14T00:30:00Z", generatedAt: "2026-10-14T00:30:00Z", observedAt: "2026-10-14T00:29:59Z", dataState: "AVAILABLE", time: "00:30", value: 0 },
    { bucketStartAt: "2026-10-14T01:00:00Z", bucketEndAt: "2026-10-14T02:00:00Z", measuredAt: "2026-10-14T01:30:00Z", generatedAt: "2026-10-14T01:30:00Z", observedAt: "2026-10-14T01:29:59Z", dataState: "LIMITED", time: "01:30", value: 42 },
    { bucketStartAt: "2026-10-14T02:00:00Z", bucketEndAt: "2026-10-14T03:00:00Z", measuredAt: "2026-10-14T02:00:00Z", dataState: "NO_DATA", time: "02:00", value: null },
  ]} />);
  const targets = container.querySelectorAll(".chart-point-target");
  expect(targets).toHaveLength(2);
  expect(Number(targets[0].getAttribute("cx"))).toBeCloseTo(40 + 370 / 6);
  expect(Number(targets[0].getAttribute("cy"))).toBe(148);
  expect(screen.getByText("현재 임계율 85%")).toBeVisible();
  expect(targets[1]).toHaveAccessibleName(/입력 제한.*판단 생성.*관측/);
  fireEvent.focus(targets[1]);
  expect(container.querySelector(".chart-tooltip")).toHaveTextContent("입력 제한");
});

test("단독 0% 표본은 실제 점으로 표시한다", () => {
  const { container } = render(<LoadChart threshold={80} samples={[
    { measuredAt: "2026-09-09T09:00:00+09:00", time: "09:00", value: null },
    { measuredAt: "2026-09-09T10:00:00+09:00", time: "10:00", value: 0 },
    { measuredAt: "2026-09-09T11:00:00+09:00", time: "11:00", value: null },
  ]} />);
  expect(container.querySelector('circle[fill="#f58a07"]')).toHaveAttribute("cy", "148");
  expect(screen.getByLabelText("10:00 대표 적재율 0%")).toBeInTheDocument();
});

test("실패와 미지원은 빈 데이터로 표시하지 않고 기존 SVG 크기를 유지한다", () => {
  const state = { status: "error" as const, from: "2026-10-14T00:00:00Z", to: "2026-10-15T00:00:00Z" };
  const { rerender } = render(<LoadChart threshold={85} samples={[]} state={state} />);
  expect(screen.getByText("적재율 추이를 조회하지 못했습니다.")).toBeVisible();
  expect(screen.getByRole("img")).toHaveAttribute("viewBox", "0 0 430 175");
  rerender(<LoadChart threshold={85} samples={[]} state={{ ...state, status: "unsupported" }} />);
  expect(screen.getByText("적재율 추이를 지원하지 않습니다.")).toBeVisible();
});

test("선택한 표본이 새 응답에서 제거되면 tooltip을 숨긴다", () => {
  const { container, rerender } = render(<LoadChart threshold={80} samples={[
    { measuredAt: "2026-09-09T09:00:00+09:00", time: "09:00", value: 44 },
    { measuredAt: "2026-09-09T10:00:00+09:00", time: "10:00", value: 45 },
  ]} />);
  const targets = container.querySelectorAll(".chart-point-target");
  fireEvent.focus(targets[1]);
  expect(container.querySelector(".chart-tooltip")).not.toBeNull();
  rerender(<LoadChart threshold={80} samples={[]} />);
  expect(container.querySelector(".chart-tooltip")).toBeNull();
});

test("갱신 실패에서 마지막 유효 결과를 유지하면 이전 결과임을 표시한다", () => {
  const { container } = render(<LoadChart threshold={80} state={{ status: "error", stale: true }} samples={[
    { measuredAt: "2026-09-09T09:00:00+09:00", time: "09:00", value: 44 },
  ]} />);
  expect(container.querySelectorAll(".load-chart-line")).toHaveLength(1);
  expect(screen.getByText("이전 조회 결과 / 갱신 실패")).toBeVisible();
});

test("적재율 소수 자릿수를 유지하고 tooltip 폭을 값 길이에 맞춘다", () => {
  const { container } = render(<LoadChart threshold={90} thresholdKind="current" samples={[
    { measuredAt: "2026-10-15T00:00:00Z", time: "00:00", value: 99.123456789, dataState: "AVAILABLE" },
  ]} />);
  fireEvent.focus(container.querySelector(".chart-point-target")!);
  const tooltip = container.querySelector(".chart-tooltip");
  expect(tooltip).toHaveTextContent("대표 적재율 99.123456789%");
  expect(Number(tooltip?.querySelector("rect")?.getAttribute("width"))).toBeGreaterThan(140);
  expect(screen.getByText("현재 임계율 90%")).not.toHaveAttribute("transform");
});

test.each([0, 80, 90, 100])("임계율 %s%%의 문구는 점선과 분리한 그래프 위쪽 여백에 표시한다", (threshold) => {
  const { container } = render(<LoadChart threshold={threshold} thresholdKind="current" samples={[]} />);
  const label = screen.getByText(`현재 임계율 ${threshold}%`);
  expect(Number(label.getAttribute("y")) + Number(label.getAttribute("font-size")) / 2).toBeLessThan(20);
  expect(container.querySelector('path[stroke-dasharray="5 5"]')).toHaveAttribute("d", `M40 ${148 - threshold * 1.28}H410`);
  expect(screen.getByRole("img")).toHaveAttribute("viewBox", "0 0 430 175");
});

test("STATE 기록이 없는 구간과 유효한 수치가 없는 판단을 구분한다", () => {
  const sample = { measuredAt: "2026-09-09T09:00:00+09:00", time: "09:00", value: null };
  const { rerender } = render(<LoadChart threshold={80} samples={[{ ...sample, dataState: "NO_DATA" }]} />);
  expect(screen.getByText("최근 적재율 데이터가 없습니다.")).toBeVisible();
  rerender(<LoadChart threshold={80} samples={[{ ...sample, dataState: "UNAVAILABLE" }]} />);
  expect(screen.getByText("유효한 적재율 데이터가 없습니다.")).toBeVisible();
});
