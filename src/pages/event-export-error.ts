export const EVENT_EXPORT_ERROR_MESSAGES: Record<string, string> = {
  RECORDING_NOT_FOUND_IN_RANGE: "이 구간에 녹화 영상이 없습니다.",
  INSUFFICIENT_STORAGE: "서버 저장 공간이 부족합니다.",
  RECORDING_STORAGE_ERROR: "저장소 오류로 영상에 접근할 수 없습니다.",
  CLIP_PREPARATION_FAILED: "구간 파일 준비에 실패했습니다.",
  RECORDING_BOUNDARY_UNAVAILABLE: "녹화 경계 시점을 자를 수 없습니다.",
  EXPORT_INCOMPATIBLE_MEDIA: "영상 형식이 달라 구간을 병합할 수 없습니다.",
  EVENT_EXPORT_NOT_FOUND: "구간 파일 요청을 찾을 수 없습니다.",
  EVENT_WINDOW_IN_FUTURE: "구간이 미래 시점이라 준비할 수 없습니다.",
  EVENT_TIME_IN_FUTURE: "구간이 미래 시점이라 준비할 수 없습니다.",
  REQUEST_TIME_IN_FUTURE: "구간이 미래 시점이라 준비할 수 없습니다.",
  EVENT_WINDOW_NOT_CLOSED: "수거가 끝난 뒤 준비할 수 있습니다.",
  EVENT_EXPORT_REQUEST_CONFLICT: "이전 요청과 충돌이 발생했습니다.",
  EVENT_EXPORT_RANGE_TOO_LONG: "구간이 1시간을 넘어 준비할 수 없습니다.",
  MEDIA_UNAVAILABLE: "미디어 서비스에 연결할 수 없습니다.",
  MEDIA_TIMEOUT: "미디어 서비스 응답 시간이 초과되었습니다.",
  MEDIA_NOT_CONFIGURED: "미디어 서비스 설정이 완료되지 않았습니다.",
  MEDIA_AUTH_FAILED: "미디어 서비스 인증에 실패했습니다.",
  MEDIA_BAD_RESPONSE: "미디어 서비스 응답 형식이 올바르지 않습니다.",
  MEDIA_RANGE_CONTEXT_INVALID: "구간 요청 정보가 유효하지 않습니다.",
  MEDIA_TIME_CONTEXT_INVALID: "구간 요청 정보가 유효하지 않습니다.",
  MEDIA_CLIP_SOURCE_CHANGED: "미디어 원본 소스가 변경되었습니다.",
  MEDIA_RANGE_BASIS_MISMATCH: "미디어 기준 정보가 일치하지 않습니다.",
  MEDIA_TIME_BASIS_MISMATCH: "미디어 기준 정보가 일치하지 않습니다.",
  EXPORT_FAILED: "구간 파일 생성에 실패했습니다.",
  EVENT_EXPORT_FAILED: "구간 파일 생성에 실패했습니다.",
  NO_FRAMES_AVAILABLE: "유효한 영상 프레임이 없습니다.",
  NO_RECORDING_DATA: "해당 구간에 녹화 데이터가 없습니다.",
  RECORDING_NOT_READY: "녹화 영상이 아직 준비되지 않았습니다.",
  RECORDING_NOT_ENABLED: "상시 녹화가 비활성화되어 있습니다.",
  RECORDING_UNAVAILABLE: "녹화 영상을 사용할 수 없습니다.",
  RECORDING_EXPIRED: "녹화 영상 보관 기간이 만료되었습니다.",
  EXPORT_IN_PROGRESS: "구간 파일 생성이 이미 진행 중입니다.",
  EXPORT_NOT_READY: "구간 파일이 아직 준비되지 않았습니다.",
  CAMERA_UNAVAILABLE: "카메라에 연결할 수 없습니다.",
  STORAGE_UNAVAILABLE: "미디어 저장소를 사용할 수 없습니다.",
};

export function eventExportErrorCodeMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return EVENT_EXPORT_ERROR_MESSAGES[code];
}

export function parseExportError(error: unknown): { status: number; message: string; code?: string } {
  let status = 0;
  let code: string | undefined;
  let rawMessage: string | undefined;

  if (error && typeof error === "object") {
    if ("status" in error && typeof error.status === "number") status = error.status;
    if ("code" in error && typeof error.code === "string") code = error.code;
    if ("message" in error && typeof error.message === "string") rawMessage = error.message;
  }

  // 1. code 기반 문구 우선
  const codeMessage = eventExportErrorCodeMessage(code);
  if (codeMessage) {
    return { status, code, message: codeMessage };
  }

  if (rawMessage) {
    for (const [key, msg] of Object.entries(EVENT_EXPORT_ERROR_MESSAGES)) {
      if (rawMessage.includes(key)) {
        return { status, code: code ?? key, message: msg };
      }
    }
  }

  // 2. 모르는 code이거나 code가 없는 경우: status별 문구 사용
  if (status === 401) return { status, code, message: "로그인이 만료되었습니다." };
  if (status === 403) return { status, code, message: "권한 또는 보안 토큰 오류입니다." };
  if (status === 404) return { status, code, message: "대상을 찾을 수 없습니다." };
  if (status === 409) return { status, code, message: "요청 처리 중 충돌이 발생했습니다." };
  if (status === 422) return { status, code, message: "입력 오류가 발생했습니다." };
  if (status === 503) return { status, code, message: "미디어 접속 또는 저장소 문제입니다." };
  if (status === 504) return { status, code, message: "시간 초과가 발생했습니다." };

  return { status, code, message: "구간 파일 준비에 실패했습니다." };
}
