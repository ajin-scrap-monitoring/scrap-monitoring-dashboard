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
| `FE-DATA-01` | `monitoring.camera-status` SSE 이벤트 | 수신한 상태와 프레임 수신 시각 및 사유 코드 연결, [카메라 상태](#카메라-상태)의 유효 기한 적용 |
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

Backend 기준은 manifest의 revision이다. 현황 보조 조회는 5개(`fill-forecast`,
`collection-summary`, `profiles`, `snapshot-with-alerts`, `layout`)이며, 수거 요약, 예상 도달,
활성 알림과 배치는 60초 간격으로 갱신하고 LiDAR 단면(`profiles`)은 약 1초 간격으로 갱신한다.
활성 알림 조회 실패는 활성 알림 영역의 오류로 표시하고 나머지 보조 조회 실패는 해당 값만
정보 없음으로 표시한다. 401과 403은 숨기지 않는다.

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
| LiDAR 1, LiDAR 2 | `/api/v2/monitoring/profiles` | 변환 사용 | 화면 활성 중 약 1초 간격 갱신, 이전 스캔 교체, [LiDAR 높이 곡선](#lidar-높이-곡선) |
| 활성 알림 | `/api/v2/monitoring/snapshot-with-alerts` | 변환 사용 | [활성 알림](#활성-알림) |
| 센서 상태 | `deviceStatus.snapshot.sensors` | 변환 사용 | `lidar-a`는 LiDAR 1, `lidar-b`는 LiDAR 2로 표시하며 원래 ID와 상태 보존, scan 시각으로 latency를 추정하지 않음 |
| 엣지 및 카메라 상태 | `connection_state`, `effective_state`, `monitoring.camera-status` | 변환 사용 | 엣지는 snapshot의 보고 상태, 카메라는 [카메라 상태](#카메라-상태)의 독립 관측 사용 |
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

### 카메라 상태

앱 공용 `/api/v2/monitoring/events?pit_id=...&include_camera_status=true` SSE의
`monitoring.camera-status` 이벤트를 사용한다. 카메라 상태 GET과 장애 중 대체 GET은 보내지 않는다.
상태는 HEALTHY 정상, INTERRUPTED 수신 중단, UNKNOWN 확인 불가, UNSUPPORTED 미지원이다.
`lastFrameReceivedAt`은 프레임 수신 시각이며 연결 상태와 사유 코드를 함께 표시한다.
유효 기한은 단조 시계의 수신 시각에 `min(validForSeconds, 5)`초를 더한 시각이다.
`validForSeconds`가 없거나 0이면 즉시 확인 불가이며 이벤트가 끊겨도 기한을 연장하지 않는다.
같은 상태의 새 이벤트는 수신 기한을 갱신한다. 첫 카메라 이벤트를 받기 전에는 snapshot의 카메라
service 상태를 표시한다. 카메라 관측은 LiDAR 측정 시각과 독립적이다.

### 1시간 전 적재율

최근 24시간 이력에서 같은 source의 과거 관측을 선택한다. 기준 시각은 snapshot의
`serverTime`과 이력 조회 종료 시각 중 늦은 값이며 브라우저 시각을 사용하지 않는다.
기준의 1시간 전부터 이전 60초 이내에서 가장 가까운 `observedAt`을 선택하고, 선택한 표본이
무효이거나 `generatedAt` 또는 `observedAt`이 없으면 더 이전 표본으로 대체하지 않고 정보
없음으로 표시한다. 조회 범위 밖, 조건에 맞는 표본 부재와 이력 조회 실패도 정보 없음이다.
현재 적재율의 역산, v1 변화량이나 수거량 추정으로 보충하지 않는다.

## 적재율 추이

현황의 최근 24시간과 이력 그래프는 `/api/v2/monitoring/load-history`에 `view=chart`를 전달해
조회한다. `bucket_seconds`는 전달하지 않고 서버의 자동 간격 선택(60, 300, 900, 3600, 7200, 21600,
86400초)을 사용한다. 한 요청의 범위는 최대 90일이며 표본 상한은 1,441개다. 구간 수는
`ceil(to/간격) - floor(from/간격)`이고 양 끝 구간은 요청 범위로 잘린다. 90일 조회는 서버 처리 상한 20초에
도달할 수 있으므로 이 요청만 25초 timeout을 사용하고 조회 중 안내를 표시한다.

응답 `view`가 `"chart"`이면 표본의 `assessmentId`, `observationId`, `methodVersion`을 요구하지
않으며 결과 metadata에 `assessmentId` key를 만들지 않는다. 응답 `view`가 없거나 `"full"`이면
세 필드를 요구하고 metadata에 `assessmentId`를 포함한다. 그 외의 `view` 값은 계약 오류로 거절한다.
시각, 구간 경계, 값 범위, `valid`, `dataState`, `reasonCodes`, `inputSource`, `valuePolicy`,
`simulated`, 표본 수 검사는 두 형식에 동일하게 적용한다. 서버가 compact 모드로 응답하면 유효한
표본의 `generatedAt`과 `observedAt`이 null일 수 있다. 이 표본은 bucket 위치로 표시하고 시각을
만들어 채우지 않는다. 응답의 `inputSource`, `valuePolicy`와 `simulated`는 보존한다. 값이 있는
표본이 모두 `simulated=true`이면 "시뮬레이션", 일부만 true이면 "시뮬레이션 포함"을 그래프 왼쪽 위와
그래프 접근성 이름에 표시한다.

유효한 0%는 보존하고 결측(null)과 `valid=false`는 선을 연결하지 않는다. 이전 값으로 채우지
않으며 전체 범위 재조회 방식을 유지한다. 90일을 넘는 기간은 요청 전에 안내하고 요청하지 않는다.
422 `HISTORY_*` 코드와 503 `HISTORY_QUERY_TIMEOUT`은 빈 그래프나 0% 대신 이력 화면에서 안내 문구로,
현황 그래프에서 오류 상태로 표시하며 자동 재시도하지 않는다. 현재 임계율은 참고선이며 과거에
적용된 임계율이 아니다.

## 표시 시간대

화면의 시각은 `Asia/Seoul`(+09:00)로 고정해 표시하고 브라우저 시간대를 따르지 않는다.
요청 파라미터는 offset을 포함한 ISO 8601을 유지하며 서버가 준 UTC 원본은 변환 없이
보존한다. 시각 문자열에 시간대가 필요한 위치는 `(한국 표준시)`를 덧붙인다.

## 오류 응답

Backend 오류 본문은 `{detail: 문자열}`, `{detail: [{loc, msg, type}]}` 그리고 미디어의
`{error: {code, message}}`의 3가지다. 대문자 코드형 `detail` 문자열은 코드로도 사용한다.
요청 검증 오류 배열의 `loc`과 `type`은 관리자 설정의 입력 영역에 대응시켜 해당 영역에
안내하고 대응이 없으면 폼 단위 안내를 표시한다. 422 검증 배열 중 `type=alert_threshold_gap`,
`loc=["body","preCollectionAlert","thresholdPercent"]`는 사전 알림 임계율 입력 칸의
오류로 연결하며, 문구는 `ctx.minimumGap`과 `ctx.collectionThresholdPercent`로 구성한다
(예: "사전 알림 임계율은 수거 임계율 85%보다 최소 5%p 낮아야 합니다."). 해당 입력 칸에
`aria-invalid`와 오류 스타일을 적용한다. 412와 428은 새로고침 안내를 표시한다.

## LiDAR 높이 곡선

`/api/v2/monitoring/profiles`의 `sensorId`가 `lidar-a`이면 LiDAR 1, `lidar-b`이면 LiDAR 2
카드에 연결한다. 이 대응은 현행 장비 상태와 같은 규칙이며 응답이 제공하는 값이 아니다.
각 profile의 `samples`는 필수 배열이며 누락이나 null이면 계약 오류로 처리한다.
`samples=[]`는 표본 없음 상태로 두고 빈 피트나 높이 0으로 바꾸지 않는다.
높이는 cm를 m로 한 번 변환하고 `positionRatio`는 0 이상 1 이하의 위치로 사용한다.
평균은 `SCAN_MEAN_TEMPORAL_MEDIAN` 기준이면 `filteredAverage`, 아니면 `average`다.
`valid=false`, 높이 또는 위치가 null인 표본은 선을 끊는다. 관측 범위는 `positionRatio`가 null이
아닌 표본의 최솟값~최댓값이다. 가로축의 [0, 최솟값)과 (최댓값, 1] 구간은 미측정 영역으로 옅은
회색 음영을 렌더링하고 음영 폭이 약 24px 이상이면 가운데에 "미측정" 글자를 표시한다. 음영의
title과 그래프의 SVG aria-label에 미측정 구간 비율(예: "미측정 A 0%~13%")을 넣는다. 위치가 있는
표본이 없으면 전체를 미측정으로 처리하고 `samples=[]`는 표본 없음 상태로 둔다. 원래 높이값,
cm에서 m 변환, 세로축 0~10m 범위, A와 B 위치는 변경하지 않는다. `simulated`와
`calibrationState`가 실측을 보증하지 않으면 시뮬레이션 또는 미검증으로 표시한다.
`lidar-a`는 LiDAR 1, `lidar-b`는 LiDAR 2에 대응한다. `positionRatio` 0 -> 1이 측정선
A -> B이며 그래프 왼쪽 -> 오른쪽이다. 임의로 반전하지 않는다. 이 방향은 Backend가
확인했다. 측정 영역 카드는 기존 그림을 유지하고 layout 응답은 배치 상태 표시에만 쓴다.

## 활성 알림

`/api/v2/monitoring/snapshot-with-alerts?pit_id=...&scope=ALL`의 `activeAlerts`는 적재율 경보 항목(`pre_collection_alert`,
`collection_required`)과 장비 항목(`device_error`, `measurement_error`)의 합집합을 제공한다.
장비 항목의 `componentKind`에 `CAMERA`, `evidenceSource`에 `MEDIA_CAMERA_STATUS`를 허용하며
카메라 항목 이름은 "카메라"다. 항목과 coverage의 선택 필드 `validUntilAt`, coverage의
`evaluatedAt`, `evidenceSource`를 허용하고 보존한다. `coverage`는 필수 배열이며 누락이나
null이면 계약 오류로 처리한다.

결합 응답의 `snapshot`과 `activeAlerts`를 같은 근거로 사용한다. `snapshot.pitId`와 source의
site 및 edge가 현재 monitoring scope와 같고 `snapshot.snapshotId === activeAlerts.basis.snapshotId`와
`snapshot.serverTime` 및 `activeAlerts.computedAt`의 같은 시각이 성립해야 한다. 위반하면 활성 알림
영역을 오류로 처리한다. 활성 알림 카드와 판정 비교는 결합 응답의 snapshot만 사용하며, 적재율과
장비 상태는 SSE snapshot을 사용한다. 결합 응답의 두 판정이 다르면 기존 보조 문구와 상세 title을
표시한다. `basis.measuredAt`은 "적재율 판정 근거 측정 시각"이며 카메라 항목은 자기
`evaluatedAt`을 사용한다.

결합 조회는 현황 상세 갱신(60초)과 함께 실행한다. 현황 상세가 활성이고 화면이 보일 때 SSE의
`operations.effectiveState`가 마지막 결합 응답의 판정과 다르면 결합 조회만 즉시 요청한다. 동시에 한 요청만 진행하고 강제 조회 시작 간격은
최소 5초다. collection-summary, fill-forecast, profiles와 layout은 이 조건으로 요청하지 않는다.
SSE 재연결 중에는 활성 알림 항목을 숨기고 연결 복구 뒤 다시 표시한다고 안내한다.

`evaluationState`가 `UNKNOWN` 또는 `ERROR`이면 "적재율 판정 불가"로 표시하고,
`basis.lastKnownState`가 있으면 "마지막 판정 NORMAL" 같은 보조 표기를 붙인다.
카메라 중단의 `startedAt=null`, `startBasis=UNKNOWN`은 시작 정보 없음으로 둔다.
`startedAt`은 `startBasis`가 `SERVER_EVALUATION`일 때만 서버 최초 확인 시각으로 표시하고
그 외에는 시작 정보 없음이다. `evaluatedAt`은 판정 시각이며 경보 시작 시각이 아니다.
`coverage`는 구성 요소별 `CHECKED`, `UNKNOWN`, `UNSUPPORTED`를 알린다. `UNKNOWN`과
`UNSUPPORTED` 구성 요소는 확인 불가 항목으로 같은 카드의 같은 페이지 방식에 표시하며
건수에 포함하지 않고 `N건 / 확인 불가 M`으로 구분한다.

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
| 날짜 녹화 | `/api/v2/recordings/daily` 목록(`view=summary`), 단건 상세(`view=full`), `exports` | 변환 사용 | 목록은 `view=summary` 요약(`gap_count`, `available_interval_count`)과 `has_gaps` 기반 tone 계산, 선택 시 단건 상세로 구간 배열(`gaps`, `available_intervals`) 수신 후 timeline 및 재생 확정, HLS 재생, 지난 날짜의 MP4 준비 |
| 날짜 녹화 삭제 | `DELETE /api/v2/recordings/daily/{recording_id}` | 직접 사용 | 관리자 전용, 확인창, CSRF |
| 이벤트 녹화 목록 | `/api/v2/recordings/events` | 변환 사용 | `stable=true`, `pageSize=50` 고정, `snapshot_token` 기반 페이징, `snapshotExpiresAt`과 `asOf` 차이 기반 로컬 만료 계산 및 ensure당 합산 1회 재시작 제한, `occurredAt` 내림차순 정렬, `include_playback=true`의 `playback` 요약(`UNKNOWN` 포함, 길이 null은 정보 없음) |
| 이벤트 구간 재생 | `/api/v2/recordings/events/{event_id}`의 `parts` | 변환 사용 | 날짜 녹화 HLS를 구간별로 이어서 재생 |
| 시작, 종료, 길이, 형식 | 이벤트 상세 | 변환 사용 | 길이는 `playbackSeconds`, 형식은 HLS |
| 보관 만료 | 날짜 녹화의 `expires_at`, `status` | 변환 사용 | `status`가 deleted 또는 expired면 "삭제됨" 또는 "만료됨" 표시, 이벤트는 `parts`의 날짜별 요약 목록(`view=summary`)에서 찾은 모든 날짜 녹화 중 가장 빠른 만료를 사용하며 하나라도 확인하지 못하면 정보 없음 |
| codec, 해상도, frame rate | `/api/v2/recordings/daily/{recording_id}/media-info`, `/api/v1/media/clips/{clip_id}/media-info` | 직접 사용 | 날짜 녹화는 file 정보와 segments(상세 창/title), 이벤트는 export 완료 후 clip media-info 연동 |
| 이벤트 구간 용량과 MP4 | `GET/POST /api/v2/recordings/events/{event_id}/exports`, `GET statusPath` | 직접 사용 | 서버 조회 복구와 명시 준비 및 재시도, 응답 requestId 및 statusPath 사용 |
| 미리보기 썸네일 | `/api/v2/recordings/daily/{id}/thumbnail-info`, `/api/v2/recordings/daily/by-date/{recording_date}/thumbnail-info`, `/api/v2/recordings/events/{event_id}/thumbnail-info`, `/api/v1/media/clips/{clipId}/thumbnail-info` | 직접 사용 | 날짜 녹화(recording, finalizing, closed, failed이며 expired와 deleted 제외) 및 이벤트 녹화 썸네일 조회, 이벤트 녹화의 `dailyThumbnailInfoPath` 우선 조회 및 클립 미대체, ready 시 content_path 이미지를 기존 썸네일 자리와 재생 poster에 연결, `RECORDING_BUSY` 보류 폴링 재조회와 준비 버튼 미제공 |

날짜 녹화 목록은 `GET /api/v2/recordings/daily`에 `view=summary`를 전달해 요청하며
`next_cursor` 페이징 시에도 같은 파라미터를 유지한다. 목록 응답의 `view`가 `"summary"`이면
요약 parser를 사용하고, `gap_count`와 `available_interval_count`는 0 이상 정수여야 하며
`has_gaps`는 `gap_count > 0`과 같아야 한다. 요약 항목에 `gaps`나 `available_intervals`가
포함되면 계약 오류로 처리한다. `view`가 없거나 `"full"`이면 기존 parser로 구간 배열을 검증한다.
목록 단계의 `Recording.gaps`는 빈 배열 대신 undefined로 두고 tone은 `has_gaps`로 계산한다.
녹화 항목 선택 시 `GET /api/v2/recordings/daily/{recording_id}` 상세를 호출해 full 녹화로
교체하기 전에는 timeline, 누락 구간 버튼, 재생 버튼을 확정하지 않고 로딩 표시를 유지한다.
상세 수신 전에는 "누락 없음", "영상 없음", "전체 구간 확보"를 표시하지 않는다. 삭제, 다운로드
준비, 보관 만료와 cleanup 표시는 단건 상세 결과를 사용한다.

날짜 녹화는 `deleted_at`, `cleanup_state`(pending, failed, complete, null), `cleanup_completed_at`,
`cleanup_error`, `space_reclaimed`를 수신 및 보존한다. `status`가 deleted 또는 expired면
녹화 정보의 보관 만료에 `expires_at` 날짜 대신 "삭제됨" 또는 "만료됨"을 표시한다. 재생과 다운로드
불가 처리는 우선하며 삭제 뒤 남은 `export_state`를 다운로드 가능으로 해석하지 않는다. 녹화 상태
상세 창은 파일 정리 상태(pending: "파일 정리 중", failed: "파일 정리 실패" 및 오류 코드, complete:
"파일 정리 완료" 및 완료 시각, null: "정보 없음")를 표시한다. `space_reclaimed`는 숫자나 회수
완료로 표시하지 않는다.

이벤트 선택은 `GET /api/v2/recordings/events/{event_id}/exports`에 `before_seconds=30`과
`after_seconds=30`을 전달해 기존 작업을 복구한다. JSON null은 작업 없음, 404는 이벤트 없음이다.
조회 중에는 "확인 중" 버튼을 비활성화하고 404는 준비를 차단한다. 다른 조회 실패는 기존 작업
확인 실패를 알리고, 상세에 `exportPath`가 있는 이벤트만 명시 준비를 허용한다. 브라우저의 export
localStorage 기억은 사용하지 않는다.
조회, 진입과 재생만으로 POST를 보내지 않는다. 첫 준비와 deleted 및 expired의 새 준비는 새
UUID (Universally Unique Identifier), failed의 명시 재시도는 응답 `requestId`와
`retryFailed=true`를 사용한다. POST가 다른 requestId를 반환해도 응답 값을 이후 요청에 사용한다.
POST가 5xx나 네트워크 오류로 응답을 잃으면 기존 작업을 한 번 조회해 pending, collecting, processing 또는
ready 작업을 이어서 표시하고, 그런 작업이 없으면 오류를 안내한다.
`pending`, `collecting`, `processing`은 준비 중이며 응답 `statusPath`를 3초 간격으로 조회한다.
상태 조회가 5xx나 네트워크 오류로 실패하면 준비 중 표시를 유지하고 2초, 4초, 8초 간격으로 최대
3회 재시도한다. 조회 성공은 연속 실패 횟수를 초기화한다. 4xx 또는 재시도 소진은 오류를 안내하고
자동 조회를 중단한다. `ready`, `deleted`, `expired`, `failed`, `blocked`도 자동 조회를 중단한다.
`ready`이고 `downloadPath`가 있을 때만 다운로드한다. 선택, 계정, data source 변경과 화면 종료는
상태 조회와 재시도 timer를 취소하고 늦은 응답을 무시한다.

이벤트 녹화의 `downloadReasonCodes`에 `EVENT_RECORDING_UNAVAILABLE`을 허용한다. 진행 중인 export
작업이 없고 `exportPath`가 null이며 `downloadReasonCode`가 `EVENT_RECORDING_UNAVAILABLE`이면
"이 구간에 확보된 녹화 영상이 없어 구간 파일을 준비할 수 없습니다."를 표시하고 버튼을
"다운로드 불가"로 비활성화한다. 버튼 title에는 상세의 `reasonCodes`와 `unavailableIntervals`의
개수와 종류를 표시한다. 화면 진입, 선택, 재생으로 POST를 전송하지 않으며 `PARTIAL`, `PROCESSING`처럼
`exportPath`가 있는 상태의 준비 버튼과 진행 중이거나 준비된 export 작업 표시는 이 안내보다 우선한다.
ready이고 coverage가 partial인 파일의 "일부 구간 누락" 표시를 유지한다.

이벤트 구간 파일 준비 요청 실패와 상태 조회의 errorCode(failed, blocked)는 HTTP status보다
오류 code를 우선해 사용자 안내 문구로 변환한다. 알려진 오류 code(RECORDING_NOT_FOUND_IN_RANGE,
INSUFFICIENT_STORAGE, RECORDING_STORAGE_ERROR, CLIP_PREPARATION_FAILED,
RECORDING_BOUNDARY_UNAVAILABLE, EXPORT_INCOMPATIBLE_MEDIA, EVENT_EXPORT_NOT_FOUND,
EVENT_WINDOW_IN_FUTURE, MEDIA_UNAVAILABLE, MEDIA_TIMEOUT 등)는 정의된 code별 문구를 표시한다.
정의되지 않은 오류 code는 기존 HTTP status별 기본 문구를 표시하고 title에 해당 code를 남긴다.

이벤트 녹화의 `windowState`는 `CLOSED`, `OPEN`, `UNKNOWN`, `POINT`이며 목록은 구간 상태를,
상세는 `state`(`AVAILABLE`, `PARTIAL`, `PROCESSING`, `UNAVAILABLE`)를 상태 문구로 사용한다.
재생 위치는 이벤트 구간의 0초부터 `playbackSeconds`까지이며 `parts`의 `startSeconds`와
`endSeconds`는 해당 날짜 녹화 안의 위치, `relativeStartSeconds`와 `relativeEndSeconds`는
이벤트 재생 시간축의 위치다. 한 part가 끝나면 다음 part로 이동하고 마지막 part의 끝에서
정지한다. `unavailableIntervals`는 재생하지 않는 구간이며 하루 또는 이벤트 구간 전체가
녹화되었다고 가정하지 않는다. 날짜 녹화를 삭제하면 같은 날짜 영상을 쓰는 이벤트 구간도
재생할 수 없다. 이벤트 상세의 `unavailableIntervals` 또는 날짜 녹화의 `gaps`가 1개 이상이면
녹화 정보 카드의 누락 구간 버튼으로 녹화 범위 상세 창을 연다. 이벤트 창은 요청 구간(`windowFrom` ~
`windowTo`), 요청 길이, 확보 길이, 재생 길이와 각 구간의 시작 및 종료 시각, 종류(GAP,
UNCONFIRMED, FUTURE, MISSING, EXPIRED)와 `reasonCode`를 표시한다. 날짜 창은 녹화 날짜와
`gaps`의 시작 및 종료 시각과 `reason_code`를 표시한다.

## 추가 계약 요청

Backend와 Media Service에 전달할 요청 항목을 관리한다. 제공되지 않는 값은 0, 정상 또는 synthetic
값으로 보충하지 않는다.

미해결 요청은 다음 12개이며 ID는 Backend 회신에서 같은 번호로 추적한다. 해결된 요청은 이 문서의 화면별 연결 표에 반영한다.

| ID | 항목 | 책임 | 상태 |
| --- | --- | --- | --- |
| Q-1 | Media 응답 지연과 간헐 504(썸네일, 날짜 녹화 상세, media-info, 구간 파일 조회와 삭제) | Media Service, Backend | Backend 삭제 응답 복구 병합, 개발 서버 반영과 Media 원인 회신 대기 |
| Q-2 | 날짜 녹화의 짧은 누락 반복과 실시간 frame 공백 | Media Service | Media 회신 대기 |
| Q-3 | 구간 파일 조각 경계 공백의 집계 기준 | Media Service, Backend | 현재 기준 문서화, Media 허용 정책 대기 |
| Q-4 | 실시간 영상의 촬영 시각 | Media Service | 원천 미지원, 시각 계약 대기 |
| Q-7 | 녹화 파일 정보(codec, 해상도, frame rate)의 파일 완성 시점 값 | Media Service, Backend | 측정 시각 field 계약 대기 |
| Q-8 | 녹화 저장 위치와 저장 용량 정책 | Media Service, Backend | 기존 정책 설명 수신, 잔여 용량 API 없음 |
| Q-9 | 카메라 latency의 정의와 전달 | Media Service, Backend | 측정 정의 미확정 |
| Q-10 | 측정 영역의 실측 배치 | Backend, Edge | 실측 근거 대기 |
| Q-11 | 시뮬레이션 `lidar-b` 측정선 위치가 현장 기준과 다름 | Backend, Edge | 현재 좌표 근거 수신, LiDAR 계산 높이 자료 대기 |
| Q-12 | 알림 실제 발송 | Backend, 운영 | 발송 보류 |
| Q-13 | 운영 배포 환경 설정 | Backend, 운영 | 운영 결정 대기 |
| Q-14 | 미해결 요청의 담당과 예정 시점 | Backend | 담당 회신 수신, 목표 날짜 미정 |

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
Dashboard는 피트 설정(`PUT /api/v1/config/pits/{pit_id}`)을 호출하지 않으므로 해당 경로의 409 응답 추가는 화면 동작에 영향을 주지 않는다.
