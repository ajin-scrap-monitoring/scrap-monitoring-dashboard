import type { components } from "../generated/backend-contract.js";

import { recordingFixture } from "./api-contract-fixtures.js";

export const monitoringV2Fixture = {
  schemaVersion: "2",
  snapshotId: "synthetic-snapshot-1",
  serverTime: "2026-10-13T00:00:10Z",
  pitId: "pit-01",
  source: { pit_id: "pit-01", site_id: "site-demo", edge_id: "edge-demo" },
  measuredAt: "2026-10-13T00:00:09Z",
  assessmentReceivedAt: "2026-10-13T00:00:10Z",
  dataState: "UNAVAILABLE",
  reasonCodes: ["FILL_METHOD_NOT_IMPLEMENTED"],
  summary: { loadPercent: null, warningThresholdPercent: 75, collectionThresholdPercent: 85, recoveryThresholdPercent: 80 },
  assessment: {
    schema_version: "2.0",
    message_type: "edge_assessment",
    message_id: "synthetic-assessment-1",
    site_id: "site-demo",
    edge_id: "edge-demo",
    generated_at: "2026-10-13T00:00:09Z",
    config_revision: "synthetic-config-1",
    assessment_type: "STATE",
    assessment_id: "synthetic-assessment-1",
    revision: 1,
    observed_from: "2026-10-13T00:00:09Z",
    observed_to: "2026-10-13T00:00:09Z",
    rule_version: null,
    decision_state: "UNAVAILABLE",
    reason_codes: ["FILL_METHOD_NOT_IMPLEMENTED"],
    fill_state: "UNAVAILABLE",
    fill_estimate: null,
    event: null,
    capabilities: { fill: "NOT_IMPLEMENTED", occlusion: "NOT_IMPLEMENTED", collection: "NOT_IMPLEMENTED", vision: "NOT_IMPLEMENTED" },
    evidence: { scans: [], vision_observations: [] },
  },
  deviceStatus: {
    site_id: "site-demo",
    edge_id: "edge-demo",
    connection_state: "UNKNOWN",
    last_received_at: null,
    effective_state: "UNKNOWN",
    reason_codes: ["STATUS_NOT_RECEIVED"],
    snapshot: null,
  },
} satisfies components["schemas"]["MonitoringSnapshotV2"];

export function monitoringV2StateFixture(dataState: components["schemas"]["MonitoringSnapshotV2"]["dataState"], loadPercent = 0): components["schemas"]["MonitoringSnapshotV2"] {
  return {
    ...monitoringV2Fixture,
    dataState,
    reasonCodes: dataState === "FRESH" ? [] : [`SYNTHETIC_${dataState}`],
    measuredAt: dataState === "NO_DATA" ? null : monitoringV2Fixture.measuredAt,
    assessmentReceivedAt: dataState === "NO_DATA" ? null : monitoringV2Fixture.assessmentReceivedAt,
    summary: { ...monitoringV2Fixture.summary, loadPercent: dataState === "FRESH" ? loadPercent : null },
    assessment: dataState === "NO_DATA" ? null : {
      ...monitoringV2Fixture.assessment,
      decision_state: dataState === "FRESH" ? "AVAILABLE" : "UNAVAILABLE",
      fill_state: dataState === "FRESH" ? "SYNTHETIC_FILL" : "UNAVAILABLE",
      fill_estimate: dataState === "FRESH" ? { ratio: loadPercent / 100, method_version: "synthetic-test" } : null,
      capabilities: { ...monitoringV2Fixture.assessment.capabilities, fill: dataState === "FRESH" ? "ENABLED" : "NOT_IMPLEMENTED" },
    },
  };
}

export const mediaRecordingFixture = {
  ...recordingFixture,
  durationSeconds: null,
  widthPixels: null,
  heightPixels: null,
  frameRate: null,
  sizeBytes: null,
  retainedFrom: null,
  retainedUntil: null,
  thumbnailPath: null,
  contentPath: "/media/clips/550e8400-e29b-41d4-a716-446655440000/content",
  downloadPath: "/media/clips/550e8400-e29b-41d4-a716-446655440000/content?download=true",
  mediaStatus: "ready",
  coverage: "partial",
  gaps: [{ start_at: "2026-09-09T00:00:00+09:00", end_at: "2026-09-09T00:00:05+09:00" }],
  errorCode: null,
} satisfies components["schemas"]["Recording"];

