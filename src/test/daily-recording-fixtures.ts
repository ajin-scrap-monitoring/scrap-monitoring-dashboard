import type { components } from "../generated/backend-contract.js";

export const dailyRecordingId = "550e8400-e29b-41d4-a716-446655440000";

export const dailyRecordingFixture = {
  recording_id: dailyRecordingId,
  camera_id: "camera-main",
  recording_date: "2026-10-12",
  timezone: "Asia/Seoul",
  window_start_at: "2026-10-11T15:00:00Z",
  window_end_at: "2026-10-12T15:00:00Z",
  status: "closed",
  coverage: "partial",
  has_gaps: true,
  coverage_as_of_at: "2026-10-11T15:01:00Z",
  playable_until_at: "2026-10-11T15:01:00Z",
  recorded_seconds: 50,
  gaps: [{ start_at: "2026-10-11T15:00:20Z", end_at: "2026-10-11T15:00:30Z", reason_code: "CAMERA_DISCONNECTED" }],
  available_intervals: [
    { start_at: "2026-10-11T15:00:00Z", end_at: "2026-10-11T15:00:20Z", playback_start_seconds: 0, playback_end_seconds: 20 },
    { start_at: "2026-10-11T15:00:30Z", end_at: "2026-10-11T15:01:00Z", playback_start_seconds: 20, playback_end_seconds: 50 },
  ],
  playback_state: "ready",
  playback_protocol: "hls",
  playback_path: `/media/daily-recordings/${dailyRecordingId}/hls/index.m3u8`,
  export_allowed: true,
  export_state: "not_requested",
  download_path: null,
  size_bytes: null,
  expires_at: "2026-11-12T15:00:00Z",
  export_expires_at: null,
  error: null,
} as const satisfies components["schemas"]["DailyRecording"];
