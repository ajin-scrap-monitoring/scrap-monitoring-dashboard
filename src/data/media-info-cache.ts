// Backend가 파일 완성 시점에 측정한 값을 제공하면 서버 값을 우선하고 이 fallback을 제거한다.

import { record } from "./contract-values";

export type FileMediaInfo = {
  status: "ready" | "unknown";
  codec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  fpsNum: number | null;
  fpsDen: number | null;
  sizeBytes: number | null;
  reasonCode: string | null;
};

export type SegmentFormat = {
  codec?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  fpsNum?: number | null;
  fpsDen?: number | null;
  segmentCount?: number;
};

export type SegmentMediaInfo = {
  status: "ready" | "partial" | "unknown";
  total: number;
  measured: number;
  formats: SegmentFormat[];
  mixed: boolean | null;
};

export type DailyMediaInfoResult = {
  kind: "daily";
  recordingId: string;
  file: FileMediaInfo | null;
  segments: SegmentMediaInfo;
  storedSizeBytes: number | null;
};

export type ClipMediaInfoResult = {
  kind: "clip";
  clipId: string;
  sizeBytes: number | null;
  mediaInfo: FileMediaInfo;
  storedSizeBytes: number | null;
};

type CachedEntry<T> = {
  result: T;
  storedSizeBytes: number | null;
};

const memoryCache = new Map<string, CachedEntry<DailyMediaInfoResult | ClipMediaInfoResult>>();
const inFlight = new Map<string, Promise<unknown>>();

let activeCount = 0;
const waitingQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeCount < 2) {
    activeCount += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waitingQueue.push(() => {
      activeCount += 1;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeCount -= 1;
  const next = waitingQueue.shift();
  if (next) {
    next();
  }
}

function dailyStorageKey(recordingId: string): string {
  return `scrap-dashboard:media-info:v1:daily:${recordingId}`;
}

function clipStorageKey(clipId: string): string {
  return `scrap-dashboard:media-info:v1:clip:${clipId}`;
}

export function parseFileMediaInfo(value: unknown): FileMediaInfo {
  if (!record(value)) {
    return {
      status: "unknown",
      codec: null,
      width: null,
      height: null,
      fps: null,
      fpsNum: null,
      fpsDen: null,
      sizeBytes: null,
      reasonCode: "metadata_unavailable",
    };
  }
  const status = value.status === "ready" ? "ready" : "unknown";
  return {
    status,
    codec: typeof value.codec === "string" ? value.codec : null,
    width: typeof value.width === "number" && Number.isFinite(value.width) ? value.width : null,
    height: typeof value.height === "number" && Number.isFinite(value.height) ? value.height : null,
    fps: typeof value.fps === "number" && Number.isFinite(value.fps) ? value.fps : null,
    fpsNum: typeof value.fps_num === "number" && Number.isFinite(value.fps_num) ? value.fps_num : null,
    fpsDen: typeof value.fps_den === "number" && Number.isFinite(value.fps_den) ? value.fps_den : null,
    sizeBytes: typeof value.size_bytes === "number" && Number.isFinite(value.size_bytes) ? value.size_bytes : null,
    reasonCode: typeof value.reason_code === "string" ? value.reason_code : null,
  };
}

export function parseDailyMediaInfo(value: unknown, recordingId: string): DailyMediaInfoResult {
  if (!record(value)) throw new Error("Unexpected daily media-info response.");
  const file = value.file ? parseFileMediaInfo(value.file) : null;
  const rawSegments = record(value.segments) ? value.segments : {};
  const status = rawSegments.status === "ready" || rawSegments.status === "partial" ? rawSegments.status : "unknown";
  const formats = Array.isArray(rawSegments.formats)
    ? rawSegments.formats.map((f: unknown): SegmentFormat => record(f) ? ({
        codec: typeof f.codec === "string" ? f.codec : null,
        width: typeof f.width === "number" ? f.width : null,
        height: typeof f.height === "number" ? f.height : null,
        fps: typeof f.fps === "number" ? f.fps : null,
        fpsNum: typeof f.fps_num === "number" ? f.fps_num : null,
        fpsDen: typeof f.fps_den === "number" ? f.fps_den : null,
        segmentCount: typeof f.segment_count === "number" ? f.segment_count : undefined,
      }) : {})
    : [];
  const mixed = typeof rawSegments.mixed === "boolean" ? rawSegments.mixed : null;
  const segments: SegmentMediaInfo = {
    status,
    total: typeof rawSegments.total === "number" ? rawSegments.total : 0,
    measured: typeof rawSegments.measured === "number" ? rawSegments.measured : 0,
    formats,
    mixed,
  };

  return {
    kind: "daily",
    recordingId,
    file,
    segments,
    storedSizeBytes: file?.sizeBytes ?? null,
  };
}

export function parseClipMediaInfo(value: unknown, clipId: string): ClipMediaInfoResult {
  if (!record(value)) throw new Error("Unexpected clip media-info response.");
  const mediaInfo = parseFileMediaInfo(value.media_info);
  const sizeBytes = typeof value.size_bytes === "number" && Number.isFinite(value.size_bytes) ? value.size_bytes : null;

  return {
    kind: "clip",
    clipId,
    sizeBytes,
    mediaInfo,
    storedSizeBytes: sizeBytes ?? mediaInfo.sizeBytes ?? null,
  };
}

export function getCachedDailyMediaInfo(
  recordingId: string,
  currentStatus?: string | null,
  currentSizeBytes?: number | null,
): DailyMediaInfoResult | null {
  if (currentStatus === "deleted" || currentStatus === "expired") return null;
  const key = dailyStorageKey(recordingId);
  let entry = memoryCache.get(key) as CachedEntry<DailyMediaInfoResult> | undefined;

  if (!entry) {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          entry = JSON.parse(raw) as CachedEntry<DailyMediaInfoResult>;
          memoryCache.set(key, entry);
        }
      }
    } catch {
      // 무시
    }
  }

  if (entry) {
    if (currentSizeBytes !== undefined && currentSizeBytes !== null && entry.storedSizeBytes !== null && entry.storedSizeBytes !== currentSizeBytes) {
      clearCachedDailyMediaInfo(recordingId);
      return null;
    }
    return entry.result;
  }

  return null;
}

