export function timeAxisTicks(from: number, to: number, stepHours: number, offsetMinutes = 0) {
  const step = Math.max(1, Math.ceil(stepHours)) * 3_600_000;
  const offset = offsetMinutes * 60_000;
  const first = Math.ceil((from + offset) / step) * step - offset;
  const count = Math.max(0, Math.floor((to - first) / step) + 1);
  return Number.isFinite(count) ? Array.from({ length: count }, (_, index) => first + index * step) : [];
}
