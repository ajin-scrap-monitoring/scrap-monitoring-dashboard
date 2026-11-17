import type { ActiveHealthAlert } from "../domain/dashboard";

const loadPercentFormatter = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 20,
});

const monitoringReasonLabels: Record<string, string> = {
  ACK_MISMATCH: "서버 응답 불일치",
  ASSESSMENT_CLOCK_SKEW: "판정 시각 오차",
  ASSESSMENT_NOT_RECEIVED: "판정 데이터 미수신",
  ASSESSMENT_STALE: "판정 데이터 만료",
  AUTHENTICATION_FAILED: "서버 인증 실패",
  BACKEND_CONFIGURATION_REJECTED: "Backend 설정 거절",
  BASE_REVISION_MISMATCH: "기준 설정 버전 불일치",
  CALIBRATION_INVALID: "보정 값 오류",
  CALIBRATION_MISMATCH: "보정 버전 불일치",
  CALIBRATION_MISSING: "보정 정보 누락",
  CALIBRATION_UNVERIFIED: "보정 미검증",
  CAMERA_AUTHENTICATION_FAILED: "카메라 인증 실패",
  CAMERA_FRAME_STALE: "카메라 프레임 수신 지연",
  CAMERA_HEALTH_SOURCE_NOT_CONFIGURED: "상태 입력 계약 없음",
  CAMERA_STATUS_BAD_RESPONSE: "카메라 상태 응답 형식 오류",
  CAMERA_STATUS_BUSY: "카메라 상태 조회 지연",
  CAMERA_STATUS_CLOCK_UNTRUSTED: "카메라 상태 시각 신뢰 불가",
  CAMERA_STATUS_EXPIRED: "카메라 상태 유효 시간 만료",
  CAMERA_STATUS_IDENTITY_MISMATCH: "카메라 식별자 불일치",
  CAMERA_STATUS_NOT_FOUND: "카메라 상태 대상 없음",
  CAMERA_STATUS_TIMEOUT: "카메라 상태 응답 시간 초과",
  CAMERA_STATUS_UNAVAILABLE: "카메라 상태 조회 실패",
  CLOCK_DEGRADED: "장치 시각 동기화 저하",
  CLOCK_UNSYNCED: "장치 시각 미동기화",
  COLLECTION_DROP_SUSPECTED: "수거 급감 감지",
  CONFIG_CAMERA_MISMATCH: "카메라 설정 불일치",
  CONFIG_CHECKSUM_MISMATCH: "설정 체크섬 불일치",
  CONFIG_DEPLOYMENT_METADATA_MISMATCH: "배포 메타데이터 불일치",
  CONFIG_DEPLOYMENT_MISMATCH: "배포 설정 불일치",
  CONFIG_ERROR: "설정 오류",
  CONFIG_INVALID: "설정 파일 오류",
  CONFIG_REVISION_MISMATCH: "설정 버전 불일치",
  CONFIG_SERVICE_VERSION_MISMATCH: "서비스 설정 버전 불일치",
  CONFIG_SITE_MISMATCH: "현장 설정 불일치",
  CONFIG_UNAVAILABLE: "설정 정보 없음",
  CONFIGURATION_ACK_PENDING: "설정 적용 확인 대기",
  CONFIGURATION_STATE_INVALID: "설정 상태 오류",
  CONNECTING: "업로드 연결 중",
  COORDINATE_FRAME_MISMATCH: "좌표계 불일치",
  COORDINATE_OUT_OF_RANGE: "좌표 범위 초과",
  CURRENT_OBSERVATION_NOT_EVALUATED: "현재 관측 미평가",
  CURRENT_STATUS_UNAVAILABLE: "현재 상태 확인 불가",
  DEFAULT_PROFILE_UNAVAILABLE: "기본 프로필 없음",
  DEFAULT_SETTINGS: "미검증 기본 설정 사용",
  DEVICE_MEASUREMENT_UNAVAILABLE: "장치 측정 사용 불가",
  DEVICE_SCOPE_MISMATCH: "장치 소속 불일치",
  DRIVER_UNAVAILABLE: "센서 드라이버 연결 불가",
  FILL_FUSION_NOT_CONFIGURED: "융합 적재율 미설정",
  FILL_FUSION_NOT_VALIDATED: "융합 적재율 미검증",
  FILL_METHOD_NOT_CONFIGURED: "적재율 계산 방식 미설정",
  FILTER_DISABLED: "시간 필터 비활성",
  FILTER_INPUT_UNAVAILABLE: "필터 입력 사용 불가",
  FILTER_UNAVAILABLE: "시간 필터 사용 불가",
  FILTER_WARMING: "시간 필터 안정화 준비 중",
  FRAME_RECEIVED: "정상 프레임 수신",
  INCOMPLETE_PROFILE: "단면 측정 범위 불완전",
  INITIALIZING: "장치 초기화 중",
  INPUT_EXPIRED_DURING_FILTER: "필터 처리 중 입력 만료",
  INSUFFICIENT_HISTORY: "시간 안정화 이력 부족",
  INSUFFICIENT_INPUT: "유효 입력 부족",
  INSUFFICIENT_SENSORS: "가용 센서 수 부족",
  INTERPOLATED_BINS: "일부 단면 보간 처리",
  LIDAR_STATUS_NOT_REPORTED: "LiDAR 상태 미보고",
  LOCAL_DELIVERY_BACKLOG_LOSS: "로컬 전송 적체 데이터 유실",
  LOCAL_DELIVERY_UNAVAILABLE: "로컬 전송 경로 사용 불가",
  MEASUREMENT_UNAVAILABLE: "측정 사용 불가",
  MEDIAN_WARMING: "중앙값 필터 준비 중",
  NETWORK_ERROR: "네트워크 통신 오류",
  NO_NEW_SCAN: "신규 스캔 없음",
  NO_SELECTED_POINTS: "선택 영역 측정 점 없음",
  NO_VALID_POINTS: "유효 측정 점 없음",
  OBSERVATION_CONFIG_MISMATCH: "관측 설정 버전 불일치",
  OBSERVATION_LOSS: "관측 데이터 일부 유실",
  OBSERVATION_TIME_UNAVAILABLE: "관측 시각 없음",
  OBSERVATIONS_UNAVAILABLE: "관측 데이터 사용 불가",
  OCCLUSION_SUSPECTED: "시야 가림 의심",
  OPERATIONS_DISABLED: "경보 평가 비활성",
  OPERATIONS_EVALUATION_ERROR: "경보 평가 오류",
  OPERATIONS_EVALUATION_PENDING: "경보 평가 반영 대기",
  OPERATIONS_EVALUATION_UNAVAILABLE: "경보 평가 불가",
  OUTBOX_DATA_LOSS: "전송 대기 데이터 유실",
  PARTIAL_POINTS: "일부 측정 점만 유효",
  PRE_COLLECTION_ALERT_DISABLED: "사전 경보 비활성",
  RAPID_RISE_SUSPECTED: "적재 급증 감지",
  RETRYING: "업로드 재시도 중",
  SCAN_NOT_UPDATED: "LiDAR 스캔 갱신 안 됨",
  SCAN_RECOVERING: "LiDAR 스캔 복구 중",
  SCAN_REJECTED: "LiDAR 스캔 데이터 거절",
  SCAN_STALE: "LiDAR 스캔 데이터 만료",
  SCAN_TIME_UNAVAILABLE: "LiDAR 스캔 시각 없음",
  SCAN_UPDATE_ALARM_UNCONFIRMED: "LiDAR 지연 경고 미확정",
  SCAN_UPDATE_DELAY: "LiDAR 스캔 갱신 지연",
  SCAN_UPDATE_DELAY_CONFIRMED: "LiDAR 스캔 갱신 지연 확정",
  SCAN_UPDATE_DELAY_PENDING: "LiDAR 스캔 갱신 지연 확인 중",
  SCAN_UPDATE_RECOVERING: "LiDAR 스캔 갱신 복구 중",
  SCHEMA_REJECTED: "메시지 형식 거절",
  SDK_INVALID_RANGE: "센서 거리 범위 초과",
  SECTION_GEOMETRY_MISMATCH: "단면 기하 구조 불일치",
  SECTION_INCOMPLETE: "단면 데이터 불완전",
  SENSOR_ABSENT: "센서 입력 없음",
  SENSOR_DISAGREEMENT: "LiDAR 1과 LiDAR 2 측정 불일치",
  SENSOR_STATUS_NOT_RECEIVED: "센서 상태 보고 미수신",
  SENSOR_TIME_MISMATCH: "센서 간 스캔 시각 불일치",
  SIMULATION_GEOMETRY: "시뮬레이션 배치 기준",
  SINGLE_SENSOR_FALLBACK: "단일 센서 대체 측정",
  SOURCE_INVALID: "원본 입력 형식 오류",
  STALE_FRAME: "오래된 스캔 프레임",
  STATUS_MISSING: "하위 서비스 상태 누락",
  STATUS_NOT_RECEIVED: "장치 상태 보고 수신 안 됨",
  STATUS_STALE: "장치 상태 보고 지연",
  STATUS_TIME_UNTRUSTED: "장치 상태 보고 시각 신뢰 불가",
  STATUS_UNAVAILABLE: "장치 상태 확인 불가",
  STOPPED: "센서 처리 중지",
  STORAGE_UNAVAILABLE: "저장소 사용 불가",
  TOKEN_UNAVAILABLE: "인증 토큰 없음",
};

