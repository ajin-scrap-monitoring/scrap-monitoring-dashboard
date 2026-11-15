import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { Recording } from "../domain/dashboard";
import {
  dailyRecordingAvailability,
  type DailyAvailableInterval,
  type DailyGap,
  type DailyIntervalPage,
} from "../data/daily-recordings";

export type DailyIntervalLoadStatus = "idle" | "loading" | "ready" | "error";

type IntervalKind = "available" | "gaps";

type KindState<Interval> = {
  history: (string | undefined)[];
  pageIndex: number;
  page?: DailyIntervalPage<Interval>;
  status: DailyIntervalLoadStatus;
  error?: string;
  retriedInvalidCursor: boolean;
  nonce: number;
  settledKey?: string;
};

type TimelineStep = {
  moveAvailable: boolean;
  moveGaps: boolean;
};

type HookState = {
  selectionKey: string;
  revisionKey: string;
  available: KindState<DailyAvailableInterval>;
  gaps: KindState<DailyGap>;
  timelineHistory: TimelineStep[];
  snapshotRetries: number;
  snapshotReloading: boolean;
  waitingDetailEpoch: number;
  summaryReloadNonce: number;
};

const dataSourceIds = new WeakMap<DashboardDataSource, number>();
let nextDataSourceId = 1;

function dataSourceIdentity(dataSource?: DashboardDataSource) {
  if (!dataSource) return 0;
  let id = dataSourceIds.get(dataSource);
  if (id === undefined) {
    id = nextDataSourceId;
    nextDataSourceId += 1;
    dataSourceIds.set(dataSource, id);
  }
  return id;
}

function emptyKindState<Interval>(): KindState<Interval> {
  return {
    history: [undefined],
    pageIndex: 0,
    page: undefined,
    status: "idle",
    error: undefined,
    retriedInvalidCursor: false,
    nonce: 0,
    settledKey: undefined,
  };
}

function createInitialState(selectionKey: string, revisionKey: string, summaryReloadNonce = 0): HookState {
  return {
    selectionKey,
    revisionKey,
    available: emptyKindState(),
    gaps: emptyKindState(),
    timelineHistory: [],
    snapshotRetries: 0,
    snapshotReloading: false,
    waitingDetailEpoch: 0,
    summaryReloadNonce,
  };
}

function errorStatusAndCode(error: unknown): { status?: number; code?: string } {
  if (!error || typeof error !== "object") return {};
  const status = "status" in error && typeof error.status === "number" ? error.status : undefined;
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return { status, code };
}

function intervalFailureMessage(error: unknown): string {
  const { status, code } = errorStatusAndCode(error);
  if (status === 400 && code === "INVALID_CURSOR") {
    return "유효하지 않은 페이지 커서입니다. 다시 조회해 주세요.";
  }
  if (status === 409 && code === "DAILY_SNAPSHOT_CHANGED") {
    return "녹화 구간 구성이 변경되었습니다. 다시 조회해 주세요.";
  }
  if (status === 502 || status === 503 || status === 504 || error instanceof TypeError) {
    return "일시적으로 녹화 구간을 조회할 수 없습니다. 잠시 후 다시 조회해 주세요.";
  }
  return "녹화 구간 정보를 불러오지 못했습니다.";
}

function isSnapshotChangedError(error: unknown): boolean {
  const { status, code } = errorStatusAndCode(error);
  return status === 409 && code === "DAILY_SNAPSHOT_CHANGED";
}

function isInvalidCursorError(error: unknown): boolean {
  const { status, code } = errorStatusAndCode(error);
  return status === 400 && code === "INVALID_CURSOR";
}

