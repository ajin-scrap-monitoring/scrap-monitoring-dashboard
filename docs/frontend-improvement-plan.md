# 프론트엔드 자체 개선 구현 계획

## 목적과 범위

확인된 서비스 계약을 유지하면서 프론트엔드의 오류 처리, 자원 정리와 검증 재현성을
개선한다. 구현 대상은 6개 작업 묶음이며, 마지막 단계에서 전체 변경을 검증하고 리뷰한다.
Backend, Camera Media Service와 Edge Platform의 코드 변경이나 실제 장비는 필요하지 않다.
실제 서비스 검증에는 고정된 소스와 image registry에 접근할 수 있는 네트워크가 필요하다.

제품 범위는 [프로젝트 명세](project-spec.md), 현재 기술과 실행 환경은
[구현 정보](implementation.md), 데이터 의미와 외부 서비스 revision은
[실제 서비스 연동 계약](contracts/backend/README.md)을 따른다.
테스트 입력은 synthetic data이며 실제 적재율 산출 능력이나 현장 정확도를 나타내지 않는다.

기존 React, TypeScript, Vitest, Testing Library, Playwright와 Docker 환경을 사용한다.
새 제품 의존성, 측정 로직, 운영 인증 정책과 배포 환경값은 추가하지 않는다.
구현 결과만 구현 정보와 계약 문서에 반영하고, 진행 상태나 작업 일지는 이 계획에 추가하지 않는다.
원격 반영은 별도 승인 대상이다.

## 개선 범위와 완료 조건

Application Programming Interface (API), Motion JPEG (MJPEG), Server-Sent Events (SSE)와
Continuous Integration (CI)를 기준으로 다음 6개 항목을 구분한다.

| 항목 | 구현 경계 | 완료 조건 | 우선순위 |
| --- | --- | --- | --- |
| FE-01 영상 parser와 연결 수명 | [parser](../src/components/mjpeg-client.ts)와 [영상 컴포넌트](../src/components/MjpegVideo.tsx) | chunk 분할과 무관한 크기 제한, timeout과 decode 및 자원 정리 회귀 테스트 | 최우선 |
| FE-02 v2 상태와 인증 흐름 | [adapter](../src/data/monitoring-v2.ts), [공통 현황 화면](../src/pages/MonitoringPage.tsx)과 [browser fixture](../e2e/backend-api.ts) | 외부 서비스 없이 전체 v2 상태와 오류 및 복구 흐름 재현 | 높음 |
| FE-03 녹화 상태 전이와 조회 취소 | [녹화 화면](../src/pages/RecordingsPage.tsx)과 [목록 조회 수명](../src/use-latest-request.ts) | 녹화 처리 상태와 늦은 응답 격리, 이력 및 녹화 목록 조회 취소 | 높음 |
| FE-04 계약 검사와 생성 재현성 | [manifest](contracts/backend/manifest.json), [추출기](../scripts/backend-contract.ts)와 [계약 설정](../redocly.yaml) | 실제 계약 타입 경계와 snapshot 재생성 및 검사 자동화 | 높음 |
| FE-05 최소 화면 너비와 키보드 | [브라우저 설정](../playwright.config.ts), [v2 테스트](../e2e/backend-api.spec.ts)와 [실제 서비스 테스트](../integration/services.spec.ts) | 최소 너비 1280을 포함한 키보드 및 레이아웃 검사 | 보통 |
| FE-06 실제 서비스 CI와 실패 진단 | [CI workflow](../.github/workflows/ci.yml), [서비스 runner](../scripts/verify-service-integration.sh)와 [artifact 정제](../scripts/integration-artifacts.ts) | 격리된 서비스 검증 자동화, 취소 및 실패 정리, 안전한 진단 산출물 | 높음 |

## 항목별 구현 계획

### FE-01 영상 parser와 연결 수명

수정 대상은 `src/components/mjpeg-client.ts`, `MjpegVideo.tsx`와 해당 테스트다.
`MjpegVideo.test.tsx`는 컴포넌트 연결 수명을 검사한다.

1. header delimiter 발견 여부와 관계없이 header 크기를 검사하고, 초과 입력은 frame 전달 전에 거부한다.
2. stream과 fetch를 제어하는 fixture로 parser의 timeout, 취소와 오류 경계를 검증한다.
3. fake timer와 Blob URL (Uniform Resource Locator) 검사로 컴포넌트의 재연결과 cleanup을 검증한다.
4. 재현 테스트가 실패하는 자원 정리나 상태 처리만 수정한다.

