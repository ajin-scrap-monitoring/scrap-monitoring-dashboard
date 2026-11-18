import type { LidarProfile, LidarProfileSample } from "../domain/dashboard";
import { nullableTimestamp, record, strings } from "./contract-values";

const slots = [
  { sensorId: "lidar-a", label: "LiDAR 1", color: "blue" },
  { sensorId: "lidar-b", label: "LiDAR 2", color: "teal" },
] as const;
const calibrationStates = ["UNVERIFIED", "VERIFIED", "UNAVAILABLE", "SIMULATION"];
const summaryPolicies = ["PROFILE_MEAN", "SCAN_MEAN_TEMPORAL_MEDIAN"];
const profileValuePolicies = ["SPATIAL_BIN_MEDIAN", "SPATIAL_TEMPORAL_MEDIAN", "SENSOR_ANGLE"];
const sampleSources = ["MEASUREMENT", "FILTERED_POINT_CLOUD"];
const sectionSources = ["EDGE_SECTION_PROFILE"];
const sectionJudgmentStates = ["AVAILABLE", "LIMITED", "UNAVAILABLE"];
const binSources = ["OBSERVED", "INTERPOLATED", "UNAVAILABLE", "MASKED"];

function nullableIntInRange(value: unknown, min: number, max = Infinity): boolean {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max);
}

