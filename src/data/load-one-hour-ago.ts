import type { DashboardData, LoadHistorySample } from "../domain/dashboard";
import { timestamp, timestampValue } from "./contract-values";

const hour = 3_600_000;
const tolerance = 60_000;

export function updateLoadOneHourAgo(monitoring: DashboardData["monitoring"]) {
  const { summary, v2, loadHistoryState } = monitoring;
  summary.loadOneHourAgo = null;
  if (!v2 || loadHistoryState?.status !== "ready" || loadHistoryState.stale
    || !timestamp(v2.serverTime) || !timestamp(loadHistoryState.from) || !timestamp(loadHistoryState.to)) return;

  const reference = Math.max(timestampValue(v2.serverTime), timestampValue(loadHistoryState.to));
  const target = reference - hour;
  if (target < timestampValue(loadHistoryState.from) || target >= timestampValue(loadHistoryState.to)) return;

  let selected: LoadHistorySample | undefined;
  let selectedTime = Number.NEGATIVE_INFINITY;
  let selectedRevisionTime = Number.NEGATIVE_INFINITY;
  for (const sample of monitoring.loadHistory) {
    if (!timestamp(sample.observedAt)) continue;
    const observedAt = timestampValue(sample.observedAt);
    const generatedAt = timestamp(sample.generatedAt) ? timestampValue(sample.generatedAt) : Number.NEGATIVE_INFINITY;
    if (observedAt > target || target - observedAt > tolerance) continue;
    if (observedAt > selectedTime || (observedAt === selectedTime && generatedAt >= selectedRevisionTime)) {
      selected = sample;
      selectedTime = observedAt;
      selectedRevisionTime = generatedAt;
    }
  }
  if (!selected || (selected.dataState !== "AVAILABLE" && selected.dataState !== "LIMITED")
    || !timestamp(selected.generatedAt) || !timestamp(selected.observedAt)
    || timestampValue(selected.generatedAt) > reference || typeof selected.value !== "number"
    || !Number.isFinite(selected.value) || selected.value < 0 || selected.value > 100) return;
  summary.loadOneHourAgo = { value: selected.value, observedAt: selected.observedAt, dataState: selected.dataState };
}