export function collectionSummaryFixture(overrides: Record<string, unknown> = {}) {
  return {
    pitId: "pit-01",
    computedAt: "2026-10-13T00:00:10Z",
    lastCollectionActivityAt: null,
    secondsSinceLastCollectionActivity: null,
    activitySource: null,
    averageSettledCollectionCycleSeconds: null,
    settledCollectionsInWindow: 0,
    settledCycleCount: 0,
    settledCycleReasonCodes: ["INSUFFICIENT_SETTLED_COLLECTIONS_IN_WINDOW"],
    ...overrides,
  };
}

export function fillForecastFixture(overrides: Record<string, unknown> = {}) {
  return {
    pitId: "pit-01",
    computedAt: "2026-10-13T00:00:00Z",
    validUntil: "2026-10-13T00:05:00Z",
    state: "UNAVAILABLE",
    method: "RECENT_LINEAR_TREND_V1",
    simulated: false,
    inputSource: "HEIGHT_SECTIONS",
    currentLoadPercent: 72,
    targetThresholdPercent: 90,
    expectedThresholdAt: null,
    remainingSeconds: null,
    windowFrom: "2026-10-12T23:00:00Z",
    windowTo: "2026-10-13T00:00:00Z",
    sampleCount: 0,
    reasonCodes: ["INSUFFICIENT_SAMPLES"],
    ...overrides,
  };
}

export function lidarProfilesFixture(overrides: Record<string, unknown> = {}) {
  const profile = (sensorId: string, heights: (number | null)[], extra: Record<string, unknown> = {}) => ({
    sensorId,
    measuredAt: "2026-10-13T00:00:05Z",
    unit: "cm",
    simulated: false,
    calibrationState: "VERIFIED",
    average: 300,
    minimum: 100,
    maximum: 500,
    filteredAverage: null,
    summaryValuePolicy: "PROFILE_MEAN",
    valuePolicy: "SPATIAL_BIN_MEDIAN",
    reasonCodes: [],
    samples: heights.map((height, index) => ({ positionRatio: index / (heights.length - 1), height, valid: height !== null })),
    ...extra,
  });
  return {
    pitId: "pit-01",
    profiles: [profile("lidar-b", [100, null, 500], { average: 250, minimum: 100, maximum: 500 }), profile("lidar-a", [100, 300, 200, 500, 400])],
    meanSectionFillPercent: null,
    meanSectionReasonCodes: [],
    ...overrides,
  };
}

export function activeAlertsFixture(overrides: Record<string, unknown> = {}) {
  return {
    pitId: "pit-01",
    computedAt: "2026-10-13T00:00:10Z",
    scope: "ALL",
    evaluationState: "CRITICAL",
    items: [{
      id: "fill-critical:pit-01", type: "collection_required", severity: "error", title: "수거 필요",
      evaluatedAt: "2026-10-13T00:00:05Z", measuredAt: "2026-10-13T00:00:05Z", evaluationSource: "CURRENT_OBSERVATION",
      loadPercent: 91.5, simulated: false, notificationId: null, startedAt: null, startBasis: "UNKNOWN",
    }],
    reasonCodes: [],
    coverage: [],
    ...overrides,
  };
}

export function activeHealthAlertFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "health:edge:pit-01:edge-01", type: "device_error", severity: "warning", title: "Edge 장치 상태 이상",
    componentKind: "EDGE", componentId: "edge-01", state: "DEGRADED",
    evaluatedAt: "2026-10-13T00:00:05Z", measuredAt: "2026-10-13T00:00:00Z",
    startedAt: "2026-10-12T23:47:42Z", startBasis: "SERVER_EVALUATION",
    evidenceSource: "EDGE_STATUS", reasonCodes: [], simulated: null,
    ...overrides,
  };
}

export function activeCoverageFixture() {
  return [
    { componentKind: "CAMERA", componentId: null, state: "UNSUPPORTED", reasonCodes: ["CAMERA_HEALTH_SOURCE_NOT_CONFIGURED"] },
    { componentKind: "EDGE", componentId: "edge-01", state: "CHECKED", reasonCodes: [] },
    { componentKind: "LIDAR", componentId: "lidar-a", state: "CHECKED", reasonCodes: [] },
    { componentKind: "LIDAR", componentId: "lidar-b", state: "UNKNOWN", reasonCodes: ["LIDAR_STATUS_NOT_REPORTED"] },
    { componentKind: "MEASUREMENT", componentId: "pit-01", state: "CHECKED", reasonCodes: ["SIMULATION_GEOMETRY"] },
  ];
}

