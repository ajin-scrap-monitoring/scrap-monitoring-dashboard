# 대시보드 서비스 API 연동 계획

## 목적과 범위

Backend와 Camera Media Service가 제공하는 Application Programming Interface (API)를
기존 대시보드의 사용자 목적과 비교하고 필요한 연동만 선별한다. 현재 화면이 주요 사용자
장면을 제공한다는 전제로 기존 디자인과 정보 구조를 기본으로 유지한다. API나 필드가
있다는 이유만으로 새 화면, 조회 모드나 제어 기능을 추가하지 않는다.

데이터 활용 평가에서 채택한 항목만 구현 범위에 포함한다. 작업은 계약과 오류 경계,
적재율 추이, 경보 근거 상세, 녹화 정보, 기존 기능의 계약 확인과 통합 검증의 6개 묶음이다.
날짜별 녹화의 브라우저 연동은 외부 계약 확정 뒤 검토하는 범위이며 현재 구현 대상으로
확정하지 않는다.
현재 구현은 [구현 정보](implementation.md), 적용 중인 데이터 의미는
[화면 데이터 매핑](contracts/backend/frontend-mapping.md)을 따른다.
[자체 개선 계획](frontend-improvement-plan.md)의 테스트와 자원 정리 기준은 재사용한다.

작업 판단 기준은 3개다.

| 구분 | 처리 기준 |
| --- | --- |
| 기존 구현의 결함 | 재현 및 회귀 테스트를 통한 수정, 추가 기능 채택과 별도 처리 |
| 합리적인 기존 기능과 계약의 불일치 | 지원하는 범위만 표시, 미지원 내용과 원인 및 외부 책임 기록, API 제한만을 이유로 기존 요구사항 축소 금지 |
| 추가 정보의 표시 | 기존 기능의 정상 표시에 필요한 값과 선택적인 설명 정보를 구분하고 사용자 확인 뒤 구현 |

수정 및 검증 대상은 이 Repository와 로컬의 격리된 검증 컨테이너다.
다른 Repository의 코드와 배포된 Backend 및 Camera Media Service의 컨테이너, 설정과
저장 데이터는 변경하지 않는다.
스크랩 서버로의 소스 동기화와 서버 통합 검증은 별도 요청 범위다. 브라우저 local port
forwarding은 사용자가 관리한다. Git 변경은 Issue와 Pull Request (PR)로 반영한다.
이 연동의 minor Release는 검증을 마친 원격 `main`의 커밋을 기준으로 생성한다.

## 계약 분석 기준

계획의 분석 기준은 다음 2개 revision이다. 실제 서비스 통합 검증에 사용하는 revision의
정본은 [manifest](contracts/backend/manifest.json)이며, 분석 기준과 배포 버전을 구분한다.
미병합 branch와 계약 초안으로 브라우저 요청 경로를 확정하지 않는다.

