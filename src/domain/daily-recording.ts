type DailyRecordingBase = {
  source: "daily";
  id: string;
  cameraId: string;
  recordingDate: string;
  timezone: "Asia/Seoul";
  windowStartsAt: string;
  windowEndsAt: string;
  status: "recording" | "finalizing" | "closed" | "failed" | "expired" | "deleted";
  coverage: "complete" | "partial" | "none" | null;
  hasGaps: boolean;
  coverageAsOfAt: string;
  playableUntilAt: string | null;
  recordedSeconds: number;
  playbackState: "pending" | "ready" | "unavailable";
  playbackProtocol: "hls" | null;
  playbackPath: string | null;
  exportAllowed: boolean;
  exportState: "not_requested" | "processing" | "ready" | "failed";
  downloadPath: string | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  exportExpiresAt: string | null;
  error: { code: string; message: string } | null;
  deletedAt?: string | null;
  cleanupState?: "pending" | "failed" | "complete" | null;
  cleanupCompletedAt?: string | null;
  cleanupError?: { code: string; message: string } | null;
  spaceReclaimed?: null;
};

export type DailyRecordingFull = DailyRecordingBase & {
  view: "full";
  gaps: { startsAt: string; endsAt: string; reasonCode: string }[];
  availableIntervals: { startsAt: string; endsAt: string; playbackStartsAtSeconds: number; playbackEndsAtSeconds: number }[];
};

export type DailyRecordingSummary = DailyRecordingBase & {
  view: "summary";
  gapCount: number;
  availableIntervalCount: number;
};

export type DailyRecording = DailyRecordingFull | DailyRecordingSummary;
