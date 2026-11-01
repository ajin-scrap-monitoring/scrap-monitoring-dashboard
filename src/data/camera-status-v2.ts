import { nullableTimestamp, record, strings, timestamp } from "./contract-values";

export type CameraStatusState = "HEALTHY" | "INTERRUPTED" | "UNKNOWN" | "UNSUPPORTED";
export type CameraConnectionState = "CONNECTED" | "DISCONNECTED" | "UNKNOWN";

export type CameraStatusV2 = {
  pitId: string;
  cameraId: string | null;
  state: CameraStatusState;
  connectionState: CameraConnectionState;
  statusBasis: "ACCEPTED_JPEG_RECEIPT" | null;
  computedAt: string;
  assessedAt: string | null;
  validUntilAt: string | null;
  validForSeconds: number | null;
  lastFrameReceivedAt: string | null;
  reasonCodes: string[];
};

const states: CameraStatusState[] = ["HEALTHY", "INTERRUPTED", "UNKNOWN", "UNSUPPORTED"];
const connectionStates: CameraConnectionState[] = ["CONNECTED", "DISCONNECTED", "UNKNOWN"];

export function parseCameraStatusV2(value: unknown, pitId: string): CameraStatusV2 {
  const fail = (): never => {
    throw new Error("Unexpected v2 camera-status contract.");
  };

  if (!record(value)) return fail();

  if (typeof value.pitId !== "string" || value.pitId !== pitId) return fail();
  if (!(value.cameraId === null || typeof value.cameraId === "string")) return fail();
  if (typeof value.state !== "string" || !states.includes(value.state as CameraStatusState)) return fail();

  const connectionState: CameraConnectionState =
    value.connectionState === undefined ? "UNKNOWN"
    : typeof value.connectionState === "string" && connectionStates.includes(value.connectionState as CameraConnectionState)
      ? (value.connectionState as CameraConnectionState)
      : fail();

  if (!(value.statusBasis === undefined || value.statusBasis === null || value.statusBasis === "ACCEPTED_JPEG_RECEIPT")) return fail();
  if (!timestamp(value.computedAt)) return fail();
  if (!nullableTimestamp(value.assessedAt, true)) return fail();
  if (!nullableTimestamp(value.validUntilAt, true)) return fail();

  if (!(value.validForSeconds === undefined || value.validForSeconds === null || (typeof value.validForSeconds === "number" && Number.isFinite(value.validForSeconds) && value.validForSeconds >= 0 && value.validForSeconds <= 5.0))) {
    return fail();
  }

  if (!nullableTimestamp(value.lastFrameReceivedAt, true)) return fail();
  if (!strings(value.reasonCodes)) return fail();

  return {
    pitId: value.pitId,
    cameraId: value.cameraId ?? null,
    state: value.state as CameraStatusState,
    connectionState,
    statusBasis: value.statusBasis ?? null,
    computedAt: value.computedAt,
    assessedAt: (value.assessedAt as string | null | undefined) ?? null,
    validUntilAt: (value.validUntilAt as string | null | undefined) ?? null,
    validForSeconds: value.validForSeconds ?? null,
    lastFrameReceivedAt: (value.lastFrameReceivedAt as string | null | undefined) ?? null,
    reasonCodes: value.reasonCodes,
  };
}
