import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";

import { createMockDashboardDataSource } from "../data/mock-dashboard-data-source";
import { dailyRecording } from "../data/daily-recordings";
import { recordingErrorCode } from "../recording-status";
import { dailyRecordingFixture } from "../test/daily-recording-fixtures";

import { RecordingStatusDetails } from "./RecordingStatusDetails";

async function failedRecording() {
  const data = await createMockDashboardDataSource().getDashboardData();
  return { ...data.recordings[0], sample: false, status: "unavailable" as const, mediaStatus: "failed", errorCode: "NO_FRAMES_AVAILABLE", coverage: "none", gaps: [] };
}

test("실패 상태를 hover하면 짧은 오류 코드와 사용자용 사유를 표시하고 벗어나면 닫는다", async () => {
  render(<RecordingStatusDetails recording={await failedRecording()} />);
  const trigger = screen.getByRole("button", { name: "녹화 실패 상세" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.mouseEnter(trigger);
  const popup = screen.getByRole("dialog", { name: "녹화 상태 상세" });
  expect(within(popup).getByText("NO_FRAMES_AVAILABLE")).toBeVisible();
  expect(within(popup).getByRole("alert")).toHaveTextContent("요청한 녹화 구간의 영상 프레임을 확보하지 못했습니다.");
  fireEvent.mouseLeave(trigger.parentElement ?? trigger);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("클릭으로 고정한 상세는 pointer가 벗어나도 유지하고 Escape와 바깥 클릭으로 닫는다", async () => {
  render(<RecordingStatusDetails recording={await failedRecording()} />);
  const trigger = screen.getByRole("button", { name: "녹화 실패 상세" });
  trigger.focus();
  fireEvent.mouseEnter(trigger);
  fireEvent.click(trigger);
  fireEvent.mouseLeave(trigger.parentElement ?? trigger);
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "녹화 상태 상세 닫기" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("긴 처리 로그와 stack trace는 DOM에 포함하지 않고 원인을 추측하지 않는다", async () => {
  const raw = "private processing stack trace /internal/path ".repeat(100);
  const view = render(<RecordingStatusDetails recording={{ ...await failedRecording(), errorCode: raw }} />);
  fireEvent.click(screen.getByRole("button", { name: "녹화 실패 상세" }));
  expect(screen.getByRole("alert")).toHaveTextContent("녹화 영상을 생성하지 못했습니다.");
  expect(screen.getByText("확인 불가", { exact: true })).toBeVisible();
  expect(view.container).not.toHaveTextContent(raw);
});

test("알 수 없는 짧은 오류 코드는 유지하고 사용자 안내는 일반적인 실패 사유로 표시한다", async () => {
  render(<RecordingStatusDetails recording={{ ...await failedRecording(), errorCode: "UNKNOWN_ENCODING_FAILURE" }} />);
  fireEvent.click(screen.getByRole("button", { name: "녹화 실패 상세" }));
  expect(screen.getByText("UNKNOWN_ENCODING_FAILURE")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("녹화 영상을 생성하지 못했습니다.");
  expect(screen.queryByText(/영상 프레임을 확보/)).not.toBeInTheDocument();
});

test("공개 계약의 오류 코드 1~100자를 보존하고 로그와 범위 밖 문자열은 거부한다", () => {
  for (const code of ["NO_FRAMES_AVAILABLE", "2_EXPORT_FAILED", "_", "A".repeat(80), "A".repeat(100)]) {
    expect(recordingErrorCode(code)).toBe(code);
  }
  for (const code of [undefined, null, "", "A".repeat(101), "error at /private/file", "<script>run()</script>"]) {
    expect(recordingErrorCode(code)).toBeNull();
  }
});

test("재생 가능한 날짜 녹화의 MP4 실패를 녹화 실패와 구분하고 공개 오류 코드를 표시한다", async () => {
  const code = `2_${"A".repeat(98)}`;
  const daily = dailyRecording({ ...dailyRecordingFixture, export_state: "failed", error: { code, message: "PRIVATE_EXPORT_DETAILS" } }, "camera-main");
  const recording = { ...await failedRecording(), status: "available" as const, mediaStatus: "closed", daily, errorCode: code };
  const view = render(<RecordingStatusDetails recording={recording} />);
  fireEvent.click(screen.getByRole("button", { name: "MP4 준비 실패 상세" }));
  expect(screen.getByRole("alert")).toHaveTextContent("MP4 다운로드 파일을 준비하지 못했습니다.");
  expect(screen.getByText(code)).toBeVisible();
  expect(view.container).not.toHaveTextContent("PRIVATE_EXPORT_DETAILS");
  expect(view.container).not.toHaveTextContent("녹화 영상을 생성하지 못했습니다.");
});
