import type { DashboardData, DashboardStatus } from "../domain/dashboard";
import type { components } from "../generated/backend-contract";

export type ApiMonitoringSnapshotV2 = components["schemas"]["MonitoringSnapshotV2"];

const states: Record<ApiMonitoringSnapshotV2["dataState"], DashboardStatus> = {
  FRESH: "fresh",
  STALE: "stale",
  UNAVAILABLE: "unavailable",
  UNKNOWN: "unknown",
  NO_DATA: "no-data",
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function timestamp(value: unknown, nullable = true) {
  return (nullable && value === null) || (typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)));
}

function validate(snapshot: unknown, pitId: string): asserts snapshot is ApiMonitoringSnapshotV2 {
  const fail = () => { throw new Error("Unexpected monitoring contract or pit assignment."); };
  if (!record(snapshot) || snapshot.schemaVersion !== "2" || snapshot.pitId !== pitId
    || typeof snapshot.dataState !== "string" || !Object.hasOwn(states, snapshot.dataState)
    || typeof snapshot.snapshotId !== "string" || !snapshot.snapshotId
    || !timestamp(snapshot.serverTime, false) || !timestamp(snapshot.measuredAt) || !timestamp(snapshot.assessmentReceivedAt)
    || !strings(snapshot.reasonCodes) || !record(snapshot.source) || snapshot.source.pit_id !== pitId
    || typeof snapshot.source.site_id !== "string" || typeof snapshot.source.edge_id !== "string"
    || !record(snapshot.summary) || !record(snapshot.deviceStatus)) return fail();
  for (const key of ["warningThresholdPercent", "collectionThresholdPercent"]) {
    const threshold = snapshot.summary[key];
    if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) return fail();
  }
  const device = snapshot.deviceStatus;
  if (typeof device.connection_state !== "string" || typeof device.effective_state !== "string"
    || !timestamp(device.last_received_at) || !strings(device.reason_codes)) return fail();
  if (device.snapshot !== null) {
    if (!record(device.snapshot) || !Array.isArray(device.snapshot.sensors)) return fail();
    for (const sensor of device.snapshot.sensors as unknown[]) {
      if (!record(sensor) || typeof sensor.sensor_id !== "string" || typeof sensor.data_state !== "string"
        || !timestamp(sensor.last_scan_at) || !strings(sensor.reason_codes)) return fail();
    }
  }
  if (snapshot.assessment !== null) {
    const assessment = snapshot.assessment;
    if (!record(assessment) || (assessment.fill_state !== null && typeof assessment.fill_state !== "string")
      || typeof assessment.decision_state !== "string" || typeof assessment.config_revision !== "string"
      || !record(assessment.capabilities)) return fail();
    const capabilityStates = ["NOT_IMPLEMENTED", "NOT_VALIDATED", "ENABLED"];
    for (const key of ["fill", "occlusion", "collection", "vision"]) {
      const capability = assessment.capabilities[key];
      if (typeof capability !== "string" || !capabilityStates.includes(capability)) return fail();
    }
  }
}

export function monitoringV2Data(snapshot: unknown, pitId: string): DashboardData["monitoring"] {
  validate(snapshot, pitId);
  const assessment = snapshot.assessment;
  const device = snapshot.deviceStatus;
  const load = snapshot.summary.loadPercent ?? null;
  const loadPercent = snapshot.dataState === "FRESH" && typeof load === "number" && Number.isFinite(load) && load >= 0 && load <= 100
    ? load : null;

  return {
    alerts: [],
    devices: [],
    headerNotifications: [],
    unreadNotificationCount: 0,
    lidarProfiles: [],
    loadHistory: [],
    status: states[snapshot.dataState],
    summary: {
      averageCollectionCycle: "정보 없음",
      collectionThreshold: snapshot.summary.collectionThresholdPercent,
      expectedArrivalAt: "정보 없음",
      loadPercent,
      operationState: null,
      preCollectionAlert: { enabled: false, threshold: snapshot.summary.warningThresholdPercent },
      recentChange: "정보 없음",
      remainingTime: "정보 없음",
      timeSinceCollection: "정보 없음",
    },
    videoMode: "mjpeg",
    videoStatus: "available",
    videoStreamId: "",
    videoTimestamp: "촬영 시각 미제공",
    v2: {
      dataState: snapshot.dataState,
      snapshotId: snapshot.snapshotId,
      pitId: snapshot.pitId,
      siteId: snapshot.source.site_id,
      edgeId: snapshot.source.edge_id,
      measuredAt: snapshot.measuredAt,
      assessmentReceivedAt: snapshot.assessmentReceivedAt,
      reasonCodes: [...snapshot.reasonCodes],
      warningThreshold: snapshot.summary.warningThresholdPercent,
      fillState: assessment?.fill_state ?? null,
      decisionState: assessment?.decision_state ?? null,
      configRevision: assessment?.config_revision ?? null,
      capabilities: assessment ? { ...assessment.capabilities } : null,
      connectionState: device.connection_state,
      effectiveState: device.effective_state,
      deviceReceivedAt: device.last_received_at,
      deviceReasons: [...device.reason_codes],
      sensors: device.snapshot?.sensors.map((sensor) => ({
        id: sensor.sensor_id,
        state: sensor.data_state,
        lastScanAt: sensor.last_scan_at,
        reasonCodes: [...sensor.reason_codes],
      })) ?? [],
      streamState: "connecting",
    },
  };
}
