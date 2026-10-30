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

## 항목 찾기

| 확인 대상 | 문서 안 위치 |
| --- | --- |
| 제공된 값의 미연결 여부 | [응답 연결 점검](#제공-응답과-화면-연결-점검) |
| 현황 수치와 장비 상태 | [현황 화면](#현황-화면), [과거 관측](#1시간-전-적재율), [LiDAR](#lidar-높이-곡선), [활성 알림](#활성-알림) |
| 그래프와 운영 기록의 의미 | [적재율 추이](#적재율-추이), [경보와 수거 사건](#경보와-수거-사건), [이력](#이력), [녹화](#녹화) |
| 다른 컴포넌트에 전달할 요청 | [추가 계약 요청](#추가-계약-요청) |
| 관리자 정책과 발송의 미구현 | [관리자 협의 항목](#관리자-설정과-알림의-협의-항목) |
| 이력과 녹화의 누락 및 제한 | [일괄 협의 항목](#이력-및-녹화-영상의-일괄-협의-항목) |

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
| v1 이력의 `resolved` 단독 값 | `statusBasis`가 해제 근거를 확인한 경우에만 해제로 표시 |
| clip ID가 없는 녹화 job | 기존 `/api/v1/media/clip-jobs`에서 조회 가능, 날짜 및 이벤트 녹화 목록과 별도 범위 |
| 날짜 녹화의 구간별 reason code | 수신 및 보존, 녹화 범위 상세 창에서 누락 구간 시각과 함께 사유 코드를 표시 |
| export cache 만료 시각 | 다운로드 가능 여부에 사용, 원본 보관 만료와 별도 표시하지 않음 |
| 수신 대상 이름과 연락처 편집 | Backend PATCH 지원, 현재 수신 정책 패널의 편집 범위 밖 |
| 녹화 revision, storage profile과 segment 설정 | 저장 및 전송 기술 정보로 기본 화면에 미표시 |
| 카메라 현재 정책과 clip 접수 당시 정책 | 서로 다른 적용 시점으로 구분하며 정책 상세 및 변경은 현재 화면 범위 밖 |

## 현황 화면

Backend 기준은 manifest의 revision이다. 현황 보조 조회 4개(`fill-forecast`,
`collection-summary`, `profiles`, `active-alerts`)와 측정 영역의 `layout`은 약 1분 간격으로 함께 조회하며 각각
실패해도 해당 값만 정보 없음으로 표시한다. 401과 403은 숨기지 않는다.

| 기존 항목 | 제공 정보 | 평가 | 연결 또는 남은 계약 |
| --- | --- | --- | --- |
| 추정 적재율 | v2 `summary.loadPercent`, `dataState`, `filterState` | 직접 사용 | 서버의 percent 값 유지, `filterState`의 WARMING 및 UNAVAILABLE 보조 표기 적용 |
| 수거 임계율과 경고 기준 | `summary.collectionThresholdPercent`, `warningThresholdPercent` | 직접 사용 | 기존 임계율 영역의 percent 표시 |
| 적재율 경보 | v2 `operations.effectiveState` | 변환 사용 | Backend의 현재 평가 결과 표시 |
| 예상 도달 및 남은 시간 | `/api/v2/monitoring/fill-forecast` | 변환 사용 | `AVAILABLE`은 `expectedThresholdAt`과 서버 시각 기준 남은 시간, `REACHED`는 임계율 도달, `UNAVAILABLE`은 정보 없음, `validUntil` 경과와 재연결 중에는 숨김 |
| 1시간 전 적재율 | `/api/v2/monitoring/load-history` | 변환 사용 | [1시간 전 적재율](#1시간-전-적재율)의 선택 규칙 |
| 최근 수거 후 경과 | `/api/v2/monitoring/collection-summary`의 `lastCollectionActivityAt` | 변환 사용 | 서버 시각과의 차이, null과 미래 시각은 정보 없음 |
| 평균 수거 주기 | `collection-summary`의 `averageSettledCollectionCycleSeconds` | 변환 사용 | 자동 수거 종료 감지 사이의 평균 간격, null은 자료 부족 |
| 실시간 영상 | Media Service의 MJPEG stream | 직접 사용 | 기존 영상 영역과 확대 기능, 실제 frame decode 뒤 LIVE 표시 |
| 영상 촬영 시각 | 제공 정보 없음 | 추가 계약 필요 | frame 촬영 시각의 출처와 전달 형식 |
| 측정 영역 | 제공 정보 없음 | 추가 계약 필요 | 참고도 유지, 실측 좌표계와 센서 및 측정선 연결 |
| 최근 24시간 적재율 | `/api/v2/monitoring/load-history` | 변환 사용 | [적재율 추이](#적재율-추이) |
| LiDAR 1, LiDAR 2 | `/api/v2/monitoring/profiles` | 변환 사용 | [LiDAR 높이 곡선](#lidar-높이-곡선) |
| 활성 알림 | `/api/v2/monitoring/active-alerts` | 변환 사용 | [활성 알림](#활성-알림) |
| 센서 상태 | `deviceStatus.snapshot.sensors` | 변환 사용 | `lidar-a`는 LiDAR 1, `lidar-b`는 LiDAR 2로 표시하며 원래 ID와 상태 보존, scan 시각으로 latency를 추정하지 않음 |
| 엣지 및 카메라 상태 | `connection_state`, `effective_state`, `services`의 `camera-edge` | 변환 사용 | 보고된 상태 반영, 연결 상태와 판단 가용성 구분 |
| 카메라 latency | 제공 정보 없음 | 추가 계약 필요 | `last_progress_at`으로 추정하지 않음 |

`summary.loadPercent`는 이미 percent 단위이므로 다시 100을 곱하지 않는다.
`measuredAt`, `assessmentReceivedAt`, 센서의 `last_scan_at`, 장비의 `last_received_at`과 영상
촬영 시각은 각각 다른 시각이다. 브라우저의 로컬 시각은 경과 시간 계산에 사용하지 않는다.
snapshot, `profiles`, `fill-forecast`와 `load-history`가 `simulated=true`를 제공하면 기존
카드 안에 시뮬레이션 보조 표기를 더한다. 실측으로 취급하지 않는다.

별도의 장비 서비스 진단 목록, 마지막 진행 시각, clock 상태와 offset은 화면에 표시하지
않는다. 서비스 부재 및 오래된 장비 snapshot을 정상 상태로 보충하지 않는다. pit 이름은
조회하거나 표시하지 않는다. 센서의 FRESH는 최근 scan 수신 기준이며 적재율 산출 성공이나
driver 서비스의 전체 건강 상태를 의미하지 않는다.

### 1시간 전 적재율

최근 24시간 이력에서 같은 source의 과거 관측을 선택한다. 기준 시각은 snapshot의
`serverTime`과 이력 조회 종료 시각 중 늦은 값이며 브라우저 시각을 사용하지 않는다.
기준의 1시간 전부터 이전 60초 이내에서 가장 가까운 `observedAt`을 선택하고, 선택한 표본이
무효이거나 `generatedAt` 또는 `observedAt`이 없으면 더 이전 표본으로 대체하지 않고 정보
없음으로 표시한다. 조회 범위 밖, 조건에 맞는 표본 부재와 이력 조회 실패도 정보 없음이다.
현재 적재율의 역산, v1 변화량이나 수거량 추정으로 보충하지 않는다.

## 적재율 추이

현황의 최근 24시간과 이력 그래프는 `/api/v2/monitoring/load-history`를 사용한다.
`bucket_seconds`는 전달하지 않고 서버의 자동 간격 선택(60, 300, 900, 3600, 7200, 21600,
86400초)을 사용한다. 한 요청의 범위는 최대 90일이며 표본 상한은 1,441개다. 구간 수는
`ceil(to/간격) - floor(from/간격)`이고 양 끝 구간은 요청 범위로 잘린다. 90일 조회는 약
11초가 걸릴 수 있어 이 요청만 25초 timeout을 사용하고 조회 중 안내를 표시한다. 서버가 compact 모드로 응답하면 유효한 표본의
`generatedAt`과 `observedAt`이 null일 수 있다. 이 표본은 bucket 위치로 표시하고 시각을
만들어 채우지 않는다. 응답의 `inputSource`, `valuePolicy`와 `simulated`는 보존한다.
유효한 0과 결측을 구분하며 `valid=false`와 null은 선을 연결하지 않는다.
90일을 넘는 기간은 요청 전에 안내하고 요청하지 않는다. 422 `HISTORY_*` 코드와 503
`HISTORY_QUERY_TIMEOUT`은 빈 그래프 대신 코드별 안내로 표시하며 자동 재시도하지 않는다.
현재 임계율은 참고선이며 과거에 적용된 임계율이 아니다.

## 표시 시간대

화면의 시각은 `Asia/Seoul`(+09:00)로 고정해 표시하고 브라우저 시간대를 따르지 않는다.
요청 파라미터는 offset을 포함한 ISO 8601을 유지하며 서버가 준 UTC 원본은 변환 없이
보존한다. 시각 문자열에 시간대가 필요한 위치는 `(한국 표준시)`를 덧붙인다.

## 오류 응답

Backend 오류 본문은 `{detail: 문자열}`, `{detail: [{loc, msg, type}]}` 그리고 미디어의
`{error: {code, message}}`의 3가지다. 대문자 코드형 `detail` 문자열은 코드로도 사용한다.
요청 검증 오류 배열의 `loc`은 관리자 설정의 입력 영역에 대응시켜 해당 영역에 안내하고
대응이 없으면 폼 단위 안내를 표시한다. 412와 428은 새로고침 안내를 표시한다.

## LiDAR 높이 곡선

`/api/v2/monitoring/profiles`의 `sensorId`가 `lidar-a`이면 LiDAR 1, `lidar-b`이면 LiDAR 2
카드에 연결한다. 이 대응은 현행 장비 상태와 같은 규칙이며 응답이 제공하는 값이 아니다.
높이는 cm를 m로 한 번 변환하고 `positionRatio`는 0 이상 1 이하의 위치로 사용한다.
평균은 `SCAN_MEAN_TEMPORAL_MEDIAN` 기준이면 `filteredAverage`, 아니면 `average`다.
`valid=false`, 높이 또는 위치가 null인 표본은 선을 끊는다. `simulated`와
`calibrationState`가 실측을 보증하지 않으면 시뮬레이션 또는 미검증으로 표시한다.
`lidar-a`는 LiDAR 1, `lidar-b`는 LiDAR 2에 대응한다. `positionRatio` 0 -> 1이 측정선
A -> B이며 그래프 왼쪽 -> 오른쪽이다. 임의로 반전하지 않는다. 이 방향은 Backend가
확인했다. 측정 영역 카드는 기존 그림을 유지하고 layout 응답은 배치 상태 표시에만 쓴다.

## 활성 알림

`/api/v2/monitoring/active-alerts?scope=ALL`은 적재율 경보 항목(`pre_collection_alert`,
`collection_required`)과 장비 항목(`device_error`, `measurement_error`)의 합집합을 제공한다.
`evaluationState`는 적재율 판정에만 해당하며 snapshot의 `operations.effectiveState`와
같을 때만 적재율 항목을 표시한다. 다르면 적재율 판정 불가 안내를 표시하고 장비 항목은
계속 표시한다. `NORMAL`의 빈 목록은 적재율 경보 없음, `WARNING`과 `CRITICAL`은 항목
표시이며 `UNKNOWN`과 `ERROR`는 판정 불가다.

`startedAt`은 `startBasis`가 `SERVER_EVALUATION`일 때만 서버 최초 확인 시각으로 표시하고
그 외에는 시작 정보 없음이다. `evaluatedAt`은 판정 시각이며 경보 시작 시각이 아니다.
`coverage`는 구성 요소별 `CHECKED`, `UNKNOWN`, `UNSUPPORTED`를 알린다. `UNKNOWN`과
`UNSUPPORTED` 구성 요소는 확인 불가 항목으로 같은 카드의 같은 페이지 방식에 표시하며
건수에 포함하지 않고 `N건 / 확인 불가 M`으로 구분한다. `coverage`가 없으면 확인 범위를
알 수 없으므로 빈 목록을 오류 없음으로 단정하지 않는다.

## 측정 영역 배치 상태

`/api/v2/monitoring/layout`은 센서별 `calibrationState`와 전체 `state`, `bindingState`를
제공한다. 측정 영역 카드는 제목 행에 한 줄 상태(시뮬레이션 배치, 일부 배치 정보 없음,
실측 배치 미검증, 배치 정보 확인 불가)만 표시하고 그림은 변경하지 않는다. 사유와
센서별 상태는 title에 둔다. `bindingState`가 `MISMATCH` 또는 `UNKNOWN`이면 확인 불가이며
조회 실패는 배치 정보 없음이다.

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

프론트엔드는 적재율과 임계율로 등급을 다시 계산하지 않는다. 실제 작업의 대기, 적재 중과
수거 중은 이 등급에서 추정하지 않는다. `operations=null`을 NORMAL로 바꾸지 않으며
`UNKNOWN` 또는 `ERROR`에서 과거 CRITICAL을 현재 경보로 표시하지 않는다. Server-Sent Events
(SSE) 연결 오류 동안에도 현재 경보를 알 수 없는 상태로 표시한다.

v2 SSE는 별도의 `notification.created`를 제공하지 않는다. 프론트엔드는 snapshot의 새로운
`notificationId`로 `/api/v1/notifications`를 다시 조회한다. 읽음 요청의 성공은 확인한
알림 ID에 반영하고 서버 목록을 다시 조회하며, 재조회 실패는 성공한 읽음을 되돌리지
않는다. 읽음 처리는 경보 해제를 의미하지 않는다. 401과 403은 보조 조회 실패로 숨기지
않는다.

COLLECTION의 CONFIRMED는 판단 조건 충족이며 실제 수거 완료가 아니다. 수거 관련 판단
사건과 실제 완료 기록을 진행 중 상태로 사용하지 않는다.

## 이력

| 기존 항목 | 제공 정보 | 적용 범위 |
| --- | --- | --- |
| 적재율 그래프 | `/api/v2/monitoring/load-history` | [적재율 추이](#적재율-추이)의 기준 |
| 운영 이력 표 | `/api/v1/events` (`collection_scope=all`) | 자동 수거 종료 감지와 이전 감지 기준의 기록까지 조회 |
| 상태 열 | `status`, `statusBasis`, `collectionSource`, `confirmedCompletion`, `stateAtOccurrence` | 아래 상태 규칙 |
| 이벤트 상세 | 같은 응답의 부가 필드 | 수거 확인 구분, 감지 기준, 시뮬레이션 출처, 현재 연결 기준의 pit, reason code |
| 관련 녹화 | `/api/v1/events` 항목의 `recordingEventId`와 `/api/v2/recordings/events/{event_id}`의 `eventId` | `recordingEventId`가 null이 아닐 때만 연결 |

상태 규칙은 다음과 같다.

| 서버 값 | 화면 상태 |
| --- | --- |
| 자동 수거 종료(`HEIGHT_SETTLED`)이며 `confirmedCompletion=false` | 종료 감지 |
| 수동 확인 수거 | 완료 |
| 경보 `active`이고 근거가 현재 평가 | 활성 |
| 경보 `resolved`이고 근거가 저장된 해제 | 해제 |
| `unknown` 또는 근거가 `UNVERIFIED` | 확인 불가 |
| 해제 근거 부재의 `resolved` | 상태 미표시 |
| 오류 | 발생 당시 상태 라벨 |

이력 `id`로 녹화를 추정하지 않으며 `recordingEventId`가 null이면 관련 녹화를 표시하지 않는다.
v2 경보와 수거 판단 목록(`/api/v2/monitoring/alerts`, `collection-events`)은 기간 필터가
없고 offset 상한이 있어 이력 표의 기간 조회에 사용하지 않는다.

## 녹화

| 기존 항목 | 제공 정보 | 평가 | 연결 또는 남은 계약 |
| --- | --- | --- | --- |
| 날짜 녹화 | `/api/v2/recordings/daily`, 단건, `exports` | 직접 사용 | 실제 확보와 누락 구간 시간축, HLS 재생, 지난 날짜의 MP4 준비 |
| 날짜 녹화 삭제 | `DELETE /api/v2/recordings/daily/{recording_id}` | 직접 사용 | 관리자 전용, 확인창, CSRF |
| 이벤트 녹화 목록 | `/api/v2/recordings/events` | 변환 사용 | `category`, `from`, `to`(최대 90일), `page`, `pageSize`, `include_playback=true`의 `playback` 요약(`UNKNOWN` 포함, 길이 null은 정보 없음) |
| 이벤트 구간 재생 | `/api/v2/recordings/events/{event_id}`의 `parts` | 변환 사용 | 날짜 녹화 HLS를 구간별로 이어서 재생 |
| 시작, 종료, 길이, 형식 | 이벤트 상세 | 변환 사용 | 길이는 `playbackSeconds`, 형식은 HLS |
| 보관 만료 | 날짜 녹화 상세의 `expires_at` | 변환 사용 | `parts`의 모든 날짜 녹화 중 가장 빠른 만료, 하나라도 확인하지 못하면 정보 없음 |
| codec, 해상도, frame rate | 제공 정보 없음 | 추가 계약 필요 | 정보 없음 |
| 이벤트 구간 용량과 MP4 | `downloadPath=null`, `EVENT_RANGE_EXPORT_UNSUPPORTED` | 추가 계약 필요 | 다운로드 미지원 표시, 날짜 MP4로 대체하지 않음 |
| 미리보기 썸네일 | 제공 정보 없음 | 추가 계약 필요 | 미리보기 없음 표시 |

이벤트 녹화의 `windowState`는 `CLOSED`, `OPEN`, `UNKNOWN`, `POINT`이며 목록은 구간 상태를,
상세는 `state`(`AVAILABLE`, `PARTIAL`, `PROCESSING`, `UNAVAILABLE`)를 상태 문구로 사용한다.
재생 위치는 이벤트 구간의 0초부터 `playbackSeconds`까지이며 `parts`의 `startSeconds`와
`endSeconds`는 해당 날짜 녹화 안의 위치, `relativeStartSeconds`와 `relativeEndSeconds`는
이벤트 재생 시간축의 위치다. 한 part가 끝나면 다음 part로 이동하고 마지막 part의 끝에서
정지한다. `unavailableIntervals`는 재생하지 않는 구간이며 하루 또는 이벤트 구간 전체가
녹화되었다고 가정하지 않는다. 날짜 녹화를 삭제하면 같은 날짜 영상을 쓰는 이벤트 구간도
재생할 수 없다. 이벤트 상세의 `unavailableIntervals` 또는 날짜 녹화의 `gaps`가 1개 이상이면 녹화 정보 카드의 부분 저장 버튼으로 녹화 범위 상세 창을 연다. 이벤트 창은 요청 구간(`windowFrom` ~ `windowTo`), 요청 길이, 확보 길이, 재생 길이와 각 구간의 시작 및 종료 시각, 종류(GAP, UNCONFIRMED, FUTURE, MISSING, EXPIRED)와 `reasonCode`를 표시한다. 날짜 창은 녹화 날짜와 `gaps`의 시작 및 종료 시각과 `reason_code`를 표시한다.

## 추가 계약 요청

Backend와 Media Service에 전달할 요청 항목을 관리한다. 제공되지 않는 값은 0, 정상 또는 synthetic
값으로 보충하지 않는다.

| ID | 항목 | 책임 | 상태 |
| --- | --- | --- | --- |
| R-01 | 카메라 상태 | Backend, Media Service | 카메라 상태 연동 대기 |
| R-03 | 측정 영역의 실측 배치 | Backend, Edge | 실측 배치 연동 대기 |
| R-07 | 이벤트 구간 MP4 다운로드와 파일 용량 | Backend, Media Service | 대기 |
| R-08 | 녹화 영상의 codec, 해상도, frame rate | Media Service | 대기 |
| R-09 | 실시간 영상의 촬영 시각 | Media Service | 대기 |
| R-10 | 날짜 녹화 삭제 시 503 | Media Service | 수정 버전 확인 대기 |
| R-11 | 녹화 목록 미리보기 이미지 | Backend, Media Service | 대기 |
| R-12 | 배포 환경 설정 | Backend, 운영 | 운영 환경 설정 대기 |
| R-13 | 알림 실제 발송 | Backend, 운영 | 대기 |
| A-01 | 시뮬레이션 `lidar-b` 측정선 위치가 현장 기준과 다름 | Backend | 대기 |
| A-02 | 대기 중인 이전 요청의 담당과 예정 시점 | Backend | 대기 |
| A-03 | 활성 알림 응답의 coverage 필수 여부 | Backend | 대기 |
| A-04 | profiles의 samples 부재와 빈 배열 | Backend | 대기 |
| A-05 | 경보 설정 저장 오류의 필드 식별 | Backend | 대기 |
| A-06 | 삭제된 날짜 녹화의 export 상태와 만료 시각 | Backend, Media Service | 대기 |
| A-07 | 적재율 이력 조회의 응답 시간 | Backend | 대기 |
| A-08 | 활성 알림과 현재 판정의 기준 차이 | Backend | 대기 |
| A-09 | 이벤트 녹화 목록의 정렬 기준과 페이지 안정성 | Backend | 대기 |

### 이력 및 녹화 영상의 일괄 협의 항목

위 표의 이력 및 녹화 항목은 한 번에 협의한다.

### 관리자 설정과 알림의 협의 항목

관리자 화면은 수거 임계율, 알림 대상 관리, 알림 정책과 테스트 알림의 4개 카드를 유지한다.
설정 저장 성공, 테스트 요청 접수와 실제 채널 수신은 서로 다른 결과다. 저장한 정책은
실제 외부 발송에 적용되지 않으며 테스트 요청은 접수(202)까지만 제공된다.

Backend는 수거 임계율을 5에서 100, 사전 알림 임계율을 0 이상이며 수거 임계율보다
5%p 이상 낮은 값으로 검증하고 위반은 422로 거절한다. 사전 알림 표시를 꺼도 같은
조합 조건을 적용한다. Frontend는 같은 범위를 먼저 검사하고 서버의 422, 412와 428을
기존 저장값을 유지한 채 안내한다. 수신 대상은 이름과 소속을 비울 수 없고 채널은 중복 없이
1개 이상이어야 한다. 전화번호 삭제는 `phone: null`이다. 현재 수신 정책 패널은 이름과
연락처를 편집하지 않는다.

Frontend 책임은 중복 요청 방지, 같은 설정 resource의 두 저장 직렬화, 요청 실패와 충돌
안내, 필수 입력 및 채널 검증, 응답값 적용과 늦은 응답 차단이다. 테스트 요청 성공 후
종 목록을 재조회하되 후속 조회 실패를 테스트 접수 실패로 바꾸지 않는다.
