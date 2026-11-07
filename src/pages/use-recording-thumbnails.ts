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
  info?: ThumbnailInfo | null;
  errorStatus?: number;
  imageFailed?: boolean;
  pollCount: number;
};

export function targetKey(target: ThumbnailTarget): string {
  if (target.kind === "event" || target.kind === "dailyDate") {
    return target.path;
  }
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
    if (!["recording", "finalizing", "closed", "failed"].includes(daily.status)) return null;
    const id = daily.id ?? recording.id;
    if (!isCanonicalUuid(id)) return null;
    return { kind: "daily", id };
  }

  if (recording.dailyThumbnailInfoPath) {
    const match = /^\/api\/v2\/recordings\/daily\/by-date\/(\d{4}-\d{2}-\d{2})\/thumbnail-info$/.exec(recording.dailyThumbnailInfoPath);
    const date = match ? match[1] : "";
    return {
      kind: "dailyDate",
      date,
      path: recording.dailyThumbnailInfoPath,
    };
  }

  if (recording.thumbnailInfoPath) {
    return {
      kind: "event",
      eventId: recording.id,
      path: recording.thumbnailInfoPath,
    };
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

  const isReadyContentPath = (target: ThumbnailTarget, info?: ThumbnailInfo | null): boolean => {
    if (!info || info.status !== "ready" || !info.contentPath) return false;
    if (target.kind === "event") {
      return Boolean(info.clipId && isValidThumbnailContentPath("clip", info.clipId, info.contentPath));
    }
    if (target.kind === "dailyDate") {
      const recId = info.recordingId ?? info.id;
      return Boolean(recId && isCanonicalUuid(recId) && isValidThumbnailContentPath("daily", recId, info.contentPath));
    }
    return isValidThumbnailContentPath(target.kind, target.id, info.contentPath);
  };

  const rawPosterPath = selectedEntry && !selectedEntry.imageFailed && isReadyContentPath(selectedEntry.target, selectedEntry.info)
    ? selectedEntry.info!.contentPath!
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
    const map = new Map<string, string>();
    if (selectedTarget) {
      const key = targetKey(selectedTarget);
      map.set(key, JSON.stringify(selectedTarget));
    }
    for (const recording of pagedRecordings) {
      const knownClipId = recording.source !== "daily" ? knownClipIds[recording.id] : undefined;
      const target = resolveThumbnailTarget(recording, knownClipId);
      if (target) {
        const key = targetKey(target);
        if (!map.has(key)) {
          map.set(key, JSON.stringify(target));
        }
      }
    }
    return Array.from(map.values()).join("\n");
  }, [pagedRecordings, knownClipIds, selectedTarget]);

  const targets = useMemo<ThumbnailTarget[]>(() => {
    if (!targetsKey) return [];
    return targetsKey.split("\n").map((line) => JSON.parse(line) as ThumbnailTarget);
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
        const isPolling = cached?.info && (
          cached.info.status === "pending" ||
          (cached.info.status === "unavailable" && cached.info.reasonCode === "RECORDING_BUSY")
        );
        if (cached?.info !== undefined && !isPolling) {
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

          const shouldPoll = info && (
            info.status === "pending" ||
            (info.status === "unavailable" && info.reasonCode === "RECORDING_BUSY")
          );
          if (shouldPoll && pollCount < PENDING_POLL_INTERVALS_MS.length) {
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
  }, [dataSource, targets, targetsKey, store, pollRevision, selectedTargetKey]);

  const prepareSelectedThumbnail = useCallback(async (retryFailed = false) => {
    if (!dataSource?.prepareThumbnail || !selectedTarget || selectedTarget.kind === "dailyDate" || isPreparing) return;

    const key = targetKey(selectedTarget);
    const cachedEntry = store.get(key);

    let targetToPrepare: ThumbnailTarget;
    if (selectedTarget.kind === "event") {
      const clipId = cachedEntry?.info?.clipId;
      if (!clipId || !isCanonicalUuid(clipId)) return;
      targetToPrepare = { kind: "clip", id: clipId };
    } else {
      targetToPrepare = selectedTarget;
    }

    setIsPreparing(true);
    try {
      const info = await dataSource.prepareThumbnail(targetToPrepare, { retryFailed });
      if (selectedTarget.kind === "event") {
        store.update(key, (prev) => ({
          target: selectedTarget,
          info: undefined,
          errorStatus: undefined,
          imageFailed: prev?.imageFailed,
          pollCount: 0,
        }));
        setPollRevision((value) => value + 1);
      } else {
        store.update(key, (prev) => ({
          target: selectedTarget,
          info,
          errorStatus: undefined,
          imageFailed: prev?.imageFailed,
          pollCount: 0,
        }));

        if (info.status === "pending") setPollRevision((value) => value + 1);
      }
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
    if (!isReadyContentPath(target, entry.info)) return undefined;
    return entry.info.contentPath ?? undefined;
  }, [knownClipIds, thumbnails]);

  return {
    getThumbnailUrl,
    handleImageError,
    handleRecordingImageError,
    posterUrl,
    // 대상이 없는 녹화는 undefined로 두어 상태 상세에서 대표 이미지 항목을 숨긴다.
    // 조회 전과 재조회 중은 undefined("확인 중"), 이벤트 대상의 null 응답만 null("연결된 구간 파일 없음")이다.
    selectedThumbnailInfo: selectedTarget ? selectedEntry?.info : undefined,
    selectedThumbnailError: selectedTarget ? selectedEntry?.errorStatus ?? null : undefined,
    prepareSelectedThumbnail,
    isPreparing,
    selectedTarget,
  };
}