| 서비스 | 분석 revision | 제공 계약의 근거 |
| --- | --- | --- |
| Backend | [`73b9e28`](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/tree/73b9e28b135e670d6c5d6a460da3b76af16250a8) | [적재율 추이](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/73b9e28b135e670d6c5d6a460da3b76af16250a8/docs/V2_LOAD_HISTORY.md), [경보와 판단 사건](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/73b9e28b135e670d6c5d6a460da3b76af16250a8/docs/V2_OPERATIONS.md), [미디어 연동](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/73b9e28b135e670d6c5d6a460da3b76af16250a8/docs/MEDIA_INTEGRATION.md) |
| Camera Media Service | [`daf293e`](https://github.com/ajin-scrap-monitoring/ajin-camera-media-service/tree/daf293e756004e7c740b585b089f257d557ad7ab) | [날짜별 녹화](https://github.com/ajin-scrap-monitoring/ajin-camera-media-service/blob/daf293e756004e7c740b585b089f257d557ad7ab/docs/DAILY_RECORDING_API_GUIDE.md), [이벤트 클립과 실시간 영상](https://github.com/ajin-scrap-monitoring/ajin-camera-media-service/blob/daf293e756004e7c740b585b089f257d557ad7ab/src/camera_media_service/http_api.py) |

Backend의 분석 revision은 v2 적재율 추이를 제공하지만 날짜별 녹화의 브라우저용 API는
제공하지 않는다. Media Service의 날짜별 API는 내부 통신용이며, 브라우저는 Backend의
인증된 조회 경로와 gateway의 영상 경로를 사용한다. Media 배포만으로 이 경계가 확정되지는
않는다.

채택한 항목의 확정된 계약 구현과 격리 테스트는 실제 서버 배포 전에도 진행한다. 미배포 기능의 서버
검증과 미확정 경로의 실제 요청 연결은 각각의 조건이 충족된 뒤 진행한다. 조회 실패나
미지원 경로를 빈 목록, 0 또는 정상 상태로 변환하지 않는다.

## 화면 유지와 데이터 사용 원칙

유지 대상은 [프로젝트 명세](project-spec.md#사용자-기능)의 현황 카드 8개, 페이지 구성,
공통 헤더와 푸터, 카드 순서, 색상과 주요 제어 요소의 배치다. 기본 화면의 카드 크기,
표의 열 너비와 행 높이를 추가 정보 때문에 변경하지 않는다. 추가 정보는 기존 표시를
선택할 때 화면 위에 겹치는 상세창에서 제공한다. 상세창은 내부 스크롤, Escape와 닫기,
키보드 진입 및 종료 후 focus 복원을 제공하며 배경 배치를 밀어내지 않는다.

데이터 사용은 직접 사용, 변환 사용, 의미 불일치와 추가 계약 필요의 4개 분류를 따른다.
API 응답은 adapter에서 화면 모델로 변환하며, 화면이 서비스의 원본 응답을 직접 해석하지
않게 한다. 제공되지 않는 정보와 허용하지 않는 변환은 화면 데이터 매핑을 따른다.

계약 정보가 부족한 영역도 카드와 공간을 유지한다. 경보 등급, 실제 수거 작업, 수거 판단
사건과 작업자의 완료 기록은 서로 다른 의미로 보존한다. 사건과 영상은 명시적인 식별자
연결만 사용한다.

## 미표시 데이터 활용 평가

평가 기준은 사용자 판단의 변화, 기존 정보와의 중복, 기존 영역의 수용 가능성, 데이터의
의미 및 신뢰도와 구현 비용이다. 기본 화면, 기존 상세와 adapter 내부에서 사용하는 값을
구분하며, 기본 화면에 숫자로 표시하지 않는다는 이유만으로 미사용으로 분류하지 않는다.

화면 적용 분류는 다음 4개다. 계약상 의미가 맞는지를 판단하는 화면 데이터 매핑의 분류와
추가 표시의 필요성을 구분한다.

| 분류 | 적용 기준 |
| --- | --- |
| 기존 기능 연결 | 이미 설계한 그래프, 목록, 상태와 버튼에 필요한 정보 |
| 상세 및 내부 사용 | 오류 원인 확인이나 올바른 동작에 필요하지만 상시 노출은 불필요한 정보 |
| 화면 미반영 | 중복 표현, 내부 통신 식별자와 운영 전용 정보 |
| 계약 확정 후 검토 | Backend의 날짜별 녹화 브라우저 계약이 필요한 정보 |

아래 16개 묶음은 분석 revision과 현재 Frontend에 대한 적용 분류다. 선택적 추가 정보는
D-01부터 D-08까지의 채택 범위를 따른다. U-11부터 U-15까지는 외부 계약 확정 뒤의 검토
대상이며 날짜 조회 모드와 브라우저 연동의 구현 승인을 의미하지 않는다.

| 항목 | API 제공 데이터 | 기존 화면과의 관계 | 적용 분류 |
| --- | --- | --- | --- |
| U-01 | v2 추이의 `valuePercent`, `valid`, `dataState`, 구간 및 판단 시각 | 현황의 최근 24시간 카드와 이력 그래프의 데이터 원천 | 기존 기능 연결, 상세 기준은 [적재율 추이의 매핑](contracts/backend/frontend-mapping.md#적재율-추이) |
| U-02 | v2 경보의 `assessmentId`, `observedAt`, `loadPercent`, `readAt` | 경보 기록 자체는 기존 운영 이력과 알림함에 포함되는 같은 `AlertLog` | 상세 및 내부 사용, D-01의 채택 범위 적용 |
| U-03 | COLLECTION 판단의 `event.stage`, `decision_state`, `capabilities`, `reason_codes` | 실제 수거 완료 이력과 다른 판단 사건 | 화면 미반영, D-02의 채택 범위 적용 |
| U-04 | 판단의 `revision`, `rule_version`, `evidence` 참조와 개정 이력 | 기본 상태 표시와 다른 원본 추적 정보 | 화면 미반영, D-03의 채택 범위 적용 |
| U-05 | `assessment.fill_estimate.ratio`, `method_version` | 이미 표시하는 `summary.loadPercent`의 원본 수치와 산출 버전 | 화면 미반영, 두 번째 적재율과 산출 방식 지표를 만들지 않고 판정 유효성은 서버 결과 사용 |
| U-06 | `deviceStatus.snapshot.services`의 상태와 마지막 진행 시각 | 기존 장비 상태 및 상태 상세와 관련된 서비스별 원인 | 상세 및 내부 사용, D-04의 채택 범위 적용 |
| U-07 | `deviceStatus.snapshot.clock.state`, `offset_ms` | 장비 상태의 시각 진단 정보 | 상세 및 내부 사용, D-04의 채택 범위 적용 |
| U-08 | `delivery.pending_messages`, `pending_bytes`, `quarantined_messages`, `last_backend_ack_at` | Edge 전송 내부의 적체 및 확인 정보 | 화면 미반영, 현재 사용자 기능과 구분되는 운영 진단 정보 |
| U-09 | `storage.used_bytes`, `limit_bytes`, `lost_messages`, 손실 구간 및 사유 | Edge 저장 상태이며 녹화 파일 저장소와 다른 원천 | 화면 미반영, 녹화 용량이나 영상 누락 정보로 사용 금지 |
| U-10 | `snapshotId`, `message_id`, `sequence`, `orchestrator_instance_id` | 일부는 이미 응답 검증과 동기화에 사용하며 기본 화면에는 미표시 | 화면 미반영, 필요한 비교 및 식별만 내부 사용 |
| U-11 | 날짜 녹화의 `recording_date`, `timezone`, 하루 관리 구간 | 기존 녹화 목록의 조회 단위와 원천 선택에 영향 | 계약 확정 후 검토, 기존 목록과 검색 조건의 지원 범위 확인 |
| U-12 | 날짜 녹화의 `status`, `coverage`, `has_gaps`, `playback_state` | 기존 녹화 상태와 부분 저장 및 재생 가능 표시로 수용 가능 | 계약 확정 후 검토, 녹화 상태와 재생 가능 여부의 독립적인 표시 |
| U-13 | `recorded_seconds`, `gaps`, `available_intervals`, `coverage_as_of_at`, `playable_until_at` | 기존 영상 길이, 누락 안내와 재생 시각에 필요한 정보 | 계약 확정 후 검토, 시간 매핑은 내부 사용하고 별도 하루 시간축 추가는 기본 미채택 |
| U-14 | `export_allowed`, `export_state`, `error` | 기존 다운로드 버튼의 활성 여부, 준비 및 실패 안내 | 계약 확정 후 검토, 별도 export 관리 화면 미추가 |
| U-15 | `size_bytes`, `expires_at`, `export_expires_at` | 기존 파일 용량과 보관 정보, 다운로드 가능 여부에 관련 | 계약 확정 후 검토, 원본 보관 정보와 export 캐시 구분 |
| U-16 | 녹화 `revision`, `storage_profile`, `segment_seconds`, `hls_target_duration` | 저장 및 전송 구현의 기술 정보 | 화면 미반영, 필요 시 재생 구현 내부 사용에 한정 |

기존 상태 상세와 녹화 상세의 표시 범위는 [화면 데이터 매핑](contracts/backend/frontend-mapping.md)을
따른다. 같은 정보를 위한 새 카드를 추가하지 않는다.

U-02의 중복 여부는 Backend의
[기존 운영 이력](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/73b9e28b135e670d6c5d6a460da3b76af16250a8/src/app/services/history_service.py)과
[v2 경보 이력](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/73b9e28b135e670d6c5d6a460da3b76af16250a8/src/app/services/edge_v2_history.py)의
동일한 기록 ID를 기준으로 평가한다. U-04부터 U-10까지의 원본 의미는
[Backend가 공개하는 v2 schema](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/73b9e28b135e670d6c5d6a460da3b76af16250a8/src/app/schemas/edge_v2.py)를
따른다.

추가 정보의 표시 위치와 미표시 항목은 아래 채택 범위를 따른다. 새 화면이나 별도 업무
조작은 포함하지 않는다.

## 추가 정보 표시 범위

추가 정보의 표시 범위는 다음 8개다. API 제공 여부는 앞의 분석 revision을 기준으로 하며,
Media 내부 응답에만 있는 값은 Backend의 브라우저 계약 확인이 필요하다.

| 항목 | 제공 정보 | 사용자 목적 | 채택 범위 |
| --- | --- | --- | --- |
| D-01 경보 근거 | 경보 당시 적재율, 관측 시각과 원본 판단 연결 | 경보가 발생한 관측과 근거 확인 | 기존 내용 셀 선택 시 상세창, 중복 경보 목록과 새 열 미추가 |
| D-02 수거 판단 사건 | 시스템의 수거 후보, 판단 조건 충족, 종료와 철회 | 실제 완료 기록과 별개인 시스템 판단 확인 | 화면 미표시 |
| D-03 판단 개정 및 근거 참조 | revision별 판단, rule version과 evidence 참조 | 판단 변경과 근거 식별 | 화면 미표시 |
| D-04 장비 진단 상세 | Edge 서비스별 상태, 마지막 진행 시각, clock 상태와 offset | 장비 장애 원인 확인 | 기존 상태 상세창에서만 표시 |
| D-05 전송 및 데이터 손실 | 전송 대기량, 격리 메시지 수, Edge 저장량과 메시지 손실 구간 | 데이터 지연 및 손실 확인 | 화면 미표시 |
| D-06 녹화 누락 설명 | 요청 구간과 실제 확보 구간 및 누락 시각 | 확보하지 못한 영상 범위 확인 | 기존 부분 저장 또는 누락 구간 선택 시 상세창, 미제공 원인 추정 금지 |
| D-07 녹화 적용 조건 | 클립 접수 당시 전후 녹화 시간과 보관 일수 | 해당 영상의 저장 범위와 정책 확인 | 화면 미표시 |
| D-08 pit 설정 정보 | 설정된 이름과 전체 깊이 | 조회 대상 이름과 설정값 확인 | 이름은 상태 상세창에서만 표시, 깊이는 미표시 |

D-01부터 D-05까지는 U-02부터 U-09까지의 선택적 정보를 사용자 목적별로 묶는다.
D-06의 이벤트 클립 조회와 미지원 정보는 [녹화 요청 및 확보 범위의 매핑](contracts/backend/frontend-mapping.md#이력-및-다른-화면)을
따른다. Media의 날짜별 응답에 있는 원인은 Backend 계약 확정 대상이다.
기존 녹화 정보의 상태, 재생 가능 여부, 누락 구간, 파일 보관 정보와 다운로드 준비 상태는
기존 기능의 정상 표시를 위한 연동에 포함하고 새로운 기능 선택으로 다시 묻지 않는다.

D-06과 D-07은 Media의 [이벤트 클립 계약](https://github.com/ajin-scrap-monitoring/ajin-camera-media-service/blob/daf293e756004e7c740b585b089f257d557ad7ab/docs/BACKEND_API_CONTRACT.md)과
[날짜별 녹화 계약](https://github.com/ajin-scrap-monitoring/ajin-camera-media-service/blob/daf293e756004e7c740b585b089f257d557ad7ab/docs/DAILY_RECORDING_API_GUIDE.md)을
따른다. 현재 카메라 정책과 클립에 적용된 과거 정책을 구분하며 정책 변경 기능은 포함하지
않는다. D-08은 Backend의 [pit 설정 응답](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/73b9e28b135e670d6c5d6a460da3b76af16250a8/src/app/schemas/config.py)에
있는 설정값이며 실제 높이, 현장 calibration이나 센서 배치의 근거로 사용하지 않는다.
D-05의 저장량과 손실은 Edge 메시지 기준이며 Media Service의 디스크나 영상 손실로
표현하지 않는다.

서버가 지원하지 않는 기존 기능의 의미와 필요한 계약은
[화면 데이터 매핑](contracts/backend/frontend-mapping.md)을 정본으로 기록한다. 분석
revision의 v2 추이는 최대 7일이므로 기존 30일과 90일 선택을 제거하지 않고 v2 그래프의
미지원 범위로 구분한다. 장기 조회 자체의 타당성을 사용자가 다시 결정할 조건으로 두지
않는다.

## 연동 검토 대상 API

아래 경로는 서비스별 제공 경로다. Media Service 경로는 브라우저 공개 경로가 아니며,
날짜별 기능의 Backend 경유 경로와 응답 타입은 외부 계약 확정 대상이다.

| 기능 | 제공 API | 기존 화면과의 관계 | 연동 검토 조건 |
| --- | --- | --- | --- |
| 현재 판단과 장비 상태 | Backend `GET /api/v2/monitoring/snapshot`, `GET /api/v2/monitoring/events` | 기존 현재 상태와 장비 카드, 상태 상세 및 Server-Sent Events (SSE) 복구 유지 | 현재 계약 |
| 적재율 추이 | Backend `GET /api/v2/monitoring/load-history` | 현황의 최근 24시간 카드와 이력 그래프 연결 | 분석 revision의 계약 |
| 경보 이력 | Backend `GET /api/v2/monitoring/alerts` | 기존 경보의 원본 연결 및 당시 관측 정보 | D-01의 상세 조회 범위 |
| 수거 판단과 개정 이력 | Backend `GET /api/v2/monitoring/collection-events`, `GET /api/v2/monitoring/collection-events/{assessment_id}/revisions` | 실제 완료와 별개인 판단 및 진단 정보 | D-02와 D-03에 따라 브라우저 조회 및 화면 표시 제외 |
| 실제 운영 기록 | Backend `GET /api/v1/events` | 실제 수거 완료와 기존 운영 기록 유지, v2 판단과 출처 구분 | 현재 계약 |
| 로그인과 알림함 | Backend `/api/v1/session`, `/api/v1/notifications` 계열 | session, 역할, 읽음 및 미읽음 수 유지, 조회 오류 분리 | 현재 계약 |
| 실시간 영상 | Media `GET /api/v1/cameras/{camera_id}/live` | 기존 Motion JPEG (MJPEG) 영상과 확대 및 연결 복구 유지 | 현재 인증 gateway |
| 이벤트 녹화 | Backend `GET /api/v1/recordings`, `GET /api/v1/recordings/{recordingId}` | 기존 목록, 상세, MP4 재생과 다운로드 유지 | 현재 계약 |
| 날짜별 녹화 정보 | Media `GET /api/v2/cameras/{camera_id}/daily-recordings`, `GET /api/v2/daily-recordings/{recording_id}` | 기존 녹화 목록과 상세의 데이터 원천 후보 | Backend 조회 계약 확정 및 기존 검색 조건과의 차이 기록 |
| 날짜별 재생 | Media `GET /api/v2/daily-recordings/{recording_id}/hls/index.m3u8`, `GET /api/v2/daily-recordings/{recording_id}/media/{segment_id}.ts` | 기존 영상 영역에서 HLS (HTTP Live Streaming) 재생 | 인증된 playlist 및 segment 경로와 player 검증 |
| 하루 MP4 다운로드 | Media `POST /api/v2/daily-recordings/{recording_id}/exports`, `GET /api/v2/daily-recordings/{recording_id}/content` | 기존 다운로드 버튼에서 준비, 상태 조회와 다운로드 연결 | Backend의 준비 요청 및 상세 계약과 인증 경로 확정 |
| 관리자 설정과 수신 대상 | Backend `/api/v1/settings/alerts`, `/api/v1/notification-recipients`, `/api/v1/notification-recipients/{recipientId}`, `/api/v1/notifications/test` | 기존 조회, 저장, 대상 추가 및 변경과 테스트 접수 결과 재검증 | 현재 계약, 운영 변경에는 서버 권한 및 요청 보호 확인 |

같은 정보를 제공하는 저수준 clip 목록과 Dashboard용 목록을 중복 사용하지 않는다.

다음 API는 제공 여부와 관계없이 현재 제품 기능에 연결하지 않는다.

| API 영역 | 분류 이유 |
| --- | --- |
| Edge ingest, measurement 저장, heartbeat와 카메라 ingest | 서비스 간 입력 경계 |
| 수동 clip 생성, clip 및 날짜 녹화 삭제, 녹화 정책 변경 | 현재 제품 범위 밖의 변경 기능 |
| 수거 완료 확인과 pit 구조 변경 | 별도 업무 및 관리 권한 결정 필요 |
| health와 readiness, clip 전송 job 관리 | 배포 및 내부 운영 진단 |
| v1 생성 profile, 고정 latency와 통계 | 기존 화면 지표와 의미 불일치 |
| Web Real-Time Communication (WebRTC)과 WebRTC-HTTP Egress Protocol (WHEP) 경로 | 현재 Camera Media Service의 미지원 기능 |

## 구현 범위와 외부 계약 조건

아래 작업은 데이터 활용 평가에서 채택한 범위에만 적용한다. 현재 구현 상태는
[구현 정보](implementation.md#코드-구조와-작업-재개-기준)를 정본으로 사용하며, 날짜별
녹화의 브라우저 연동은 API-04의 외부 계약 조건을 따른다.

### API-01 계약 갱신과 초기 오류 경계

대상은 `docs/contracts/backend/`, `src/generated/backend-contract.ts`,
`src/data/http-dashboard-data-source.ts`, `src/data/dashboard-data-source.ts`,
`src/domain/dashboard.ts`, `src/data/use-dashboard-data.ts`와 해당 테스트다.

1. 분석 revision의 실제 OpenAPI에서 사용할 경로와 schema를 추출하고 manifest, snapshot과 생성 타입을 함께 갱신한다.
2. Media 내부 계약과 Backend 브라우저 계약을 구분하고 날짜별 경로가 확정되기 전에는 제안 경로를 생성 타입에 추가하지 않는다.
3. 현재 판단, 추이, 알림함, 최근 완료 기록과 페이지별 조회의 오류 상태 및 재시도 경계를 분리한다.
4. 알림 조회의 5xx나 개별 행의 계약 위반이 현재 판단과 영상 화면 전체의 초기화를 막지 않게 한다.
5. 실패한 알림함은 조회 실패로 표시하고 미읽음 수를 0으로 확정하지 않는다. 유효한 마지막 응답의 유지 여부도 상태에 표시한다.
6. 인증 만료, 권한 부족, 미지원 경로, 네트워크 오류와 취소를 구분하며, 인증 실패를 보조 데이터 실패로 숨기지 않는다.

완료 조건은 알림 조회 실패 중에도 snapshot과 영상 영역이 표시되고, 재시도 및 동일
snapshot 재수신으로 오류가 복구되는 상태다. 서버 데이터 정리나 Backend 오류 수정을
Frontend의 완료 조건으로 대신하지 않는다.

### API-02 현황과 이력의 v2 적재율 추이

대상은 `src/data/monitoring-v2.ts`, `http-dashboard-data-source.ts`,
`src/domain/dashboard.ts`, `src/components/MonitoringVisuals.tsx`,
`src/pages/MonitoringPage.tsx`, `src/pages/HistoryPage.tsx`와 해당 테스트다.
추이의 `dataState`는 현재 snapshot의 `dataState`와 별도 모델로 유지한다.

1. 현황 카드에는 최근 24시간, 이력 그래프에는 적용한 조회 기간의 v2 STATE 표본을 연결한다.
2. `schemaVersion`, `pitId`와 source를 검증한다. `bucketStartAt`, `bucketEndAt`으로 결측 구간까지 시간축을 유지하고 실제 점은 `generatedAt`에 배치하며 `observedAt`은 관측 시각으로 구분한다.
3. `valuePercent`는 percent 그대로 사용한다. `valid=false`와 null은 그래프를 끊고 실제 0%는 유효한 점으로 표시한다.
4. 이력의 숫자 전용 표본 모델을 nullable 모델로 확장하고, 결측 구간의 선 연결과 경계값 보간을 제거한다. `LIMITED`는 수치와 제한 상태를 함께 표시한다.
5. 기본 bucket 선택은 서버에 맡기며 조회 기간 최대 7일과 응답 최대 1,441개를 검사한다. 30일 및 90일 선택은 유지하되 v2 그래프에는 범위 미지원 안내를 표시한다.
6. 오늘이 포함된 종료 시각은 서버 시각을 넘지 않게 하고, 종료를 다음 분으로 올림하지 않는다. 조회 기간을 사용자 모르게 축소하거나 여러 응답으로 장기 집계를 만들지 않는다.
7. 현재 임계율은 현재 설정의 참고선으로만 표시하고 과거에 적용된 임계율로 표현하지 않는다. v1 이벤트를 v2 그래프 값에 맞추어 재배치하지 않는다.
8. 화면 진입과 기간 변경 시 조회하고 현황의 최근 구간은 약 1분 간격으로 갱신한다. SSE마다 전체 이력을 다시 요청하지 않으며 이전 요청과 timer를 회수한다.

완료 조건은 기존 차트의 위치, 색상과 크기를 유지하면서 부분 결측, 전체 결측, 0%,
제한된 값과 현재 통신 중단 전의 유효한 과거 값이 구분되는 상태다. 최근 1시간 변화량,
평균 수거 주기와 예상 도달은 각각의 계산 및 제공 계약이 확정되기 전에는 추이만으로
만들지 않는다.

### API-03 경보 근거 상세

대상은 `src/data/dashboard-data-source.ts`, `http-dashboard-data-source.ts`,
`src/domain/dashboard.ts`, `src/pages/HistoryPage.tsx`와 이력 및 browser 테스트다.

D-01의 경보 근거 상세만 연결하며 별도 경보 목록, 수거 판단 사건과 개정 이력 화면은
추가하지 않는다. 기존 운영 이력의 기간 및 유형 조회는 유지하고 경보 근거의 페이지
조회와 분리한다. 식별자 연결, 읽음 의미와 페이지 조회 기준은
[경보와 수거 사건의 매핑](contracts/backend/frontend-mapping.md#경보와-수거-사건)을 따른다.

완료 조건은 기존 표의 배치를 유지하면서 선택한 경보의 근거를 표시하고, 늦은 응답이
현재 선택을 덮어쓰지 않는 상태다.

### API-04 이벤트 클립 상세와 날짜별 녹화의 외부 계약

대상은 `src/domain/dashboard.ts`, `src/data/dashboard-data-source.ts`,
`http-dashboard-data-source.ts`, `src/pages/RecordingsPage.tsx`,
`src/components/Pagination.tsx`, 영상 컴포넌트와 관련 테스트다. 공개 경로 확정 뒤 이
Repository의 Nginx와 개발 gateway 설정도 함께 검증한다.

D-06의 이벤트 클립 상세를 기존 녹화 화면에 연결한다. 날짜별 녹화는 Backend 브라우저
계약이 필요하며 아래 목록, player와 export 절차는 계약 확정 뒤 검토하는 조건부 범위다.
현재 순수 모델과 시간 매핑의 구현 범위는 [구현 정보](implementation.md#코드-구조와-작업-재개-기준)를
따른다. 날짜별 브라우저 요청과 새 의존성 채택은 현재 구현 범위에 포함하지 않는다.

#### 조건부 날짜별 목록과 데이터 모델

1. 기존 조회 조건, 목록, 영상 및 상세 배치를 유지한다. 날짜별 원천이 채택되면 기존 목록에 연결하고 두 원천을 모두 조회할 사용자 목적이 확인된 경우에만 조회 모드를 추가한다.
2. 녹화 모델에 원천 구분을 두고 날짜 녹화에 수거, 알림 또는 오류 유형을 임의로 부여하지 않는다. 같은 형식의 ID도 원천과 함께 식별한다.
3. 날짜 모드는 `Asia/Seoul`의 날짜와 종료일 제외 조건을 사용하고 시각 필터의 미적용을 안내한다. 이벤트 모드의 기존 기간 및 유형 조회는 유지한다.
4. cursor는 해석하지 않고 같은 카메라, 필터와 limit에서 재사용한다. 이전 및 다음 이동은 기존 pagination 외형을 유지하며 제공되지 않은 전체 건수와 마지막 페이지를 만들지 않는다.
5. `status`, `coverage`, `playback_state`, `export_state`를 독립적으로 보존한다. 녹화 중에도 완료 구간은 재생할 수 있고, 날짜 마감과 다운로드 준비 완료는 구분한다.
6. `recorded_seconds`, `coverage_as_of_at`, `playable_until_at`, `gaps`, `available_intervals`와 원본 및 export 만료 시각을 기존 상세에 연결한다. null metadata는 정보 없음으로 표시한다.

#### 조건부 날짜별 재생과 누락 구간

1. 기존 영상 영역과 확대 화면에 HLS player를 연결하고 이벤트 MP4 재생을 유지한다. playlist와 모든 segment는 같은 origin의 인증된 gateway를 통과한다.
2. playlist 내부 Uniform Resource Identifier (URI)도 공개 경로와 일치시킨다. 내부 주소와 임의의 외부 Uniform Resource Locator (URL)는 거부하고 session Cookie나 service token을 Media Service에 전달하지 않는다.
3. `available_intervals`로 재생 위치와 서버 수신 시각을 연결한다. 경과 시간을 자정에 더해 원래 영상 시각으로 표시하지 않는다.
4. 기존 상세의 누락 구간과 재생 시각 표시로 실제 누락, 아직 도래하지 않은 시간과 처리 중인 구간을 구분한다. 별도 하루 시간축과 구간 선택 기능은 기본 범위에 넣지 않고 기존 표시로 부족한 사용자 목적이 확인된 경우에만 검토한다.
5. 브라우저의 native HLS 지원을 검사하고 Media Source Extensions (MSE) 기반 player를 검토한다. 후보는 [hls.js](https://github.com/video-dev/hls.js)이며 채택 전에 버전, 라이선스, 무음 H.264/TS 호환성과 빌드 크기를 보고한다.
6. 새 의존성은 검토 후 채택한다. lazy loading만으로 전체 JavaScript 예산 문제가 해결된 것으로 간주하지 않으며 기존 예산을 임의로 늘리지 않는다.
7. 선택 변경, 확대 전환, 로그아웃과 화면 종료 시 player, 요청, timer와 worker를 회수한다. 지원하지 않는 브라우저와 재생 오류에는 해당 영상 영역에서 복구 동작을 제공한다.

#### 조건부 날짜별 MP4 준비와 다운로드

1. 기존 다운로드 버튼을 준비 요청, 준비 중과 다운로드 가능 상태에 연결한다. `export_allowed`와 최신 상세를 확인하고 오늘 영상의 전체 다운로드는 허용하지 않는다.
2. 최초 및 진행 중의 202와 준비 완료의 200을 구분한다. 중복 클릭은 같은 작업을 기다리고 상세 조회는 약 2초에서 시작해 긴 작업에서는 간격을 늘린다.
3. 선택 변경과 화면 종료는 Frontend의 polling만 취소한다. 이미 접수된 서버 export 작업을 취소하거나 삭제하지 않는다.
4. `export_state=ready`의 최신 인증 경로로 다운로드한다. 부분 저장은 실제 파일 길이와 누락 정보를 함께 알리고 전체 byte를 메모리에 모으지 않는다.
5. 준비 실패, 용량 부족, 접근 제한, 삭제 및 만료를 구분한다. export 캐시 만료는 원본 삭제와 구분하고 서버가 허용하는 준비 재요청을 제공한다.

모델, 시간 매핑과 상태 전이 테스트는 Media의 확정 계약으로 먼저 작성할 수 있다.
Backend의 최종 응답에 대한 adapter와 브라우저 요청 연결은 해당 계약 확정 뒤 구현한다.
미확정 경로를 운영 설정에 추가하거나 Media 내부 API에 직접 연결하지 않는다.

### API-05 기존 조회와 관리자 기능의 계약 확인

대상은 기존 session, 알림, 이벤트 녹화와 관리자 adapter 및 화면과 테스트다.

1. 기존 snapshot, 장비 상세, MJPEG, 알림 읽음, 실제 완료 기록과 이벤트 MP4의 사용 범위를 새 계약과 함께 회귀 검증한다.
2. 관리자 설정과 수신 대상 변경은 서버가 반환한 값과 버전을 사용한다. `If-Match`, 409 및 412의 실제 지원 범위를 확인하고 충돌을 성공으로 표시하지 않는다.
3. 역할과 Cross-Site Request Forgery (CSRF) 검사는 Backend 또는 gateway 계약을 따른다. Frontend의 버튼 숨김을 서버 권한 검사로 간주하지 않는다.
4. 테스트 발송의 accepted와 LOG 기록을 이메일 및 문자 전달 성공으로 표시하지 않는다. 설정 저장과 v2 worker의 실제 적용 범위를 구분한다.
5. 현재 session 계약에서 로그인 화면의 현황 이동이 다시 로그인으로 돌아오는 흐름을 점검하고 문구와 동작을 일치시킨다. 비로그인 조회 정책이나 계정 정책은 변경하지 않는다.

완료 조건은 기존 조회 및 관리 기능의 의미가 유지되고, 오류와 권한 및 지원 범위가
화면에서 일치하는 상태다. 실제 서버 설정을 바꾸는 검증은 수행하지 않으며 변경 요청은
격리 환경에서 검사한다.

## 실행 순서와 외부 의존성

실행은 다음 6단계다. 외부 미확정 항목은 해당 기능의 착수 조건으로 관리하고 다른
작업의 진행을 막지 않는다.

| 단계 | 작업 | 시작 조건 | 완료 기준 |
| --- | --- | --- | --- |
| 1. 데이터 활용 평가 | 미표시 데이터와 D-01부터 D-08까지 | 분석 revision과 현재 화면 및 사용자 목적 | 기존 기능 연결과 미지원 기록, 추가 정보의 채택 범위 확정 |
| 2. 계약과 오류 경계 | API-01 | 채택한 연동 범위와 현재 Frontend | 계약 생성 재현, 보조 조회 실패의 영역 분리 |
| 3. 채택한 조회 연동 | API-02, API-03, API-05 | 단계 2의 타입과 오류 경계 | 채택한 정보와 기존 기능의 테스트 통과, 중복 표시 부재 |
| 4. 녹화 정보 연동 | API-04 | D-06의 기존 계약, 날짜별 브라우저 연동은 별도 외부 조건 | 기존 녹화 범위 상세 검증, 날짜별 항목은 계약 확정 후 검토 |
| 5. 실제 서버 통합 | API-06 | 별도 사용자 요청과 필요한 Backend 배포 및 인증 경로 제공 | 실제 응답, 브라우저와 production 경로 일치 |
| 6. 전체 회귀와 리뷰 | 채택한 전체 변경 | 앞 단계의 완료 범위와 정본 갱신 | 전체 검증, Codex와 agy 리뷰 지적 해소 및 재검증 |

Backend에 확인할 날짜별 계약은 6개다. 해당 항목은 외부 담당자의 구현 범위이며 이
Repository에서 대체 구현하지 않는다.

| 항목 | 필요한 계약 |
| --- | --- |
| 조회 | 목록, 상세, pit 및 camera 연결, 필드 변환과 오류 형식 |
| 페이지와 기간 | 한국 날짜, 종료일 제외, cursor 또는 페이지 변환과 지원 필터 |
| 권한 | 조회 및 export 준비 권한, session과 CSRF 조건 |
| 영상 | playlist와 segment 공개 경로, 내부 URI 변환, GET 및 HEAD 허용 범위, Range와 캐시 및 오류 전달 |
| export | 준비 요청과 상태 조회, 재요청 조건과 원본 및 캐시 만료 |
| 사건 연결 | 기존 이벤트 클립과 날짜 영상의 구분, 명시적인 사건 및 영상 연결 정보 |

활성 알림의 정의, 실제 높이 profile, 예측과 수거 통계 등 추가 데이터 경계는
[화면 데이터 매핑의 추가 계약](contracts/backend/frontend-mapping.md#추가-계약의-책임과-우선순위)을
따른다. 제공되지 않은 항목을 이번 연동의 가상값으로 채우지 않는다.

## API-06 검증과 인계

검증은 단위 및 컴포넌트, browser fixture, 격리된 실제 서비스와 스크랩 서버의 4개 범위를
구분한다. fixture의 성공을 실제 서버 통합 완료로 기록하지 않는다.

| 검증 영역 | 핵심 입력과 완료 조건 |
| --- | --- |
| 초기화와 인증 | 알림 500, 보조 조회 실패, 401과 403, 재시도와 session 종료의 영역별 처리 |
| 적재율 추이 | 0과 null, 모든 데이터 상태, 최대 표본 수, UTC (Coordinated Universal Time) 및 한국 날짜 경계, 7일과 초과 기간, 미래 종료 방지 |
| 이력 | 기존 운영 기록과 경보 근거 상세의 식별자 연결, 페이지 조회 범위, 늦은 응답 차단과 clip 연결 부재 |
| 날짜 목록 | 오늘 및 지난 날짜, cursor 만료와 필터 변경, 데이터 없음, nullable metadata, 실제 녹화 중 재생 가능 상태 |
| HLS | 무음 H.264/TS 실제 재생, 전체 인증 경로, seek와 시각 매핑, 누락, 확대와 선택 변경 및 자원 회수 |
| 다운로드 | 202에서 ready 전환, 중복 요청, 실패와 재요청, 원본 및 export 캐시 만료, 실제 파일과 Range 206 및 416 |
| 디자인 | 1280 x 900, 1440 x 900과 1920 x 1080의 카드 순서 및 위치와 크기, 기존 페이지 배치, 긴 내용과 키보드 조작 |
| 보안과 산출물 | 내부 주소 및 자격 증명 미노출, same-origin과 요청 보호, 공개 artifact 정제, 기존 빌드 크기 예산 |

날짜별 목록과 HLS 및 export의 브라우저 검증은 API-04의 계약 확정 뒤 적용한다.
현재 순수 모델 검증과 브라우저 연동 검증의 범위는 [구현 정보](implementation.md#정적-검사와-테스트-기준선)를
따른다.

디자인 검증은 변경 전후를 같은 viewport, 같은 데이터 및 같은 상태로 비교한다.
API 모드와 synthetic 모드의 공통 화면을 함께 검사하고, 의도한 문구 및 상태 추가와
비의도적인 배치 변경을 구분한다.

전체 검증과 실행 및 회수 명령은
[개발과 검증 컨테이너](implementation.md#개발과-검증-컨테이너)를 정본으로 사용한다.
계약 revision을 갱신한 격리 환경에서 실제 API, SSE, 영상과 다운로드를 검사한다.
스크랩 서버의 읽기 중심 사용자 흐름 확인은 별도 사용자 요청 뒤 진행한다. 운영 카메라 단절, 저장 데이터 생성
및 삭제, 정책 변경과 서비스 재시작은 검증에 포함하지 않는다. 테스트용 export 준비 등
서버에 작업을 만드는 검증은 격리 환경을 사용한다.

원격 개발 환경의 구성은 [원격 개발 컨테이너](implementation.md#원격-개발-컨테이너)를
따른다. 이번 로컬 구현은 해당 동기화를 실행하지 않으며 production 배포 설정은 배포
Repository의 인계 범위로 구분한다.

Codex와 agy 리뷰는 계약 변환, 오류 및 자원 정리, 영상과 권한 경계, 디자인 회귀와
검증 범위를 대상으로 한다. timeout과 응답 부재는 리뷰 통과가 아니다. 구현 결과만
구현 정보와 계약 정본에 반영하고, 진행 상태와 리뷰 결과는 작업 요청 또는 별도로
승인된 Issue와 PR에서 관리한다.
