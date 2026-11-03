import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { calculateUnmeasuredRanges } from "../data/lidar-profiles-v2";
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

test("LiDAR 미측정 구간 계산: 앞쪽, 뒤쪽, 양쪽, 없음, 전체, 빈 표본", () => {
  // 앞쪽만 미측정
  const frontOnly = calculateUnmeasuredRanges([
    { positionRatio: 0.13 },
    { positionRatio: 1.0 },
  ]);
  expect(frontOnly).toEqual([
    { side: "start", startRatio: 0, endRatio: 0.13, label: "미측정 A 0%~13%" },
  ]);

  // 뒤쪽만 미측정
  const backOnly = calculateUnmeasuredRanges([
    { positionRatio: 0.0 },
    { positionRatio: 0.87 },
  ]);
  expect(backOnly).toEqual([
    { side: "end", startRatio: 0.87, endRatio: 1, label: "미측정 B 87%~100%" },
  ]);

  // 양쪽 미측정
  const both = calculateUnmeasuredRanges([
    { positionRatio: 0.15 },
    { positionRatio: 0.5 },
    { positionRatio: 0.85 },
  ]);
  expect(both).toEqual([
    { side: "start", startRatio: 0, endRatio: 0.15, label: "미측정 A 0%~15%" },
    { side: "end", startRatio: 0.85, endRatio: 1, label: "미측정 B 85%~100%" },
  ]);

  // 없음 (전체 관측)
  const none = calculateUnmeasuredRanges([
    { positionRatio: 0.0 },
    { positionRatio: 1.0 },
  ]);
  expect(none).toEqual([]);

  // 전체 (위치 있는 표본이 하나도 없음)
  const allUnmeasured = calculateUnmeasuredRanges([
    { positionRatio: null },
    { positionRatio: null },
  ]);
  expect(allUnmeasured).toEqual([
    { side: "all", startRatio: 0, endRatio: 1, label: "미측정 0%~100%" },
  ]);

  // 빈 배열은 표본 없음 상태 유지 (미측정 영역 없음)
  expect(calculateUnmeasuredRanges([])).toEqual([]);

  // 경계 값: 가로축 길이 1% 미만(0.009, 0.991)은 제외, 1% 이상(0.01, 0.99)은 생성
  expect(calculateUnmeasuredRanges([{ positionRatio: 0.009 }, { positionRatio: 1.0 }])).toEqual([]);
  expect(calculateUnmeasuredRanges([{ positionRatio: 0.01 }, { positionRatio: 1.0 }])).toEqual([
    { side: "start", startRatio: 0, endRatio: 0.01, label: "미측정 A 0%~1%" },
  ]);
  expect(calculateUnmeasuredRanges([{ positionRatio: 0.0 }, { positionRatio: 0.99 }])).toEqual([
    { side: "end", startRatio: 0.99, endRatio: 1, label: "미측정 B 99%~100%" },
  ]);
  expect(calculateUnmeasuredRanges([{ positionRatio: 0.0 }, { positionRatio: 0.991 }])).toEqual([]);
});

test("ProfileChart 미측정 음영 표시와 선 끊김 유지", () => {
  const { container } = render(
    <ProfileChart
      average="1.5 m"
      color="blue"
      label="LiDAR 1 단면 높이"
      maximum="2.0 m"
      minimum="1.0 m"
      samples={[
        { height: 1.0, positionRatio: 0.13 },
        { height: null, positionRatio: 0.4 }, // valid=false / 결측: 선 끊김
        { height: 1.8, positionRatio: 0.6 },
        { height: 2.0, positionRatio: 0.87 },
      ]}
    />,
  );

  // SVG aria-label에 미측정 구간 비율 포함
  const svg = container.querySelector("svg");
  expect(svg?.getAttribute("aria-label")).toContain("미측정 A 0%~13%");
  expect(svg?.getAttribute("aria-label")).toContain("미측정 B 87%~100%");

  // 음영 사각형 및 title 확인
  const unmeasuredZones = container.querySelectorAll(".profile-unmeasured-zones rect");
  expect(unmeasuredZones).toHaveLength(2);
  expect(unmeasuredZones[0].querySelector("title")?.textContent).toBe("미측정 A 0%~13%");
  expect(unmeasuredZones[1].querySelector("title")?.textContent).toBe("미측정 B 87%~100%");

  // 폭 24px 이상이면 미측정 텍스트 표시
  const texts = container.querySelectorAll(".profile-unmeasured-zones text");
  expect(texts.length).toBeGreaterThan(0);
  expect(texts[0].textContent).toBe("미측정");

  // 선 그래프가 2개로 끊김 (positionRatio 0.4 결측 때문)
  expect(container.querySelectorAll(".profile-chart-line")).toHaveLength(2);
});

test("최근 적재율 그래프는 서버가 simulated로 표시한 표본에 시뮬레이션 표기를 붙인다", () => {
  const sample = (hour: number, value: number | null, simulated: boolean) => ({ measuredAt: `2026-09-09T${String(hour).padStart(2, "0")}:00:00+09:00`, time: `${hour}:00`, value, simulated });
  const { container, rerender } = render(<LoadChart threshold={80} samples={[sample(9, 44, true), sample(10, null, false), sample(11, 48, true)]} />);
  expect(container.querySelector(".load-chart-simulation")).toHaveTextContent("시뮬레이션");
  expect(screen.getByRole("img", { name: "최근 24시간 대표 적재율 그래프 (시뮬레이션)" })).toBeInTheDocument();
  rerender(<LoadChart threshold={80} samples={[sample(9, 44, true), sample(11, 48, false)]} />);
  expect(container.querySelector(".load-chart-simulation")).toHaveTextContent("시뮬레이션 포함");
  rerender(<LoadChart threshold={80} samples={[sample(9, 44, false), sample(11, 48, false)]} />);
  expect(container.querySelector(".load-chart-simulation")).toBeNull();
  rerender(<LoadChart threshold={80} state={{ status: "loading" }} samples={[sample(9, 44, true)]} />);
  expect(container.querySelector(".load-chart-simulation")).toBeNull();
});
