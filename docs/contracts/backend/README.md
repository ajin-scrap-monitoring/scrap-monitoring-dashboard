# 실제 서비스 연동 계약

## 계약 출처

프론트엔드의 실제 서비스 연동 기준은 다음 3개 Repository다. 고정 revision과 추출 경로의
정본은 [`manifest.json`](manifest.json)이며 snapshot 추출기와 통합 스크립트가 함께 읽는다.

| Repository | 확인 대상 |
| --- | --- |
| [scrap-monitoring-backend](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend) | v2 조회와 SSE, session, 선택적 v1 모니터링, 이력 및 관리, 미디어 제어와 녹화 조회 |
| [ajin-camera-media-service](https://github.com/ajin-scrap-monitoring/ajin-camera-media-service) | MJPEG와 이벤트 MP4, 보관 상태와 Range 응답 |
| [ajin-edge-platform](https://github.com/ajin-scrap-monitoring/ajin-edge-platform) | v2 configuration, status와 assessment 생성 및 schema 검사 |

`openapi.json`은 해당 Backend의 `app.openapi()`에서 manifest에 지정한 경로와 참조하는
schema를 추출한 snapshot이다.
`src/generated/backend-contract.ts`는 이 snapshot에서 생성한다. 통합 검증은 실행한
Backend의 OpenAPI를 같은 추출기로 처리해 snapshot 전체가 일치하는지 검사한다.
snapshot 검사 및 명시적 갱신 절차는
[구현 정보](../../implementation.md#정적-검사와-테스트-기준선)를 따른다.

이 snapshot은 실행 가능한 구현을 확인한 근거이며 전체 시스템 계약이나 현장 운영 정책의
승인을 대신하지 않는다. `../proposal/`은 v1 제안과 WHEP 대역 서버 검증에만 사용한다.

## 현재 상태와 데이터 의미

현재 판단은 검증한 runtime 설정의 단일 pit으로 `/api/v2/monitoring/snapshot?pit_id=...`와
`/api/v2/monitoring/events?pit_id=...`를 사용한다. 응답은 `schemaVersion="2"`이며
`snapshotId`는 상태 내용의 hash다. ID를 순번으로 비교하지 않는다.

데이터 상태는 5개다.

| `dataState` | 표시 의미 | `loadPercent` |
| --- | --- | --- |
| `FRESH` | 유효 기간 안의 사용 가능한 관측 | 서버가 제공한 0 이상 100 이하 값 또는 `null` |
| `STALE` | 관측 기한 초과 | `null` |
| `UNAVAILABLE` | 판단 불가 | `null` |
| `UNKNOWN` | 장비 상태 확인 불가 | `null` |
| `NO_DATA` | STATE 판단 없음 | `null` |

`measuredAt`은 STATE assessment의 `observed_to`다. 서버가 assessment를 받은 시각은
측정 시각이나 freshness 기준을 대신하지 않는다. `0`은 유효한 적재율이며 결측값이 아니다.
프론트엔드는 `null`을 0으로 변환하지 않고 상태, reason code와 capability를 표시한다.
v2 경보 평가, 적재율 시계열, 경보 목록과 수거 사건의 revision 이력은 제공한다. LiDAR
profile과 예상 도달 시각은 제공하지 않는다. v1 이력, 알림과 관리자 설정의 적용 경계 및
기존 화면 항목별 변환과 추가 계약 평가는 [화면 데이터 매핑](frontend-mapping.md)을 따른다.

Edge Orchestrator는 적재율 산출을 구현하지 않으며 `FILL_METHOD_NOT_IMPLEMENTED`와
`UNAVAILABLE`을 제공한다. 프론트엔드는 이 값을 synthetic 적재율이나 v1 값으로 보충하지
않는다. 통합 테스트의 FRESH 0%와 STALE 입력은 수신 및 표시 동작을 확인하는 synthetic
case이며 Edge의 측정 산출 능력을 증명하지 않는다.

## 실시간 상태 갱신

Server-Sent Events (SSE)는 연결 시 현재 snapshot을 전송하고 변경된 snapshot을 전송한다.
v2는 event ID나 `Last-Event-ID` replay를 제공하지 않는다. EventSource 재연결 뒤 받은
snapshot으로 현재 상태를 복구하며 이력 누락을 복구했다고 간주하지 않는다. 연결 오류 시
session을 다시 확인하며 인증 만료가 확인되면 로그인으로 이동한다. 연결 오류
동안 적재율을 숨기고 재연결 상태를 표시한다. 동일한 `snapshotId`를 다시 받아도 연결
상태를 복구한다. `session.expired`는 연결을 닫고 로그인 화면으로 이동한다.

v2 경보 및 사건 조회는 같은 pit과 source를 사용하며 viewer 또는 administrator session으로
조회한다. 경로와 필드 의미는 [화면 데이터 매핑](frontend-mapping.md#경보와-수거-사건)을
따른다. 경보 worker는 Backend 설정으로 활성화하며 프론트엔드가 활성화를 대신하지 않는다.

## 인증과 접근 경계

`/api/v1/session`의 `scrap_session` Cookie를 사용한다. v2 조회와 녹화 조회는 viewer 또는
administrator session이 필요하다. 프론트엔드는 관리자 설정을 administrator에게만 표시하고
변경 요청에 Cross-Site Request Forgery (CSRF) token을 전달한다. 현재 Backend의 v1 관리자
API는 서버의 역할 및 CSRF 검사를 강제하지 않는다. 운영 배포 전에 Backend 또는 gateway에서
이 경계를 확정해야 하며 프론트엔드의 화면 제한을 API 접근 제어로 간주하지 않는다.
미디어 제어 API는 Backend가 administrator 역할 및 CSRF token을 검사한다. 브라우저는
service token을 사용하지 않는다. Backend의 개발용 in-memory session과 SQLite는 통합
테스트 전용이다.

## 실시간 영상과 녹화 파일

영상 경로는 2개다.

현재 v2 모니터링은 MJPEG 모드만 사용한다. 선택적 WHEP 모드는 v1 모니터링에서만 선택할 수
있으며 현재 Camera Media Service에 WHEP 지원이 있다고 간주하지 않는다.

| 브라우저 경로 | Media Service 경로 | 용도 |
| --- | --- | --- |
| `/media/cameras/{cameraId}/live` | `/api/v1/cameras/{cameraId}/live` | MJPEG 실시간 영상 |
| `/media/clips/{clipId}/content` | `/api/v1/clips/{clipId}/content` | MP4 재생과 `download=true` 다운로드 |

Nginx는 `/api/v1/media/access`의 `auth_request`로 브라우저 session을 확인한 뒤 영상 byte를
Media Service에서 전달한다. Backend는 메타데이터와 제어 요청만 처리한다. Media Service의
내부 HTTP API는 인증을 제공하지 않으므로 외부에 직접 노출하지 않고 gateway와 내부
네트워크로 접근을 제한한다. 현재 Backend는 `MEDIA_SERVICE_URL`과 `MEDIA_API_TOKEN`의
동시 설정을 요구한다. 통합 테스트는 임시 service token을 설정하지만 이 값은 Media
Service의 HTTP 접근을 보호하는 수단이 아니다.

MJPEG client는 `multipart/x-mixed-replace`, boundary와 `Content-Length`로 JPEG 프레임을
읽는다. header는 4096 byte, JPEG는 4 MiB로 제한하며 chunk 분할과 무관하게 검사한다.
브라우저가 JPEG를 decode한 뒤 LIVE 상태를 표시하며 stream 종료나 오류 시 마지막 프레임을
숨긴다. 최초 프레임과 다음 프레임에 timeout을 적용하고 제한된 재연결 뒤 수동 재시도를
제공한다. decode 실패도 연결 오류로 처리하며 화면 종료 시 stream reader, timer와 Blob URL을
정리한다. Media Service는 프레임 촬영 시각을 제공하지 않는다.

녹화 조회는 `/api/v1/recordings`와 단건 조회를 사용한다. 실제 필터는 `pit_id`, `from`,
`to`, `category`이며 Backend의 page pagination을 따른다. duration, width, height,
frame rate, size와 보관 시각의 `null`은 정보 없음으로 표시한다. `mediaStatus`, `coverage`,
`gaps`와 `errorCode`는 저장 상태 및 누락 구간을 표시한다. 부분 저장된 ready MP4는 재생할
수 있다. 재생 전 단건 조회와 다운로드 전 재조회로 접근 상태를 확인하며 collecting,
processing, failed, deleted, expired 상태에는 재생 및 다운로드 경로를 노출하지 않는다.
collecting과 processing은 단건 조회를 반복하고 ready 또는 종료 상태에서 반복을 중단한다.
다운로드 재조회가 접근 불가 상태나 HTTP 404 및 410을 반환하면 다운로드를 시작하지 않는다.

부분 저장이나 누락 구간을 선택하면 `/api/v1/media/clips/{clip_id}`를 조회해 요청 구간과
실제 확보 구간을 별도 상세창에 표시한다. 응답의 clip 및 camera 식별자를 검사하며 구간별
누락 원인은 제공되지 않는다. 녹화 정책은 이 상세창에 표시하지 않는다.

Media의 날짜별 녹화 계약은 순수 모델과 시간 매핑 테스트에서 사용한다. Backend의 날짜별
브라우저 조회 및 export 계약은 제공되지 않으며 내부 Media 경로에 직접 연결하지 않는다.

MP4 재생은 HTTP Range 요청을 사용한다. 삭제된 파일은 gateway에서 `410`으로 거절한다.
프론트엔드는 clip 생성, 삭제와 보관 정책 변경 화면을 제공하지 않는다.

## 통합 검증

`scripts/verify-service-integration.sh`는 다음 7개 service를 별도 Compose project로 실행한다.

| service | 역할 |
| --- | --- |
| `backend` | 고정한 실제 Backend |
| `media` | 고정한 실제 Camera Media Service |
| `dashboard` | synthetic data를 비활성화한 production 프론트엔드 |
| `dashboard-alt` | 같은 production image와 다른 runtime 설정을 사용하는 독립 Browser 검증 |
| `camera-input` | synthetic JPEG ingest와 부분 MP4 fixture 생성 |
| `edge-input` | 실제 Edge Orchestrator의 v2 메시지 생성과 Backend 전달 |
| `browser` | Chromium 사용자 흐름 및 계약 snapshot 검사 |

호스트 port를 공개하지 않으며 매 실행마다 자격 증명과 격리된 데이터 volume을 생성한다.
정상, 실패와 INT 및 TERM 종료 시 해당 project의 컨테이너, volume과 image를 제거한다.
정제한 결과 및 screenshot과 비공개 로그의 저장 위치, 대기 상한과 recovery 절차는
[구현 정보](../../implementation.md#개발과-검증-컨테이너)를 따른다.
`SYNC_SOURCE_ROOT`를 지정하면 해당 경로의 `backend`, `media`, `edge` checkout을 재사용하며
revision과 작업 트리가 일치하지 않으면 실패한다. 운영 데이터나 운영 자격 증명을 사용하지
않는다.

통합 검증은 OpenAPI 일치, 실제 session, Edge 판단 불가, MJPEG 수신과 확대 종료, v2 SSE의
0% 및 STALE, session 종료, nullable 녹화 정보, 부분 MP4 재생, Range 206/416, 다운로드와
삭제 후 410을 확인한다. 1280, 1440과 1920 너비에서 현재 상태 및 녹화 화면을 검사하고
1280 너비에서 영상 확대의 키보드 종료와 focus 복원을 확인한다.
runtime 검증은 동일한 local image ID를 확인하고 두 Nginx의 실제 JSON mount를 읽은 Browser의
pit query 및 camera 경로를 검사한다. 이 검사의 API 및 영상 응답은 별도 synthetic fixture이며
두 번째 환경의 실제 서비스 배포 검증을 대신하지 않는다.
실제 LiDAR, 카메라 hardware, 현장 calibration, 적재율 정확도,
실제 알림 채널 수신과 운영 배포 환경은 이 검증에 포함하지 않는다.