export function measurementLayoutFixture(overrides: Record<string, unknown> = {}) {
  const point = (x: number, y: number, z?: number) => z === undefined ? { x, y } : { x, y, z };
  return {
    pitId: "pit-01",
    computedAt: "2026-10-13T00:00:10Z",
    unit: "cm",
    state: "SIMULATION",
    source: "SIMULATION_REFERENCE",
    simulated: true,
    configRevision: "synthetic-r1",
    configurationGeneratedAt: "2026-10-12T00:00:00Z",
    bindingState: "MATCHED",
    coordinateFrame: { id: "synthetic-scrap-pit-v1", unit: "cm", verticalAxis: "z", handedness: "RIGHT_HANDED", originDescription: "o", xAxisDescription: "x", yAxisDescription: "y", zAxisDescription: "z" },
    region: { kind: "SIMULATION_BOUNDARY", boundary: [point(0, 0), point(400, 0), point(400, 530), point(0, 530)], floorZ: 0, topZ: 1000 },
    sensors: [
      { sensorId: "lidar-a", position: point(50, 250, 1000), calibrationVersion: null, calibrationState: "SIMULATION", measurementLine: { kind: "SCAN_PLANE_FLOOR_INTERSECTION", a: point(0, 20, 0), b: point(400, 20, 0), lengthCm: 400 }, profileMapping: { basis: "FLOOR_SECTION", axis: null, minimumCm: 0, maximumCm: 400 }, reasonCodes: [] },
      { sensorId: "lidar-b", position: point(230, 390, 1000), calibrationVersion: null, calibrationState: "SIMULATION", measurementLine: { kind: "SCAN_PLANE_FLOOR_INTERSECTION", a: point(380, 0, 0), b: point(380, 530, 0), lengthCm: 530 }, profileMapping: { basis: "FLOOR_SECTION", axis: null, minimumCm: 0, maximumCm: 530 }, reasonCodes: [] },
    ],
    reasonCodes: ["SIMULATION_GEOMETRY", "PHYSICAL_INSTALLATION_UNVERIFIED"],
    ...overrides,
  };
}

export const eventRecordingId = "evt-alert-contract-1";
export const eventRecordingDailyId = "11111111-1111-4111-8111-111111111111";

export function eventRecordingFixture(overrides: Record<string, unknown> = {}) {
  return {
    eventId: eventRecordingId,
    pitId: "pit-01",
    category: "alert",
    title: "수거 필요",
    eventType: "collection_required",
    occurredAt: "2026-10-12T01:00:00Z",
    eventTo: null,
    windowKind: "EVENT_CONTEXT",
    windowState: "POINT",
    windowFrom: "2026-10-12T00:59:30Z",
    windowTo: "2026-10-12T01:00:30Z",
    stateAtOccurrence: null,
    simulated: false,
    pitAttribution: "RECORDED",
    reasonCodes: [],
    ...overrides,
  };
}

export function eventRecordingPageFixture(items: Record<string, unknown>[] = [eventRecordingFixture()]) {
  return {
    items,
    page: { page: 1, pageSize: 100, totalItems: items.length, totalPages: items.length > 0 ? 1 : 0 },
    from: "2026-10-05T00:00:00Z",
    to: "2026-10-12T02:00:00Z",
    asOf: "2026-10-12T02:00:00Z",
  };
}

export function eventReplayPartFixture(overrides: Record<string, unknown> = {}) {
  return {
    recordingId: eventRecordingDailyId,
    recordingDate: "2026-10-12",
    playbackPath: `/media/daily-recordings/${eventRecordingDailyId}/hls/index.m3u8`,
    fromAt: "2026-10-12T00:59:30Z",
    toAt: "2026-10-12T01:00:30Z",
    startSeconds: 3570,
    endSeconds: 3630,
    relativeStartSeconds: 0,
    relativeEndSeconds: 60,
    mapping: "LINEAR",
    ...overrides,
  };
}

export function eventReplayFixture(overrides: Record<string, unknown> = {}, event: Record<string, unknown> = {}) {
  return {
    event: eventRecordingFixture(event),
    source: "DAILY_RECORDING",
    state: "AVAILABLE",
    asOf: "2026-10-12T02:00:00Z",
    effectiveTo: "2026-10-12T01:00:30Z",
    requestedSeconds: 60,
    coveredSeconds: 60,
    playbackSeconds: 60,
    parts: [eventReplayPartFixture()],
    unavailableIntervals: [],
    reasonCodes: [],
    downloadPath: null,
    downloadReasonCode: "EVENT_RANGE_EXPORT_UNSUPPORTED",
    ...overrides,
  };
}
