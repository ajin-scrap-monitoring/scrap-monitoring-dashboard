# 프론트엔드 계약 매핑

## 상태

이 문서는 `openapi.yaml`과 현재 프론트엔드 동작의 매핑을 정의한다. 경로와 schema는 외부
담당자의 승인 전까지 제안 상태다. 프론트엔드는 제안 schema로 생성한 타입을 사용하고,
계약 예제 응답을 화면 도메인 모델로 변환한다.

## 화면 진입 요청

화면 진입 시 브라우저가 호출하는 Application Programming Interface (API)는 다음과 같다.

| 화면 | 공통 요청 | 화면별 요청 | 장기 연결 |
| --- | --- | --- | --- |
| 현황 | `GET /api/v1/session`, `GET /api/v1/monitoring/snapshot` | 인증 시 `GET /api/v1/notifications` | `GET /api/v1/monitoring/events`, WebRTC-HTTP Egress Protocol (WHEP) session |
| 이력 | `GET /api/v1/session`, `GET /api/v1/monitoring/snapshot` | `GET /api/v1/history/load`, `GET /api/v1/events`, 인증 시 `GET /api/v1/notifications` | Server-Sent Events (SSE) |
| 녹화 영상 | `GET /api/v1/session`, `GET /api/v1/monitoring/snapshot` | 기본 진입 시 `GET /api/v1/recordings`, 관련 녹화 진입 시 `GET /api/v1/recordings/{recordingId}`, 인증 시 `GET /api/v1/notifications` | SSE |
| 관리자 | `GET /api/v1/session`, `GET /api/v1/monitoring/snapshot`, `GET /api/v1/notifications` | `GET /api/v1/settings/alerts`, `GET /api/v1/notification-recipients` | SSE |
| 로그인 | 없음 | `POST /api/v1/session` | 없음 |

`GET /api/v1/session`의 `401`은 비로그인 상태로 처리한다. 현황, 이력, 녹화 영상과 WHEP
조회 경로는 제안상 비로그인 접근을 허용한다. 알림함과 관리자 경로는 session Cookie를
요구한다. 조회 사용자는 관리자 메뉴와 설정 화면을 사용할 수 없다.

## 사용자 조작 요청

| 사용자 조작 | 요청 | 프론트엔드 처리 |
| --- | --- | --- |
| 로그인 | `POST /api/v1/session` | session과 Cross-Site Request Forgery (CSRF) token 저장 |
| 로그아웃 | `DELETE /api/v1/session` | session 제거와 로그인 화면 이동 |
| 알림 읽음 | `PATCH /api/v1/notifications/{notificationId}` | 읽음 상태와 미확인 건수 갱신 |
| 알림 모두 읽음 | `POST /api/v1/notifications/read-all` | 미확인 건수 0으로 갱신 |
| 이력 조회 | `GET /api/v1/history/load`, `GET /api/v1/events` | 기간과 이벤트 유형을 두 요청에 동일하게 적용 |
| 녹화 조회 | `GET /api/v1/recordings` | 기간과 이벤트 유형 적용 |
| 관련 녹화 열기 | `GET /api/v1/recordings/{recordingId}` | 기본 조회 기간 밖의 영상도 식별자로 조회하고 해당 녹화 구간 표시 |
| 녹화 재생 | `GET {contentPath}` | HTML video의 byte range 재생 |
| 녹화 미리보기 | `GET {thumbnailPath}` | 목록과 video poster 표시 |
| 녹화 다운로드 | `GET {downloadPath}` | 서버 파일 응답 다운로드 |
| 수거 및 알림 설정 저장 | `PUT /api/v1/settings/alerts` | 최신 Entity Tag (ETag) 기반 전체 설정 교체 |
| 알림 대상 추가 | `POST /api/v1/notification-recipients` | 반환된 대상과 version 적용 |
| 알림 대상 수신 설정 저장 | `PATCH /api/v1/notification-recipients/{recipientId}` | 최신 ETag 기반 부분 변경 |
| 테스트 알림 요청 | `POST /api/v1/notifications/test` | 접수 상태 표시 |
| 실시간 영상 시작 | `POST /api/v1/webrtc/streams/{streamId}` | SDP 협상과 session Location 저장 |
| SDP counter-offer 응답 | `PATCH {WHEP session Location}` | ICE 수집을 완료한 SDP answer 전달 |
| ICE candidate 전달 | `PATCH {WHEP session Location}` | ETag와 SDP fragment 전달 |
| 실시간 영상 종료 | `DELETE {WHEP session Location}` | 미디어 session 해제 |

상태 변경 요청은 session 응답의 CSRF token을 `X-CSRF-Token`에 넣는다. 설정과 알림 대상
변경은 응답 version을 `If-Match`에 넣고 `412 Precondition Failed`를 충돌로 처리한다.
기간 조회의 화면 입력값은 초기 응답 시각의 명시적 UTC offset을 유지해 RFC 3339 query로
전송한다. 브라우저 운영체제 시간대는 조회 구간을 바꾸지 않는다.

## 화면 데이터 변환

