import { displayTimeOffset } from "../display-time";

export const missingValue = "정보 없음";

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

export function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  const date = value.slice(0, 10);
  const midnight = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(midnight) && new Date(midnight).toISOString().startsWith(date);
}

export function nullableTimestamp(value: unknown, nullable = true): boolean {
  return (nullable && value === null) || timestamp(value);
}

export function timestampValue(value: string) {
  const fraction = value.match(/\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/i)?.[1];
  return fraction === undefined ? Date.parse(value)
    : Date.parse(value.replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/i, "")) + Number(`0.${fraction}`) * 1000;
}

export function pathWithId(path: string, parameterOrId: string, value?: string) {
  return value === undefined
    ? path.replace(/\{[^}]+\}/, encodeURIComponent(parameterOrId))
    : path.replace(`{${parameterOrId}}`, encodeURIComponent(value));
}

export function rfc3339AtOffset(timestamp: number, offset: string, preserveMilliseconds = false) {
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  const offsetMinutes = match
    ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0;
  const suffix = match ? offset : "Z";
  const iso = new Date(timestamp + offsetMinutes * 60_000).toISOString();
  return preserveMilliseconds ? iso.replace(/Z$/, suffix) : iso.replace(/\.\d{3}Z$/, suffix);
}

export function wallClock(value: string | null, includeSeconds = false) {
  if (value === null) return missingValue;
  const instant = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : Number.NaN;
  const text = Number.isFinite(instant) ? rfc3339AtOffset(instant, displayTimeOffset, true) : value;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return value;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}${includeSeconds ? `:${match[6] ?? "00"}` : ""}`;
}

export function timeOnly(value: string | null, includeSeconds = false) {
  if (value === null) return missingValue;
  return wallClock(value, includeSeconds).split(" ")[1] ?? value;
}
