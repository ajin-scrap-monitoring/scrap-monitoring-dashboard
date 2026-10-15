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

## 현황 화면

| 기존 항목 | 제공 정보 | 평가 | 연결 또는 필요한 계약 |
| --- | --- | --- | --- |
| 대표 적재율 | v2 `summary.loadPercent`, `dataState` | 직접 사용 | 서버의 percent 값 유지, 데이터 상태에 따른 표시 가능 여부 적용 |
| 수거 임계율 | `summary.collectionThresholdPercent` | 직접 사용 | 기존 임계율 영역의 percent 표시 |
| 경고 기준 | `summary.warningThresholdPercent` | 직접 사용 | 임계율 영역의 보조 정보, 알림 발송 활성 여부와 구분 |
| 적재율 경보 | v2 `operations.effectiveState` | 변환 사용 | Backend의 현재 평가 결과를 기존 현재 상태 카드에 표시 |
| 예상 도달 및 남은 시간 | v1 `expectedThresholdAt=null`, v2 예측 필드 부재 | 추가 계약 필요 | 서버의 예상 도달 시각, 가용성, 산출 기준과 유효 기간 |
| 최근 1시간 변화량 | v2 STATE 시계열, 변화량 산출 규칙 부재 | 추가 계약 필요 | 비교 구간과 결측 및 제한된 표본을 포함하는 변화량 산출 계약 |
| 최근 수거 후 경과 | `/api/v1/events`의 실제 `collection_completed` 기록 | 변환 사용 | 같은 pit의 가장 최근 완료 시각과 v2 `serverTime` 간 차이를 시간과 분으로 표시 |
| 평균 수거 주기 | 완료 기록 목록, v1의 고정 `averageCollectionCycleSeconds` | 의미 불일치 | 완료 기록 기반 집계의 기간, 표본 수와 계산 규칙 확정 필요 |
| 실시간 영상 | Media Service의 Motion JPEG (MJPEG) stream | 직접 사용 | 기존 영상 영역과 확대 기능, 실제 frame decode 뒤 LIVE 표시 |
| 영상 촬영 시각 | Media Service의 촬영 시각 부재 | 추가 계약 필요 | frame 촬영 시각과 전달 지연 정보, 측정 시각으로 대체 금지 |
| 측정 영역 | 현장 좌표와 측정선 배치 부재 | 추가 계약 필요 | 참고도 유지, 실측 좌표계 및 센서와 측정선의 연결 계약 |
| 최근 24시간 적재율 | `/api/v2/monitoring/load-history`의 같은 source STATE 표본 | 변환 사용 | percent 유지, 판단 생성 시각의 점과 bucket 구간 및 결측 보존 |
| LiDAR 1 및 LiDAR 2 profile | v2 evidence 참조와 sensor ID, v1 생성 profile | 의미 불일치 | 실제 높이 표본, 단위, 위치 좌표, 통계와 화면 slot 연결 계약 |
| 활성 알림 | v2 경보 이력과 `operations` | 의미 불일치 | 경보 기록의 활성 및 해제 상태 또는 현재 조건을 활성 알림으로 사용하는 제품 정의 |
| 센서 상태 | `deviceStatus.snapshot.sensors` | 변환 사용 | 실제 sensor ID와 데이터 상태, 마지막 scan 시각 표시, latency 추정 금지 |
| 엣지 장비 상태 | `connection_state`, `effective_state`, `last_received_at` | 변환 사용 | 실제 상태와 수신 시각 표시, 연결 상태와 판단 가용성 구분 |
| 카메라 상태 및 latency | MJPEG 연결 상태, v1 고정 상태와 latency | 의미 불일치 | 브라우저 영상 연결과 장비 health 구분, 실제 카메라 health 및 latency 계약 필요 |

`summary.loadPercent`는 이미 percent 단위이므로 다시 100을 곱하지 않는다.
`measuredAt`, `assessmentReceivedAt`, 센서의 `last_scan_at`, 장비의 `last_received_at`과 영상
촬영 시각은 각각 다른 시각이다. 수거 완료 시각이 서버 시각보다 미래이면 경과 시간을
정보 없음으로 표시한다. 브라우저의 로컬 시각은 경과 시간 계산에 사용하지 않는다.