const componentKindLabels: Record<ActiveHealthAlert["componentKind"], string> = {
  EDGE: "엣지 장비",
  LIDAR: "LiDAR 센서",
  MEASUREMENT: "측정 데이터",
  CAMERA: "카메라",
};

const evidenceSourceLabels: Record<ActiveHealthAlert["evidenceSource"], string> = {
  EDGE_STATUS: "Edge 장치 상태 보고",
  STATUS_FRESHNESS: "장치 상태 보고 신선도",
  CURRENT_MEASUREMENT: "현재 측정 판단 결과",
  MEDIA_CAMERA_STATUS: "Media 카메라 상태 관측",
};

/**
 * 추정 적재율 숫자를 반올림 없이 최소 소수 둘째 자리까지 고정 형식으로 변환한다.
 */
export function formatLoadPercent(value: number): string {
  return loadPercentFormatter.format(Object.is(value, -0) ? 0 : value);
}

/**
 * 알려진 영문 사유 코드를 한국어 설명으로 변환하고, 미등록 코드는 원문을 반환한다.
 */
export function translateMonitoringReason(code: string): string {
  return Object.hasOwn(monitoringReasonLabels, code) ? monitoringReasonLabels[code] : code;
}

/**
 * 사유 코드 목록을 한국어 설명과 원시 코드 형식의 문자열 배열로 변환한다.
 */
