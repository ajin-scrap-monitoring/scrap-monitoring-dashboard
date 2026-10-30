import type { MeasurementLayoutStatus } from "../domain/dashboard";
import { record, strings, timestamp } from "./contract-values";

const states = ["SIMULATION", "PARTIAL", "UNVERIFIED", "UNAVAILABLE"];
const sources = ["SIMULATION_REFERENCE", "HEIGHT_REFERENCE", "NONE"];
const bindings = ["MATCHED", "MISMATCH", "UNKNOWN"];
const calibrationStates = ["SIMULATION", "VERIFIED", "UNAVAILABLE"];

function optionalOneOf(value: unknown, allowed: string[]) {
  return value === undefined || (typeof value === "string" && allowed.includes(value));
}

// 측정 영역 그림은 평면도 기반 그림을 유지하므로 layout 좌표는 사용하지 않고 배치 상태만 연결한다.
export function parseMeasurementLayoutV2(value: unknown, pitId: string): MeasurementLayoutStatus {
  const fail = (): never => { throw new Error("Unexpected v2 measurement layout contract."); };
  if (!record(value) || value.pitId !== pitId || !timestamp(value.computedAt) || value.unit !== "cm" && value.unit !== undefined
    || !optionalOneOf(value.state, states) || !optionalOneOf(value.source, sources) || !optionalOneOf(value.bindingState, bindings)
    || !(value.simulated === undefined || typeof value.simulated === "boolean")
    || !(value.reasonCodes === undefined || strings(value.reasonCodes))
    || !Array.isArray(value.sensors ?? [])) return fail();
  const sensors = (value.sensors ?? []) as unknown[];
  return {
    state: (value.state ?? "UNAVAILABLE") as MeasurementLayoutStatus["state"],
    bindingState: (value.bindingState ?? "UNKNOWN") as MeasurementLayoutStatus["bindingState"],
    simulated: value.simulated ?? null,
    reasonCodes: value.reasonCodes ?? [],
    sensors: sensors.map((sensor) => {
      if (!record(sensor) || typeof sensor.sensorId !== "string" || !optionalOneOf(sensor.calibrationState, calibrationStates)
        || !(sensor.reasonCodes === undefined || strings(sensor.reasonCodes))) return fail();
      return {
        sensorId: sensor.sensorId,
        calibrationState: (sensor.calibrationState ?? "UNAVAILABLE") as MeasurementLayoutStatus["sensors"][number]["calibrationState"],
        reasonCodes: sensor.reasonCodes ?? [],
      };
    }),
  };
}