| 검증 입력 | 완료 조건 |
| --- | --- |
| 같은 header의 단일 및 여러 chunk 전달, 크기 제한 직전과 직후 | chunk 분할과 무관한 허용 여부, 제한 초과 시 frame 미전달 |
| 잘못된 boundary, Content-Type, Content-Length와 JPEG (Joint Photographic Experts Group) 시작 및 종료 marker | 명시적 오류, 불완전한 frame 미전달 |
| 최초 frame 미수신과 다음 frame 중단 | 현재 timeout 적용, 마지막 frame 숨김, 연결 오류 표시 |
| 자동 재연결 실패와 수동 재시도 | 제한된 자동 재연결, 종료 뒤 수동 재시도 동작 |
| HTTP (Hypertext Transfer Protocol) 401 및 403 | 로그인 이동, 영상 자동 재연결 중단 |
| URL 변경, 화면 종료, 확대 전환과 React StrictMode | 이전 요청 취소, timer 제거, 생성한 Blob URL 회수, 종료한 연결의 늦은 frame 무시 |

JPEG decode 실패도 브라우저에서 재현하고, 표시할 수 없는 이미지에 LIVE 상태가 남는 경우
연결 오류로 처리한다. 정상 frame 이후의 복구 동작까지 검사한다.

### FE-02 v2 상태와 인증 흐름

수정 대상은 `src/data/monitoring-v2.ts`, `http-dashboard-data-source.ts`,
`monitoring-v2.test.ts`, `use-dashboard-data.test.tsx`와 `src/pages/MonitoringPage.tsx`다.
공통 현황 컴포넌트 테스트와 browser fixture를 사용한다.

1. `src/test/backend-contract-fixtures.ts`에 실제 생성 타입을 따르는 상태별 fixture를 구성한다.
2. 기존 v1 제안 fixture와 구분되는 v2 HTTP 및 SSE browser fixture를 사용한다.
3. adapter, 화면과 브라우저에서 같은 상태 전이의 서로 다른 책임을 검사한다.
4. 계약 위반 입력과 종료한 구독의 응답이 현재 화면에 적용되지 않도록 필요한 guard를 보강한다.

| 검증 입력 | 완료 조건 |
| --- | --- |
| 모든 dataState, 유효한 0% 및 소수 적재율, 결측값 | 계약에 맞는 값과 상태 표시, v1 또는 synthetic 값으로 보충하지 않는 동작 |
| 유효하지 않은 적재율, 다른 pit, 다른 schemaVersion, 잘못된 JSON (JavaScript Object Notation) 및 필수 구조 누락 | 잘못된 값 미적용, 초기 조회 오류 표시, SSE handler 예외의 화면 전파 방지 |
| SSE 연결 오류와 같은 snapshotId의 재수신 | 연결 오류 동안 적재율 숨김, snapshot 재수신 후 연결 상태 복구 |
| 재연결 중 session 조회 지연 및 네트워크 오류 | 중복 session 조회 억제, 네트워크 오류를 인증 만료로 오인하지 않는 동작 |
| 초기 401, 조회 중 401, session.expired와 구독 종료 후 응답 | 로그인 이동, 구독 종료와 늦은 상태 갱신 차단 |
| assessment 또는 장비 snapshot 부재, 긴 reason code와 sensor 목록 | 기존 화면 영역 유지, 미제공 값과 실측의 구분, 상세 정보의 접근 가능성 |

실제 SSE transport와 session Cookie 연동의 증거는 서비스 통합 테스트로 유지한다.
제어 가능한 browser fixture는 클라이언트 오류 및 상태 전이 검사에 사용한다.

### FE-03 녹화 상태 전이와 조회 취소

수정 대상은 `src/pages/RecordingsPage.tsx`, `HistoryPage.tsx`, `Pages.test.tsx`,
`src/data/dashboard-data-source.ts`, `http-dashboard-data-source.ts`와 adapter 테스트다.

