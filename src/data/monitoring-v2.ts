import type { DashboardData, DashboardStatus, DeviceStatus } from "../domain/dashboard";
import type { components } from "../generated/backend-contract";
import { record, strings, nullableTimestamp as timestamp } from "./contract-values";

export type ApiMonitoringSnapshotV2 = components["schemas"]["MonitoringSnapshotV2"];
const missingValue = "정보 없음";

const states: Record<ApiMonitoringSnapshotV2["dataState"], DashboardStatus> = {
  FRESH: "fresh",
  STALE: "stale",
  UNAVAILABLE: "unavailable",
  UNKNOWN: "unknown",
  NO_DATA: "no-data",
};

function deviceStatus(state = ""): DeviceStatus["status"] {
  return /^(FRESH|HEALTHY)$/.test(state) ? "normal"
    : /^(STALE|RECOVERING|STARTING|DEGRADED|RETRYING)$/.test(state) ? "delayed"
      : /^(UNAVAILABLE|MEASUREMENT_UNAVAILABLE|CONFIG_ERROR|FATAL)$/.test(state) ? "unavailable" : "unknown";
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
  for (const key of ["warningThresholdPercent", "collectionThresholdPercent", "recoveryThresholdPercent"]) {
    const threshold = snapshot.summary[key];
    if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) return fail();
  }
  if (snapshot.operations !== undefined && snapshot.operations !== null) {
    const operations = snapshot.operations;
    if (!record(operations) || typeof operations.effectiveState !== "string"
      || !["NORMAL", "WARNING", "CRITICAL", "UNKNOWN", "ERROR"].includes(operations.effectiveState)
      || (operations.lastKnownState !== null && (typeof operations.lastKnownState !== "string" || !["NORMAL", "WARNING", "CRITICAL"].includes(operations.lastKnownState)))
      || !timestamp(operations.lastEvaluatedAt) || !timestamp(operations.lastAlertAt)
      || (operations.notificationId !== null && typeof operations.notificationId !== "string")) return fail();
  }
  const device = snapshot.deviceStatus;
  if (typeof device.connection_state !== "string" || typeof device.effective_state !== "string"
    || !timestamp(device.last_received_at) || !strings(device.reason_codes)) return fail();
  if (device.snapshot !== null) {
    if (!record(device.snapshot) || !Array.isArray(device.snapshot.sensors)) return fail();
    if (device.snapshot.clock !== undefined) {
      const clock = device.snapshot.clock;
      if (!record(clock) || typeof clock.state !== "string" || (clock.offset_ms !== null && (typeof clock.offset_ms !== "number" || !Number.isFinite(clock.offset_ms)))) return fail();
    }
    if (device.snapshot.services !== undefined) {
      if (!Array.isArray(device.snapshot.services)) return fail();
      for (const service of device.snapshot.services as unknown[]) {
        if (!record(service) || typeof service.service !== "string" || typeof service.state !== "string"
          || !timestamp(service.last_progress_at) || !strings(service.reason_codes)) return fail();
      }
    }
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
  const load = snapshot.summary.loadPercent;
  const loadPercent = snapshot.dataState === "FRESH" && typeof load === "number" && load >= 0 && load <= 100
    ? load : null;
  const sensors = device.snapshot?.sensors ?? [];
  const reporting = device.connection_state === "REPORTING";
  const cameraState = reporting ? device.snapshot?.services?.find(service => service.service === "camera-edge")?.state : "UNKNOWN";
  const sensorDevices: DeviceStatus[] = sensors.length ? sensors.map((sensor) => ({
    label: sensor.sensor_id === "lidar-a" ? "LiDAR 1" : sensor.sensor_id === "lidar-b" ? "LiDAR 2" : sensor.sensor_id,
    received: sensor.last_scan_at ?? missingValue,
    latency: missingValue,
    status: deviceStatus(reporting ? sensor.data_state : undefined),
    statusLabel: reporting ? sensor.data_state : "UNKNOWN",
  })) : ["LiDAR 1", "LiDAR 2"].map((label) => ({ label, received: missingValue, latency: missingValue, status: "unknown" }));

  return {
    alarmState: snapshot.operations?.effectiveState ?? null,
    alerts: [],
    devices: [
      ...sensorDevices,
      { label: "카메라", received: missingValue, latency: missingValue, status: deviceStatus(cameraState), statusLabel: cameraState },
      { label: "엣지 장비", received: device.last_received_at ?? missingValue, latency: missingValue, status: deviceStatus(device.effective_state), statusLabel: device.effective_state },
    ],
    headerNotifications: [],
    unreadNotificationCount: 0,
    lidarProfiles: [],
    loadHistory: [],
    status: states[snapshot.dataState],
    summary: {
      averageCollectionCycle: missingValue,
      collectionThreshold: snapshot.summary.collectionThresholdPercent,
      expectedArrivalAt: missingValue,
      loadPercent,
      operationState: null,
      preCollectionAlert: { enabled: false, threshold: snapshot.summary.warningThresholdPercent },
      loadOneHourAgo: null,
      remainingTime: missingValue,
      timeSinceCollection: missingValue,
    },
    videoMode: "mjpeg",
    videoStatus: "available",
    videoStreamId: "",
    videoCapturedAt: null,
    v2: {
      ...(snapshot.summary.simulated === true && { simulated: true }),
      serverTime: snapshot.serverTime,
      dataState: snapshot.dataState,
      snapshotId: snapshot.snapshotId,
      pitId: snapshot.pitId,
      siteId: snapshot.source.site_id,
      edgeId: snapshot.source.edge_id,
      measuredAt: snapshot.measuredAt,
      assessmentReceivedAt: snapshot.assessmentReceivedAt,
      reasonCodes: [...snapshot.reasonCodes],
      warningThreshold: snapshot.summary.warningThresholdPercent,
      recoveryThreshold: snapshot.summary.recoveryThresholdPercent,
      operations: snapshot.operations ? { ...snapshot.operations } : null,
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
      services: device.snapshot?.services?.map((service) => ({ name: service.service, state: service.state, lastProgressAt: service.last_progress_at, reasonCodes: [...service.reason_codes] })) ?? [],
      clock: device.snapshot?.clock ? { state: device.snapshot.clock.state, offsetMs: device.snapshot.clock.offset_ms } : null,
      streamState: "connecting",
    },
  };
}
