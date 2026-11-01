import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Recording } from "../domain/dashboard";
import { createRecordingList, type LoadEventsRequest, type RecordingEventPage } from "./recording-list";

function recording(id: string, start: number, source: "daily" | "event" = "event", occurredAt?: string): Recording {
  return {
    id,
    source,
    start: String(start),
    end: String(start + 1),
    occurredAt: occurredAt ?? new Date(start).toISOString(),
    date: "",
    time: "",
    detail: id,
    type: source === "daily" ? "날짜 녹화" : "수거",
    tone: "complete",
    sample: false,
    codec: "",
    format: "",
    frameRate: null,
    height: null,
    width: null,
    size: "",
    retentionStartsAt: "",
    retentionEndsAt: "",
    duration: "",
    status: "available",
  };
}

const startOf = (item: Recording) => Number(item.start);

function eventServer(
  total: number,
  snapshotToken = "token-123",
  snapshotExpiresAt = "2026-10-25T00:05:00Z",
  asOf = "2026-10-25T00:00:00Z",
) {
  const all = Array.from({ length: total }, (_, index) => recording(`evt-${index}`, 100_000 - index * 10));
  const loadEvents = vi.fn((request: LoadEventsRequest): Promise<RecordingEventPage> =>
    Promise.resolve({
      totalItems: total,
      items: all.slice((request.page - 1) * request.pageSize, request.page * request.pageSize),
      snapshotToken,
      snapshotExpiresAt,
      asOf,
      from: "2026-10-25T00:00:00Z",
      to: "2026-11-01T00:00:00Z",
    }));
  return { all, loadEvents };
}