1. `queryHistory`와 `queryRecordings` 인터페이스의 선택적 AbortSignal을 사용한다.
2. 화면 종료 및 후속 조회 시 이전 요청을 취소하고, 취소 상태와 녹화 요청 식별자로 늦은 응답의 적용을 차단한다.
3. 녹화 단건 polling, 선택 변경, 새로고침과 다운로드 재조회를 검사한다.
4. 재생 및 다운로드 가능 여부가 최신 단건 응답을 따르도록 재현된 오류를 수정한다.

| 검증 입력 | 완료 조건 |
| --- | --- |
| collecting 또는 processing에서 ready 및 failed 전환 | 처리 중 접근 경로 미노출, ready 응답 뒤 재생 허용, 종료 상태 뒤 polling 중단 |
| 선택 변경, 목록 재조회, 새로고침과 화면 종료 | 이전 polling과 요청 취소, 이전 영상 및 다운로드 경로 미적용 |
| A에서 B 선택 후 A 재선택, 역순 단건 응답 | 최신 선택과 확인 요청에 해당하는 응답만 적용 |
| 다운로드 재조회 중 deleted 및 expired 전환, HTTP 404 및 410 | anchor click 차단, 접근 불가 안내와 새로고침 동작 |
| 조회 실패, 취소 뒤 늦게 완료하는 data source | 조회 실패 시 기존 결과 유지, 취소 시 오류 안내와 상태 갱신 미발생 |
| 녹화 nullable metadata, 부분 저장과 여러 gap | 결측값 보존, 재생 가능 여부 및 누락 구간 표시 |

테스트는 실제 파일 전송 성공과 메타데이터 접근 확인을 구분한다. frontend fixture는
anchor click과 경로 선택을 검사하고 실제 다운로드 및 Range 응답은 서비스 통합에서 검사한다.

### FE-04 계약 검사와 생성 재현성

수정 대상은 `package.json`, `src/data/http-dashboard-data-source.ts`, 생성 타입을 사용하는
fixture와 `docs/contracts/backend/`다. snapshot 추출 및 검사 스크립트를 사용한다.

1. 실제 Backend 호출에는 `backend-contract.ts`의 타입을 사용하고 제안 모드에는 제안 타입을 유지한다.
2. 공통 변환을 공유하는 부분은 타입 호환성을 검사하여 실제 계약 변경을 제안 타입이 가리지 않게 한다.
3. 고정 revision과 추출 경로 목록을 machine-readable 정본으로 관리하고 통합 스크립트가 이를 읽게 한다.
4. 실제 Backend OpenAPI 입력에서 선택 경로와 참조 schema를 재귀 추출하고 일정한 순서로 출력한다.
5. 읽기 전용 비교와 명시적 갱신을 구분하며, 통상 검증은 추적된 snapshot과 생성 타입을 변경하지 않는다.
6. `contract:check`에서 실제 OpenAPI의 문법 및 참조를 검사하고 추출기의 단위 테스트를 실행한다.

| 검증 입력 | 완료 조건 |
| --- | --- |
| 같은 고정 Backend의 OpenAPI를 반복 추출 | 동일한 snapshot과 생성 타입, 불필요한 diff 부재 |
| 선택 경로 누락, schema 참조 누락과 schema 변경 | 비정상 종료와 변경 위치 식별 |
| 실제 타입과 제안 타입의 차이 | 실제 호출에서 컴파일 또는 계약 검사 실패, 제안 검증의 독립성 유지 |
| 고정 revision 불일치와 dirty source checkout | 통합 실행 전 실패, 임의 checkout 또는 외부 작업 트리 수정 금지 |

외부 revision 갱신이나 계약 확정은 이 항목에 포함하지 않는다. 실제 OpenAPI에서 제공되지
않는 인증 강제 규칙이나 SSE event ID를 생성물에 추가하지 않는다.

### FE-05 최소 화면 너비와 키보드

수정 대상은 `playwright.config.ts`, v2 browser 테스트, `integration/services.spec.ts`,
필요한 화면 컴포넌트와 `src/App.css`다.

1. 1280 x 900, 1440 x 900과 1920 x 1080 Chromium 검증을 실행한다.
2. FE-02의 fixture로 v2 상태별 화면과 영상 오류 및 재시도 화면을 검사한다.
3. 영상 확대 dialog의 Tab, Shift+Tab, Escape와 닫기 후 focus 복원을 검사한다.
4. 실제 서비스 테스트에서 1280 너비의 v2 및 녹화 화면을 검사한다.
5. 수평 overflow, card 잘림과 footer 겹침이 재현되는 위치만 수정한다.

