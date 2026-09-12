import { afterEach, expect, test, vi } from "vitest";

import type { DashboardData } from "../domain/dashboard";
import { createMockDashboardDataSource } from "./mock-dashboard-data-source";

test("기본 합성 데이터는 화면에 필요한 데이터를 제공한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();

  expect(data.monitoring.status).toBe("normal");
  expect(data.monitoring.devices).toHaveLength(4);
  expect(data.monitoring.loadHistory).toHaveLength(24);
  expect(data.history.loadSamples).not.toHaveLength(0);
  expect(data.recordings).toHaveLength(8);
  expect(data.admin.recipients).toHaveLength(11);
});

test("합성 시나리오는 상태별 화면 데이터를 분리한다", async () => {
  const collectionRequired = await createMockDashboardDataSource("collection-required").getDashboardData();
  const measurementError = await createMockDashboardDataSource("measurement-error").getDashboardData();
  const disconnected = await createMockDashboardDataSource("disconnected").getDashboardData();

  expect(collectionRequired.monitoring.status).toBe("collection-required");
  expect(collectionRequired.monitoring.alerts[0].detail).toBe("대표 적재율 84%");
  expect(measurementError.monitoring.devices[1].latency).toBe("-");
  expect(disconnected.monitoring.devices.every((device) => device.latency === "수신 없음")).toBe(true);
});

test("데이터 없음과 요청 오류 시나리오를 제공한다", async () => {
  const noData = await createMockDashboardDataSource("no-data").getDashboardData();

  expect(noData.monitoring.status).toBe("no-data");
  expect(noData.monitoring.loadHistory).toHaveLength(0);
  expect(noData.history.events).toHaveLength(0);
  await expect(createMockDashboardDataSource("request-error").getDashboardData()).rejects.toThrow("합성 데이터 요청 오류");
});

test("빈 목록 시나리오는 현황을 유지하고 부가 목록만 비운다", async () => {
  const data = await createMockDashboardDataSource("empty-lists").getDashboardData();

  expect(data.monitoring.status).toBe("normal");
  expect(data.monitoring.loadHistory).toHaveLength(24);
  expect(data.monitoring.alerts).toHaveLength(0);
  expect(data.history.events).toHaveLength(0);
  expect(data.recordings).toHaveLength(0);
  expect(data.admin.recipients).toHaveLength(0);
});

test("호출마다 독립된 합성 데이터를 반환한다", async () => {
  const source = createMockDashboardDataSource();
  const first = await source.getDashboardData();
  first.monitoring.alerts[0].detail = "변경됨";
  const second = await source.getDashboardData();

  expect(second.monitoring.alerts[0].detail).toBe("대표 적재율 82%");
});

test("합성 데이터 요청은 AbortSignal로 취소할 수 있다", async () => {
  const controller = new AbortController();
  const request = createMockDashboardDataSource("loading").getDashboardData({ signal: controller.signal });
  controller.abort();

  await expect(request).rejects.toMatchObject({ name: "AbortError" });
});

test("live-update 시나리오는 구독자에게 새 스냅샷을 전달한다", async () => {
  const updates: DashboardData[] = [];
  const source = createMockDashboardDataSource("live-update");
  const unsubscribe = source.subscribe?.((data) => updates.push(data));

  await new Promise((resolve) => window.setTimeout(resolve, 1200));

  expect(updates).toHaveLength(1);
  expect(updates[0].monitoring.summary.loadPercent).toBe(75);
  unsubscribe?.();
});

afterEach(() => {
  vi.useRealTimers();
});

test("operation-cycle 시나리오는 수거와 장애 상태 전이를 순서대로 전달한다", () => {
  vi.useFakeTimers();
  const statuses: Array<{ status: string; loadPercent: number }> = [];
  const source = createMockDashboardDataSource("operation-cycle");
  const unsubscribe = source.subscribe?.((data) => {
    statuses.push({ status: data.monitoring.status, loadPercent: data.monitoring.summary.loadPercent });
  });

  vi.advanceTimersByTime(2500);

  expect(statuses).toEqual([
    { status: "collection-required", loadPercent: 80 },
    { status: "normal", loadPercent: 4 },
    { status: "measurement-error", loadPercent: 72 },
    { status: "disconnected", loadPercent: 72 },
    { status: "normal", loadPercent: 72 },
  ]);
  unsubscribe?.();
});
