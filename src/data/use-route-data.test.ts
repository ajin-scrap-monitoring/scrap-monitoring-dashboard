import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { DashboardData } from "../domain/dashboard";
import type { DashboardDataSource, DashboardRoute, DashboardRouteData } from "./dashboard-data-source";
import { useRouteData } from "./use-route-data";

describe("useRouteData", () => {
  test("loadRouteData가 없으면 fallbackData에서 해당 화면 데이터를 추출한다", () => {
    const historyData = {
      chartEvents: [],
      events: [],
      loadSamples: [],
      startsAt: "2026-09-03T18:00:00+09:00",
      endsAt: "2026-09-10T18:00:00+09:00",
      thresholds: [],
    };
    const fallbackData = {
      history: historyData,
    } as unknown as DashboardData;
    const dataSource: DashboardDataSource = {
      getDashboardData: () => Promise.resolve({} as unknown as DashboardData),
    };

    const { result } = renderHook(() =>
      useRouteData({
        dataSource,
        fallbackData,
        isAppReady: true,
        route: "history",
        search: "",
      }),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.history).toEqual(historyData);
    expect(result.current.error).toBeNull();
  });

  test("loadRouteData를 호출하여 화면 데이터를 가져오고 성공 시 반영한다", async () => {
    const routeData: DashboardRouteData = {
      history: {
        chartEvents: [],
        loadSamples: [],
        endsAt: "2026-09-10T18:00:00+09:00",
        events: [],
        startsAt: "2026-09-03T18:00:00+09:00",
        thresholds: [],
      },
    };
    const dataSource: DashboardDataSource = {
      getDashboardData: () => Promise.resolve({} as unknown as DashboardData),
      loadRouteData: vi.fn().mockResolvedValue(routeData),
    };

    const { result } = renderHook(() =>
      useRouteData({
        dataSource,
        isAppReady: true,
        route: "history",
        search: "",
      }),
    );

    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual(routeData);
    expect(result.current.error).toBeNull();
  });

  test("route나 search가 변경되면 이전 요청을 abort하고 늦은 결과를 무시한다", async () => {
    const abortSignals: AbortSignal[] = [];
    let resolveFirst: (data: DashboardRouteData) => void = () => undefined;
    let resolveSecond: (data: DashboardRouteData) => void = () => undefined;

    const dataSource: DashboardDataSource = {
      getDashboardData: () => Promise.resolve({} as unknown as DashboardData),
      loadRouteData: vi.fn().mockImplementation((route: DashboardRoute, options: { search: string; signal?: AbortSignal }) => {
        if (options.signal) abortSignals.push(options.signal);
        if (route === "history") {
          return new Promise<DashboardRouteData>((resolve) => { resolveFirst = resolve; });
        }
        return new Promise<DashboardRouteData>((resolve) => { resolveSecond = resolve; });
      }),
    };

    const { rerender, result } = renderHook(
      ({ route, search }: { route: DashboardRoute; search: string }) =>
        useRouteData({
          dataSource,
          isAppReady: true,
          route,
          search,
        }),
      { initialProps: { route: "history" as DashboardRoute, search: "" } },
    );

    expect(abortSignals).toHaveLength(1);
    expect(abortSignals[0].aborted).toBe(false);

    rerender({ route: "recordings", search: "" });
    expect(abortSignals).toHaveLength(2);
    expect(abortSignals[0].aborted).toBe(true);
    expect(abortSignals[1].aborted).toBe(false);

    // 늦게 도착한 첫 번째 응답
    await act(async () => {
      resolveFirst({ history: { chartEvents: [], events: [], loadSamples: [], startsAt: "", endsAt: "", thresholds: [] } });
      await Promise.resolve();
    });
    expect(result.current.data).toBeNull();

    // 두 번째 응답
    await act(async () => {
      resolveSecond({ recordings: [] });
      await Promise.resolve();
    });
    expect(result.current.data?.recordings).toEqual([]);
  });

  test("요청 실패 시 error를 반영하고 AbortError는 무시한다", async () => {
    const dataSource: DashboardDataSource = {
      getDashboardData: () => Promise.resolve({} as unknown as DashboardData),
      loadRouteData: vi.fn().mockRejectedValue(new Error("조회 실패")),
    };

    const { result } = renderHook(() =>
      useRouteData({
        dataSource,
        isAppReady: true,
        route: "admin",
        search: "",
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toBe("조회 실패");
    expect(result.current.data).toBeNull();
  });
});
