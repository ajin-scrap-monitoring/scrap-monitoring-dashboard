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
