import { nullableTimestamp, record, strings } from "./contract-values";

export type CollectionSummary = {
  lastActivityAt: string | null;
  averageCycleSeconds: number | null;
  cycleCount: number;
  reasonCodes: string[];
};

const activitySources = ["CONFIRMED_COMPLETION", "HEIGHT_SETTLED"];

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parseCollectionSummaryV2(value: unknown, pitId: string): CollectionSummary {
  const fail = (): never => { throw new Error("Unexpected v2 collection summary contract."); };
  if (!record(value) || value.pitId !== pitId || !nullableTimestamp(value.lastCollectionActivityAt, true)
    || !(value.averageSettledCollectionCycleSeconds === null || nonNegative(value.averageSettledCollectionCycleSeconds))
    || !Number.isInteger(value.settledCycleCount) || (value.settledCycleCount as number) < 0
    || !strings(value.settledCycleReasonCodes)
    || !(value.activitySource === undefined || value.activitySource === null
      || (typeof value.activitySource === "string" && activitySources.includes(value.activitySource)))) return fail();
  if (value.averageSettledCollectionCycleSeconds !== null && value.settledCycleCount === 0) return fail();
  return {
    lastActivityAt: value.lastCollectionActivityAt as string | null,
    averageCycleSeconds: value.averageSettledCollectionCycleSeconds,
    cycleCount: value.settledCycleCount as number,
    reasonCodes: value.settledCycleReasonCodes,
  };
}