Backend의 [v1 snapshot 구현](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/3419823806ece8bd722c710ef36d9ef3452d1f7e/src/app/services/snapshot_service.py)은
평균 수거 주기에 고정값을 사용하고, 하나의 높이에 임의의 차이를 더해 profile을 생성한다.
장비 latency와 카메라 상태에도 고정값을 사용하며 CRITICAL을 `collecting`으로 변환한다.
이 값들은 실제 수거 작업, LiDAR 표면 표본 또는 장비 health의 확인 근거로 사용하지 않는다.
실제 완료 기록은 `/api/v1/events?category=collection&page=1&pageSize=1&pit_id=...`로 조회한다.
이 API는 `CollectionLog.completed_at`을 Coordinated Universal Time (UTC) offset이 있는
`occurredAt`으로 제공한다.
`/api/v1/collections/history`의 `completed_at`은 SQLite 환경에서 offset 없이 반환되므로
경과 시간 입력으로 사용하지 않는다. 보조 지표 조회 실패 및 계약 위반은 해당 값을 정보
없음으로 표시하며 현황 화면 전체의 조회 실패로 처리하지 않는다.

장비 서비스별 상태와 마지막 진행 시각, clock 상태와 offset은 상태 상세창에서만 표시한다.
clock offset은 장비 시계 오차이며 센서 또는 카메라의 통신 latency로 변환하지 않는다.
pit 이름도 같은 상세창에서 조회하며 기본 화면의 제목과 식별자를 바꾸지 않는다.

## 적재율 추이

현황의 최근 24시간과 이력 그래프는 v2 모드에서 `/api/v2/monitoring/load-history`를
사용한다. `bucket_seconds`는 전달하지 않고 서버의 자동 간격 선택을 사용한다.
`schemaVersion`, pit 및 site와 edge를 확인하고 서버의 percent 값을 유지한다.
점의 위치는 `generatedAt`, 관측 시각은 `observedAt`, 전체 시간축과 결측 구간은
`bucketStartAt`과 `bucketEndAt`을 사용한다. 유효한 0과 결측을 구분하며 `valid=false`와
null은 선을 연결하지 않는다. LIMITED의 유효한 수치는 제한 상태를 함께 표시한다.

조회 최대 범위는 7일이고 표본 상한은 1,441개다. 최근 30일과 90일 선택 및 운영 기록
조회는 유지하며 v2 그래프만 범위 미지원으로 표시한다. 현재 snapshot이 없거나 장비 연결이
중단되어도 별도로 조회한 과거 표본의 유효성을 다시 판정하지 않는다. 현재 임계율은 참고선이며
과거에 적용된 임계율이 아니다. v1 운영 사건을 v2 적재율 값에 맞춰 재배치하지 않는다.

현황은 약 1분 간격으로 추이를 갱신하며 SSE마다 전체 추이를 다시 요청하지 않는다.
초기 및 자동 조회의 종료 시각은 서버 시각을 넘기도록 올림하지 않는다. 조회 실패는 해당
그래프에서 구분하며 v1 값으로 대체하지 않는다. 원본 의미는 Backend의
[적재율 추이 계약](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/73b9e28b135e670d6c5d6a460da3b76af16250a8/docs/V2_LOAD_HISTORY.md)을 따른다.

## 경보와 수거 사건

현재 상태 카드의 적재율 경보는 서버의 현재 평가 결과를 다음 문구로 표시한다.

| 서버 값 | 화면 문구 |
| --- | --- |
| `NORMAL` | 경고 기준 미만 |
| `WARNING` | 경고 |
| `CRITICAL` | 위험 |
| `UNKNOWN` | 확인 불가 |
| `ERROR` | 판정 불가 |
| `operations=null` 또는 평가 정보 부재 | 경보 평가 미제공 |

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

알림 조회 실패는 현재 판단과 영상을 차단하지 않는다. 최초 실패의 미읽음 수는 확인 불가로
표시하고 이전 유효 응답이 있으면 갱신 실패와 이전 응답의 사용을 구분한다. 재시도는 기존
알림 popover에서 제공한다. 401과 403은 보조 조회 실패로 숨기지 않는다.

경보 근거는 기존 이력 표의 내용 선택으로 조회한다. 원본 `eventId`가 같은 기록에만
관측 시각, 당시 적재율과 판단 식별자를 연결한다. v2 목록은 상세창에서 한 페이지씩
조회하며 현재 페이지에 근거가 없다는 이유로 전체 기록에 근거가 없다고 확정하지 않는다.

COLLECTION의 CONFIRMED는 판단 조건 충족이며 실제 수거 완료가 아니다. capability,
`decision_state`, reason code와 revision은 함께 해석한다. 사건 또는 겹치는 시각만으로
녹화 영상을 연결하지 않는다. 의미와 제공 범위의 근거는 Backend의
[v2 운영 계약](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/3419823806ece8bd722c710ef36d9ef3452d1f7e/docs/V2_OPERATIONS.md)이다.

## 이력 및 다른 화면

