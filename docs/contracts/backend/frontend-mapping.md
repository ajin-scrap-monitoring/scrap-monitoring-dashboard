# 기존 화면과 Backend 데이터 매핑

## 기준과 평가 분류

화면 구조는 [프로젝트 명세](../../project-spec.md#사용자-기능)를 따른다. Application
Programming Interface (API)의 revision과 경로는 [manifest](manifest.json)에 고정하며,
데이터 상태와 외부 경계는 [실제 서비스 연동 계약](README.md)을 따른다.
프론트엔드는 응답 schema뿐 아니라 Backend 구현의 데이터 출처와 필드 의미를 확인한다.

연동 평가는 4개 분류를 사용한다.

| 분류 | 기준 |
| --- | --- |
| 직접 사용 | 기존 화면 지표와 의미가 일치하는 서버 값 |
| 변환 사용 | 단위, 표시 형식 또는 확정된 시각 간 차이의 변환 |
| 의미 불일치 | 필드는 존재하지만 기존 화면 지표와 다른 의미 또는 실측으로 사용할 수 없는 생성값 |
| 추가 계약 필요 | 해당 지표의 값, 출처 또는 해석 규칙 부재 |

`null`, 0건과 비활성화는 서로 다른 상태다. 제공되지 않은 값을 0, 정상, 대기 또는 알림
없음으로 변환하지 않는다. 서로 다른 데이터 출처의 적재율, profile과 시계열을 하나의
관측 결과로 합치지 않는다.

## 제공 응답과 화면 연결 점검

Frontend는 다음 5개 규칙으로 제공된 응답을 연결한다. 외부 기능의 미구현과 의도적인
비표시는 구분하며 기존 카드, 열과 안내 영역을 유지한다.

| 식별자 | 제공 정보 | Frontend 적용 규칙 |
| --- | --- | --- |
| `FE-DATA-01` | `deviceStatus.snapshot.services`의 camera-edge 상태 | 유효한 보고의 서비스 상태를 기존 카메라 행에 연결, 서비스 부재와 오래된 snapshot을 정상으로 표시하지 않음 |
| `FE-DATA-02` | 상위 연결 상태와 마지막 sensor snapshot | REPORTING일 때 현재 센서 상태 사용, Server-Sent Events (SSE) 연결 오류에는 장비 행을 확인 불가로 표시하고 원본 보고 보존 |
| `FE-DATA-03` | 날짜 녹화의 `export_state`와 오류 코드 | HTTP Live Streaming (HLS) 재생과 MP4 준비 실패 구분, 기존 다운로드 안내와 상태 상세에 비동기 실패 및 재진입 결과 반영 |
| `FE-DATA-04` | 날짜 녹화의 오류 코드 | 공개 계약의 `[A-Z0-9_]` 1~100자 표시, 서버 처리 로그는 노출하지 않음 |
| `FE-DATA-05` | 이벤트의 서버 title 및 detail | v1과 v2 이력의 최초 조회와 재조회에서 제목과 내용을 별도로 보존 |

Backend는 장비 보고가 30초 이상 없으면 연결 상태를 UNKNOWN으로 바꾸고 마지막 snapshot을
보존한다. Frontend는 과거 snapshot의 FRESH를 현재 정상 상태로 표시하지 않는다. SSE 연결
오류도 장비의 현재 표시를 무효화하되 원본 보고의 상태와 시각은 유지한다. 같은 snapshot을
다시 수신해도 현재 표시를 복원한다. 브라우저 연결 문제로 Backend의 원본 연결 상태를
다시 작성하지 않는다.

수신한 정보를 표시하지 않는 모든 경우가 연결 결함은 아니다.

| 항목 | 현재 처리와 분류 |
| --- | --- |
| 관리자 설정과 수신 대상 정보 | 임계율, 정책, 대상 정보와 version 연결, 실제 발송 미구현과 별개 |
| 종 알림의 제목, 내용과 읽음 | 서버 값과 읽음 여부 연결, 원시 type과 읽음 시각은 기본 표시 범위 밖 |
| v2 경보의 판단 근거 및 COLLECTION revision | 조회 API 존재, 별도 판단 목록과 근거 영역을 제공하지 않는 제품 범위 |
| 장비 scan 및 진행 시각, clock, delivery와 storage | 진단 정보 또는 숨김 대상, 촬영 시각과 latency로 대체하지 않음 |
| v1 이력 경보의 resolved 상태 | 실제 해제 상태가 아닌 Backend 생성값이므로 의도적 비표시 |
| clip ID가 없는 녹화 job | 기존 `/api/v1/media/clip-jobs`에서 조회 가능, 날짜 및 이벤트 녹화 목록과 별도 범위 |
| 날짜 녹화의 구간별 reason code | 수신 및 보존, 현재 게이지의 표시 범위는 확보 및 누락 구간 |
| export cache 만료 시각 | 다운로드 가능 여부에 사용, 원본 보관 만료와 별도 표시하지 않음 |
| 수신 대상 이름과 연락처 편집 | Backend PATCH 지원, 현재 수신 정책 패널의 편집 범위 밖 |

## 현황 화면

| 기존 항목 | 제공 정보 | 평가 | 연결 또는 필요한 계약 |
| --- | --- | --- | --- |
| 추정 적재율 | v2 `summary.loadPercent`, `dataState` | 직접 사용 | 서버의 percent 값 유지, 데이터 상태에 따른 표시 가능 여부 적용 |
| 수거 임계율 | `summary.collectionThresholdPercent` | 직접 사용 | 기존 임계율 영역의 percent 표시 |
| 경고 기준 | `summary.warningThresholdPercent` | 직접 사용 | 임계율 영역의 보조 정보, 알림 발송 활성 여부와 구분 |
| 적재율 경보 | v2 `operations.effectiveState` | 변환 사용 | Backend의 현재 평가 결과를 기존 현재 상태 카드에 표시 |
| 예상 도달 및 남은 시간 | v1 `expectedThresholdAt=null`, v2 예측 필드 부재 | 추가 계약 필요 | 서버의 예상 도달 시각, 가용성, 산출 기준과 유효 기간 |
| 1시간 전 적재율 | v2 STATE 시계열의 `valuePercent`, `observedAt` | 변환 사용 | 같은 source의 유효한 과거 관측값을 선택하고 수치를 그대로 표시 |
| 최근 수거 후 경과 | `/api/v1/events`의 실제 `collection_completed` 기록 | 변환 사용 | 같은 pit의 가장 최근 완료 시각과 v2 `serverTime` 간 차이를 시간과 분으로 표시 |
| 평균 수거 주기 | 완료 기록 목록, v1의 고정 `averageCollectionCycleSeconds` | 의미 불일치 | 완료 기록 기반 집계의 기간, 표본 수와 계산 규칙 확정 필요 |
| 실시간 영상 | Media Service의 Motion JPEG (MJPEG) stream | 직접 사용 | 기존 영상 영역과 확대 기능, 실제 frame decode 뒤 LIVE 표시 |
| 영상 촬영 시각 | Media Service의 촬영 시각 부재 | 추가 계약 필요 | frame 촬영 시각의 출처와 전달 형식, 브라우저 수신 시각 및 측정 시각과 구분 |
| 측정 영역 | 현장 좌표와 측정선 배치 부재 | 추가 계약 필요 | 참고도 유지, 실측 좌표계 및 센서와 측정선의 연결 계약 |
| 최근 24시간 적재율 | `/api/v2/monitoring/load-history`의 같은 source STATE 표본 | 변환 사용 | percent 유지, 판단 생성 시각의 점과 bucket 구간 및 결측 보존 |
| LiDAR 1 및 LiDAR 2 profile | v2 evidence 참조와 sensor ID, v1 생성 profile | 의미 불일치 | 실제 높이 표본, 단위, 위치 좌표, 통계와 화면 slot 연결 계약 |
| 활성 알림 | v2 경보 이력과 `operations` | 추가 계약 필요 | [활성 알림의 제공 계약](#활성-알림의-제공-계약)에 따른 알림별 활성 및 해제 상태 |
| 센서 상태 | `deviceStatus.snapshot.sensors` | 변환 사용 | `lidar-a`는 LiDAR 1, `lidar-b`는 LiDAR 2로 표시하며 원래 ID와 상태 보존, 나머지 ID는 그대로 표시, scan 시각을 이용한 latency 추정 금지 |
| 엣지 장비 상태 | `connection_state`, `effective_state`, `last_received_at` | 변환 사용 | 보고된 장비 상태 반영, 연결 상태와 판단 가용성 구분 |
| 카메라 상태 | v2 `deviceStatus.snapshot.services`의 `service=camera-edge`와 `state` | 변환 사용 | 기존 카메라 행에 서비스 상태 연결, 장비 보고와 브라우저 영상 수신 상태 구분 |
| 카메라 latency | 해당 응답의 latency 부재 | 추가 계약 필요, 현재 세부 정보 미표시 | `last_progress_at`으로 추정하지 않으며 기존 숨김 정책 유지 |

`summary.loadPercent`는 이미 percent 단위이므로 다시 100을 곱하지 않는다.
`measuredAt`, `assessmentReceivedAt`, 센서의 `last_scan_at`, 장비의 `last_received_at`과 영상
촬영 시각은 각각 다른 시각이다. 현재 Backend v1의 `video.capturedAt`은 측정 시각에서
생성하므로 실제 영상 촬영 시각으로 사용하지 않는다. 수거 완료 시각이 서버 시각보다 미래이면 경과 시간을
정보 없음으로 표시한다. 브라우저의 로컬 시각은 경과 시간 계산에 사용하지 않는다.

Backend의 [v1 snapshot 구현](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/41c24d58066190ce4a673ee39b8e0c8bb7ad2553/src/app/services/snapshot_service.py)은
평균 수거 주기에 고정값을 사용하고, 하나의 높이에 임의의 차이를 더해 profile을 생성한다.
장비 latency와 카메라 상태에도 고정값을 사용하며 CRITICAL을 `collecting`으로 변환한다.
이 값들은 실제 수거 작업, LiDAR 표면 표본 또는 장비 health의 확인 근거로 사용하지 않는다.
실제 완료 기록은 `/api/v1/events?category=collection&page=1&pageSize=1&pit_id=...`로 조회한다.
이 API는 `CollectionLog.completed_at`을 Coordinated Universal Time (UTC) offset이 있는
`occurredAt`으로 제공한다.
Backend는 `/api/v1/collections/confirm` 요청에서 수거 완료 기록을 생성한다. 영상의 수거
장면을 완료 기록으로 자동 변환하지 않으며 v2 COLLECTION 판단도 실제 완료로 간주하지 않는다.
`/api/v1/collections/history`의 `completed_at`은 SQLite 환경에서 offset 없이 반환되므로
경과 시간 입력으로 사용하지 않는다. 보조 지표 조회 실패 및 계약 위반은 해당 값을 정보
없음으로 표시하며 현황 화면 전체의 조회 실패로 처리하지 않는다.

별도의 장비 서비스 진단 목록과 마지막 진행 시각, clock 상태와 offset은 화면에 표시하지 않는다.
`camera-edge` 상태를 기존 카메라 행에 사용하는 것과 별도 서비스 진단 목록을 표시하는 것은
구분한다. adapter는 services를 내부 모델에 보존하며 유효한 camera-edge 상태를 기존
카메라 행에 연결한다.
`HEALTHY`, `DEGRADED`, `STARTING`, `RETRYING`, `FATAL`과 `UNKNOWN`을 구분하고 서비스
부재 및 오래된 장비 snapshot을 정상 상태로 보충하지 않는다. `last_progress_at`은 서비스
상태의 진행 시각이며 frame 촬영 시각이나 latency가 아니다.
clock offset은 장비 시계 오차이며 센서 또는 카메라의 통신 latency로 변환하지 않는다.
pit 이름은 조회하거나 표시하지 않으며 기본 화면의 제목과 식별자를 유지한다.

센서의 FRESH는 기존 장비 행에서 정상으로 표시한다. 이 표시는 최근 scan 수신 기준이며
적재율 산출 성공이나 driver 서비스의 전체 건강 상태를 의미하지 않는다. 서비스의 누적
손실에 따른 DEGRADED와 센서 FRESH는 함께 제공될 수 있다. 센서와 서비스 사이의 공개
연결 계약 없이 Frontend가 이름을 추정하여 두 상태를 합치지 않는다.

원시 LiDAR 측정의 수신 및 저장은 `/api/edge/v2/measurements`에 구현되어 있다. 해당 경로는
POST 수신용이며 브라우저용 원시 측정 목록 및 단건 조회 API는 없다. raw point, 검증된
좌표, 화면용 높이 profile과 적재율은 서로 다른 정보다. `transform_state=UNAVAILABLE`의
좌표와 미산출 적재율을 Frontend의 임시 계산이나 synthetic data로 보충하지 않는다.

### 1시간 전 적재율

최근 24시간 이력에서 같은 source의 과거 관측을 선택한다. 초기 기준 시각은 snapshot의
`serverTime`이며 기존 약 1분 간격 조회의 종료 시각과 새 snapshot의 서버 시각으로
진행한다. 브라우저의 로컬 현재 시각이나 현재 관측 시각을 기준으로 사용하지 않는다.

기준 시각의 1시간 전부터 이전 60초 이내에서 가장 가까운 `observedAt`을 선택한다.
관측 시각이 같으면 가장 나중에 생성한 판단을 사용한다. 선택한 표본이 무효이면 더
이전의 유효한 표본으로 대체하지 않는다. `valuePercent`는 percent 단위와 원본 정밀도를
유지하며 유효한 0을 보존한다. LIMITED의 유효한 수치는 tooltip에 제한 상태를 명시한다.

현재 측정이나 SSE 연결 상태가 과거 관측을 무효화하지 않는다. 조회 범위 밖, 조건에 맞는
표본 부재, source 변경과 이력 조회 실패는 정보 없음으로 표시한다. 오래된 캐시 값,
v1 변화량, 현재 적재율의 역산이나 수거량 추정으로 보충하지 않는다. tooltip은 실제
관측 시각과 선택 범위를 표시한다. 새로고침은 Backend 이력을 다시 조회하며 브라우저가
1시간 동안 실행되거나 값을 영구 보관할 필요가 없다.

## 적재율 추이

현황의 최근 24시간과 이력 그래프는 v2 모드에서 `/api/v2/monitoring/load-history`를
사용한다. `bucket_seconds`는 전달하지 않고 서버의 자동 간격 선택을 사용한다.
`schemaVersion`, pit 및 site와 edge를 확인하고 서버의 percent 값을 유지한다.
점의 위치는 `generatedAt`, 관측 시각은 `observedAt`, 전체 시간축과 결측 구간은
`bucketStartAt`과 `bucketEndAt`을 사용한다. 유효한 0과 결측을 구분하며 `valid=false`와
null은 선을 연결하지 않는다. LIMITED의 유효한 수치는 제한 상태를 함께 표시한다.

한 요청의 시작과 종료 시각 차이는 최대 7일이고 표본 상한은 1,441개다. 이 제한은 데이터
보관 기간이나 최근 7일만 조회 가능하다는 의미가 아니다. 과거 기간의 실제 조회 가능 여부는
저장된 데이터와 보관 정책에 달려 있다. 최근 30일과 90일 선택 및 운영 기록
조회는 유지하며 v2 그래프만 범위 미지원으로 표시한다. 현재 snapshot이 없거나 장비 연결이
중단되어도 별도로 조회한 과거 표본의 유효성을 다시 판정하지 않는다. 현재 임계율은 참고선이며
과거에 적용된 임계율이 아니다. v1 운영 사건을 v2 적재율 값에 맞춰 재배치하지 않는다.

현황은 약 1분 간격으로 추이를 갱신하며 SSE마다 전체 추이를 다시 요청하지 않는다.
초기 및 자동 조회의 종료 시각은 서버 시각을 넘기도록 올림하지 않는다. 조회 실패는 해당
그래프에서 구분하며 v1 값으로 대체하지 않는다. 원본 의미는 Backend의
[적재율 추이 계약](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/41c24d58066190ce4a673ee39b8e0c8bb7ad2553/docs/V2_LOAD_HISTORY.md)을 따른다.

## 경보와 수거 사건

현재 상태 카드의 적재율 경보는 서버의 현재 평가 결과를 다음 문구로 표시한다.

| 서버 값 | 화면 문구 |
| --- | --- |
| `NORMAL` | 경고 기준 미만 |
| `WARNING` | 경고 |
| `CRITICAL` | 위험 |
| `UNKNOWN` | 확인 불가 |
| `ERROR` | 판정 불가 |
| `operations=null` 또는 평가 정보 부재 | 미지원 |

프론트엔드는 적재율과 임계율로 등급을 다시 계산하지 않는다. 위험 기준보다 낮은 적재율도
Backend가 CRITICAL을 유지하면 위험으로 표시한다. 실제 작업의 대기, 적재 중과 수거 중은
이 등급에서 추정하지 않는다. 현재 계약은 실제 수거 진행 상태를 제공하지 않는다.

| 제공 정보 | 사용할 수 있는 범위 | 현재 화면과 맞지 않는 의미 |
| --- | --- | --- |
| `operations.effectiveState` | 현재 경보 평가 상태 | 실제 수거 작업의 진행 여부 |
| `lastKnownState`, 평가 및 경보 시각 | 마지막 유효 경보 상태와 근거 확인 | 현재 상태 또는 실제 수거 완료 시각 |
| `recoveryThresholdPercent` | 경보 복귀 기준의 표시 | 프론트엔드의 경보 상태 재계산 |
| `operations.notificationId` | 기존 알림함 재조회와 읽음 처리 대상 | 활성 경보의 해제 여부 |
| `/api/v2/monitoring/alerts` | 같은 pit 및 장비의 경보 이력과 원본 assessment 연결 | 활성 알림만의 목록 |
| `/api/v2/monitoring/collection-events` | 사건별 최고 revision의 COLLECTION 판단 | 작업자가 확인한 수거 완료 기록 |
| `/collection-events/{assessment_id}/revisions` | 후보, 판단 조건 충족, 종료와 철회의 개정 이력 | 단일 완료 사건으로 합치는 변환 |

현재 경보 평가와 마지막 유효 경보 상태는 분리해 표시한다. `operations=null`은 평가 정보
미제공으로 표시하며 NORMAL로 바꾸지 않는다. `UNKNOWN` 또는 `ERROR`에서 과거 CRITICAL을
현재 경보로 표시하지 않는다. Server-Sent Events (SSE) 연결 오류 동안에도 현재 경보를
알 수 없는 상태로 표시한다.

v2 SSE는 별도의 `notification.created`를 제공하지 않는다. 프론트엔드는 snapshot의 새로운
`notificationId`로 기존 `/api/v1/notifications`를 다시 조회한다. 완료 기록도 snapshot 수신 시
같은 pit으로 재조회하며 중복 요청을 병합하고 구독 종료 시 요청을 취소한다.
읽음 처리는 경보 해제나 cooldown 초기화를 의미하지 않는다. LOG 기록은 이메일 및 문자
전달 성공을 의미하지 않는다.

읽음 요청의 성공은 확인한 알림 ID에 반영하며 서버 목록을 다시 조회한다. 재조회 실패는
성공한 읽음을 되돌리지 않는다. 요청 도중 발생한 새 알림은 읽음 처리 대상에 추가하지
않으며 미읽음 수는 최신 서버 응답을 따른다. 실패한 재조회는 다음 snapshot에서 다시
실행한다. 로그아웃, 데이터 reload와 구독 종료는 진행 중인 읽음 및 조회 요청을 취소한다.

알림 조회 실패의 화면 처리와 갱신 방식은
[`docs/implementation.md`](../../implementation.md)의 알림함 설명을 따른다.
401과 403은 보조 조회 실패로 숨기지 않는다.

Backend의 v2 경보 조회는 `eventId`에 연결된 관측 시각, 당시 적재율과 판단 식별자를
제공한다. 프론트엔드 이벤트 상세의 표시 범위는
[`docs/implementation.md`](../../implementation.md)의 `DetailDialog` 설명을 따른다.

종 목록은 저장된 AlertLog를 조회한다. v2 경보 생성에는 Backend의
`EDGE_V2_OPERATIONS_ENABLED` 활성화와 유효한 FRESH 적재율이 필요하며 현재 worker는
CRITICAL 조건에서 기록을 생성한다. 기능 비활성화나 미산출 적재율은 빈 목록의 생성
조건과 구분한다. 장비 DEGRADED와 측정 불가를 자동으로 종 알림으로 변환하는 동작은
현재 v2 worker에 없으며 Frontend가 임의의 알림 기록을 생성하지 않는다.

COLLECTION의 CONFIRMED는 판단 조건 충족이며 실제 수거 완료가 아니다. capability,
`decision_state`, reason code와 revision은 함께 해석한다. 사건 또는 겹치는 시각만으로
녹화 영상을 연결하지 않는다. 의미와 제공 범위의 근거는 Backend의
[v2 운영 계약](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/41c24d58066190ce4a673ee39b8e0c8bb7ad2553/docs/V2_OPERATIONS.md)이다.

## 이력 및 다른 화면

| 기존 화면 | 제공 정보 | 적용 범위와 추가 경계 |
| --- | --- | --- |
| 적재율 이력 그래프 | v2 `/api/v2/monitoring/load-history`, 선택적 v1 `/api/v1/history/load` | 현재 모드의 출처만 사용, 시각과 결측 및 조회 상한은 적재율 추이 기준 적용 |
| 운영 이력 표 | `/api/v1/events`, 같은 AlertLog를 사용하는 v2 경보 기록 포함 | 현재 표시 경로는 v1 운영 기록, v2 COLLECTION 판단을 실제 수거 완료로 변환하지 않음 |
| 이력 기간과 유형 조회 | 운영 기록의 v1 기간 및 category, v2 추이의 기간 조회 | 운영 기록과 그래프를 별도로 조회, v2 경보 상세의 offset과 혼합 금지 |
| 녹화 목록 및 재생 | 기존 `/api/v1/recordings`와 Media clip 정보 | 실제 clip ID 연결만 사용, v2 경보 및 COLLECTION의 자동 clip 연결 부재 |
| 관리자 임계율 | 기존 pit 설정과 v2 summary | 현재 서버 임계율 사용, 경고 및 복귀와 위험 임계율의 저장 검증 계약 필요 |
| 관리자 발송 정책 | 기존 저장 설정과 v2 worker 설정 | 저장된 UI 정책과 실제 worker 적용 범위 구분, LOG 외 발송 및 정책 적용 계약 필요 |
| 녹화 요청 및 확보 범위 | `/api/v1/media/clips/{clip_id}` | clip과 camera 식별자 검사, 선택 시 별도 상세창 표시, 구간별 누락 원인 미제공 |
| 날짜 녹화 | `/api/v2/recordings/daily`와 단건 및 export | 이벤트와 별도 조회, 실제 확보 및 누락 시간축, HTTP Live Streaming (HLS) 재생과 지난 날짜의 MP4 준비 |

v2 경보 및 수거 판단 목록은 `items`, `totalItems`, `limit`, `offset`을 사용하며 v1의 page
metadata와 다르다. 이 목록에는 기간 필터가 없고 offset 상한이 있다. 목록 일부를 브라우저에서 날짜로
걸러 전체 기간의 조회 결과로 표시하지 않는다.

Backend 이력의 상태는 `type=collection_completed` 및 `status=completed`인 수거 완료 기록만
완료로 표시한다. 경보와 오류의 `status=resolved`는 실제 해제 상태를 조회한 값이 아니므로
상태를 표시하지 않는다. severity를 처리 상태로 사용하지 않는다. v1 이력의 source와 생성 기준은
[이력 구현](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/41c24d58066190ce4a673ee39b8e0c8bb7ad2553/src/app/services/history_service.py)을
따른다.

assessment 및 message ID, revision, rule 및 config revision, capability, reason code와
evidence 참조는 출처 확인에 사용할 수 있다. evidence 참조는 높이 표본이 아니며 데이터
참조만으로 profile을 복원하지 않는다. clock, service, delivery와 storage 정보는 장비 진단
정보이며 기존 적재율, latency와 수거 지표의 대체값으로 사용하지 않는다.

## 추가 계약의 책임과 우선순위

Backend와 Camera Media Service에 일괄 협의할 데이터 제공 요청 후보는 이 절에서 관리한다.
제공되지 않는다는 이유만으로 Backend가 이미 산출할 수 있다고 판단하지 않는다. 각 항목은
저장 데이터와 기존 조회 구현의 제한, 다른 서비스 데이터의 브라우저 제공 경로, 데이터 생산 및 의미 정의의
부재를 구분하고 Backend의 제공 가능 여부를 확인한다. 실제 요청과 담당자 답변은 Issue 또는
Pull Request에서 관리하며 확정된 계약은 해당 매핑 항목에 반영한다.

| 우선순위 | 필요한 정보 또는 결정 | 책임 경계 |
| --- | --- | --- |
| 높음 | [실제 수거 구간과 완료의 제공](#현황-데이터의-생산과-제공-요청) | Edge 또는 확정한 작업 기록 주체, Backend 계약 |
| 높음 | [알림별 활성 및 해제 상태가 있는 목록](#활성-알림의-제공-계약) | Backend 제공 계약, Frontend의 기존 활성 알림 카드 연결 |
| 높음 | [화면에서 지정한 기간의 적재율 추이 조회](#장기-적재율-조회-요청) | Backend 조회 및 집계 계약, Frontend의 기존 장기 조회 연결 |
| 높음 | [실제 적재율과 LiDAR 높이 profile](#현황-데이터의-생산과-제공-요청) | Edge 측정 결과, Backend 제공 계약, Frontend 표시 |
| 보통 | [수거 주기와 예상 도달](#현황-데이터의-생산과-제공-요청) | 제품 및 Backend 계약, 확정된 통계의 Frontend 표시 |
| 보통 | [경보 및 사건과 clip ID 연결](#v2-경보와-이벤트-녹화-연결) | Backend 및 Media 계약, Frontend 기존 이력 및 녹화 화면 연동 |
| 보통 | [frame 촬영 시각 및 실측 배치](#현황-데이터의-생산과-제공-요청) | Edge 및 Media 제공 정보, Backend 조회 계약 |
| 보통 | [관리자 설정과 실제 발송의 적용 범위](#관리자-설정과-알림의-협의-항목) | Backend 및 운영 계약, Frontend 입력 검증 |
| 보통 | 이벤트 클립의 구간별 누락 원인 | Backend 및 Media 제공 계약, Frontend의 기존 녹화 범위 상세 연결 |

Frontend만으로 가능한 작업은 제공된 값의 표시 및 시각과 단위 변환, 상태 분리, pagination
adapter, 취소와 재조회 및 기존 화면의 회귀 검증이다. 실제 높이, 예측, 장비 health와
수거 완료의 의미를 Frontend에서 만들어 추가 계약을 대신하지 않는다.

### 현황 데이터의 생산과 제공 요청

데이터 생산 기능이 없는 항목과 이미 있는 정보를 Dashboard에 제공하지 않는 항목을
구분한다. 아래 항목은 기존 카드의 실제 값을 위한 요청이며 새 화면의 추가 요구가 아니다.

| 식별자 | 담당과 현재 경계 | 요청 내용 및 수락 조건 |
| --- | --- | --- |
| `EDGE-DATA-01` | Edge 산출, Backend 전달. 현재 v2 STATE의 fill 알고리즘 미활성 | 검증한 적재율 산출, method version과 관측 범위 및 유효성 제공, 산출 불가를 정상 0%로 표현하지 않음 |
| `EDGE-DATA-02` | Edge 높이 산출, Backend 공개 계약. raw point와 좌표 변환은 실제 표면 높이 profile과 다름 | sensor ID와 화면 slot, 실제 높이 표본과 단위 및 위치 좌표, 관측 시각과 통계의 의미 정의, Frontend의 원시 점 해석 없이 표시 가능한 응답 |
| `BE-DATA-05` | Backend 제공 및 산출 주체 협의. 예상 도달과 평균 수거 주기의 신뢰 가능한 공개값 부재 | 목표 임계율, 예측 시각과 유효 기간 및 계산 불가 사유, 실제 완료 기록 기반 집계 기간과 최소 표본 수 및 계산 규칙, 고정 예시값 미사용 |
| `BE-DATA-06` | Edge 또는 확정한 작업 기록 주체가 구간 생산, Backend 저장 및 제공. 실제 수거 시작 및 종료의 공개 계약 부재 | 실제 작업과 판단 사건 및 완료 확인 기록의 구분, 시작과 종료 및 출처와 개정 의미, 녹화 연결은 `BE-MEDIA-02` 적용 |
| `CMS-DATA-03` | Edge capture 시각 생산, Media frame별 전달. 현재 JPEG byte 전송과 Media 수신 시각만 존재 | frame 식별, 실제 capture 시각과 timezone 및 clock 품질 정의, 수신 시각과 구분 가능한 브라우저 제공, Frontend의 frame 수신 시각 fallback 유지 |
| `EDGE-DATA-03` | 설치 및 calibration 담당의 실측값 확인, Edge 적용, Backend 배치 제공. calibration 좌표 변환 자체는 구현 | 실제 좌표계와 설치값 검증, sensor와 측정선 및 화면 slot 연결, 실제 배치와 참고도 구분 |

Edge의 `v2/orchestration.py`는 fill, occlusion, collection과 vision capability를
NOT_IMPLEMENTED로 보고한다. 실제 알고리즘의 산출과 정확도 검증은 Frontend 범위가 아니다.
`v2/processing.py`의 VERIFIED calibration 좌표 변환과 미검증 시 null 처리,
`camera_edge/status.py`의 로컬 camera 상태 생성은 이미 구현된 기능으로 구분한다.
카메라 서비스 상태는 Backend의 services에도 제공되므로 외부 미구현 요청에서 제외하며
Frontend의 기존 행 매핑으로 처리한다.
기존 수거 완료 등록 및 조회 기능이 존재하므로 완료 목록 0건을 해당 API의 미구현으로
분류하지 않는다. 실제 기록 부재와 자동 구간 생산의 미구현은 서로 다른 항목이다.

### 활성 알림의 제공 계약

요청 식별자는 `BE-DATA-04`이며 담당은 Backend다. 활성 알림 카드는 현재도 유효한 경고와
문제를 표시한다. 종 모양 알림함은 발생한 알림 기록과 사용자별 읽음 여부를 표시한다.
알림의 활성 여부와 읽음 여부는 독립적이며 미읽음 목록을 활성 알림 목록으로 사용하지 않는다.

현재 `/api/v1/notifications`는 읽음 여부를 제공하고 `/api/v2/monitoring/alerts`는 경보
이력을 제공한다. `operations.effectiveState`는 현재 경보 평가이지 알림별 활성 및 해제
상태가 있는 목록이 아니다. Frontend는 이 값들로 개별 알림의 활성 여부를 추정하지 않는다.

요청 범위는 알림의 안정적인 식별자와 대상, 제목과 내용 및 심각도, 활성 여부와 발생 및
해제 시각을 구분한 목록이다. 조회와 갱신 방식, 해제 조건과 조회 실패 시 응답도 Backend
계약에서 확정한다. 구체적인 경로와 필드명은 확정 전까지 지정하지 않는다.

수락 조건은 2개다.

- 읽은 알림도 문제가 지속되면 활성 목록에 유지
- 읽지 않은 알림도 문제가 해제되면 활성 목록에서 제외하고 알림함의 미읽음 상태는 유지

활성 목록 계약이 없는 현재 화면은 정보 없음으로 표시하며 활성 알림 0건으로 단정하지 않는다.

### 관리자 설정과 알림의 협의 항목

관리자 화면은 수거 임계율, 알림 대상 관리, 알림 정책과 테스트 알림의 4개 카드를 유지한다.
설정 저장 성공, 테스트 요청 접수와 실제 채널 수신은 서로 다른 결과다. 현재 Backend의
저장 기능을 실제 email 또는 Short Message Service (SMS) 전달 지원으로 취급하지 않는다.
책임 구분의 근거는 manifest의 Backend revision에 있는 `api/v1/admin.py`,
`services/admin_service.py`, `services/alert_policy_service.py`,
`services/edge_v2_operations.py`와 `models/log.py`다.

| 식별자 | 문제와 현재 구현 | 요청 내용 및 책임 |
| --- | --- | --- |
| `BE-ADMIN-01` | 테스트 요청의 202 응답과 `AlertLog(status=SENT)` 저장만 존재, 실제 provider 호출 부재 | Backend의 실제 email 및 SMS 발송 구현, 운영 담당자의 provider와 시험 수신처 구성, 접수 및 전달 상태 구분 |
| `BE-ADMIN-02` | 설정과 대상은 저장되지만 v2 worker가 발송 지연, 반복, 최대 횟수, 복구 알림, 이벤트 선택과 대상별 정책을 미적용 | Backend의 설정별 실제 적용 범위 정의 및 worker 연결, 지원 여부와 적용 상태의 공개 계약 |
| `BE-ADMIN-03` | 저장 schema는 0~100만 검사하지만 v2 평가는 `0 <= warning <= critical - 5 < critical <= 100` 관계를 요구, 위반 시 평가 생략 | Backend의 원자적 설정 검증과 공개 허용 범위 및 관계 정의, 계약 확정 후 Frontend 입력 검증 연결 |
| `BE-ADMIN-04` | 대상 PATCH가 `If-Match`를 받지만 version 비교 없이 저장 | Backend의 Entity Tag (ETag) 비교와 원자적 갱신, 누락 시 428 및 충돌 시 412, Frontend의 기존 header 전달 및 충돌 안내 유지 |
| `BE-ADMIN-05` | 테스트 로그의 pit가 `pit-01`로 고정되고 기본 event type이 `collection_required`, 내용은 실제 전달 없이 전송 완료로 기록 | Backend의 대상 범위, 테스트 식별과 실제 처리 상태 정의, 알림 및 이력에서 수거 경보와 테스트 기록 구분 |

`BE-ADMIN-01`에서 일반 v1 경보의 EMAIL 표기도 실제 발송 근거가 아니다.
`alert_engine.py`는 SMTP 설정 유무에 따라 channel 문자열을 정하지만 provider를 호출하지
않는다. v2 worker는 LOG 및 RECORDED 기록을 생성한다. 실제 테스트 요청과 일반 경보의
성공 기준에는 provider 처리 결과와 시험 수신처의 수신 확인이 필요하다. 현재 응답만으로
실제 전달 성공을 Frontend가 표시하지 않는다.

`BE-ADMIN-02`에서 warning 및 critical 임계율의 v2 평가 사용은 확인되지만
`preCollectionAlert.enabled`와 대상의 enabled, channels, global 및 custom 설정은
실제 발송에 적용되지 않는다. 관리자가 저장한 값의 재조회와 경보 worker의 실행 결과를
별도로 검증해야 한다. Frontend는 미구현된 발송 규칙을 자체 timer나 브라우저 알림으로
대체하지 않는다.

`BE-ADMIN-05`의 현재 테스트 요청은 recipient ID와 channels만 전달하며 본문을 받지 않는다.
Backend는 대상의 존재 여부 외에 수신 중지, 등록 채널, SMS 전화번호를 검증하지 않는다.
입력 오류와 미지원 채널에 대한 실패 계약 및 테스트의 정책 우회 허용 여부를 Backend에서
정의해야 한다. 테스트 기록 생성은 별도 SSE 변경 알림을 발행하지 않으므로 다른 session의
갱신 방식도 명시해야 한다. 현재 요청을 보낸 Frontend는 성공 후 종 목록을 재조회한다.

Frontend 책임은 중복 요청 방지, 같은 설정 resource의 두 저장 직렬화, 요청 실패와 충돌
안내, 필수 입력 및 채널 검증, 응답값 적용과 늦은 응답 차단이다. 테스트 요청 성공 후
종 목록을 재조회하되 후속 조회 실패를 테스트 접수 실패로 바꾸지 않는다. 관리자 설정의
조회와 변경 권한 및 Cross-Site Request Forgery (CSRF) 검사, pit별 설정 경로와 no-store는
현재 Backend 계약에 존재한다.

수락 조건은 다음과 같다.

- 관리자 저장 및 재조회와 실제 worker 정책 적용의 구분 검증
- 미지원 전달 채널과 미설정 provider의 명시적 응답, 접수 및 실제 전달 상태 구분
- 시험 수신처에서의 일반 알림과 테스트 알림 수신 확인
- 동시 대상 편집의 stale version 거절 및 기존 저장값 보존
- 유효하지 않은 임계율 조합의 저장 거절과 기존 경보 평가 유지
- 테스트 기록의 정확한 대상 및 유형, 사용자별 읽음 상태와 독립적인 수신 정책
- 기존 카드 배치와 표 열 너비를 유지하는 Frontend 계약 연결

### 이력 및 녹화 영상의 일괄 협의 항목

기존 두 화면의 데이터 연동에 대한 협의 항목은 6개이며 선택적 확장 후보는 별도로 구분한다.
아래 항목은 요청 후보이며 상대 서비스의 구현이나 제공 가능성이 확정되었다는 의미가 아니다.
코드 근거의 revision은 [manifest](manifest.json)를 따른다. 공개 Issue에는 정제한 재현 절차와
기대 결과만 기록하며 서버 로그와 현장 데이터는 승인된 비공개 경로로 전달한다.

| 식별자 | 담당 | 구분 | 협의 항목 |
| --- | --- | --- | --- |
| `BE-DATA-01` | Backend | 조회 제한 | [장기 적재율 조회](#장기-적재율-조회-요청) |
| `BE-DATA-02` | Backend | 이벤트 의미 | [이벤트와 알림의 유형 및 제목과 상태](#이벤트와-알림의-의미-일관성) |
| `BE-DATA-03` | Backend | 응답 정합성 위험 | [알림 목록의 응답 정합성](#알림-목록-응답-정합성) |
| `BE-MEDIA-01` | Camera Media Service 주관, Backend 전달, Frontend 표시 | 생성 정보 및 제공 계약 | [날짜 및 이벤트 녹화의 실제 metadata](#녹화-파일-metadata와-시간-의미) |
| `BE-MEDIA-02` | Backend 주관, Camera Media Service 연동 | 서비스 연결 | [v2 경보와 이벤트 녹화의 자동 연결](#v2-경보와-이벤트-녹화-연결) |
| `CMS-OPS-01` | Camera Media Service 주관, Backend 협조 | 환경 진단 | [녹화 요청 구간의 프레임 부재](#녹화-실패의-환경-진단) |

화면의 표와 카드 배치를 유지하고 확인된 서버 값만 표시한다. 새로운 판단 목록 화면,
과거 임계율 변경 이력과 설명 문자열별 번역 규칙은 이 요청 범위에 포함하지 않는다.

### 장기 적재율 조회 요청

요청 식별자는 `BE-DATA-01`이다. 대상은 기존 이력 화면의 기간 선택을 처리하는
`/api/v2/monitoring/load-history`다. 현재 조회 제약은 [적재율 추이](#적재율-추이)를 따른다.
Backend의 `load_history_v2_service.py`는 저장한 STATE를 기간으로 조회하며 `history_window`가
요청 기간의 길이를 제한한다. 장기 조회의 실제 제공 가능 범위는 보관 정책과 저장 데이터 및
집계 성능 확인이 필요하다. 이 요청은 Backend에서 추가 데이터 생산이 필요하다는 항목과
구분한다.

| 협의 항목 | 요청 내용 |
| --- | --- |
| 조회 기간 | 기존 화면의 최근 30일, 최근 90일 및 사용자 지정 시작과 종료 시각 지원 |
| 보관 범위 | 실제 보관 기간, 조회 가능한 가장 오래된 시각과 요청 범위 일부만 존재할 때의 응답 규칙 |
| 표본 및 성능 | 긴 기간에도 표본 상한과 응답 크기를 제어하는 서버 측 간격 선택 및 조회 성능 기준 |
| 값의 의미 | 대표 표본 선택 또는 집계 정책, 실제 bucket 간격과 유효성 및 결측 구간의 명시 |
| 응답 경계 | 요청 범위와 실제 반환 범위, 지원하지 않는 범위 및 오류 응답의 명확한 구분 |
| 검증 조건 | 각 지원 기간의 시간축과 표본 경계, 0%, 소수 및 null 보존, 결측 구간 미연결과 기존 필터 동작 |

이 요청은 기간별 적재율 제공 범위를 확장하는 요청이다. 임계율 선은 현재 값을 사용하는
화면 정책을 유지하며 과거 임계율 변경 이력 조회를 포함하지 않는다.

### 이벤트와 알림의 의미 일관성

`BE-DATA-02`의 대상은 `/api/v1/events`와 `/api/v1/notifications`다.
`history_service.py`는 AlertLog의 실제 유형과 무관하게 경보 행을 `collection_required`,
`수거 필요`, `severity=error`, `status=resolved`로 구성한다. `resolvedAt`은 null이다.
`notification_service.py`의 제목 생성은 별도의 고정 적재율 기준을 사용한다. 따라서 같은
원본 기록이라도 제목과 상태가 실제 사건이나 현재 경보 정책을 정확히 설명하지 않을 수 있다.

요청 내용은 실제 기록 유형과 경보 평가에 근거한 제목, 설명, severity와 상태의 일관성이다.
운영 경보와 검증용 기록의 구분이 필요하면 서버의 명시적 필드와 허용값으로 정의한다.
프론트엔드는 자유 형식 설명을 해석해서 유형이나 제목을 다시 만들지 않는다.
현재 v1 오류 이력은 무효인 `ScrapMetric`에서 생성하며 v2 측정 불가 및 장비 상태 전이가
같은 운영 기록으로 자동 연결되지는 않는다. Backend는 기록할 상태 전이, 유형과 제목 및
severity, 중복 억제와 해제 및 원본 source를 정의해야 한다. 오류의 녹화 대상 조건은
`BE-MEDIA-02`와 함께 확정한다. 별도 v2 판단 목록 화면을 추가하는 요청은 아니다.
수락 조건은 일반 경보, 수거 완료, 측정 오류와 검증용 기록의 조회 결과가 각각의 의미를
유지하며 해제 정보가 없는 기록을 해제된 경보로 표시하지 않는 것이다. 알림함 전체와
선택 기간의 이벤트 목록이 같은 집합이라는 요구는 포함하지 않는다.

### 알림 목록 응답 정합성

`BE-DATA-03`의 대상은 `/api/v1/notifications`다. Backend는 저장된 `event_type`을
Notification의 허용 유형으로 직접 반환하므로 정의되지 않은 값이 저장되면 목록 응답
검증이 실패할 수 있다. 저장 데이터와 응답 schema의 정합성을 확인해야 한다.

요청 내용은 오류 원인 확인과 저장 데이터의 정리 또는 명시적 유형 지원 정책이다.
임의의 기본 유형으로 바꾸거나 프론트엔드에서 잘못된 기록을 숨기는 방식으로 대체하지 않는다.
수락 조건은 목록 조회의 정상 응답, 미읽음 수와 목록의 일치, 개별 읽음 및 모두 읽음의
저장과 재조회 후 유지다. 현재 확인된 정상 응답과 특정 저장 유형에서의 잠재적 응답 검증
실패를 구분하며 현재 알림 조회가 항상 실패한다고 단정하지 않는다.

### 녹화 파일 metadata와 시간 의미

`BE-MEDIA-01`의 대상은 `/api/v2/recordings/daily`와 단건 조회 및 export,
`/api/v1/recordings`와 단건 조회 및 Media의 clip 상세 계약이다. 요청 목적은 기존 녹화 정보
카드에 실제 영상의 metadata를 제공하는 것이다. 누락은 계약의 제공 범위와 정상적인
처리 단계별 null로 구분하며 모두 서비스 장애로 분류하지 않는다.

책임 경계는 3개다. Camera Media Service는 생성한 영상과 export 파일의 metadata를
산출하고 제공한다. Backend는 이를 응답 schema와 공개 경로에 반영한다. Frontend는 계약
검증, 단위 및 시각 변환과 기존 카드 표시를 담당한다. Edge의 카메라 입력 설정을 녹화
산출물의 검사 결과로 사용하지 않는다.

| 화면 항목 | 날짜 녹화의 현재 제공 범위 | 원인 및 요청 책임 |
| --- | --- | --- |
| 재생 형식 및 파일 형식 | `playback_protocol=hls`, 다운로드는 별도 MP4 export | 기존 계약으로 표시 가능, HLS 재생과 MP4 다운로드를 구분하며 형식 자체의 신규 제공 요청에서 제외 |
| 비디오 codec | 공개 응답 필드 부재 | Media의 실제 인코딩 결과 제공, Backend schema 확장, Frontend adapter 및 표시 연결 |
| 해상도 | 공개 응답 필드 부재 | Media의 실제 출력 width 및 height 제공, Backend schema 확장, Frontend adapter 및 표시 연결 |
| 화면 비율 | width 및 height 부재로 계산 불가 | Media와 Backend의 해상도 제공 후 Frontend 계산, 별도 서버 계산 필드 불필요 |
| Frame rate | 공개 응답 필드 부재 | Media의 실제 출력 frame rate 및 고정 또는 가변 기준 정의, Backend 전달, Frontend 표시 연결 |
| 파일 용량 | `size_bytes`, MP4 export 준비 전 null | Media의 export 파일 용량이며 HLS 저장량과 별개, 준비 완료 후 Backend 전달값을 Frontend가 표시 |
| 보관 만료 | `expires_at`, 녹화 중 null 가능 | Media의 날짜 마감 후 만료 시각 확정, 녹화 중 예정 만료를 제공할 수 있는지와 정책 변경 시 의미 협의, Backend 전달 |
| 관리 구간 및 확보된 길이 | `window_start_at`, `window_end_at`, `recorded_seconds`, `available_intervals`, `gaps` | 기존 제공값 사용, 관리 구간과 실제 재생 길이 구분 및 시간축 유지는 Frontend 책임 |

Media의 `daily_recording.py`는 `storage_profile`에 출력 width, height와 fps 설정을 저장하지만
Backend의 `schemas/daily_recording.py`에는 해당 공개 필드가 없다. 설정값이 있다는 사실은
개별 산출물의 검사 결과가 제공된다는 의미가 아니다. Media의 `daily_export.py`는 export
완료 시 `size_bytes`와 `export_expires_at`을 저장한다. 원본의 `expires_at`과 export cache의
`export_expires_at`은 서로 다른 만료 시각이다. Frontend의 `daily-recording-api.ts`는 현재
계약에 없는 codec, width, height와 frame rate를 정보 없음으로 유지하고 제공된 size 및
만료 시각은 변환해 표시한다. 현재 계약의 metadata 누락을 Frontend가 수신값을 버린
문제로 분류하지 않는다.

Media clip과 연동한 이벤트 녹화는 Backend 변환이 ready 상태에도 해상도, frame rate와 파일 크기를 null로
설정하며 Media의 ClipDetail에도 해당 metadata 필드가 없다. 형식과 codec 및 요청 구간
대체값의 현재 의미는 [실제 서비스 연동 계약](README.md#실시간-영상과-녹화-파일)을 따른다.
Media의 실제 파일 검사 결과 제공과 Backend의 기본값 및 변환 검토를 함께 요청한다.

수락 조건은 다음과 같다.

- 날짜 및 이벤트 녹화의 공개 schema, 단위, null 사유와 필드 확정 시점 정의
- codec, 해상도와 frame rate의 실제 생성 영상 일치 및 MP4 파일 용량의 실제 byte 수 일치
- 녹화 중 HLS 재생 정보와 지난 날짜의 MP4 export 정보 구분
- 요청 및 관리 구간, 실제 확보 범위, 파일 재생 길이와 보관 및 export 만료 의미 구분
- 정상적인 미준비 null과 실패 상태 구분 및 실패한 파일에 검사하지 않은 기본값 미표시
- Backend 목록과 단건 응답의 같은 의미 유지 및 인증된 경로 제공
- Frontend 계약 타입 및 adapter 연결과 기존 카드 배치 유지

썸네일의 선택적 요청은 `CMS-DATA-02`로 구분한다.

### v2 경보와 이벤트 녹화 연결

`BE-MEDIA-02`의 대상은 v2 경보 생성과 MediaClipJob 등록, `/api/v1/events`의
`recordingId` 연결 및 이벤트 녹화 구간의 기준 시각이다. 현재 `edge_v2_operations.py`는 경보와 판단의 연결을 저장하지만
이벤트 clip 등록을 호출하지 않는다. `enqueue_event_clip`의 호출 지점은 v1 경보 생성,
수거 완료와 명시적 media 제어 요청이다. 이력은 이미 등록된 job만 `eventId`로 연결한다.

Backend의 `media_job_service.py`는 `occurred_at`을 저장하지만 `process_job`은
`ClipRequest(event_id, camera_id)`만 Media에 전달한다. Media의 `recording.py`는 요청 수신
시각을 기준으로 `pre_roll_seconds`와 `post_roll_seconds` 구간을 만든다. 따라서 queue 대기나
재시도 지연이 있으면 사건 발생 전후가 아닌 요청 수신 전후 영상이 생성될 수 있다.
현재 계약에는 실제 수거 시작과 종료 구간을 전달하는 기능이 없다.

| 구현 지점 | 확인한 문제 또는 미제공 정보 | 요청 내용 및 담당 |
| --- | --- | --- |
| 이벤트와 녹화 생성 연결 | Backend v2 경보 생성의 clip job 등록 누락 | Backend의 녹화 대상 조건 및 자동 요청, 원본 event ID와 clip ID 연결 |
| 사건 발생 시각 전달 | Backend 저장 시각의 Media 요청 누락, Media의 요청 수신 시각 기준 구간 생성 | Backend와 Media의 사건 시각 또는 명시적 요청 구간 계약, 지연 및 재시도에도 같은 구간 유지 |
| 실제 수거 전체 구간 | 완료 확인 시점의 clip과 실제 작업 시작 및 종료의 차이, 확인한 Edge v2 구현의 수거 판단 알고리즘 미활성화 | Edge 및 Backend의 구간 생성 주체와 시작 및 종료 의미 협의, 확정한 구간의 Media 녹화 연결 |
| 문제 구간의 녹화 대상 | 측정 오류 등 모든 이벤트의 자동 clip 생성 미지원, 명시적 clip 요청의 경보 및 수거 ID만 허용 | Backend의 대상 이벤트 유형 및 녹화 정책 명시, Media와의 원본 식별자 연결 |
| clip 생성 전 실패의 제공 | Backend 녹화 목록은 clip ID가 없는 job을 제외 | 기존 `/api/v1/media/clip-jobs` 진단과 사용자 목록의 제공 정책 협의, 빈 목록을 요청 부재로 단정하지 않음 |

실제 수거 전체 구간의 제공은 Backend와 Frontend 사이의 응답 필드 추가만으로 해결되지
않는다. 구간 생산 주체가 시작과 종료를 제공해야 하며 현재 수거 완료 등록 시점만으로
과거의 실제 작업 구간을 복원하지 않는다. 판단 기록 모두를 녹화 대상으로 간주하거나
COLLECTION 판단을 실제 수거 완료로 바꾸지 않는다. Frontend는 영상 내용이나 적재율
변화로 사건과 구간을 추정하지 않는다.

수락 조건은 다음과 같다.

- 녹화 대상 및 제외 이벤트 유형과 자동 요청 조건의 명시
- 같은 event ID의 지연 전달 및 재시도에서 같은 요청 구간과 중복 없는 clip 연결
- 요청 구간과 실제 확보 구간 및 부분 저장 또는 프레임 부재의 구분
- 실제 수거 전체 구간을 제공하는 경우 시작과 종료의 출처, 시각 및 개정 의미 정의
- 기존 이력의 영상 보기와 이벤트 녹화 목록에서 같은 clip 조회, 재생 및 다운로드
- 녹화 실패, 삭제와 만료 상태의 원본 이벤트 연결 유지

날짜 녹화가 존재한다는 사실만으로 해당 과거 구간의 이벤트 clip 생성이나 소급 복구를
보장하지 않는다. 현재 이벤트 clip의 frame 확보 경계는 `CMS-OPS-01`에서 확인한다.

Frontend의 현재 이벤트 녹화 조회, 유형 필터와 `recordingId` 링크는 기존 계약을 사용한다.
외부 계약 확정 후 필요한 Frontend 변경은 생성 타입과 adapter의 추가 metadata 연결,
썸네일 경로 연결 및 새 구간 의미의 표시다. 기존 녹화 범위 게이지와 5개 카드 배치는 유지한다.
실제 사건의 자동 clip 생성부터 화면 조회까지의 운영 환경 검증은 서비스 연결과 실제
데이터 확보 후 수행하며 현재 화면 구현 완료와 구분한다.

### 녹화 실패의 환경 진단

`CMS-OPS-01`의 대상은 현재 검증 환경의 `NO_FRAMES_AVAILABLE` 녹화다. 이 코드는
`recording.py`에서 요청 구간에 저장된 프레임이 없을 때 발생한다. 실시간 영상 연결만으로
해당 과거 녹화 구간의 프레임 확보를 보장할 수 없으며 원인을 프론트엔드에서 확정하지 않는다.

확인 요청은 camera 식별자와 프레임 촬영 시각 및 수신 시각, 기록 buffer의 수집과 보관 범위,
Backend의 이벤트 및 녹화 요청 시각과 Media의 요청 구간이다. 수락 조건은 프레임이 존재하는
구간의 ready 파일 생성, 실제 확보 범위에 맞는 coverage와 재생 및 다운로드, 프레임이 없는
구간의 명시적 실패 응답이다. 기존 실패 기록의 재생 가능 여부나 소급 복구 가능성을 미리 보장하지 않는다.
이는 기존 오류 코드의 사용자용 표시 추가가 아니라 서비스 측 환경 진단 요청이다.

### 선택적 확장 후보

아래 항목은 기존 페이지 완료의 필수 조건이 아니며 화면 기능 추가 여부를 별도로 결정한다.

| 식별자 | 담당 | 현재 경계와 협의 내용 |
| --- | --- | --- |
| `CMS-DATA-01` | Camera Media Service와 Backend | 이벤트 clip의 `gaps`에 구간별 누락 사유를 제공할 수 있는지와 명시적 reason code 계약 |
| `CMS-DATA-02` | Camera Media Service 주관, Backend 경로 제공, Frontend 표시 | 날짜 및 이벤트 녹화의 대표 frame 썸네일 생성, 선택 기준과 생성 상태 및 만료, 인증된 same-origin 경로 제공 |
| `BE-DATA-07` | Backend | 별도 v2 사건 목록을 제품 기능에 연결하는 경우의 기간, 유형, source, 정렬과 pagination 계약, 현재 별도 판단 목록 화면의 필수 요청에서 제외 |

`CMS-DATA-02`의 날짜 녹화 계약에는 썸네일 필드가 없고 Backend의 Media clip 변환은
이벤트 녹화의 `thumbnailPath`를 null로 제공한다. Media가 썸네일을 생성하고 Backend와
gateway가 인증된 경로를 제공하는 계약을 요청한다. Frontend는 해당 경로의 이미지를
기존 크기로 표시하고 생성 전, 실패 및 만료에는
빈 미리보기를 유지한다. 다른 시점의 실시간 frame이나 예시 이미지를 대신 사용하지 않으며
목록의 각 영상을 브라우저에서 열어 썸네일을 추출하는 동작은 포함하지 않는다.

### 추가 요청에서 제외하는 항목

이벤트 녹화의 기간과 유형 필터, clip ID를 통한 단건 조회, ready MP4 재생 및 다운로드,
Range와 삭제 후 접근 거절은 기존 계약과 통합 검증 범위다. 날짜 녹화의 인증 조회,
HLS 경로와 시간 매핑 및 MP4 export도 제공된 계약의 Frontend 연동 범위이며 새 API로 요청하지 않는다.
긴 설명의 처리와 모달, 오류 안내, 파일 metadata의 결측 표현, 불필요한 보조 조회와 화면
초기화 대기는 프론트엔드의 책임이며 Backend 필수 요청으로 분류하지 않는다.
