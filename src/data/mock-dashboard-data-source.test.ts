import { expect, test } from "vitest";

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

test("호출마다 독립된 합성 데이터를 반환한다", async () => {
  const source = createMockDashboardDataSource();
  const first = await source.getDashboardData();
  first.monitoring.alerts[0].detail = "변경됨";
  const second = await source.getDashboardData();

  expect(second.monitoring.alerts[0].detail).toBe("대표 적재율 82%");
});
