import type { ActiveAlert, ActiveAlertCoverage } from "../domain/dashboard";
import { nullableTimestamp, record, strings, timestamp } from "./contract-values";

export type ActiveFillAlerts = {
  evaluationState: "NORMAL" | "WARNING" | "CRITICAL" | "UNKNOWN" | "ERROR";
  reasonCodes: string[];
  items: ActiveAlert[];
  coverage: ActiveAlertCoverage[];
};

const evaluationStates = ["NORMAL", "WARNING", "CRITICAL", "UNKNOWN", "ERROR"];
const severities = ["warning", "error"];
const fillTypes = ["pre_collection_alert", "collection_required"];
const healthTypes = ["device_error", "measurement_error"];
const healthComponents = ["EDGE", "LIDAR", "MEASUREMENT"];
const coverageComponents = [...healthComponents, "CAMERA"];
const coverageStates = ["CHECKED", "UNKNOWN", "UNSUPPORTED"];
const evidenceSources = ["EDGE_STATUS", "STATUS_FRESHNESS", "CURRENT_MEASUREMENT"];
const startBases = ["SERVER_EVALUATION", "UNKNOWN"];

function componentName(kind: string, id: string | null) {
  if (kind === "LIDAR") return id === "lidar-a" ? "LiDAR 1" : id === "lidar-b" ? "LiDAR 2" : id ?? "LiDAR";
  return kind === "EDGE" ? "엣지 장비" : kind === "CAMERA" ? "카메라" : "측정";
}

// startedAt은 startBasis가 SERVER_EVALUATION일 때만 서버가 처음 확인한 시각이다. 그 외에는 시작 정보가 없으며 evaluatedAt으로 대신 채우지 않는다.
function serverStart(item: Record<string, unknown>) {
  return item.startBasis === "SERVER_EVALUATION" && typeof item.startedAt === "string" ? item.startedAt : null;
}

export function parseActiveAlertsV2(value: unknown, pitId: string): ActiveFillAlerts {
  const fail = (): never => { throw new Error("Unexpected v2 active alert contract."); };
  if (!record(value) || value.pitId !== pitId || value.scope !== "ALL" || !timestamp(value.computedAt)
    || typeof value.evaluationState !== "string" || !evaluationStates.includes(value.evaluationState)
    || !Array.isArray(value.items) || !strings(value.reasonCodes)
    || !(value.coverage === undefined || Array.isArray(value.coverage))) return fail();
  return {
    evaluationState: value.evaluationState as ActiveFillAlerts["evaluationState"],
    reasonCodes: value.reasonCodes,
    items: value.items.map((item: unknown): ActiveAlert => {
      if (!record(item) || typeof item.id !== "string" || typeof item.title !== "string" || !item.id
        || typeof item.type !== "string" || typeof item.severity !== "string" || !severities.includes(item.severity) || !timestamp(item.evaluatedAt)
        || !nullableTimestamp(item.measuredAt === undefined ? null : item.measuredAt, true)
        || !nullableTimestamp(item.startedAt === undefined ? null : item.startedAt, true)
        || !(item.startBasis === undefined || (typeof item.startBasis === "string" && startBases.includes(item.startBasis)))) return fail();
      const common = {
        id: item.id,
        title: item.title,
        level: item.severity as ActiveAlert["level"],
        time: (item.measuredAt as string | null | undefined) ?? item.evaluatedAt,
        startedAt: serverStart(item),
      };
      if (fillTypes.includes(item.type)) {
        if (typeof item.loadPercent !== "number" || !Number.isFinite(item.loadPercent) || item.loadPercent < 0 || item.loadPercent > 100
          || typeof item.simulated !== "boolean") return fail();
        return { ...common, detail: `적재율 ${item.loadPercent}%${item.simulated ? " (시뮬레이션)" : ""}` };
      }
      if (!healthTypes.includes(item.type) || typeof item.componentKind !== "string" || !healthComponents.includes(item.componentKind)
        || typeof item.componentId !== "string" || typeof item.state !== "string"
        || typeof item.evidenceSource !== "string" || !evidenceSources.includes(item.evidenceSource)
        || !(item.reasonCodes === undefined || strings(item.reasonCodes))
        || !(item.simulated === undefined || item.simulated === null || typeof item.simulated === "boolean")) return fail();
      return {
        ...common,
        detail: `${componentName(item.componentKind, item.componentId)} ${item.state}`,
        health: {
          componentKind: item.componentKind as NonNullable<ActiveAlert["health"]>["componentKind"],
          componentName: componentName(item.componentKind, item.componentId),
          componentId: item.componentId,
          state: item.state,
          evidenceSource: item.evidenceSource as NonNullable<ActiveAlert["health"]>["evidenceSource"],
          reasonCodes: item.reasonCodes ?? [],
          simulated: item.simulated ?? null,
        },
      };
    }),
    coverage: (value.coverage ?? []).map((entry: unknown): ActiveAlertCoverage => {
      if (!record(entry) || typeof entry.componentKind !== "string" || !coverageComponents.includes(entry.componentKind)
        || !(entry.componentId === undefined || entry.componentId === null || typeof entry.componentId === "string")
        || typeof entry.state !== "string" || !coverageStates.includes(entry.state)
        || !(entry.reasonCodes === undefined || strings(entry.reasonCodes))) return fail();
      return {
        componentKind: entry.componentKind as ActiveAlertCoverage["componentKind"],
        componentName: componentName(entry.componentKind, entry.componentId ?? null),
        componentId: entry.componentId ?? null,
        state: entry.state as ActiveAlertCoverage["state"],
        reasonCodes: entry.reasonCodes ?? [],
      };
    }),
  };
}
