import { missingValue } from "./contract-values";

export const eventRecordingIdentifier = /^[A-Za-z0-9._:-]{1,200}$/;

export function choice<const T extends readonly string[]>(value: unknown, options: T, failMsg = "Unexpected contract"): T[number] {
  if (typeof value === "string" && (options as readonly string[]).includes(value)) return value;
  throw new Error(failMsg);
}

export function clockDuration(seconds: number | null) {
  if (seconds === null) return missingValue;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function byteSize(bytes: number | null) {
  if (bytes === null) return missingValue;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
