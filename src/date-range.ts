export const recentPeriods = [
  { hours: 24, label: "최근 24시간" },
  { hours: 168, label: "최근 7일" },
  { hours: 720, label: "최근 30일" },
  { hours: 2160, label: "최근 90일" },
];

export function dateTimeValue(value: string) {
  const normalized = value.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(normalized)) {
    return Date.parse(`${normalized}${normalized.length === 16 ? ":00" : ""}Z`);
  }
  return Date.parse(normalized);
}

export function isValidDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const timestamp = dateTimeValue(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 16) === value;
}

export function recentRange(hours: number, endsAt: string) {
  const end = dateTimeValue(endsAt);
  const format = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 16);
  return { start: format(end - hours * 3_600_000), end: format(end) };
}