export function formatMonitoringReasonDetails(codes: readonly string[]): string[] {
  return codes.map((code) => {
    const label = translateMonitoringReason(code);
    return label === code ? code : `${label} (${code})`;
  });
}

/**
 * 사유 코드 목록을 활성 알림 한 줄 표시용 요약 문구로 축약한다.
 */
export function formatMonitoringReasonSummary(codes: readonly string[]): string | null {
  if (codes.length === 0) return null;
  const first = translateMonitoringReason(codes[0]);
  return codes.length === 1 ? first : `${first} 외 ${codes.length - 1}건`;
}

/**
 * 장비 상태 카드 항목의 hover 안내 문구를 상태 코드와 사유 코드 기준으로 조합한다.
 */
export function deviceStatusTitle(
  statusLabel: string | undefined,
  reasonCodes: readonly string[] | undefined,
): string | undefined {
  if (!reasonCodes || reasonCodes.length === 0) return statusLabel;
  const details = formatMonitoringReasonDetails(reasonCodes);
  return [statusLabel, ...details.map((detail) => `사유: ${detail}`)].filter(Boolean).join("\n");
}

export function componentKindLabel(kind: ActiveHealthAlert["componentKind"]): string {
  return componentKindLabels[kind];
}

export function evidenceSourceLabel(source: ActiveHealthAlert["evidenceSource"]): string {
  return evidenceSourceLabels[source];
}
