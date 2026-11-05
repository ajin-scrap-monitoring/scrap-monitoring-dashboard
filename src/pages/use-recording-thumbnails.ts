import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { EventExportStatus } from "../data/event-recordings";
import {
  isCanonicalUuid,
  isValidThumbnailContentPath,
  type ThumbnailInfo,
  type ThumbnailTarget,
} from "../data/recording-thumbnail";
import type { Recording } from "../domain/dashboard";

const MAX_CONCURRENT_REQUESTS = 3;
const PENDING_POLL_INTERVALS_MS = [5000, 10000, 20000];

export type ThumbnailCacheEntry = {
  target: ThumbnailTarget;
  info?: ThumbnailInfo;
  errorStatus?: number;
  imageFailed?: boolean;
  pollCount: number;
};

export function targetKey(target: ThumbnailTarget): string {
  return `${target.kind}:${target.id}`;
}

export type ThumbnailStore = {
  get: (this: void, key: string) => ThumbnailCacheEntry | undefined;
  update: (this: void, key: string, updater: (prev?: ThumbnailCacheEntry) => ThumbnailCacheEntry) => void;
  subscribe: (this: void, listener: () => void) => () => void;
  getSnapshot: (this: void) => Record<string, ThumbnailCacheEntry>;
};

export function createThumbnailStore(): ThumbnailStore {
  let state: Record<string, ThumbnailCacheEntry> = {};
  const listeners = new Set<() => void>();

  return {
    get: (key: string) => state[key],
    update: (key: string, updater: (prev?: ThumbnailCacheEntry) => ThumbnailCacheEntry) => {
      state = { ...state, [key]: updater(state[key]) };
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
  };
}

export function resolveThumbnailTarget(
  recording: Recording,
  knownClipId?: string | null,
): ThumbnailTarget | null {
  if (recording.source === "daily" || recording.daily) {
    const daily = recording.daily;
    if (!daily) return null;
    if (daily.status === "recording" || daily.status === "finalizing") return null;
    if (daily.exportState !== "ready") return null;
    const id = daily.id ?? recording.id;
    if (!isCanonicalUuid(id)) return null;
    return { kind: "daily", id };
  }

  const clipId = knownClipId;
  if (!clipId || !isCanonicalUuid(clipId)) return null;
  return { kind: "clip", id: clipId };
}

export function useRecordingThumbnails({
  dataSource,
  pagedRecordings,
  selectedRecording,
  eventExport,
}: {
  dataSource?: DashboardDataSource;
  pagedRecordings: Recording[];
  selectedRecording?: Recording;
  eventExport?: EventExportStatus | null;
}) {
  const [store] = useState(() => createThumbnailStore());
  const thumbnails = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const [knownClipIds, setKnownClipIds] = useState<Record<string, string>>({});
  const [failedPosterUrl, setFailedPosterUrl] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [pollRevision, setPollRevision] = useState(0);

  if (
    selectedRecording &&
    selectedRecording.source !== "daily" &&
    eventExport?.status === "ready" &&
    eventExport.clipId &&
    isCanonicalUuid(eventExport.clipId) &&
    knownClipIds[selectedRecording.id] !== eventExport.clipId
  ) {
    const validClipId = eventExport.clipId;
    setKnownClipIds((prev) => ({
      ...prev,
      [selectedRecording.id]: validClipId,
    }));
  }

  const selectedKnownClipId = selectedRecording && selectedRecording.source !== "daily"
    ? knownClipIds[selectedRecording.id]
    : undefined;
  const selectedTarget = selectedRecording ? resolveThumbnailTarget(selectedRecording, selectedKnownClipId) : null;
  const selectedTargetKey = selectedTarget ? targetKey(selectedTarget) : null;
  const selectedEntry = selectedTargetKey ? thumbnails[selectedTargetKey] : undefined;

  const handleImageError = useCallback((target: ThumbnailTarget) => {
    const key = targetKey(target);
    store.update(key, (prev) => {
      const current = prev ?? { target, pollCount: 0 };
      return { ...current, imageFailed: true };
    });
  }, [store]);

  const handleRecordingImageError = useCallback((recording: Recording) => {
    const knownClipId = recording.source !== "daily" ? knownClipIds[recording.id] : undefined;
    const target = resolveThumbnailTarget(recording, knownClipId);
    if (target) {
      handleImageError(target);
    }
  }, [knownClipIds, handleImageError]);

  const rawPosterPath = selectedEntry?.info?.status === "ready" && !selectedEntry.imageFailed && selectedEntry.info.contentPath && isValidThumbnailContentPath(selectedEntry.target.kind, selectedEntry.target.id, selectedEntry.info.contentPath)
    ? selectedEntry.info.contentPath
    : undefined;

  const posterUrl = rawPosterPath && rawPosterPath !== failedPosterUrl ? rawPosterPath : undefined;

  useEffect(() => {
    if (!rawPosterPath) return;
    let active = true;
    const probe = new Image();
    probe.src = rawPosterPath;
    probe.onerror = () => {
      if (active) {
        setFailedPosterUrl(rawPosterPath);
      }
    };
    return () => {
      active = false;
    };
  }, [rawPosterPath]);

  const targetsKey = useMemo(() => {
    const list: string[] = [];
    for (const recording of pagedRecordings) {
      const knownClipId = recording.source !== "daily" ? knownClipIds[recording.id] : undefined;
      const target = resolveThumbnailTarget(recording, knownClipId);
      if (target) {
        const key = targetKey(target);
        if (!list.includes(key)) {
          list.push(key);
        }
      }
    }
    if (selectedTargetKey && !list.includes(selectedTargetKey)) {
      list.unshift(selectedTargetKey);
    }
    return list.join(",");
  }, [pagedRecordings, knownClipIds, selectedTargetKey]);

  const targets = useMemo(() => {
    if (!targetsKey) return [];
    return targetsKey.split(",").map((k) => {
      const [kind, id] = k.split(":");
      return { kind: kind as "clip" | "daily", id };
    });
  }, [targetsKey]);

  useEffect(() => {
    if (!dataSource?.getThumbnailInfo) return;

    const controller = new AbortController();
    const activeTimers = new Set<ReturnType<typeof setTimeout>>();
    const inFlightKeys = new Set<string>();
    let activeRequests = 0;
    const queue: ThumbnailTarget[] = [...targets];

    const processQueue = () => {
      if (controller.signal.aborted) return;
      while (activeRequests < MAX_CONCURRENT_REQUESTS && queue.length > 0) {
        const target = queue.shift();
        if (!target) break;
        const key = targetKey(target);
        if (inFlightKeys.has(key)) {
          continue;
        }

        const cached = store.get(key);
        if (cached?.info && cached.info.status !== "pending") {
          continue;
        }
        // 404, 410, 422 같은 대상 오류만 재사용한다. 5xx와 통신 오류는 선택 변경이나 페이지 이동으로 effect가 다시 실행될 때 재조회한다.
        if (cached?.errorStatus && cached.errorStatus !== 409 && cached.errorStatus < 500) {
          continue;
        }

        activeRequests += 1;
        inFlightKeys.add(key);
        fetchThumbnail(target);
      }
    };

    const fetchThumbnail = (target: ThumbnailTarget) => {
      const key = targetKey(target);
      dataSource.getThumbnailInfo!(target, controller.signal)
        .then((info) => {
          if (controller.signal.aborted) return;
          let pollCount = 0;
          store.update(key, (prev) => {
            pollCount = prev?.pollCount ?? 0;
            return {
              target,
              info,
              errorStatus: undefined,
              imageFailed: prev?.imageFailed,
              pollCount,
            };
          });

          if (info.status === "pending" && pollCount < PENDING_POLL_INTERVALS_MS.length) {
            const delay = PENDING_POLL_INTERVALS_MS[pollCount];
            const timer = setTimeout(() => {
              activeTimers.delete(timer);
              if (!controller.signal.aborted) {
                store.update(key, (prev) => ({
                  ...(prev ?? { target, pollCount: 0 }),
                  pollCount: (prev?.pollCount ?? 0) + 1,
                }));
                queue.push(target);
                processQueue();
              }
            }, delay);
            activeTimers.add(timer);
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const status = error && typeof error === "object" && "status" in error
            ? Number(error.status)
            : 0;
          let pollCount = 0;
          store.update(key, (prev) => {
            pollCount = prev?.pollCount ?? 0;
            return {
              target,
              errorStatus: status || 500,
              imageFailed: prev?.imageFailed,
              pollCount,
            };
          });

          if (status === 409 && pollCount < PENDING_POLL_INTERVALS_MS.length) {
            const delay = PENDING_POLL_INTERVALS_MS[pollCount];
            const timer = setTimeout(() => {
              activeTimers.delete(timer);
              if (!controller.signal.aborted) {
                store.update(key, (prev) => ({
                  ...(prev ?? { target, pollCount: 0 }),
                  pollCount: (prev?.pollCount ?? 0) + 1,
                }));
                queue.push(target);
                processQueue();
              }
            }, delay);
            activeTimers.add(timer);
          }
        })
        .finally(() => {
          activeRequests -= 1;
          inFlightKeys.delete(key);
          processQueue();
        });
    };

    processQueue();

    return () => {
      controller.abort();
      for (const timer of activeTimers) {
        clearTimeout(timer);
      }
      activeTimers.clear();
      inFlightKeys.clear();
    };
  }, [dataSource, targets, store, pollRevision, selectedTargetKey]);

  const prepareSelectedThumbnail = useCallback(async (retryFailed = false) => {
    if (!dataSource?.prepareThumbnail || !selectedTarget || isPreparing) return;

    setIsPreparing(true);
    const key = targetKey(selectedTarget);
    try {
      const info = await dataSource.prepareThumbnail(selectedTarget, { retryFailed });
      store.update(key, (prev) => ({
        target: selectedTarget,
        info,
        errorStatus: undefined,
        imageFailed: prev?.imageFailed,
        pollCount: 0,
      }));

      // pending 재조회는 조회 effect가 맡아 선택 변경과 화면 이탈 시 같은 abort와 횟수 상한을 적용한다.
      if (info.status === "pending") setPollRevision((value) => value + 1);
    } catch (error: unknown) {
      const status = error && typeof error === "object" && "status" in error
        ? Number(error.status)
        : 0;
      store.update(key, (prev) => ({
        target: selectedTarget,
        errorStatus: status || 500,
        imageFailed: prev?.imageFailed,
        pollCount: 0,
      }));
    } finally {
      setIsPreparing(false);
    }
  }, [dataSource, selectedTarget, isPreparing, store]);

  const getThumbnailUrl = useCallback((recording: Recording): string | undefined => {
    const knownClipId = recording.source !== "daily" ? knownClipIds[recording.id] : undefined;
    const target = resolveThumbnailTarget(recording, knownClipId);
    if (!target) return undefined;
    const key = targetKey(target);
    const entry = thumbnails[key];
    if (!entry?.info || entry.info.status !== "ready" || entry.imageFailed) return undefined;
    const path = entry.info.contentPath;
    if (!path || !isValidThumbnailContentPath(target.kind, target.id, path)) return undefined;
    return path;
  }, [knownClipIds, thumbnails]);

  return {
    getThumbnailUrl,
    handleImageError,
    handleRecordingImageError,
    posterUrl,
    // 대상이 없는 녹화는 undefined로 두어 상태 상세에서 대표 이미지 항목을 숨긴다.
    selectedThumbnailInfo: selectedTarget ? selectedEntry?.info ?? null : undefined,
    selectedThumbnailError: selectedTarget ? selectedEntry?.errorStatus ?? null : undefined,
    prepareSelectedThumbnail,
    isPreparing,
    selectedTarget,
  };
}
