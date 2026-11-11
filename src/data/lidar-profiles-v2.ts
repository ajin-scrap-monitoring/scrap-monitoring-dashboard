import type { LidarProfile, LidarProfileSample } from "../domain/dashboard";
import { nullableTimestamp, record, strings } from "./contract-values";

const slots = [
  { sensorId: "lidar-a", label: "LiDAR 1", color: "blue" },
  { sensorId: "lidar-b", label: "LiDAR 2", color: "teal" },
] as const;
const calibrationStates = ["UNVERIFIED", "VERIFIED", "UNAVAILABLE", "SIMULATION"];
const summaryPolicies = ["PROFILE_MEAN", "SCAN_MEAN_TEMPORAL_MEDIAN"];
const sampleSources = ["MEASUREMENT", "FILTERED_POINT_CLOUD"];

function nullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function meters(centimeters: number | null | undefined) {
  return typeof centimeters === "number" ? `${(centimeters / 100).toFixed(2)} m` : "-";
}

// LidarProfileSampleV2: valid, positionRatio, height는 필수(null 가능), angleMdeg와 sourceIndex는 선택이다.
// 표본 수는 가변이고 앞쪽 다수가 valid=false, positionRatio=null, height=null일 수 있다.
function sampleOf(value: unknown): LidarProfileSample {
  if (!record(value) || typeof value.valid !== "boolean" || !nullableNumber(value.positionRatio) || !nullableNumber(value.height)
    || value.positionRatio === undefined || value.height === undefined
    || !(value.angleMdeg === undefined || Number.isInteger(value.angleMdeg)) || !(value.sourceIndex === undefined || Number.isInteger(value.sourceIndex))) {
    throw new Error("Unexpected v2 LiDAR profile sample contract.");
  }
  // 위치가 없거나 범위 밖인 표본은 제거하지 않고 높이 없는 끊김 표지로 남긴다.
  if (value.positionRatio === null || value.positionRatio < 0 || value.positionRatio > 1) return { positionRatio: null, height: null };
  return { positionRatio: value.positionRatio, height: value.valid && value.height !== null ? value.height / 100 : null };
}

export function parseLidarProfilesV2(value: unknown, pitId: string): LidarProfile[] {
  const fail = (): never => { throw new Error("Unexpected v2 LiDAR profile contract."); };
  if (!record(value) || value.pitId !== pitId || !Array.isArray(value.profiles)) return fail();
  const bySensor = new Map<string, Record<string, unknown>>();
  for (const profile of value.profiles) {
    if (!record(profile) || typeof profile.sensorId !== "string" || bySensor.has(profile.sensorId)
      || !nullableTimestamp(profile.measuredAt === undefined ? null : profile.measuredAt, true) || !Array.isArray(profile.samples)
      || !["average", "minimum", "maximum", "filteredAverage"].every((key) => profile[key] === undefined || nullableNumber(profile[key]))
      || !(profile.calibrationState === undefined || calibrationStates.includes(profile.calibrationState as string))
      || !(profile.summaryValuePolicy === undefined || summaryPolicies.includes(profile.summaryValuePolicy as string))
      || !(profile.reasonCodes === undefined || strings(profile.reasonCodes))
      || !(profile.sampleSource === undefined || sampleSources.includes(profile.sampleSource as string))
      || !(profile.processingVersion === undefined || nullableString(profile.processingVersion))
      || !(profile.sourceScanId === undefined || nullableString(profile.sourceScanId))) return fail();
    bySensor.set(profile.sensorId, profile);
  }
  return slots.map((slot) => {
    const profile = bySensor.get(slot.sensorId);
    if (!profile) return { average: "-", color: slot.color, label: slot.label, maximum: "-", minimum: "-", samples: [] };
    const representative = profile.summaryValuePolicy === "SCAN_MEAN_TEMPORAL_MEDIAN" ? profile.filteredAverage : profile.average;
    return {
      average: meters(representative as number | null | undefined),
      color: slot.color,
      label: slot.label,
      maximum: meters(profile.maximum as number | null | undefined),
      minimum: meters(profile.minimum as number | null | undefined),
      samples: ((profile.samples ?? []) as unknown[]).map(sampleOf),
      ...(profile.simulated === true && { simulated: true }),
      ...(typeof profile.calibrationState === "string" && { calibrationState: profile.calibrationState as LidarProfile["calibrationState"] }),
      ...(Array.isArray(profile.reasonCodes) && profile.reasonCodes.length > 0 && { reasonCodes: profile.reasonCodes as string[] }),
    };
  });
}

export type UnmeasuredRange = {
  side: "start" | "end" | "all";
  startRatio: number;
  endRatio: number;
  label: string;
};

export function calculateUnmeasuredRanges(
  samples: readonly { positionRatio: number | null }[],
): UnmeasuredRange[] {
  if (samples.length === 0) return [];

  const positioned = samples
    .map((s) => s.positionRatio)
    .filter((r): r is number => r !== null && Number.isFinite(r));

  if (positioned.length === 0) {
    return [
      {
        side: "all",
        startRatio: 0,
        endRatio: 1,
        label: "미측정 0%~100%",
      },
    ];
  }

  const minRatio = Math.max(0, Math.min(1, Math.min(...positioned)));
  const maxRatio = Math.max(0, Math.min(1, Math.max(...positioned)));

  const ranges: UnmeasuredRange[] = [];

  // 가로축 길이의 1% 미만인 앞쪽 또는 뒤쪽 구간은 생성하지 않는다.
  if (minRatio >= 0.01) {
    const endPercent = Math.round(minRatio * 100);
    ranges.push({
      side: "start",
      startRatio: 0,
      endRatio: minRatio,
      label: `미측정 A 0%~${endPercent}%`,
    });
  }

  if (1 - maxRatio >= 0.01) {
    const startPercent = Math.round(maxRatio * 100);
    ranges.push({
      side: "end",
      startRatio: maxRatio,
      endRatio: 1,
      label: `미측정 B ${startPercent}%~100%`,
    });
  }

  return ranges;
}
