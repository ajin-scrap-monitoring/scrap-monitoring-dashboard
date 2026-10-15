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