type Action =
  | { type: "RESET_CONTEXT"; selectionKey: string; revisionKey: string }
  | { type: "SUMMARY_SETTLED"; selectionKey: string; revisionKey: string; detailEpoch: number }
  | { type: "SUMMARY_FAILED"; detailError: string }
  | { type: "START"; selectionKey: string; revisionKey: string; kind: IntervalKind }
  | {
    type: "SUCCESS";
    selectionKey: string;
    revisionKey: string;
    targetKey: string;
    kind: IntervalKind;
    page: DailyIntervalPage<DailyAvailableInterval> | DailyIntervalPage<DailyGap>;
    expectedRevision: number;
    detailEpoch: number;
    needsAvailable: boolean;
    needsGaps: boolean;
  }
  | {
    type: "FAILURE";
    selectionKey: string;
    revisionKey: string;
    targetKey: string;
    kind: IntervalKind;
    requestedCursor: string | undefined;
    error: unknown;
    detailEpoch: number;
  }
  | { type: "NAVIGATE_TIMELINE"; direction: "prev" | "next"; needsAvailable: boolean; needsGaps: boolean }
  | { type: "NAVIGATE_GAPS"; direction: "prev" | "next" }
  | { type: "RETRY"; scope: "all" | "gaps"; detailEpoch: number };

function updateKindState<Interval>(
  state: KindState<Interval>,
  updater: (current: KindState<Interval>) => KindState<Interval>,
) {
  return updater(state);
}

function advanceKindPage<Interval>(state: KindState<Interval>): KindState<Interval> {
  const nextCursor = state.page?.nextCursor;
  if (!nextCursor) return state;
  const nextIndex = state.pageIndex + 1;
  const history = state.history[nextIndex] === nextCursor
    ? state.history
    : [...state.history.slice(0, nextIndex), nextCursor];
  return { ...state, history, pageIndex: nextIndex, error: undefined };
}

function rewindKindPage<Interval>(state: KindState<Interval>): KindState<Interval> {
  if (state.pageIndex <= 0) return state;
  return { ...state, pageIndex: state.pageIndex - 1, error: undefined };
}

function triggerSnapshotReload(state: HookState, detailEpoch: number): HookState {
  if (state.snapshotRetries >= 2) {
    const message = "녹화 구간 구성이 변경되었습니다. 다시 조회해 주세요.";
    return {
      ...state,
      available: { ...emptyKindState(), status: "error", error: message },
      gaps: { ...emptyKindState(), status: "error", error: message },
      timelineHistory: [],
      snapshotReloading: false,
    };
  }
  return {
    ...createInitialState(state.selectionKey, state.revisionKey),
    snapshotRetries: state.snapshotRetries + 1,
    snapshotReloading: true,
    waitingDetailEpoch: detailEpoch,
    summaryReloadNonce: state.summaryReloadNonce + 1,
  };
}

function normalizeStateForContext(state: HookState, selectionKey: string, revisionKey: string): HookState {
  if (state.selectionKey !== selectionKey) {
    return createInitialState(selectionKey, revisionKey, state.summaryReloadNonce);
  }
  if (state.revisionKey !== revisionKey) {
    return {
      ...createInitialState(selectionKey, revisionKey, state.summaryReloadNonce),
      snapshotRetries: state.snapshotRetries,
    };
  }
  return state;
}