export function setCachedDailyMediaInfo(
  recordingId: string,
  result: DailyMediaInfoResult,
  currentStatus?: string | null,
): void {
  if (currentStatus === "deleted" || currentStatus === "expired") {
    return;
  }

  const key = dailyStorageKey(recordingId);
  const entry: CachedEntry<DailyMediaInfoResult> = {
    result,
    storedSizeBytes: result.storedSizeBytes,
  };
  memoryCache.set(key, entry);

  const isCompletedFile = currentStatus !== "recording" && currentStatus !== "finalizing" && result.file?.status === "ready";
  if (isCompletedFile) {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, JSON.stringify(entry));
      }
    } catch {
      // 무시
    }
  }
}

export function clearCachedDailyMediaInfo(recordingId: string): void {
  const key = dailyStorageKey(recordingId);
  memoryCache.delete(key);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // 무시
  }
}

export function getCachedClipMediaInfo(
  clipId: string,
  currentStatus?: string | null,
  currentSizeBytes?: number | null,
): ClipMediaInfoResult | null {
  if (currentStatus === "deleted" || currentStatus === "expired") return null;
  const key = clipStorageKey(clipId);
  let entry = memoryCache.get(key) as CachedEntry<ClipMediaInfoResult> | undefined;

  if (!entry) {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          entry = JSON.parse(raw) as CachedEntry<ClipMediaInfoResult>;
          memoryCache.set(key, entry);
        }
      }
    } catch {
      // 무시
    }
  }

  if (entry) {
    if (currentSizeBytes !== undefined && currentSizeBytes !== null && entry.storedSizeBytes !== null && entry.storedSizeBytes !== currentSizeBytes) {
      clearCachedClipMediaInfo(clipId);
      return null;
    }
    return entry.result;
  }

  return null;
}

export function setCachedClipMediaInfo(
  clipId: string,
  result: ClipMediaInfoResult,
  currentStatus?: string | null,
): void {
  if (currentStatus === "deleted" || currentStatus === "expired") return;

  const key = clipStorageKey(clipId);
  const entry: CachedEntry<ClipMediaInfoResult> = {
    result,
    storedSizeBytes: result.storedSizeBytes,
  };
  memoryCache.set(key, entry);

  const isCompletedFile = result.mediaInfo.status === "ready";
  if (isCompletedFile) {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, JSON.stringify(entry));
      }
    } catch {
      // 무시
    }
  }
}

export function clearCachedClipMediaInfo(clipId: string): void {
  const key = clipStorageKey(clipId);
  memoryCache.delete(key);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // 무시
  }
}

/**
 * 동시 최대 2개 실행 및 동일 키 요청 병합을 지원하는 실행기
 */
export async function scheduleMediaInfoRequest<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = (async () => {
    await acquireSlot();
    try {
      return await fetcher();
    } finally {
      releaseSlot();
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

export function clearAllMemoryMediaInfo(): void {
  memoryCache.clear();
  inFlight.clear();
}
