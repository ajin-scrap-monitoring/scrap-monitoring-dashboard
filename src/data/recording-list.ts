import type { Recording, RecordingList, RecordingListSnapshot } from "../domain/dashboard";

// 녹화 화면의 목록 페이지 크기이다.
export const recordingsPerPage = 6;
// 이벤트 페이지 크기는 50건으로 고정한다.
export const eventPageSize = 50;

export type RecordingEventPage = {
  items: Recording[];
  totalItems: number;
  snapshotToken?: string | null;
  snapshotExpiresAt?: string | null;
  from?: string;
  to?: string;
  asOf?: string | null;
};

export type LoadEventsRequest = {
  page: number;
  pageSize: number;
  snapshotToken?: string | null;
  from?: string;
  to?: string;
};

type Options = {
  /** 날짜 녹화처럼 개수가 적은 목록을 한 번에 가져온다. 없으면 날짜 녹화를 포함하지 않는다. */
  loadDaily?: (signal?: AbortSignal) => Promise<Recording[]>;
  /** 이벤트 서버 페이지를 가져온다. page는 1부터 시작한다. 없으면 이벤트를 포함하지 않는다. */
  loadEvents?: (request: LoadEventsRequest, signal?: AbortSignal) => Promise<RecordingEventPage>;
  startOf: (recording: Recording) => number;
  now?: () => number;
};

const keyOf = (recording: Recording) => `${recording.source ?? "event"}:${recording.id}`;

function isSnapshotResetError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { status?: number; code?: string; message?: string };
  if (typeof err.code === "string") {
    return err.code === "EVENT_LIST_QUERY_CHANGED" || err.code === "EVENT_LIST_SNAPSHOT_GONE";
  }
  if (err.status === 409 || err.status === 410) return true;
  if (typeof err.message === "string" && (err.message.includes("EVENT_LIST_QUERY_CHANGED") || err.message.includes("EVENT_LIST_SNAPSHOT_GONE"))) return true;
  return false;
}

/**
 * 날짜 녹화와 이벤트를 시각 역순으로 합친 목록을 필요한 만큼만 가져온다.
 * 이벤트 서버 정렬은 occurredAt 내림차순, 같은 시각은 eventId 내림차순이며 서버 순서를 그대로 쓴다.
 * 날짜 녹화와 합칠 때 이벤트 비교 시각은 occurredAt이다.
 * 앞쪽 rank개가 이미 불러온 이벤트의 가장 이른 occurredAt 이후에 있으면 더 가져오지 않는다.
 */
export function createRecordingList({ loadDaily, loadEvents, startOf, now }: Options): RecordingList {
  let daily: Recording[] | null = loadDaily ? null : [];
  const events: Recording[] = [];
  const seen = new Set<string>();
  let requests = 0;
  let covered = 0;
  let totalEvents: number | null = loadEvents ? null : 0;
  let snapshotToken: string | null = null;
  let snapshotFrom: string | undefined;
  let snapshotTo: string | undefined;
  let localExpiresAt: number | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const eventTime = (item: Recording): number => {
    if (item.occurredAt) {
      const parsed = Date.parse(item.occurredAt);
      if (Number.isFinite(parsed)) return parsed;
    }
    return startOf(item);
  };

  const itemTime = (item: Recording) => item.source === "daily" ? startOf(item) : eventTime(item);

  const merged = () => {
    const dailyItems = daily ?? [];
    const result: Recording[] = [];
    let d = 0;
    let e = 0;
    while (d < dailyItems.length && e < events.length) {
      const dTime = startOf(dailyItems[d]);
      const eTime = eventTime(events[e]);
      if (dTime >= eTime) {
        result.push(dailyItems[d]);
        d += 1;
      } else {
        result.push(events[e]);
        e += 1;
      }
    }
    while (d < dailyItems.length) {
      result.push(dailyItems[d]);
      d += 1;
    }
    while (e < events.length) {
      result.push(events[e]);
      e += 1;
    }
    return result;
  };

  const complete = () => totalEvents !== null && covered >= totalEvents;
  const settled = (items: Recording[], rank: number) => {
    if (complete()) return true;
    if (totalEvents === null || events.length === 0) return false;
    const earliestOccurred = Math.min(...events.map(eventTime));
    return items.filter((item) => itemTime(item) >= earliestOccurred).length >= rank;
  };
  const snapshot = (items: Recording[]): RecordingListSnapshot => ({ items, total: (daily?.length ?? 0) + (totalEvents ?? 0), complete: complete() });

  const resetEvents = () => {
    events.length = 0;
    seen.clear();
    requests = 0;
    covered = 0;
    totalEvents = null;
    snapshotToken = null;
    snapshotFrom = undefined;
    snapshotTo = undefined;
    localExpiresAt = null;
  };

  const run = async (rank: number, signal?: AbortSignal): Promise<RecordingListSnapshot> => {
    let restarts = 0;
    if (daily === null && loadDaily) {
      const rawDaily = await loadDaily(signal);
      daily = [...rawDaily].sort((a, b) => startOf(b) - startOf(a) || keyOf(a).localeCompare(keyOf(b)));
    }
    while (true) {
      const items = merged();
      if (settled(items, rank) || !loadEvents) return snapshot(items);

      if (requests > 0 && localExpiresAt !== null) {
        const currentTime = now ? now() : Date.now();
        if (currentTime >= localExpiresAt) {
          if (restarts < 1) {
            restarts += 1;
            resetEvents();
            continue;
          }
        }
      }

      const pageToFetch = requests + 1;
      const pageSize = eventPageSize;
      let result: RecordingEventPage;
      try {
        result = await loadEvents({
          page: pageToFetch,
          pageSize,
          snapshotToken: snapshotToken ?? undefined,
          from: snapshotFrom,
          to: snapshotTo,
        }, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        if (isSnapshotResetError(error)) {
          if (restarts < 1) {
            restarts += 1;
            resetEvents();
            continue;
          }
        }
        throw error;
      }

      const receivedAt = now ? now() : Date.now();

      requests = pageToFetch;
      totalEvents = result.totalItems;
      covered = requests * pageSize;
      if (result.snapshotToken !== undefined) snapshotToken = result.snapshotToken;
      if (result.from) snapshotFrom = result.from;
      if (result.to) snapshotTo = result.to;

      if (typeof result.snapshotExpiresAt === "string" && typeof result.asOf === "string") {
        const expiresTime = Date.parse(result.snapshotExpiresAt);
        const asOfTime = Date.parse(result.asOf);
        if (Number.isFinite(expiresTime) && Number.isFinite(asOfTime)) {
          localExpiresAt = receivedAt + Math.max(0, expiresTime - asOfTime);
        } else {
          localExpiresAt = null;
        }
      } else {
        localExpiresAt = null;
      }

      for (const item of result.items) {
        const key = keyOf(item);
        if (!seen.has(key)) {
          seen.add(key);
          events.push(item);
        }
      }
      if (result.items.length === 0) covered = totalEvents;
    }
  };

  return {
    ensure(rank, signal) {
      const result = chain.then(() => run(rank, signal));
      chain = result.catch(() => undefined);
      return result;
    },
  };
}