function nullableNumberInRange(value: unknown, min: number, max: number): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max);
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function nullablePercent(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function meters(centimeters: number | null | undefined) {
  return typeof centimeters === "number" ? `${(centimeters / 100).toFixed(2)} m` : "-";
}

// LidarProfileSampleV2: valid, positionRatio, height는 필수(null 가능), angleMdeg, sourceIndex, binSource는 선택이다.
// 표본 수는 가변이고 앞쪽 다수가 valid=false, positionRatio=null, height=null일 수 있다.
function sampleOf(value: unknown): LidarProfileSample {
  if (!record(value) || typeof value.valid !== "boolean" || !nullableNumber(value.positionRatio) || !nullableNumber(value.height)
    || value.positionRatio === undefined || value.height === undefined
    || !(value.angleMdeg === undefined || Number.isInteger(value.angleMdeg)) || !(value.sourceIndex === undefined || Number.isInteger(value.sourceIndex))
    || !(value.binSource === undefined || binSources.includes(value.binSource as string))) {
    throw new Error("Unexpected v2 LiDAR profile sample contract.");
  }
  // 위치가 없거나 범위 밖인 표본은 제거하지 않고 높이 없는 끊김 표지로 남긴다.
  if (value.positionRatio === null || value.positionRatio < 0 || value.positionRatio > 1) return { positionRatio: null, height: null };
  return { positionRatio: value.positionRatio, height: value.valid && value.height !== null ? value.height / 100 : null };
}

export function parseLidarProfilesV2(value: unknown, pitId: string): LidarProfile[] {
  const fail = (): never => { throw new Error("Unexpected v2 LiDAR profile contract."); };
  if (!record(value) || value.pitId !== pitId || !Array.isArray(value.profiles)
    || !(value.meanSectionFillPercent === undefined || nullablePercent(value.meanSectionFillPercent))
    || !(value.rawMeanSectionFillPercent === undefined || nullablePercent(value.rawMeanSectionFillPercent))) return fail();
  const meanSectionReasonCodes = value.meanSectionReasonCodes === undefined ? []
    : strings(value.meanSectionReasonCodes) ? value.meanSectionReasonCodes : fail();
  const bySensor = new Map<string, Record<string, unknown>>();
  for (const profile of value.profiles) {
    if (!record(profile) || typeof profile.sensorId !== "string" || bySensor.has(profile.sensorId)
      || !nullableTimestamp(profile.measuredAt === undefined ? null : profile.measuredAt, true) || !Array.isArray(profile.samples)
      || !["average", "minimum", "maximum", "filteredAverage"].every((key) => profile[key] === undefined || nullableNumber(profile[key]))
      || !(profile.calibrationState === undefined || calibrationStates.includes(profile.calibrationState as string))
      || !(profile.summaryValuePolicy === undefined || summaryPolicies.includes(profile.summaryValuePolicy as string))
      || !(profile.valuePolicy === undefined || profileValuePolicies.includes(profile.valuePolicy as string))
      || !(profile.displayBinCount === undefined || nullableIntInRange(profile.displayBinCount, 2, 200))
      || !(profile.displayCoverageRatio === undefined || nullableNumberInRange(profile.displayCoverageRatio, 0, 1))
      || !(profile.displayUnpositionedCount === undefined || nullableIntInRange(profile.displayUnpositionedCount, 0))
      || !(profile.reasonCodes === undefined || strings(profile.reasonCodes))
      || !(profile.sampleSource === undefined || profile.sampleSource === null || sampleSources.includes(profile.sampleSource as string))
      || !(profile.sectionSource === undefined || profile.sectionSource === null || sectionSources.includes(profile.sectionSource as string))
      || !(profile.sectionJudgmentState === undefined || profile.sectionJudgmentState === null || sectionJudgmentStates.includes(profile.sectionJudgmentState as string))
      || !(profile.sectionFillPercent === undefined || nullablePercent(profile.sectionFillPercent))
      || !(profile.processingVersion === undefined || nullableString(profile.processingVersion))
      || !(profile.sourceScanId === undefined || nullableString(profile.sourceScanId))) return fail();
    bySensor.set(profile.sensorId, profile);
  }
  return slots.map((slot) => {
    const profile = bySensor.get(slot.sensorId);
    if (!profile) return { average: "-", color: slot.color, label: slot.label, maximum: "-", minimum: "-", samples: [], sensorId: slot.sensorId, measuredAt: null };
    const representative = profile.summaryValuePolicy === "SCAN_MEAN_TEMPORAL_MEDIAN" ? profile.filteredAverage : profile.average;
    const mergedReasonCodes = Array.from(new Set([
      ...(Array.isArray(profile.reasonCodes) ? (profile.reasonCodes as string[]) : []),
      ...meanSectionReasonCodes,
    ]));
    return {
      average: meters(representative as number | null | undefined),
      color: slot.color,
      label: slot.label,
      maximum: meters(profile.maximum as number | null | undefined),
      minimum: meters(profile.minimum as number | null | undefined),
      samples: ((profile.samples ?? []) as unknown[]).map(sampleOf),
      sensorId: slot.sensorId,
      measuredAt: typeof profile.measuredAt === "string" ? profile.measuredAt : null,
      ...(profile.simulated === true && { simulated: true }),
      ...(typeof profile.calibrationState === "string" && { calibrationState: profile.calibrationState as LidarProfile["calibrationState"] }),
      ...(mergedReasonCodes.length > 0 && { reasonCodes: mergedReasonCodes }),
    };
  });
}

export type UnmeasuredRange = {
  side: "start" | "middle" | "end" | "all";
  startRatio: number;
  endRatio: number;
  label: string;
};

type LidarPositionSample = {
  positionRatio: number | null;
  height?: number | null;
};

function isMeasuredPositionSample(
  sample: LidarPositionSample,
): sample is { positionRatio: number; height?: number | null } {
  if (sample.positionRatio === null || !Number.isFinite(sample.positionRatio)) return false;
  if (sample.height === undefined) return true;
  return sample.height !== null && Number.isFinite(sample.height);
}

export function calculateUnmeasuredRanges(
  samples: readonly LidarPositionSample[],
): UnmeasuredRange[] {
  if (samples.length === 0) return [];

  const segmentSpans: [number, number][] = [];
  let spanMin = Infinity;
  let spanMax = -Infinity;

  for (const sample of samples) {
    if (isMeasuredPositionSample(sample)) {
      const clamped = Math.max(0, Math.min(1, sample.positionRatio));
      if (clamped < spanMin) spanMin = clamped;
      if (clamped > spanMax) spanMax = clamped;
    } else if (spanMin <= spanMax) {
      segmentSpans.push([spanMin, spanMax]);
      spanMin = Infinity;
      spanMax = -Infinity;
    }
  }
  if (spanMin <= spanMax) {
    segmentSpans.push([spanMin, spanMax]);
  }

  if (segmentSpans.length === 0) {
    return [
      {
        side: "all",
        startRatio: 0,
        endRatio: 1,
        label: "미측정 0%~100%",
      },
    ];
  }

  segmentSpans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const covered: [number, number][] = [segmentSpans[0]];
  for (let i = 1; i < segmentSpans.length; i += 1) {
    const prev = covered[covered.length - 1];
    const [nextStart, nextEnd] = segmentSpans[i];
    if (nextStart <= prev[1]) {
      prev[1] = Math.max(prev[1], nextEnd);
    } else {
      covered.push([nextStart, nextEnd]);
    }
  }

  const minRatio = covered[0][0];
  const maxRatio = covered[covered.length - 1][1];
  const ranges: UnmeasuredRange[] = [];

  // 가로축 길이의 1% 미만인 앞쪽 또는 뒤쪽 바깥 구간은 생성하지 않는다.
  if (minRatio >= 0.01) {
    ranges.push({
      side: "start",
      startRatio: 0,
      endRatio: minRatio,
      label: `미측정 A 0%~${Math.round(minRatio * 100)}%`,
    });
  }

  // 유효 구간 사이의 중간 결손 구간은 길이와 무관하게 모두 미측정 빗금 구간으로 생성한다.
  for (let i = 0; i < covered.length - 1; i += 1) {
    const gapStart = covered[i][1];
    const gapEnd = covered[i + 1][0];
    if (gapEnd > gapStart) {
      ranges.push({
        side: "middle",
        startRatio: gapStart,
        endRatio: gapEnd,
        label: `미측정 ${Math.round(gapStart * 100)}%~${Math.round(gapEnd * 100)}%`,
      });
    }
  }

  if (1 - maxRatio >= 0.01) {
    ranges.push({
      side: "end",
      startRatio: maxRatio,
      endRatio: 1,
      label: `미측정 B ${Math.round(maxRatio * 100)}%~100%`,
    });
  }

  return ranges;
}
