import type { Recording, RecordingList, RecordingListSnapshot } from "../domain/dashboard";

// 녹화 화면의 목록 페이지 크기이다.
export const recordingsPerPage = 6;
// 첫 이벤트 요청은 작은 페이지로 가져와 첫 화면을 빠르게 표시하고, 이후 요청은 100건 페이지를 사용한다.
const firstEventPageSize = 20;
const nextEventPageSize = 100;

export type RecordingEventPage = { items: Recording[]; totalItems: number };

type Options = {
  /** 날짜 녹화처럼 개수가 적은 목록을 한 번에 가져온다. 없으면 날짜 녹화를 포함하지 않는다. */
  loadDaily?: (signal?: AbortSignal) => Promise<Recording[]>;
  /** 이벤트 서버 페이지를 가져온다. page는 1부터 시작한다. 없으면 이벤트를 포함하지 않는다. */
  loadEvents?: (request: { page: number; pageSize: number }, signal?: AbortSignal) => Promise<RecordingEventPage>;
  startOf: (recording: Recording) => number;
};

const keyOf = (recording: Recording) => `${recording.source ?? "event"}:${recording.id}`;

/**
 * 날짜 녹화와 이벤트를 시작 시각 역순으로 합친 목록을 필요한 만큼만 가져온다.
 * 이벤트 서버 페이지는 시작 시각 역순에 가깝다고 가정한다. 앞쪽 rank개가 이미 불러온 이벤트의
 * 가장 이른 시작 시각 이후에 있으면 더 가져오지 않는다.
 */
export function createRecordingList({ loadDaily, loadEvents, startOf }: Options): RecordingList {
  let daily: Recording[] | null = loadDaily ? null : [];
  const events: Recording[] = [];
  const seen = new Set<string>();
  let requests = 0;
  let covered = 0;
  let totalEvents: number | null = loadEvents ? null : 0;
  let chain: Promise<unknown> = Promise.resolve();

  const compare = (a: Recording, b: Recording) => startOf(b) - startOf(a) || keyOf(a).localeCompare(keyOf(b));
  const merged = () => [...(daily ?? []), ...events].sort(compare);
  const complete = () => totalEvents !== null && covered >= totalEvents;
  const settled = (items: Recording[], rank: number) => {
    if (complete()) return true;
    if (totalEvents === null || events.length === 0) return false;
    const earliest = Math.min(...events.map(startOf));
    return items.filter((item) => startOf(item) >= earliest).length >= rank;
  };
  const snapshot = (items: Recording[]): RecordingListSnapshot => ({ items, total: (daily?.length ?? 0) + (totalEvents ?? 0), complete: complete() });

  const run = async (rank: number, signal?: AbortSignal): Promise<RecordingListSnapshot> => {
    if (daily === null && loadDaily) daily = await loadDaily(signal);
    while (true) {
      const items = merged();
      if (settled(items, rank) || !loadEvents) return snapshot(items);
      const first = requests === 0;
      const pageSize = first ? firstEventPageSize : nextEventPageSize;
      const result = await loadEvents({ page: first ? 1 : requests, pageSize }, signal);
      requests += 1;
      totalEvents = result.totalItems;
      covered = first ? pageSize : (requests - 1) * pageSize;
      for (const item of result.items) {
        const key = keyOf(item);
        if (!seen.has(key)) { seen.add(key); events.push(item); }
      }
      // 서버가 빈 페이지를 돌려주면 더 가져올 항목이 없다.
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
