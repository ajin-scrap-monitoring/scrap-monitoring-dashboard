import { expect, test } from "vitest";

import { simulationLabel } from "./simulation-label";

test("값이 있는 표본이 모두 시뮬레이션이면 시뮬레이션, 일부면 시뮬레이션 포함, 없으면 표기하지 않는다", () => {
  expect(simulationLabel([{ value: 10, simulated: true }, { value: null, simulated: false }])).toBe("시뮬레이션");
  expect(simulationLabel([{ value: 10, simulated: true }, { value: 20, simulated: false }])).toBe("시뮬레이션 포함");
  expect(simulationLabel([{ value: 10 }, { value: null, simulated: true }])).toBeNull();
  expect(simulationLabel([])).toBeNull();
});