function reducer(state: HookState, action: Action): HookState {
  switch (action.type) {
    case "RESET_CONTEXT": {
      return normalizeStateForContext(state, action.selectionKey, action.revisionKey);
    }
    case "SUMMARY_SETTLED": {
      const base = normalizeStateForContext(state, action.selectionKey, action.revisionKey);
      if (!base.snapshotReloading || action.detailEpoch === base.waitingDetailEpoch) return base;
      return {
        ...base,
        snapshotReloading: false,
        available: { ...base.available, nonce: base.available.nonce + 1, settledKey: undefined },
        gaps: { ...base.gaps, nonce: base.gaps.nonce + 1, settledKey: undefined },
      };
    }
    case "SUMMARY_FAILED": {
      if (!state.snapshotReloading) return state;
      const message = "녹화 구간 정보를 불러오지 못했습니다.";
      return {
        ...state,
        snapshotReloading: false,
        available: { ...emptyKindState(), status: "error", error: message },
        gaps: { ...emptyKindState(), status: "error", error: message },
      };
    }
    case "START": {
      const base = normalizeStateForContext(state, action.selectionKey, action.revisionKey);
      return action.kind === "available"
        ? { ...base, available: updateKindState(base.available, (current) => ({ ...current, status: "loading", error: undefined, page: undefined })) }
        : { ...base, gaps: updateKindState(base.gaps, (current) => ({ ...current, status: "loading", error: undefined, page: undefined })) };
    }
    case "SUCCESS": {
      const base = normalizeStateForContext(state, action.selectionKey, action.revisionKey);
      if (action.page.revision !== action.expectedRevision) {
        return triggerSnapshotReload(base, action.detailEpoch);
      }
      const otherPage = action.kind === "available" ? base.gaps.page : base.available.page;
      if (otherPage && otherPage.snapshot !== action.page.snapshot) {
        return triggerSnapshotReload(base, action.detailEpoch);
      }
      const updated = action.kind === "available"
        ? {
          ...base,
          available: {
            ...base.available,
            page: action.page as DailyIntervalPage<DailyAvailableInterval>,
            status: "ready" as const,
            error: undefined,
            settledKey: action.targetKey,
          },
        }
        : {
          ...base,
          gaps: {
            ...base.gaps,
            page: action.page as DailyIntervalPage<DailyGap>,
            status: "ready" as const,
            error: undefined,
            settledKey: action.targetKey,
          },
        };
      const availableSettled = !action.needsAvailable || updated.available.status === "ready";
      const gapsSettled = !action.needsGaps || updated.gaps.status === "ready";
      return availableSettled && gapsSettled && updated.snapshotRetries !== 0
        ? { ...updated, snapshotRetries: 0 }
        : updated;
    }
    case "FAILURE": {
      const base = normalizeStateForContext(state, action.selectionKey, action.revisionKey);
      if (isSnapshotChangedError(action.error)) {
        return triggerSnapshotReload(base, action.detailEpoch);
      }
      if (isInvalidCursorError(action.error) && action.requestedCursor !== undefined) {
        const currentKind = action.kind === "available" ? base.available : base.gaps;
        if (!currentKind.retriedInvalidCursor) {
          const resetPageOne = (nonce: number, retriedInvalidCursor: boolean) => ({
            ...emptyKindState<never>(),
            retriedInvalidCursor,
            nonce: nonce + 1,
          });
          // available과 gaps 중 한쪽 커서만 무효화돼도 timelineHistory가 비워지므로,
          // 2페이지 이상에 남아 있는 반대쪽도 1페이지로 되돌려 타임라인 페이지와 이전 버튼 상태를 맞춘다.
          return {
            ...base,
            timelineHistory: [],
            available: action.kind === "available"
              ? resetPageOne(base.available.nonce, true)
              : base.available.pageIndex > 0
                ? resetPageOne(base.available.nonce, base.available.retriedInvalidCursor)
                : base.available,
            gaps: action.kind === "gaps"
              ? resetPageOne(base.gaps.nonce, true)
              : base.gaps.pageIndex > 0
                ? resetPageOne(base.gaps.nonce, base.gaps.retriedInvalidCursor)
                : base.gaps,
          };
        }
      }
      const message = intervalFailureMessage(action.error);
      return action.kind === "available"
        ? {
          ...base,
          available: {
            ...base.available,
            page: undefined,
            status: "error",
            error: message,
            settledKey: action.targetKey,
          },
        }
        : {
          ...base,
          gaps: {
            ...base.gaps,
            page: undefined,
            status: "error",
            error: message,
            settledKey: action.targetKey,
          },
        };
    }
    case "NAVIGATE_TIMELINE": {
      if (state.snapshotReloading) return state;
      if (action.direction === "next") {
        const moveAvailable = Boolean(action.needsAvailable && state.available.page?.nextCursor);
        const moveGaps = Boolean(action.needsGaps && state.gaps.page?.nextCursor);
        if (!moveAvailable && !moveGaps) return state;
        return {
          ...state,
          available: moveAvailable ? advanceKindPage(state.available) : state.available,
          gaps: moveGaps ? advanceKindPage(state.gaps) : state.gaps,
          timelineHistory: [...state.timelineHistory, { moveAvailable, moveGaps }],
        };
      }
      const last = state.timelineHistory[state.timelineHistory.length - 1];
      const moveAvailable = last ? last.moveAvailable : state.available.pageIndex > 0;
      const moveGaps = last ? last.moveGaps : state.gaps.pageIndex > 0;
      if (!moveAvailable && !moveGaps) return state;
      return {
        ...state,
        available: moveAvailable ? rewindKindPage(state.available) : state.available,
        gaps: moveGaps ? rewindKindPage(state.gaps) : state.gaps,
        timelineHistory: last ? state.timelineHistory.slice(0, -1) : [],
      };
    }
    case "NAVIGATE_GAPS": {
      if (state.snapshotReloading) return state;
      return {
        ...state,
        gaps: action.direction === "next" ? advanceKindPage(state.gaps) : rewindKindPage(state.gaps),
      };
    }
    case "RETRY": {
      if (action.scope === "gaps") {
        return {
          ...state,
          gaps: {
            ...state.gaps,
            status: "idle",
            error: undefined,
            retriedInvalidCursor: false,
            nonce: state.gaps.nonce + 1,
            settledKey: undefined,
          },
        };
      }
      if (state.snapshotRetries >= 2) {
        return {
          ...createInitialState(state.selectionKey, state.revisionKey),
          snapshotRetries: 0,
          snapshotReloading: true,
          waitingDetailEpoch: action.detailEpoch,
          summaryReloadNonce: state.summaryReloadNonce + 1,
        };
      }
      return {
        ...state,
        snapshotRetries: 0,
        available: {
          ...state.available,
          status: state.available.status === "error" ? "idle" : state.available.status,
          error: undefined,
          retriedInvalidCursor: false,
          nonce: state.available.status === "error" ? state.available.nonce + 1 : state.available.nonce,
          settledKey: state.available.status === "error" ? undefined : state.available.settledKey,
        },
        gaps: {
          ...state.gaps,
          status: state.gaps.status === "error" ? "idle" : state.gaps.status,
          error: undefined,
          retriedInvalidCursor: false,
          nonce: state.gaps.status === "error" ? state.gaps.nonce + 1 : state.gaps.nonce,
          settledKey: state.gaps.status === "error" ? undefined : state.gaps.settledKey,
        },
      };
    }
  }
}

