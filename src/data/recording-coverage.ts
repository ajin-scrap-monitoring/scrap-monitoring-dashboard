import type { RecordingCoverageDetail } from "../domain/dashboard";
import { record, timestamp, timestampValue } from "./contract-values";

export const clipIdentifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseClipCoverage(value: unknown, recordingId: string, cameraId: string): RecordingCoverageDetail {
  const fail = (): never => { throw new Error("Unexpected recording coverage contract or camera assignment."); };
  if (!clipIdentifier.test(recordingId) || !record(value) || value.clip_id !== recordingId || value.camera_id !== cameraId
    || !timestamp(value.requested_start_at) || !timestamp(value.requested_end_at)
    || timestampValue(value.requested_start_at) >= timestampValue(value.requested_end_at)
    || (value.actual_start_at !== null && !timestamp(value.actual_start_at))
    || (value.actual_end_at !== null && !timestamp(value.actual_end_at))
    || ![null, "complete", "partial", "none"].includes(value.coverage as string | null) || !Array.isArray(value.gaps)
    || (value.error !== null && (!record(value.error) || typeof value.error.code !== "string"))) return fail();
  if (typeof value.actual_start_at === "string" && typeof value.actual_end_at === "string" && timestampValue(value.actual_start_at) > timestampValue(value.actual_end_at)) return fail();
  const gaps = value.gaps.map((gap: unknown) => {
    if (!record(gap) || !timestamp(gap.start_at) || !timestamp(gap.end_at) || timestampValue(gap.start_at) >= timestampValue(gap.end_at)) return fail();
    return { start: gap.start_at, end: gap.end_at };
  });
  return {
    requestedStart: value.requested_start_at,
    requestedEnd: value.requested_end_at,
    actualStart: value.actual_start_at,
    actualEnd: value.actual_end_at,
    coverage: value.coverage as RecordingCoverageDetail["coverage"],
    gaps,
    errorCode: record(value.error) ? value.error.code as string : null,
  };
}
