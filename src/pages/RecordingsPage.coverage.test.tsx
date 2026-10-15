import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import type { RecordingCoverageDetail } from "../domain/dashboard";

import { RecordingsPage } from "./RecordingsPage";

const id = "550e8400-e29b-41d4-a716-446655440000";
const detail: RecordingCoverageDetail = { requestedStart: "2026-09-09T00:00:00Z", requestedEnd: "2026-09-09T00:00:30Z", actualStart: "2026-09-09T00:00:05Z", actualEnd: "2026-09-09T00:00:25Z", coverage: "partial", gaps: [{ start: "2026-09-09T00:00:00Z", end: "2026-09-09T00:00:05Z" }], errorCode: null };

test("기존 부분 저장 표시를 선택한 경우에만 범위를 조회하고 닫을 때 focus를 복원한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const recording = { ...data.recordings[0], id, coverage: "partial", gaps: detail.gaps };
  const getRecordingCoverage = vi.fn().mockResolvedValue(detail);
  const source: DashboardDataSource = { getDashboardData: () => Promise.resolve(data), getRecordingCoverage };
  render(<RecordingsPage dataSource={source} recordings={[recording]} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="normal" />);
  expect(getRecordingCoverage).not.toHaveBeenCalled();
  const opener = screen.getByRole("button", { name: "부분 저장" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: "녹화 범위 상세" });
  expect(await within(dialog).findByText(detail.requestedStart)).toBeVisible();
  expect(within(dialog).getByText(detail.actualStart!)).toBeVisible();
  expect(within(dialog).getByText("구간별 누락 원인은 API에서 제공하지 않습니다.")).toBeVisible();
  expect(getRecordingCoverage).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  expect(screen.getByRole("heading", { name: "녹화 정보" })).toBeVisible();
});

test("녹화 범위 조회 오류와 재시도를 기본 카드 밖에서 처리한다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  const getRecordingCoverage = vi.fn().mockRejectedValueOnce(new Error("Temporary failure")).mockResolvedValue(detail);
  const source: DashboardDataSource = { getDashboardData: () => Promise.resolve(data), getRecordingCoverage };
  render(<RecordingsPage dataSource={source} recordings={[{ ...data.recordings[0], id, coverage: "partial" }]} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="normal" />);
  fireEvent.click(screen.getByRole("button", { name: "부분 저장" }));
  const dialog = screen.getByRole("dialog");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("조회 실패");
  fireEvent.click(within(dialog).getByRole("button", { name: "다시 조회" }));
  expect(await within(dialog).findByText(detail.requestedStart)).toBeVisible();
});

test("최초 녹화 조회 실패를 빈 목록과 0건으로 표시하지 않는다", async () => {
  const data = await createMockDashboardDataSource().getDashboardData();
  render(<RecordingsPage recordings={[]} recordingsState={{ status: "error", message: "녹화 목록 조회 실패" }} headerNotifications={[]} lastMeasuredAt={data.lastMeasuredAt} status="normal" />);
  expect(screen.getByRole("alert")).toHaveTextContent("녹화 목록 조회 실패");
  expect(screen.getByText("확인 불가", { exact: true })).toBeVisible();
  expect(screen.queryByText("0건")).not.toBeInTheDocument();
  expect(screen.queryByText("조회된 녹화 영상이 없습니다.")).not.toBeInTheDocument();
});