| 화면 정보 | 계약 필드 | 변환 규칙 |
| --- | --- | --- |
| 대표 적재율 | `MonitoringSnapshot.summary.loadPercent` | `%` 단위 표시 |
| 운영 상태 | `MonitoringSnapshot.operationState` | `idle`, `accumulating`, `collecting` 문구 변환 |
| 시스템 상태 | `MonitoringSnapshot.systemStatus` | 정상, 수거 필요, 측정 오류, 연결 끊김, 데이터 없음 화면 상태 변환 |
| 예상 도달과 남은 시간 | `serverTime`, `summary.expectedThresholdAt` | 서버 시각 기준 차이 계산 |
| 수거 주기 | `lastCollectionAt`, `averageCollectionCycleSeconds` | 시간과 분 단위 표시 |
| 최근 적재율 | `recentLoad[].measuredAt`, `valuePercent`, `valid` | 전체 시간축을 유지하고 유효하지 않은 표본 구간에서 선 분리 |
| LiDAR profile | `lidarProfiles[].lidarId`, `samples[].positionRatio`, `height`, `valid` | LiDAR 1과 2 카드 고정, 누락 profile은 정보 없음, A에서 B 방향의 유효하지 않은 표본 구간에서 선 분리 |
| 장비 상태 | `devices[].status`, `lastReceivedAt`, `latencyMilliseconds` | 정상, 지연, 수신 없음 표시 |
| 활성 알림 | `activeAlerts[]` | severity별 색상과 발생 시각 표시 |
| 개인 알림 | `NotificationPage.items`, `unreadCount` | 서버 전체 미확인 건수와 최근 목록 분리 |
| 적재율 이력 | `LoadHistory.samples`, `collectionThresholds`, `eventMarkers` | 조회 시작 시각 기준 시간축과 marker type별 수거 필요, 수거 완료, 오류 변환 |
| 이벤트 이력 | `EventPage.items` | 유형, 상태, 내용과 녹화 식별자 표시 |
| 녹화 영상 | `RecordingPage.items` | 메타데이터, 상태와 제공 경로 표시 |
| 알림 설정 | `AlertSettings` | 수거 기준, 사전 알림과 발송 정책 표시 |
| 알림 대상 | `NotificationRecipientPage.items` | 전역 또는 개인별 수신 설정 표시 |

`valid: false`인 적재율과 LiDAR 표본은 값으로 그리지 않으며 해당 표본의 시각 또는 위치는
축 범위와 결측 구간을 결정하는 데 사용한다. nullable 시각, 수거 주기와 녹화 경로는 정보
없음 또는 사용 불가 상태로 표시한다. 목록 endpoint의 모든 page를 조회한 뒤 현재 화면의
고정 행 수로 페이지를 나눈다.

## 실시간 처리

브라우저는 초기 snapshot 적용 후 SSE 연결을 시작한다. `monitoring.snapshot`은 현재 상태를
전체 교체하고 개인 알림 목록은 유지한다. 인증된 연결에서만 `notification.created`를 받아
최근 20건까지 알림함에 병합한다. 같은 event ID는 최근 1024건 범위에서 한 번만 적용한다.
`stream.resync-required`를 받으면 snapshot과 인증 사용자의 개인 알림함을 다시 조회한다.
재조회 중 같은 영역의 새 event가 도착하면 해당 영역의 늦은 재조회 응답을 적용하지 않는다.
`session.expired`를 받으면 SSE를 닫고 로그인 화면으로 이동한다.

WHEP client는 `201 Created`의 SDP answer와 `406 Not Acceptable`의 SDP counter-offer를
처리한다. 응답의 `Content-Type`과 same-origin `Location`을 검증한다. `201`은 strong ETag와
trickle ICE 협상을 요구하고 버퍼에 모은 candidate와 수집 완료를 SDP fragment로 전달한다. `406`은 ICE
수집을 완료한 SDP answer를 `If-Match` 없이 먼저 전달한다. 연결 실패 시 응답의
`Retry-After`를 우선 적용하고, 없으면 1초, 2초, 3초 간격으로 다시 연결한 뒤 수동 재시도
동작을 제공한다. 확대 화면 전환, 컴포넌트 해제와 page hide 시 기존 session을 종료한다.

## 실행 가능한 계약 예제

`src/test/api-contract-fixtures.ts`가 공개 가능한 계약 응답 예제의 정본이다. 모든 예제는
`openapi.yaml`에서 생성한 TypeScript 타입의 필수 필드, enum과 nullable 조건을 컴파일 시
검사한다. 같은 예제를 데이터 adapter 단위 테스트와 Playwright 브라우저 통합 테스트가
공유한다.

검증 범위는 다음과 같다.

- OpenAPI 문법, 참조와 권장 규칙 검사
- OpenAPI 생성 타입과 저장된 생성물의 일치 검사
- 최근 24시간 표본 순서와 수거 필요 marker 및 적용 임계율의 의미 일치 검사
- HTTP adapter의 모든 화면 데이터 변환 검사
- CSRF, ETag, 오류 응답, 결측값과 인증 만료 검사
- SSE snapshot, 중복 제거, 새 알림과 재동기화 검사
- WHEP 정상 협상, counter-offer, ICE 전달, 종료와 재연결 검사
- 로그인, 이력 조회, 녹화 재생 및 다운로드, 관리자 변경의 브라우저 검사
- 1440 x 900과 1920 x 1080 viewport의 사용자 흐름 검사
- Nginx API, SSE와 WHEP proxy의 컨테이너 통합 검사

다음 명령이 프론트엔드 계약 검증의 단일 진입점이다.

```bash
pnpm run check
```

실제 FastAPI와 미디어 서비스가 승인한 계약을 구현한 뒤에는 같은 브라우저 시나리오를 실제
통합 환경에 연결해야 한다. 현재 자동 검증은 제안 계약과 프론트엔드의 정합성을 보장하며,
외부 서비스 구현의 계약 준수 여부를 대신하지 않는다.
