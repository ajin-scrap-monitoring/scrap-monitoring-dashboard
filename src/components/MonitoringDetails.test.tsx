import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import { monitoringV2Data } from "../data/monitoring-v2";
import { monitoringV2StateFixture } from "../test/backend-contract-fixtures";

import MonitoringDetails from "./MonitoringDetails";

function state() {
  return monitoringV2Data(monitoringV2StateFixture("FRESH", 0), "pit-01").v2!;
}

test("장비 시계 오차 0과 서비스 상태를 상세에서만 표시한다", () => {
  render(<MonitoringDetails dataSource={createMockDashboardDataSource()} state={{ ...state(), clock: { state: "SYNCHRONIZED", offsetMs: 0 }, services: [{ name: "synthetic-service", state: "DEGRADED", lastProgressAt: "2026-10-13T00:00:00Z", reasonCodes: ["SYNTHETIC_REASON"] }] }} />);
  expect(screen.getByText("시계 오차").parentElement).toHaveTextContent("0 ms");
  expect(screen.getByLabelText("서비스 상태")).toHaveTextContent("synthetic-service: DEGRADED");
  expect(screen.getByLabelText("서비스 상태")).toHaveTextContent("SYNTHETIC_REASON");
});

test("pit 이름 조회 실패는 재시도하며 식별자를 유지한다", async () => {
  const getPitName = vi.fn().mockRejectedValueOnce(new Error("Temporary failure")).mockResolvedValueOnce("운영 대상 이름");
  const source: DashboardDataSource = { ...createMockDashboardDataSource(), getPitName };
  render(<MonitoringDetails dataSource={source} state={state()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("이름 조회 실패");
  expect(screen.getByText("pit-01")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
  expect(await screen.findByText("운영 대상 이름")).toBeVisible();
  expect(getPitName).toHaveBeenCalledTimes(2);
});

test("상세 종료 시 pit 이름 요청을 취소한다", () => {
  const getPitName = vi.fn((signal?: AbortSignal) => { expect(signal).toBeDefined(); return new Promise<string>(() => undefined); });
  const view = render(<MonitoringDetails dataSource={{ ...createMockDashboardDataSource(), getPitName }} state={state()} />);
  const signal = getPitName.mock.calls[0]?.[0];
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

test("snapshot의 장비 진단 값을 변환하고 통신 지연으로 사용하지 않는다", () => {
  const snapshot = monitoringV2StateFixture("FRESH", 0);
  const result = monitoringV2Data({ ...snapshot, deviceStatus: { ...snapshot.deviceStatus, snapshot: {
    sensors: [], clock: { state: "SYNCHRONIZED", offset_ms: 17 }, services: [{ service: "test-service", state: "HEALTHY", last_progress_at: "2026-10-13T00:00:00Z", reason_codes: [] }],
  } } }, "pit-01");
  expect(result.v2?.clock).toEqual({ state: "SYNCHRONIZED", offsetMs: 17 });
  expect(result.v2?.services?.[0]).toMatchObject({ name: "test-service", lastProgressAt: "2026-10-13T00:00:00Z" });
  expect(result.devices.every(device => device.latency === "정보 없음")).toBe(true);
});

test.each([{ clock: { state: "SYNCHRONIZED", offset_ms: Number.NaN } }, { services: [{ service: "test", state: "HEALTHY", last_progress_at: "bad-time", reason_codes: [] }] }])("잘못된 장비 진단 계약을 거부한다 %j", invalid => {
  const snapshot = monitoringV2StateFixture("FRESH", 0);
  expect(() => monitoringV2Data({ ...snapshot, deviceStatus: { ...snapshot.deviceStatus, snapshot: { sensors: [], ...invalid } } }, "pit-01")).toThrow();
});