완료 조건은 모든 대상 너비에서 주요 정보와 제어 요소가 가려지지 않고, 긴 식별자 및
reason code와 여러 녹화 gap을 읽을 수 있으며, dialog를 키보드로 열고 닫을 수 있는 상태다.
동적 연결 및 오류 안내에는 접근 가능한 이름과 status 또는 alert 의미를 검사한다.
새 Chrome 최소 버전, 모바일 지원과 screenshot 기준 이미지 정책은 결정하지 않는다.

### FE-06 실제 서비스 CI와 실패 진단

수정 대상은 `scripts/verify-service-integration.sh`, `integration/compose.yaml`,
`playwright.integration.config.ts`, `.github/workflows/ci.yml`과 진단 검사 테스트다.
OCI (Open Container Initiative) 산출물 검증을 위한
`scripts/verify-container-integration.sh` wrapper를 사용한다.

1. CI 및 container job과 Ubuntu 24.04 host의 별도 서비스 통합 job을 유지한다.
2. 기존 Pull Request (PR) 및 main push trigger에서 동일한 통합 명령을 실행하고 Docker 및 Compose 최소 버전을 검사한다.
3. 임시 자격 증명과 격리된 Compose project를 유지하며 운영 secret, 외부 장비와 host port를 사용하지 않는다.
4. service readiness, 테스트 실행과 cleanup의 대기 상한을 설정하고 EXIT, INT 및 TERM 종료 경로를 검사한다.
5. job timeout과 취소를 명시하고 실패한 테스트를 성공으로 처리하는 설정을 사용하지 않는다.
6. screenshot과 정제한 결과 요약만 별도 공개 artifact 디렉토리에 수집하고 원본 로그는 비공개로 유지한다.
7. 정상, 강제 실패, 중단 및 반복 실행의 종료 코드와 project 자원 정리를 검사한다.
8. 기본 이미지, Transport Layer Security (TLS)와 reverse proxy 검증의 host 도구 의존성을 검증 컨테이너로 옮기고 기존 CI와 같은 검사를 실행하는 wrapper를 제공한다.

| 경계 | 구현 조건 |
| --- | --- |
| 실행 권한 | `contents: read`, checkout 자격 증명 미보관, 외부 Action의 전체 commit SHA (Secure Hash Algorithm) 고정 |
| 배포 | image 게시와 Release 실행 제외 |
| 실행 격리 | 고정 source revision, 실행마다 분리된 project 및 volume, 자체 생성한 자원만 정리 |
| 검증 도구 | Node.js, curl과 OpenSSL을 포함한 검증 컨테이너, 내부 Docker 명령의 host 경로 및 daemon 접근 검사 |
| 오류 보존 | 테스트의 비정상 종료 코드 보존, cleanup 오류의 별도 식별 |
| 중단 복구 | 실행한 project 식별자와 종료 절차 제공, SIGKILL 등 trap 실행 불가 종료의 별도 회수 경로 |
| 공개 artifact | 비밀번호, token, Cookie, CSRF (Cross-Site Request Forgery) 값과 원본 Playwright trace 제외, 정제 검사를 통과한 파일만 업로드 |
| 보관 | Organization 보관 한도 안의 `retention-days: 7`, 기존 실행 결과와 섞이지 않는 디렉토리 |

