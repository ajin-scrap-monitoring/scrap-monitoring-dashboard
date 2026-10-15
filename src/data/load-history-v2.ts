import type { HistoryLoadSample, LoadHistorySample } from "../domain/dashboard";
import { record, strings, timestamp, timestampValue } from "./contract-values";

export type LoadHistoryScope = { pitId: string; siteId: string; edgeId: string };
export type HistoryDataState = "AVAILABLE" | "LIMITED" | "UNAVAILABLE" | "STALE" | "UNKNOWN" | "NO_DATA";

export type ParsedLoadHistoryV2 = {
  from: string;
  to: string;
  bucketSeconds: number;
  monitoringSamples: LoadHistorySample[];
  historySamples: HistoryLoadSample[];
};

const historyStates = ["AVAILABLE", "LIMITED", "UNAVAILABLE", "STALE", "UNKNOWN", "NO_DATA"];
const intervals = [60, 300, 900, 3600];
const maximumHistoryDuration = 7 * 24 * 3_600_000;
const maximumHistorySamples = 1441;
const historyClock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });

function clock(value: string) {
  return historyClock.format(new Date(value));
}

export function parseLoadHistoryV2(value: unknown, scope: LoadHistoryScope): ParsedLoadHistoryV2 {
  const fail = (): never => { throw new Error("Unexpected v2 load history contract or source assignment."); };
  if (!record(value) || value.schemaVersion !== "2" || value.pitId !== scope.pitId
    || !record(value.source) || value.source.pit_id !== scope.pitId
    || value.source.site_id !== scope.siteId || value.source.edge_id !== scope.edgeId
    || !timestamp(value.from) || !timestamp(value.to)
    || typeof value.bucketSeconds !== "number" || !intervals.includes(value.bucketSeconds)
    || value.selectionPolicy !== "LATEST_STATE_PER_BUCKET" || !Array.isArray(value.samples)
    || value.samples.length > maximumHistorySamples) return fail();

  const from = timestampValue(value.from);
  const to = timestampValue(value.to);
  const interval = value.bucketSeconds * 1000;
  const firstBucket = Math.floor(from / interval);
  const bucketCount = Math.ceil(to / interval) - firstBucket;
  if (to <= from || to - from > maximumHistoryDuration || value.samples.length !== bucketCount) return fail();

  const monitoringSamples: LoadHistorySample[] = [];
  const historySamples: HistoryLoadSample[] = [];
  for (const [index, sample] of value.samples.entries()) {
    if (!record(sample) || !timestamp(sample.bucketStartAt) || !timestamp(sample.bucketEndAt)
      || ![sample.generatedAt, sample.observedAt].every((item) => item === null || timestamp(item))
      || !(sample.assessmentId === null || typeof sample.assessmentId === "string")
      || !(sample.valuePercent === null || (typeof sample.valuePercent === "number" && Number.isFinite(sample.valuePercent) && sample.valuePercent >= 0 && sample.valuePercent <= 100))
      || typeof sample.valid !== "boolean" || typeof sample.dataState !== "string" || !historyStates.includes(sample.dataState)
      || !strings(sample.reasonCodes)) return fail();

    const bucketStart = Math.max(from, (firstBucket + index) * interval);
    const bucketEnd = Math.min(to, (firstBucket + index + 1) * interval);
    if (timestampValue(sample.bucketStartAt) !== bucketStart || timestampValue(sample.bucketEndAt) !== bucketEnd) return fail();
    const generatedAt = sample.generatedAt as string | null;
    const observedAt = sample.observedAt as string | null;
    if (generatedAt !== null && (timestampValue(generatedAt) < bucketStart || timestampValue(generatedAt) >= bucketEnd)) return fail();
    if (sample.valid && sample.valuePercent !== null && (generatedAt === null || observedAt === null
      || !["AVAILABLE", "LIMITED"].includes(sample.dataState))) return fail();

    const measuredAt = generatedAt ?? sample.bucketStartAt;
    const metadata = {
      bucketStartAt: sample.bucketStartAt,
      bucketEndAt: sample.bucketEndAt,
      generatedAt,
      observedAt,
      assessmentId: sample.assessmentId,
      dataState: sample.dataState as HistoryDataState,
      reasonCodes: sample.reasonCodes,
    };
    const plottedValue = sample.valid && typeof sample.valuePercent === "number" ? sample.valuePercent : null;
    monitoringSamples.push({ ...metadata, measuredAt, time: clock(measuredAt), value: plottedValue });
    historySamples.push({ ...metadata, hour: (timestampValue(measuredAt) - from) / 3_600_000, value: plottedValue });
  }
  return { from: value.from, to: value.to, bucketSeconds: value.bucketSeconds, monitoringSamples, historySamples };
}