| 기존 화면 | 제공 정보 | 적용 범위와 추가 경계 |
| --- | --- | --- |
| 적재율 이력 그래프 | v2 `/api/v2/monitoring/load-history`, 선택적 v1 `/api/v1/history/load` | 현재 모드의 출처만 사용, 시각과 결측 및 조회 상한은 적재율 추이 기준 적용 |
| 운영 이력 표 | `/api/v1/events`, v2 경보 및 사건 이력 | v1 기록과 v2 판단 출처 구분, v2 사건을 수거 완료로 변환하지 않음 |
| 이력 기간과 유형 조회 | 운영 기록의 v1 기간 및 category, v2 추이의 기간 조회 | 운영 기록과 그래프를 별도로 조회, v2 경보 상세의 offset과 혼합 금지 |
| 녹화 목록 및 재생 | 기존 `/api/v1/recordings`와 Media clip 정보 | 실제 clip ID 연결만 사용, v2 경보 및 COLLECTION의 자동 clip 연결 부재 |
| 관리자 임계율 | 기존 pit 설정과 v2 summary | 현재 서버 임계율 사용, 경고 및 복귀와 위험 임계율의 저장 검증 계약 필요 |
| 관리자 발송 정책 | 기존 저장 설정과 v2 worker 설정 | 저장된 UI 정책과 실제 worker 적용 범위 구분, LOG 외 발송 및 정책 적용 계약 필요 |
| 녹화 요청 및 확보 범위 | `/api/v1/media/clips/{clip_id}` | clip과 camera 식별자 검사, 선택 시 별도 상세창 표시, 구간별 누락 원인 미제공 |
| 날짜별 상시 녹화 | Media 내부 날짜별 계약 | 순수 모델과 시간 매핑 검증, Backend 브라우저 계약 부재로 요청 및 player 미연결 |

v2 경보 및 수거 판단 목록은 `items`, `totalItems`, `limit`, `offset`을 사용하며 v1의 page
metadata와 다르다. 이 목록에는 기간 필터가 없고 offset 상한이 있다. 목록 일부를 브라우저에서 날짜로
걸러 전체 기간의 조회 결과로 표시하지 않는다.

v1 이력의 경보와 오류 `status=resolved`는 해제 상태를 조회한 값이 아니므로 프론트엔드는
기록으로 표시한다. severity는 해당 기록의 표시 수준에 사용한다. v1 이력의 source와 생성 기준은
[이력 구현](https://github.com/ajin-scrap-monitoring/scrap-monitoring-backend/blob/3419823806ece8bd722c710ef36d9ef3452d1f7e/src/app/services/history_service.py)을
따른다.

assessment 및 message ID, revision, rule 및 config revision, capability, reason code와
evidence 참조는 출처 확인에 사용할 수 있다. evidence 참조는 높이 표본이 아니며 데이터
참조만으로 profile을 복원하지 않는다. clock, service, delivery와 storage 정보는 장비 진단
정보이며 기존 적재율, latency와 수거 지표의 대체값으로 사용하지 않는다.

## 추가 계약의 책임과 우선순위

| 우선순위 | 필요한 정보 또는 결정 | 책임 경계 |
| --- | --- | --- |
| 높음 | 실제 수거 진행 상태의 제공, 활성 알림의 정의와 해제 조건 | 제품 결정 및 Backend 계약 |
| 높음 | 7일을 초과하는 v2 적재율 추이 조회 | Backend 조회 및 집계 계약, Frontend의 기존 장기 조회 연결 |
| 높음 | 실제 LiDAR 높이 profile과 화면 slot 및 sensor ID 연결 | Edge 측정 결과, Backend 제공 계약, Frontend 표시 |
| 보통 | 수거 주기의 집계 기간과 표본, 예측 결과의 가용성과 시각 | 제품 및 Backend 계약, 확정된 통계의 Frontend 표시 |
| 보통 | v2 사건의 기간 조회와 유형 필터, 경보 및 사건과 clip ID 연결 | Backend 및 Media 계약, Frontend 기존 이력 및 녹화 화면 연동 |
| 보통 | 카메라 health, frame 촬영 시각, latency와 실측 배치 | Edge 및 Media 제공 정보, Backend 조회 계약 |
| 보통 | 경고와 복귀 및 위험 임계율의 저장 검증, 실제 발송 정책 적용 범위 | Backend 및 운영 계약, Frontend 입력 검증 |
| 보통 | 날짜별 녹화의 브라우저 조회와 영상 및 export 경로, 이벤트 클립의 구간별 누락 원인 | Backend 및 Media 제공 계약, Frontend의 기존 녹화 화면 연결 |

Frontend만으로 가능한 작업은 제공된 값의 표시 및 시각과 단위 변환, 상태 분리, pagination
adapter, 취소와 재조회 및 기존 화면의 회귀 검증이다. 실제 높이, 예측, 장비 health와
수거 완료의 의미를 Frontend에서 만들어 추가 계약을 대신하지 않는다.
