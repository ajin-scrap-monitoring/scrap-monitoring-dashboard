import { describe, expect, test, vi } from "vitest";

import type { Recording } from "../domain/dashboard";
import { createRecordingList, type RecordingEventPage } from "./recording-list";

function recording(id: string, start: number, source: "daily" | "event" = "event"): Recording {
  return { id, source, start: String(start), end: String(start + 1), date: "", time: "", detail: id, type: source === "daily" ? "날짜 녹화" : "수거", tone: "complete", sample: false,
    codec: "", format: "", frameRate: null, height: null, width: null, size: "", retentionStartsAt: "", retentionEndsAt: "", duration: "", status: "available" };
}

const startOf = (item: Recording) => Number(item.start);

// 서버처럼 시작 시각 역순의 이벤트 total건을 pageSize 단위로 돌려준다.
function eventServer(total: number) {
  const all = Array.from({ length: total }, (_, index) => recording(`evt-${index}`, 10_000 - index));
  const loadEvents = vi.fn((request: { page: number; pageSize: number }): Promise<RecordingEventPage> =>
    Promise.resolve({ totalItems: total, items: all.slice((request.page - 1) * request.pageSize, request.page * request.pageSize) }));
  return { all, loadEvents };
}

describe("녹화 목록 핸들", () => {
  test("첫 목록은 이벤트 서버 1페이지(20건)만 요청하고 전체 건수는 날짜 녹화 수와 이벤트 totalItems의 합이다", async () => {
    const { loadEvents } = eventServer(1393);
    const loadDaily = vi.fn(() => Promise.resolve([recording("d1", 20_000, "daily"), recording("d2", 5_000, "daily")]));
    const list = createRecordingList({ loadDaily, loadEvents, startOf });
    const first = await list.ensure(6);
    expect(loadEvents).toHaveBeenCalledTimes(1);
    expect(loadEvents).toHaveBeenCalledWith({ page: 1, pageSize: 20 }, undefined);
    expect(loadDaily).toHaveBeenCalledTimes(1);
    expect(first.total).toBe(1395);
    expect(first.complete).toBe(false);
    expect(first.items.slice(0, 3).map((item) => item.id)).toEqual(["d1", "evt-0", "evt-1"]);
  });

  test("더 아래 순위가 필요하면 다음 서버 페이지를 순서대로 가져오고 eventId 중복은 제거한다", async () => {
    const { loadEvents } = eventServer(1393);
    const list = createRecordingList({ loadEvents, startOf });
    await list.ensure(6);
    await list.ensure(12);
    expect(loadEvents).toHaveBeenCalledTimes(1);
    const deeper = await list.ensure(150);
    expect(loadEvents.mock.calls.map(([request]) => `${request.page}/${request.pageSize}`)).toEqual(["1/20", "1/100", "2/100"]);
    expect(deeper.items).toHaveLength(200);
    expect(new Set(deeper.items.map((item) => item.id)).size).toBe(200);
    expect(deeper.items.map((item) => item.id).slice(0, 3)).toEqual(["evt-0", "evt-1", "evt-2"]);
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

  test("날짜 녹화가 이벤트 사이에 있으면 시작 시각 역순으로 합친다", async () => {
    const { loadEvents } = eventServer(40);
    const list = createRecordingList({ loadDaily: () => Promise.resolve([recording("daily-mid", 9_990.5, "daily")]), loadEvents, startOf });
    const result = await list.ensure(15);
    const ids = result.items.map((item) => item.id);
    expect(ids.indexOf("daily-mid")).toBe(10);
    expect(ids.slice(8, 12)).toEqual(["evt-8", "evt-9", "daily-mid", "evt-10"]);
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

  test("동시에 호출해도 서버 요청은 순서대로 한 번에 하나씩 실행한다", async () => {
    const { all } = eventServer(300);
    let active = 0;
    let maximum = 0;
    const loadEvents = vi.fn(async (request: { page: number; pageSize: number }): Promise<RecordingEventPage> => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return { totalItems: 300, items: all.slice((request.page - 1) * request.pageSize, request.page * request.pageSize) };
    });
    const list = createRecordingList({ loadEvents, startOf });
    await Promise.all([list.ensure(6), list.ensure(100), list.ensure(250)]);
    expect(maximum).toBe(1);
  });

  test("요청이 실패하면 거절하고 이미 받은 페이지는 유지해 다음 호출에서 이어간다", async () => {
    const { all } = eventServer(300);
    let fail = false;
    const loadEvents = vi.fn((request: { page: number; pageSize: number }): Promise<RecordingEventPage> => fail
      ? Promise.reject(new Error("failure"))
      : Promise.resolve({ totalItems: 300, items: all.slice((request.page - 1) * request.pageSize, request.page * request.pageSize) }));
    const list = createRecordingList({ loadEvents, startOf });
    await list.ensure(6);
    fail = true;
    await expect(list.ensure(150)).rejects.toThrow("failure");
    fail = false;
    expect((await list.ensure(150)).items.length).toBeGreaterThanOrEqual(150);
    expect(loadEvents.mock.calls.map(([request]) => `${request.page}/${request.pageSize}`)).toEqual(["1/20", "1/100", "1/100", "2/100"]);
  });
});
