export const recentPeriods = [
  { hours: 24, label: "최근 24시간" },
  { hours: 168, label: "최근 7일" },
  { hours: 720, label: "최근 30일" },
  { hours: 2160, label: "최근 90일" },
];

export function isValidDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16) === value;
}

export function recentRange(hours: number, endsAt: string) {
  const end = new Date(endsAt.replace(" ", "T"));
  end.setSeconds(0, 0);
  const start = new Date(end.getTime() - hours * 3_600_000);
  const format = (date: Date) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
    return local.toISOString().slice(0, 16);
  };
  return { start: format(start), end: format(end) };
}
