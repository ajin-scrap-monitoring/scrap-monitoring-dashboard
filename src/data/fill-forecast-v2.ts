import { nullableTimestamp, record, strings, timestamp } from "./contract-values";

export type FillForecast = {
  state: "AVAILABLE" | "REACHED" | "UNAVAILABLE";
  expectedThresholdAt: string | null;
  validUntil: string;
  reasonCodes: string[];
  simulated: boolean;
};

const states = ["AVAILABLE", "REACHED", "UNAVAILABLE"];

export function parseFillForecastV2(value: unknown, pitId: string): FillForecast {
  const fail = (): never => { throw new Error("Unexpected v2 fill forecast contract."); };
  if (!record(value) || value.pitId !== pitId || !timestamp(value.computedAt) || !timestamp(value.validUntil)
    || typeof value.state !== "string" || !states.includes(value.state) || !nullableTimestamp(value.expectedThresholdAt, true)
    || !(value.remainingSeconds === null || (Number.isInteger(value.remainingSeconds) && (value.remainingSeconds as number) >= 0))
    || !strings(value.reasonCodes) || !(value.simulated === undefined || typeof value.simulated === "boolean")) return fail();
  if (value.state === "AVAILABLE" && value.expectedThresholdAt === null) return fail();
  return {
    state: value.state as FillForecast["state"],
    expectedThresholdAt: value.expectedThresholdAt as string | null,
    validUntil: value.validUntil,
    reasonCodes: value.reasonCodes,
    simulated: value.simulated === true,
  };
}