서비스 readiness 상한은 Docker Compose의 `--wait-timeout`을 사용한다.
[Docker Compose 명령 문서](https://docs.docker.com/reference/cli/docker/compose/up/)를 따른다.
job 권한, timeout과 취소는
[GitHub Actions workflow 문법](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)을
사용한다. artifact의 보관 기간 지정은
[GitHub Actions artifact 문서](https://docs.github.com/en/actions/tutorials/store-and-share-data)를 따른다.

로컬 완료 조건은 같은 명령의 반복 성공, 강제 실패의 비정상 종료, 생성한 자원의 정리와
진단 산출물의 비밀값 미포함이다. GitHub runner에서의 실제 성공 여부는 원격 반영 승인 뒤
확인하며 로컬 검증으로 대체하지 않는다.

## 구현 순서

구현은 4단계로 진행한다. FE-04의 계약 경계를 먼저 마련하고, 클라이언트 검증 결과를
화면 및 실제 서비스 CI로 확장한다.

| 단계 | 작업 | 입력 | 완료 조건 |
| --- | --- | --- | --- |
| 1. 계약 검사와 영상 결함 | FE-01, FE-04 | 현재 고정 계약과 header 제한 재현 | 실제 계약 검사 재현, 영상 parser 결함 회귀 테스트 통과 |
| 2. 상태 전이와 조회 수명 | FE-02, FE-03 | 단계 1의 계약 타입과 영상 fixture | 외부 서비스 없는 정상 및 오류 전이 테스트 통과 |
| 3. 브라우저와 서비스 자동화 | FE-05, FE-06 | 단계 2의 화면 fixture와 로컬 통합 명령 | 대상 너비 및 키보드 검사, 서비스 검증 반복 성공과 실패 cleanup 확인 |
| 4. 전체 검증과 리뷰 | 전체 변경 및 정본 문서 반영 | 앞 단계의 코드와 테스트 | 전체 검사 통과, Codex와 agy 리뷰 지적 해소 및 수정 후 재검증 |

각 단계는 실패하는 재현 테스트, 필요한 수정, 회귀 검증 순서로 진행한다. 테스트만으로
기존 동작이 확인되는 항목은 불필요한 제품 코드 변경을 하지 않는다.
작업 중 기존 사용자 변경을 보존하고 branch 전환, commit, push와 Issue 및 PR 생성은
원격 반영 결정과 별도로 승인된 범위에서만 수행한다.

## 검증과 리뷰

검증은 저장소 루트에서 컨테이너로 실행한다. 전체 검사, production runtime과 실제 서비스의
실행 및 회수 절차는 [구현 정보](implementation.md#개발과-검증-컨테이너)를 따른다.
host에 Node.js, pnpm이나 OpenSSL을 설치하지 않는다.

서비스 검증은 성공 실행 뒤 새로운 project로 재실행한다. 실패 및 중단 검사는 테스트가
만든 project를 대상으로 수행하고 기존 컨테이너나 volume을 종료하지 않는다.
산출물 검증 wrapper도 실행별 이름으로 만든 container, network, volume과 image를 회수한다.
개발 및 verification volume의 종료와 회수는 기존 실행 절차를 유지한다.

리뷰 대상은 제품 코드, 테스트, 계약 snapshot 및 생성 타입, Docker와 Nginx 설정,
shell script, workflow와 문서다. Codex와 agy가 각 대상 영역을 검토하고 오류 위치,
재현 조건과 사용자 영향을 기준으로 지적을 구분한다. 큰 변경은 영역별로 나누어도 전체
파일 목록과 리뷰 범위가 대응되어야 한다.

리뷰 timeout이나 답변 부재는 통과가 아니다. 지적을 수정하면 해당 영역의 재리뷰와 회귀
검증을 수행하고, 남은 외부 미확정 사항을 구현 결함과 구분해 인계한다.
리뷰 결과와 다음 행동은 현재 작업 요청 또는 승인된 Issue 및 PR에서 관리한다.

## 외부 결정이 필요한 제외 항목

다음 5개 경계는 자체 개선의 완료 조건에 넣지 않는다.

| 경계 | 필요한 결정 또는 입력 | 담당 범위 |
| --- | --- | --- |
| 실제 측정과 판단 | 적재율 산출, calibration과 현장 정확도 | Edge 및 측정 담당자 |
| 운영 인증과 요청 보호 | 계정 제공, session 정책, v1 관리자 API의 역할 및 CSRF 검사 | Backend 및 운영 담당자 |
| 제품 기능 확장 | v2 이력과 예측 및 알림, 다중 pit 및 camera, 수동 clip과 보관 정책 화면 | 제품 및 해당 서비스 담당자 |
| 운영 환경과 호환성 | 실제 Chrome 버전, upstream 및 TLS 값, 현장 네트워크와 hardware | 운영 및 배포 담당자 |
| 원격 반영 | Issue 및 PR 대응, 원격 main 반영, GitHub runner 실행과 필수 검사 지정 | 작업 요청자 및 Repository 관리자 |

이 결정들은 [외부 연동 계약 절차](contracts/README.md)와
[구현 결정 상태](implementation.md#제품-구현-결정-상태)에서 관리한다.
FE-01부터 FE-06까지의 로컬 구현은 이 결정 없이 진행할 수 있다.
