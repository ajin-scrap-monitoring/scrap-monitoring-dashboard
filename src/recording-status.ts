import type { Recording } from "./domain/dashboard";

export function recordingStatus(recording: Recording) {
  if (recording.daily) {
    const daily = recording.daily;
    if (daily.status === "failed") return "녹화 실패";
    if (daily.status === "expired") return "보관 만료";
    if (daily.status === "deleted") return "삭제됨";
    if (daily.status === "recording") return "녹화 중";
    if (daily.status === "finalizing") return "녹화 정리 중";
    return daily.playbackState === "ready" ? "재생 가능" : daily.playbackState === "pending" ? "재생 준비 중" : "영상 없음";
  }
  if (recording.eventWindow) {
    if (!recording.replay && recording.playbackSummary) {
      return ({ AVAILABLE: "재생 가능", PARTIAL: "일부 재생 가능", PROCESSING: "재생 준비 중", UNAVAILABLE: "영상 없음", UNKNOWN: "확인 불가" })[recording.playbackSummary.state];
    }
    if (!recording.replay) return ({ CLOSED: "구간 확정", OPEN: "구간 진행 중", UNKNOWN: "구간 종료 미확인", POINT: "시점 이벤트" })[recording.eventWindow.windowState];
    return ({ AVAILABLE: "재생 가능", PARTIAL: "일부 재생 가능", PROCESSING: "재생 준비 중", UNAVAILABLE: "영상 없음" })[recording.replay.state];
  }
  const states: Record<string, string> = {
    collecting: "녹화 구간 수집 중", processing: "파일 생성 중", ready: "재생 가능",
    failed: "녹화 실패", deleted: "삭제됨", expired: "보관 만료", blocked: "녹화 요청 차단",
  };
  if (recording.mediaStatus) return states[recording.mediaStatus] ?? "상태 확인 불가";
  return recording.status === "available" ? "정상" : recording.status === "processing" ? "처리 중" : recording.status === "expired" ? "보관 만료" : "사용 불가";
}

export function recordingErrorCode(value: string | null | undefined) {
  return typeof value === "string" && /^[A-Z0-9_]{1,100}$/.test(value) ? value : null;
}

export function recordingStatusReason(recording: Recording) {
  if (recording.daily) {
    const daily = recording.daily;
    if (daily.status === "failed") return "날짜 녹화를 처리하지 못했습니다. 상세 원인은 서버 로그에서 확인하세요.";
    if (daily.status === "expired" || daily.status === "deleted") return "녹화 영상이 만료되거나 삭제되어 재생할 수 없습니다.";
    if (daily.exportState === "failed") return "MP4 다운로드 파일을 준비하지 못했습니다. 다시 준비하거나 서버 로그를 확인하세요.";
    if (daily.playbackState === "pending") return "확보한 영상의 재생을 준비하고 있습니다.";
    if (daily.playbackState === "unavailable") return "현재 재생할 수 있는 확보 구간이 없습니다.";
    if (daily.hasGaps || daily.coverage === "partial") return "실제 확보한 구간만 재생합니다. 누락 구간은 시간축에서 확인할 수 있습니다.";
    if (daily.status === "recording" || daily.status === "finalizing") return "날짜 녹화가 진행 중이며 확보가 완료된 구간부터 재생할 수 있습니다.";
    return "서버에서 확보한 날짜 녹화 구간을 재생할 수 있습니다.";
  }
  if (recording.eventWindow) {
    const replay = recording.replay;
    if (!replay && recording.playbackSummary?.state === "UNKNOWN") return "목록에서는 영상 확보 여부를 확인하지 못했습니다. 선택하면 최신 재생 구간을 확인합니다.";
    if (!replay) return "구간 상태에 따라 재생 가능 여부가 달라집니다. 선택하면 최신 재생 구간을 확인합니다.";
    const gaps = replay.unavailableIntervals.length;
    if (replay.state === "PARTIAL") return `확보한 구간만 이어서 재생합니다. 재생할 수 없는 구간이 ${gaps}개 있습니다.`;
    if (replay.state === "PROCESSING") return "이벤트 구간의 영상이 아직 확보되고 있습니다.";
    if (replay.state === "UNAVAILABLE") return "이 이벤트 구간에서 재생할 수 있는 영상이 없습니다.";
    return recording.eventWindow.windowState === "OPEN" ? "이벤트 구간이 진행 중이며 확보한 영상까지 재생합니다." : "이벤트 구간 전체를 재생할 수 있습니다.";
  }
  if (recording.errorCode === "NO_FRAMES_AVAILABLE") return "요청한 녹화 구간의 영상 프레임을 확보하지 못했습니다.";
  if (recording.mediaStatus === "failed") return "녹화 영상을 생성하지 못했습니다. 상세 원인은 서버 로그에서 확인하세요.";
  if (recording.mediaStatus === "deleted") return "녹화 파일이 삭제되어 재생할 수 없습니다.";
  if (recording.mediaStatus === "expired" || recording.status === "expired") return "녹화 파일의 보관 기간이 만료되었습니다.";
  if (recording.mediaStatus === "blocked") return "녹화 요청이 차단되었습니다. 상세 원인은 서버 로그에서 확인하세요.";
  if (recording.mediaStatus === "collecting") return "요청한 녹화 구간의 영상을 수집하고 있습니다.";
  if (recording.mediaStatus === "processing" || recording.status === "processing") return "녹화 파일을 생성하고 있습니다.";
  if (recording.status === "available" && (!recording.mediaStatus || recording.mediaStatus === "ready")) return "녹화 영상을 재생할 수 있습니다.";
  return "녹화 영상의 접근 상태를 확인할 수 없습니다.";
}
