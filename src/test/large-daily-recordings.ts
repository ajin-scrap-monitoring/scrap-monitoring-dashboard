import { dailyRecordingFixture } from "./daily-recording-fixtures";

const iso = (value: number) => new Date(value).toISOString().replace(".000Z", "Z");

// 하루 안에 20초 간격으로 누락 구간과 확보 구간을 번갈아 배치한 대용량 날짜 녹화 항목이다.
export function largeDailyRecording(index: number, gapCount = 2000, intervalCount = 900) {
  const day = 12 + index;
  const start = Date.parse(`2026-10-${String(day - 1).padStart(2, "0")}T15:00:00Z`);
  const gaps: Array<{ start_at: string; end_at: string; reason_code: string }> = [];
  const intervals: Array<{ start_at: string; end_at: string; playback_start_seconds: number; playback_end_seconds: number }> = [];
  let at = start;
  let playback = 0;
  while (gaps.length < gapCount || intervals.length < intervalCount) {
    if (gaps.length < gapCount && (gaps.length < intervals.length * 2.2 || intervals.length >= intervalCount)) {
      gaps.push({ start_at: iso(at), end_at: iso(at + 10_000), reason_code: "CAMERA_DISCONNECTED" });
    } else {
      intervals.push({ start_at: iso(at), end_at: iso(at + 5000), playback_start_seconds: playback, playback_end_seconds: playback + 5 });
      playback += 5;
    }
    at += 20_000;
  }
  const id = `550e8400-e29b-41d4-a716-44665544000${index}`;
  return {
    ...dailyRecordingFixture,
    recording_id: id,
    recording_date: `2026-10-${day}`,
    window_start_at: iso(start),
    window_end_at: iso(start + 86_400_000),
    coverage_as_of_at: iso(at),
    playable_until_at: intervals.at(-1)?.end_at ?? null,
    recorded_seconds: playback,
    gaps,
    available_intervals: intervals,
    playback_path: `/media/daily-recordings/${id}/hls/index.m3u8`,
  };
}

export function largeDailyPage(items = 5, gapCount = 2000, intervalCount = 900) {
  return { items: Array.from({ length: items }, (_, index) => largeDailyRecording(index, gapCount, intervalCount)), next_cursor: null };
}