describe("녹화 목록 핸들", () => {
  test("첫 목록은 pageSize 50으로 요청하고 전체 건수는 날짜 녹화 수와 이벤트 totalItems의 합이다", async () => {
    const { loadEvents } = eventServer(1393);
    const loadDaily = vi.fn(() => Promise.resolve([recording("d1", 200_000, "daily"), recording("d2", 50_000, "daily")]));
    const list = createRecordingList({ loadDaily, loadEvents, startOf });
    const first = await list.ensure(6);
    expect(loadEvents).toHaveBeenCalledTimes(1);
    expect(loadEvents).toHaveBeenCalledWith({ page: 1, pageSize: 50, snapshotToken: undefined, from: undefined, to: undefined }, undefined);
    expect(loadDaily).toHaveBeenCalledTimes(1);
    expect(first.total).toBe(1395);
    expect(first.complete).toBe(false);
    expect(first.items.slice(0, 3).map((item) => item.id)).toEqual(["d1", "evt-0", "evt-1"]);
  });

  test("다음 페이지 요청 시 snapshotToken과 첫 응답의 from, to를 전달하고 pageSize는 50으로 고정한다", async () => {
    const { loadEvents } = eventServer(130);
    const list = createRecordingList({ loadEvents, startOf });
    await list.ensure(6);
    expect(loadEvents).toHaveBeenCalledTimes(1);
    const deeper = await list.ensure(75);
    expect(loadEvents).toHaveBeenCalledTimes(2);
    expect(loadEvents.mock.calls[1][0]).toEqual({
      page: 2,
      pageSize: 50,
      snapshotToken: "token-123",
      from: "2026-10-25T00:00:00Z",
      to: "2026-11-01T00:00:00Z",
    });
    expect(deeper.items).toHaveLength(100);
    expect(new Set(deeper.items.map((item) => item.id)).size).toBe(100);
  });

  test("409 또는 410 오류를 받으면 받은 페이지를 버리고 토큰 없이 1페이지부터 다시 조회한다", async () => {
    let callCount = 0;
    const { all } = eventServer(150);
    const loadEvents = vi.fn((request: LoadEventsRequest): Promise<RecordingEventPage> => {
      callCount += 1;
      if (callCount === 2) {
        const error = new Error("EVENT_LIST_SNAPSHOT_GONE") as Error & { status: number; code: string };
        error.status = 410;
        error.code = "EVENT_LIST_SNAPSHOT_GONE";
        return Promise.reject(error);
      }
      return Promise.resolve({
        totalItems: 150,
        items: all.slice((request.page - 1) * request.pageSize, request.page * request.pageSize),
        snapshotToken: callCount > 2 ? "token-new" : "token-old",
        asOf: "2026-10-25T00:00:00Z",
        snapshotExpiresAt: "2026-10-25T00:05:00Z",
        from: "2026-10-25T00:00:00Z",
        to: "2026-11-01T00:00:00Z",
      });
    });
    const list = createRecordingList({ loadEvents, startOf });
    await list.ensure(6);
    expect(loadEvents).toHaveBeenCalledTimes(1);
    const deeper = await list.ensure(70);
    expect(loadEvents).toHaveBeenCalledTimes(4); // 1: p1, 2: p2 (410 에러), 3: p1 (재시작, 토큰 없음), 4: p2 (새 토큰)
    expect(loadEvents.mock.calls[2][0]).toEqual({
      page: 1,
      pageSize: 50,
      snapshotToken: undefined,
      from: undefined,
      to: undefined,
    });
    expect(deeper.items).toHaveLength(100);
  });

  test("409 EVENT_LIST_QUERY_CHANGED 오류 시에도 1페이지부터 토큰 없이 재시작한다", async () => {
    let callCount = 0;
    const { all } = eventServer(150);
    const loadEvents = vi.fn((request: LoadEventsRequest): Promise<RecordingEventPage> => {
      callCount += 1;
      if (callCount === 2) {
        const error = new Error("EVENT_LIST_QUERY_CHANGED") as Error & { status: number; code: string };
        error.status = 409;
        error.code = "EVENT_LIST_QUERY_CHANGED";
        return Promise.reject(error);
      }
      return Promise.resolve({
        totalItems: 150,
        items: all.slice((request.page - 1) * request.pageSize, request.page * request.pageSize),
        snapshotToken: "token-reset",
        asOf: "2026-10-25T00:00:00Z",
        snapshotExpiresAt: "2026-10-25T00:05:00Z",
      });
    });
    const list = createRecordingList({ loadEvents, startOf });
    await list.ensure(6);
    const deeper = await list.ensure(60);
    expect(loadEvents.mock.calls[2][0].page).toBe(1);
    expect(loadEvents.mock.calls[2][0].snapshotToken).toBeUndefined();
    expect(deeper.items).toHaveLength(100);
  });

  test("한 번의 ensure 호출 안에서 재시작은 1번까지만 하고 다시 409/410이 발생하면 오류를 던진다", async () => {
    let callCount = 0;
    const { all } = eventServer(150);
    const loadEvents = vi.fn((request: LoadEventsRequest): Promise<RecordingEventPage> => {
      callCount += 1;
      if (callCount === 2 || callCount === 3) {
        const error = new Error("EVENT_LIST_SNAPSHOT_GONE") as Error & { status: number; code: string };
        error.status = 410;
        error.code = "EVENT_LIST_SNAPSHOT_GONE";
        return Promise.reject(error);
      }
      return Promise.resolve({
        totalItems: 150,
        items: all.slice((request.page - 1) * request.pageSize, request.page * request.pageSize),
        snapshotToken: "token-reset",
        asOf: "2026-10-25T00:00:00Z",
        snapshotExpiresAt: "2026-10-25T00:05:00Z",
      });
    });
    const list = createRecordingList({ loadEvents, startOf });
    await list.ensure(6); // callCount 1 (p1 성공)

    // deeper 요청: callCount 2 (p2에서 410 발생 -> 1회 재시작) -> callCount 3 (재시작 p1에서도 410 발생 -> 2회째이므로 오류)
    await expect(list.ensure(60)).rejects.toThrow("EVENT_LIST_SNAPSHOT_GONE");
    expect(loadEvents).toHaveBeenCalledTimes(3);
  });

  test("status가 409여도 다른 code이면 재시작하지 않고 오류를 던진다", async () => {
    let callCount = 0;
    const { all } = eventServer(100);
    const loadEvents = vi.fn((request: LoadEventsRequest): Promise<RecordingEventPage> => {
      callCount += 1;
      if (callCount === 2) {
        const error = new Error("OTHER_CONFLICT") as Error & { status: number; code: string };
        error.status = 409;
        error.code = "OTHER_CONFLICT";
        return Promise.reject(error);
      }
      return Promise.resolve({
        totalItems: 100,
        items: all.slice((request.page - 1) * request.pageSize, request.page * request.pageSize),
      });
    });
    const list = createRecordingList({ loadEvents, startOf });
    await list.ensure(6);
    await expect(list.ensure(60)).rejects.toThrow("OTHER_CONFLICT");
    expect(loadEvents).toHaveBeenCalledTimes(2);
  });

  test("브라우저 시계가 서버보다 1시간 빠른 경우에도 무한 반복 없이 정상 페이징되고 요청 수가 예상과 같다", async () => {
    const serverAsOf = "2026-10-25T00:00:00Z";
    const serverExpires = "2026-10-25T00:05:00Z";
    const browserTime = Date.parse(serverAsOf) + 3600 * 1000;
    const now = vi.fn(() => browserTime);

    const { loadEvents } = eventServer(130, "token-ahead", serverExpires, serverAsOf);
    const list = createRecordingList({ loadEvents, startOf, now });

    const result = await list.ensure(130);
    expect(loadEvents).toHaveBeenCalledTimes(3);
    expect(result.items).toHaveLength(130);
    expect(result.complete).toBe(true);
  });

  test("로컬 만료 시각이 지난 경우 다음 페이지 요청 전에 1회 재시작한다", async () => {
    let currentTime = 1000;
    const now = () => currentTime;
    const { all } = eventServer(150);
    const loadEvents = vi.fn((request: LoadEventsRequest): Promise<RecordingEventPage> => {
      const pageIndex = request.page - 1;
      return Promise.resolve({
        totalItems: 150,
        items: all.slice(pageIndex * request.pageSize, request.page * request.pageSize),
        snapshotToken: request.snapshotToken ? "token-next" : "token-first",
        asOf: "2026-10-25T00:00:00Z",
        snapshotExpiresAt: "2026-10-25T00:05:00Z", // 300초 수명
      });
    });

    const list = createRecordingList({ loadEvents, startOf, now });
    await list.ensure(6); // 1페이지 수신 (receivedAt = 1000, localExpiresAt = 1000 + 300,000 = 301,000)
    expect(loadEvents).toHaveBeenCalledTimes(1);

    // 시각을 로컬 만료 시각(301,000) 이후로 전진
    currentTime = 302_000;
    await list.ensure(60); // 2페이지 요청 전 만료 감지 -> 1회 재시작 (1페이지 토큰 없이 재요청) -> 2페이지 요청
    expect(loadEvents).toHaveBeenCalledTimes(3);
    expect(loadEvents.mock.calls[1][0]).toEqual({
      page: 1,
      pageSize: 50,
      snapshotToken: undefined,
      from: undefined,
      to: undefined,
    });
    expect(loadEvents.mock.calls[2][0].page).toBe(2);
  });

  test("응답마다 수명이 0인 경우 재시작은 1회뿐이고 이후 현재 토큰으로 계속 요청한다", async () => {
    const { all } = eventServer(150);
    const loadEvents = vi.fn((request: LoadEventsRequest): Promise<RecordingEventPage> => {
      const pageIndex = request.page - 1;
      return Promise.resolve({
        totalItems: 150,
        items: all.slice(pageIndex * request.pageSize, request.page * request.pageSize),
        snapshotToken: request.snapshotToken ?? "token-zero-ttl",
        asOf: "2026-10-25T00:00:00Z",
        snapshotExpiresAt: "2026-10-25T00:00:00Z", // 수명 0
      });
    });

    const list = createRecordingList({ loadEvents, startOf });
    const result = await list.ensure(60);
    expect(loadEvents).toHaveBeenCalledTimes(3);
    expect(loadEvents.mock.calls[0][0].page).toBe(1);
    expect(loadEvents.mock.calls[1][0].page).toBe(1);
    expect(loadEvents.mock.calls[1][0].snapshotToken).toBeUndefined();
    expect(loadEvents.mock.calls[2][0].page).toBe(2);
    expect(loadEvents.mock.calls[2][0].snapshotToken).toBe("token-zero-ttl");
    expect(result.items).toHaveLength(100);
  });

  test("asOf가 없으면 사전 재시작 없이 다음 페이지를 요청한다", async () => {
    const { all } = eventServer(100);
    const loadEvents = vi.fn((request: LoadEventsRequest): Promise<RecordingEventPage> => {
      const pageIndex = request.page - 1;
      return Promise.resolve({
        totalItems: 100,
        items: all.slice(pageIndex * request.pageSize, request.page * request.pageSize),
        snapshotToken: "token-no-asof",
        snapshotExpiresAt: "2020-01-01T00:00:00Z", // 과거 시각이어도 asOf가 없으므로 사전 재시작하지 않음
      });
    });

    const list = createRecordingList({ loadEvents, startOf });
    await list.ensure(60);
    expect(loadEvents).toHaveBeenCalledTimes(2);
    expect(loadEvents.mock.calls[0][0].page).toBe(1);
    expect(loadEvents.mock.calls[1][0].page).toBe(2);
    expect(loadEvents.mock.calls[1][0].snapshotToken).toBe("token-no-asof");
  });

  test("만료로 1회 재시작한 뒤 410 오류를 받으면 다시 재시작하지 않고 오류를 던진다", async () => {
    let currentTime = 1000;
    const now = () => currentTime;
    const { all } = eventServer(150);
    let callCount = 0;
    const loadEvents = vi.fn((request: LoadEventsRequest): Promise<RecordingEventPage> => {
      callCount += 1;
      if (callCount === 3) {
        const error = new Error("EVENT_LIST_SNAPSHOT_GONE") as Error & { status: number; code: string };
        error.status = 410;
        error.code = "EVENT_LIST_SNAPSHOT_GONE";
        return Promise.reject(error);
      }
      return Promise.resolve({
        totalItems: 150,
        items: all.slice((request.page - 1) * request.pageSize, request.page * request.pageSize),
        snapshotToken: request.snapshotToken ?? "token-exp",
        asOf: "2026-10-25T00:00:00Z",
        snapshotExpiresAt: "2026-10-25T00:05:00Z",
      });
    });

    const list = createRecordingList({ loadEvents, startOf, now });
    await list.ensure(6);
    expect(loadEvents).toHaveBeenCalledTimes(1);

    currentTime = 302_000;
    await expect(list.ensure(60)).rejects.toThrow("EVENT_LIST_SNAPSHOT_GONE");
    expect(loadEvents).toHaveBeenCalledTimes(3);
  });

  test("410 오류로 1회 재시작한 뒤 만료가 감지되어도 추가 재시작 없이 현재 토큰으로 요청한다", async () => {
    const { all } = eventServer(150);
    let callCount = 0;
    const loadEvents = vi.fn((request: LoadEventsRequest): Promise<RecordingEventPage> => {
      callCount += 1;
      if (callCount === 2) {
        const error = new Error("EVENT_LIST_SNAPSHOT_GONE") as Error & { status: number; code: string };
        error.status = 410;
        error.code = "EVENT_LIST_SNAPSHOT_GONE";
        return Promise.reject(error);
      }
      return Promise.resolve({
        totalItems: 150,
        items: all.slice((request.page - 1) * request.pageSize, request.page * request.pageSize),
        snapshotToken: request.snapshotToken ?? "token-restarted",
        asOf: "2026-10-25T00:00:00Z",
        snapshotExpiresAt: callCount >= 3 ? "2026-10-25T00:00:00Z" : "2026-10-25T00:05:00Z",
      });
    });

    const list = createRecordingList({ loadEvents, startOf });
    await list.ensure(6);
    expect(loadEvents).toHaveBeenCalledTimes(1);

    const result = await list.ensure(60);
    expect(loadEvents).toHaveBeenCalledTimes(4);
    expect(loadEvents.mock.calls[3][0].page).toBe(2);
    expect(loadEvents.mock.calls[3][0].snapshotToken).toBe("token-restarted");
    expect(result.items).toHaveLength(100);
  });

  test("시스템 시계가 2027-01-01인 미래 환경에서도 시간 의존 없이 정상 페이징된다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    try {
      const { loadEvents } = eventServer(130);
      const list = createRecordingList({ loadEvents, startOf });
      const first = await list.ensure(6);
      expect(first.items).toHaveLength(50);
      const deeper = await list.ensure(75);
      expect(deeper.items).toHaveLength(100);
      expect(loadEvents).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("날짜 녹화와 이벤트를 합칠 때 이벤트는 occurredAt 기준으로 비교하며 이벤트 간 순서는 서버 순서를 유지한다", async () => {
    // 이벤트의 start와 occurredAt이 다른 경우
    // evt-0: start 50, occurredAt 1000
    // evt-1: start 100, occurredAt 800 (서버 순서: evt-0 -> evt-1)
    const e0 = recording("evt-0", 50, "event", new Date(1000).toISOString());
    const e1 = recording("evt-1", 100, "event", new Date(800).toISOString());
    const dMid = recording("daily-mid", 900, "daily"); // daily time: 900
    const loadEvents = vi.fn(() => Promise.resolve<RecordingEventPage>({
      totalItems: 2,
      items: [e0, e1],
      snapshotToken: "tok",
    }));
    const loadDaily = () => Promise.resolve([dMid]);
    const list = createRecordingList({ loadDaily, loadEvents, startOf });
    const result = await list.ensure(3);
    const ids = result.items.map((item) => item.id);
    // e0 (occurredAt 1000) > dMid (start 900) > e1 (occurredAt 800)
    expect(ids).toEqual(["evt-0", "daily-mid", "evt-1"]);
  });

  test("동일 occurredAt의 이벤트 사이 순서는 서버 순서를 그대로 보존한다", async () => {
    const e0 = recording("evt-b", 50, "event", new Date(1000).toISOString());
    const e1 = recording("evt-a", 60, "event", new Date(1000).toISOString());
    const loadEvents = vi.fn(() => Promise.resolve<RecordingEventPage>({
      totalItems: 2,
      items: [e0, e1],
      snapshotToken: "tok",
    }));
    const list = createRecordingList({ loadEvents, startOf });
    const result = await list.ensure(2);
    expect(result.items.map((item) => item.id)).toEqual(["evt-b", "evt-a"]);
  });

  test("마지막 페이지까지 가져오면 완료로 표시하고 더 요청하지 않는다", async () => {
    const { loadEvents } = eventServer(130);
    const list = createRecordingList({ loadEvents, startOf });
    const all = await list.ensure(1000);
    expect(all.items).toHaveLength(130);
    expect(all.complete).toBe(true);
    await list.ensure(1000);
    expect(loadEvents).toHaveBeenCalledTimes(3);
  });

  test("이벤트가 없는 유형은 서버 이벤트를 요청하지 않는다", async () => {
    const list = createRecordingList({ loadDaily: () => Promise.resolve([recording("d1", 1, "daily")]), startOf });
    expect(await list.ensure(6)).toMatchObject({ total: 1, complete: true });
  });

  test("서버가 빈 페이지를 돌려주면 반복하지 않고 완료한다", async () => {
    const loadEvents = vi.fn(() => Promise.resolve<RecordingEventPage>({ totalItems: 500, items: [] }));
    const list = createRecordingList({ loadEvents, startOf });
    expect((await list.ensure(50)).complete).toBe(true);
    expect(loadEvents).toHaveBeenCalledTimes(1);
  });
});

describe("2027-01-01 가상 시계 환경", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("시스템 시계가 2027-01-01이어도 무한 루프 없이 정상 페이징된다", async () => {
    const { loadEvents } = eventServer(130);
    const list = createRecordingList({ loadEvents, startOf });
    const first = await list.ensure(6);
    expect(first.items).toHaveLength(50);
    const deeper = await list.ensure(75);
    expect(deeper.items).toHaveLength(100);
    expect(loadEvents).toHaveBeenCalledTimes(2);
  });

  test("2027-01-01 환경에서 브라우저 시계가 서버보다 1시간 빨라도 정상 페이징된다", async () => {
    const serverAsOf = "2026-10-25T00:00:00Z";
    const serverExpires = "2026-10-25T00:05:00Z";
    const { loadEvents } = eventServer(100, "tok", serverExpires, serverAsOf);
    const list = createRecordingList({ loadEvents, startOf });
    const result = await list.ensure(100);
    expect(loadEvents).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(100);
  });

  test("2027-01-01 환경에서 로컬 만료 시 1회 재시작 후 완료된다", async () => {
    const { all } = eventServer(150);
    const loadEvents = vi.fn((request: LoadEventsRequest): Promise<RecordingEventPage> => {
      const pageIndex = request.page - 1;
      return Promise.resolve({
        totalItems: 150,
        items: all.slice(pageIndex * request.pageSize, request.page * request.pageSize),
        snapshotToken: request.snapshotToken ? "token-next" : "token-first",
        asOf: "2026-10-25T00:00:00Z",
        snapshotExpiresAt: "2026-10-25T00:05:00Z", // 300초 수명
      });
    });

    const list = createRecordingList({ loadEvents, startOf });
    await list.ensure(6);
    expect(loadEvents).toHaveBeenCalledTimes(1);

    // 2027-01-01에서 301초 경과
    vi.setSystemTime(new Date("2027-01-01T00:05:01Z"));
    await list.ensure(60);
    expect(loadEvents).toHaveBeenCalledTimes(3);
    expect(loadEvents.mock.calls[1][0].page).toBe(1);
    expect(loadEvents.mock.calls[1][0].snapshotToken).toBeUndefined();
    expect(loadEvents.mock.calls[2][0].page).toBe(2);
  });
});