export function useDailyRecordingIntervals({
  dataSource,
  recording,
  detailReady,
  detailEpoch,
  detailError,
  now,
  resetKey,
  limit = 100,
  onSnapshotChanged,
}: {
  dataSource?: DashboardDataSource;
  recording?: Recording;
  detailReady: boolean;
  detailEpoch: number;
  detailError?: string;
  now: number;
  resetKey: string;
  limit?: number;
  onSnapshotChanged: () => void;
}) {
  const daily = recording?.daily;
  const metadata = daily?.view === "metadata" ? daily : undefined;
  const sourceId = dataSourceIdentity(dataSource);
  const selectionKey = `${sourceId}|${resetKey}|${limit}`;
  const revisionKey = metadata ? `${metadata.id}|${metadata.revision}` : "";

  const [rawState, dispatch] = useReducer(
    reducer,
    { selectionKey, revisionKey },
    ({ selectionKey: sKey, revisionKey: rKey }) => createInitialState(sKey, rKey),
  );
  const state = useMemo(
    () => normalizeStateForContext(rawState, selectionKey, revisionKey),
    [rawState, selectionKey, revisionKey],
  );

  const unavailable = metadata && Number.isFinite(now)
    ? dailyRecordingAvailability(metadata, now).originalUnavailable
    : false;
  const canQueryMetadata = Boolean(metadata && detailReady && Number.isFinite(now) && !unavailable && !detailError);
  const needsAvailable = Boolean(canQueryMetadata && metadata && metadata.recordedSeconds > 0);
  const needsGaps = Boolean(canQueryMetadata && metadata && metadata.hasGaps);

  useEffect(() => {
    dispatch({ type: "RESET_CONTEXT", selectionKey, revisionKey });
  }, [selectionKey, revisionKey]);

  const handledReloadNonce = useRef(0);
  useEffect(() => {
    if (state.snapshotReloading && state.summaryReloadNonce > handledReloadNonce.current) {
      handledReloadNonce.current = state.summaryReloadNonce;
      onSnapshotChanged();
    }
  }, [state.snapshotReloading, state.summaryReloadNonce, onSnapshotChanged]);

  useEffect(() => {
    if (!state.snapshotReloading) return;
    if (detailError) {
      dispatch({ type: "SUMMARY_FAILED", detailError });
      return;
    }
    if (detailEpoch !== state.waitingDetailEpoch) {
      dispatch({ type: "SUMMARY_SETTLED", selectionKey, revisionKey, detailEpoch });
    }
  }, [state.snapshotReloading, state.waitingDetailEpoch, detailEpoch, detailError, selectionKey, revisionKey]);

  const availableCursor = state.available.history[state.available.pageIndex];
  const availableTargetKey = `${selectionKey}|${revisionKey}|available|${state.available.pageIndex}|${availableCursor ?? ""}|${state.available.nonce}`;
  useEffect(() => {
    if (!needsAvailable || state.snapshotReloading || !metadata) return;
    if (!dataSource?.getDailyRecordingAvailableIntervals) return;
    if (state.available.settledKey === availableTargetKey) return;
    const controller = new AbortController();
    dispatch({ type: "START", selectionKey, revisionKey, kind: "available" });
    void dataSource.getDailyRecordingAvailableIntervals(
      metadata.id,
      { limit, ...(availableCursor !== undefined ? { cursor: availableCursor } : {}) },
      controller.signal,
    ).then((page) => {
      if (controller.signal.aborted) return;
      dispatch({
        type: "SUCCESS",
        selectionKey,
        revisionKey,
        targetKey: availableTargetKey,
        kind: "available",
        page,
        expectedRevision: metadata.revision,
        detailEpoch,
        needsAvailable,
        needsGaps,
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      dispatch({
        type: "FAILURE",
        selectionKey,
        revisionKey,
        targetKey: availableTargetKey,
        kind: "available",
        requestedCursor: availableCursor,
        error,
        detailEpoch,
      });
    });
    return () => controller.abort();
  }, [
    needsAvailable,
    state.snapshotReloading,
    metadata,
    dataSource,
    limit,
    availableCursor,
    availableTargetKey,
    state.available.settledKey,
    selectionKey,
    revisionKey,
    detailEpoch,
    needsGaps,
  ]);

  const gapsCursor = state.gaps.history[state.gaps.pageIndex];
  const gapsTargetKey = `${selectionKey}|${revisionKey}|gaps|${state.gaps.pageIndex}|${gapsCursor ?? ""}|${state.gaps.nonce}`;
  useEffect(() => {
    if (!needsGaps || state.snapshotReloading || !metadata) return;
    if (!dataSource?.getDailyRecordingGaps) return;
    if (state.gaps.settledKey === gapsTargetKey) return;
    const controller = new AbortController();
    dispatch({ type: "START", selectionKey, revisionKey, kind: "gaps" });
    void dataSource.getDailyRecordingGaps(
      metadata.id,
      { limit, ...(gapsCursor !== undefined ? { cursor: gapsCursor } : {}) },
      controller.signal,
    ).then((page) => {
      if (controller.signal.aborted) return;
      dispatch({
        type: "SUCCESS",
        selectionKey,
        revisionKey,
        targetKey: gapsTargetKey,
        kind: "gaps",
        page,
        expectedRevision: metadata.revision,
        detailEpoch,
        needsAvailable,
        needsGaps,
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      dispatch({
        type: "FAILURE",
        selectionKey,
        revisionKey,
        targetKey: gapsTargetKey,
        kind: "gaps",
        requestedCursor: gapsCursor,
        error,
        detailEpoch,
      });
    });
    return () => controller.abort();
  }, [
    needsGaps,
    state.snapshotReloading,
    metadata,
    dataSource,
    limit,
    gapsCursor,
    gapsTargetKey,
    state.gaps.settledKey,
    selectionKey,
    revisionKey,
    detailEpoch,
    needsAvailable,
  ]);

  const nextTimelinePage = useCallback(() => {
    dispatch({ type: "NAVIGATE_TIMELINE", direction: "next", needsAvailable, needsGaps });
  }, [needsAvailable, needsGaps]);

  const prevTimelinePage = useCallback(() => {
    dispatch({ type: "NAVIGATE_TIMELINE", direction: "prev", needsAvailable, needsGaps });
  }, [needsAvailable, needsGaps]);

  const nextGapPage = useCallback(() => {
    dispatch({ type: "NAVIGATE_GAPS", direction: "next" });
  }, []);

  const prevGapPage = useCallback(() => {
    dispatch({ type: "NAVIGATE_GAPS", direction: "prev" });
  }, []);

  const retryAll = useCallback(() => {
    dispatch({ type: "RETRY", scope: "all", detailEpoch });
  }, [detailEpoch]);

  const retryGaps = useCallback(() => {
    dispatch({ type: "RETRY", scope: "gaps", detailEpoch });
  }, [detailEpoch]);

  if (daily?.view === "full") {
    return {
      availableIntervals: daily.availableIntervals,
      gaps: daily.gaps,
      availableTotal: daily.availableIntervals.length,
      gapTotal: daily.gaps.length as number | null,
      availableStatus: "ready" as DailyIntervalLoadStatus,
      gapsStatus: "ready" as DailyIntervalLoadStatus,
      availableError: undefined as string | undefined,
      gapsError: undefined as string | undefined,
      timelinePagination: undefined,
      gapsPagination: undefined,
    };
  }

  const missingEndpointError = canQueryMetadata && (
    (needsAvailable && !dataSource?.getDailyRecordingAvailableIntervals)
    || (needsGaps && !dataSource?.getDailyRecordingGaps)
  ) ? "녹화 구간 조회 기능을 사용할 수 없습니다." : undefined;

  const availableStatus: DailyIntervalLoadStatus = !metadata ? "idle"
    : !needsAvailable ? (unavailable || (canQueryMetadata && metadata.recordedSeconds === 0) ? "ready" : "idle")
    : state.snapshotReloading ? "loading"
    : missingEndpointError && !dataSource?.getDailyRecordingAvailableIntervals ? "error"
    : state.available.status === "idle" ? "loading"
    : state.available.status;

  const gapsStatus: DailyIntervalLoadStatus = !metadata ? "idle"
    : !needsGaps ? (unavailable || (canQueryMetadata && !metadata.hasGaps) ? "ready" : "idle")
    : state.snapshotReloading ? "loading"
    : missingEndpointError && !dataSource?.getDailyRecordingGaps ? "error"
    : state.gaps.status === "idle" ? "loading"
    : state.gaps.status;

  const availableError = state.available.error ?? (missingEndpointError && !dataSource?.getDailyRecordingAvailableIntervals ? missingEndpointError : undefined);
  const gapsError = state.gaps.error ?? (missingEndpointError && !dataSource?.getDailyRecordingGaps ? missingEndpointError : undefined);
  const timelineError = availableError ?? gapsError;

  const availableIntervals = needsAvailable && availableStatus === "ready" ? (state.available.page?.items ?? []) : [];
  const gaps = needsGaps && gapsStatus === "ready" ? (state.gaps.page?.items ?? []) : [];
  const availableTotal = !metadata ? null
    : needsAvailable ? (state.available.page?.total ?? null)
    : (canQueryMetadata || unavailable ? (unavailable ? null : 0) : null);
  const gapTotal = !metadata ? null
    : needsGaps ? (state.gaps.page?.total ?? null)
    : (canQueryMetadata ? 0 : null);

  const hasPrevious = state.timelineHistory.length > 0 || state.available.pageIndex > 0 || state.gaps.pageIndex > 0;
  const hasNext = Boolean((needsAvailable && state.available.page?.nextCursor) || (needsGaps && state.gaps.page?.nextCursor));
  const pageNumber = Math.max(state.available.pageIndex, state.gaps.pageIndex) + 1;
  const busy = availableStatus === "loading" || gapsStatus === "loading";

  const gapHasPrevious = state.gaps.pageIndex > 0;
  const gapHasNext = Boolean(needsGaps && state.gaps.page?.nextCursor);

  return {
    availableIntervals,
    gaps,
    availableTotal,
    gapTotal,
    availableStatus,
    gapsStatus,
    availableError,
    gapsError,
    timelinePagination: metadata ? {
      hasPrevious,
      hasNext,
      busy,
      error: timelineError,
      pageLabel: hasPrevious || hasNext ? `구간 ${pageNumber}페이지` : undefined,
      onPrevious: prevTimelinePage,
      onNext: nextTimelinePage,
      onRetry: retryAll,
    } : undefined,
    gapsPagination: metadata ? {
      hasPrevious: gapHasPrevious,
      hasNext: gapHasNext,
      busy: gapsStatus === "loading",
      error: gapsError,
      pageNumber: state.gaps.pageIndex + 1,
      onPrevious: prevGapPage,
      onNext: nextGapPage,
      onRetry: retryGaps,
    } : undefined,
  };
}
