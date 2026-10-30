# 검증 기준과 리뷰

## 문서 역할

이 문서는 검사 계층, 계약 생성 검증, 회귀 테스트, 빌드 예산과 검증 자원 회수의 정본이다.
개발 및 verification 컨테이너 실행은 [개발 환경](development.md#개발과-검증-컨테이너),
현재 기능은 [구현 정보](implementation.md), 외부 검증의 경계는
[실제 서비스 계약](contracts/backend/README.md#통합-검증)을 따른다.
테스트의 존재와 특정 실행의 통과 여부는 구분하며 실행 결과는 현재 작업 요청 또는
승인된 Issue와 Pull Request (PR)에서 관리한다.

## 정적 검사와 테스트 기준선

검증 계층은 7개다.

| 계층 | 도구 | 범위 |
| --- | --- | --- |
| 계약 검사 | snapshot 추출기, Redocly CLI와 openapi-typescript | manifest 일치, OpenAPI 문법 및 참조와 생성 타입 일치 |
| 정적 검사 | ESLint와 typescript-eslint | TypeScript 타입 기반 규칙, React Hooks와 Fast Refresh 경계 |
| 검증 도구 테스트 | Node.js test runner와 OpenSSL | 계약 추출, 공개 artifact 정제, runner 종료 및 cleanup과 TLS material 오류 거부 |
| 컴포넌트 테스트 | Vitest, jsdom과 Testing Library | `src/`의 렌더링, 상태와 사용자 상호작용 |
| 브라우저 테스트 | Playwright Chromium | synthetic data, 실제 v2 fixture와 v1 제안 API의 사용자 흐름 및 대상 뷰포트 렌더링 |
| 컨테이너 통합 테스트 | Docker, Nginx와 OpenSSL | OCI 이미지, reverse proxy, 임시 PKI와 TLS Secret 주입 |
| 실제 서비스 통합 테스트 | 고정한 Backend, Media Service, Edge와 Chromium | 실제 서비스의 계약 snapshot, 인증, 상태 갱신과 영상 사용자 흐름 |

`docs/contracts/backend/manifest.json`은 외부 source revision과 선택 경로의 정본이다.
`scripts/backend-contract.ts`는 해당 경로와 참조하는 component를 재귀 추출하고 key를 정렬해
일정한 JSON을 생성한다. 선택 경로 누락, 참조 누락과 외부 참조는 실패한다.
`contract:snapshot`의 기본 동작과 `--check`는 읽기 전용이며 local manifest 및 snapshot의
일치 여부를 검사한다. 실행한 Backend의 OpenAPI와의 비교는 실제 서비스 통합 검증에서
수행한다. `--write`는 명시한 입력이 있어야 snapshot을 갱신한다.

`redocly.yaml`은 실제 및 제안 OpenAPI와 각각의 생성 파일을 구분한다.
실제 Backend가 제공하지 않는 servers, security 선언과 license를 생성물에 추가하지 않고
해당 권장 규칙만 제외한다. 제안 계약에는 기존 권장 규칙을 유지한다.
`scripts/generate-api-contracts.ts`는 두 계약을 모두 처리하고 검사 중 생성 파일을 변경하지 않는다.
`redocly.yaml`은 API별 source, output과 생성 옵션의 정본이다. Backend의 `defaultNonNullable=false`는
OpenAPI의 optional default 입력을 보존하며 `emptyObjectsUnknown=true`는 미지정 object 속성을 허용한다.
두 옵션은 [openapi-typescript 생성 규칙](https://openapi-ts.dev/cli#flags)을 따른다.
`contract:generate`는 두 계약의 immutable TypeScript 타입을 명시적으로 생성하고 `contract:check`는
snapshot 검사, 두 OpenAPI lint와 생성 타입의 읽기 전용 일치 검사를 실행한다.
실제 API adapter는 Backend 생성 타입을 사용하며 공통 v1 fixture는 두 생성 타입의 호환성을
컴파일 단계에서 검사한다.

고정한 Backend에서 추출한 전체 OpenAPI JSON을 `test-results/backend-openapi.json`에 둔 뒤
snapshot과 타입을 갱신한다. 외부 revision 변경은 외부 계약 절차를 따른다.

```bash
# 명시한 실제 OpenAPI 입력으로 추적 대상 snapshot을 갱신한다.
sudo docker compose run --rm verification pnpm run contract:snapshot --input /app/test-results/backend-openapi.json --write

# 실제 계약과 제안 계약의 생성 타입을 함께 갱신한다.
sudo docker compose run --rm verification pnpm run contract:generate

# 생성물을 변경하지 않고 manifest, 문법 및 생성 타입 일치를 검사한다.
sudo docker compose run --rm verification pnpm run contract:check
```

`eslint.config.js`는 ESLint flat config, 권장 TypeScript 타입 검사, React Hooks와 Vite
Fast Refresh 규칙을 적용한다. `pnpm run lint`는 경고를 허용하지 않는다.

Vitest는 `src/**/*.{test,spec}.{ts,tsx}`만 수집하고 jsdom에서 실행한다. Testing Library는
구현 세부 구조 대신 브라우저의 역할, 이름과 사용자 상호작용을 기준으로 컴포넌트를
검증한다. `pnpm run test`는 테스트를 한 번 실행하고 `pnpm run test:watch`는 변경을
감시한다.

Playwright는 `e2e/`의 브라우저 테스트를 1280 x 900, 1440 x 900과 1920 x 1080 Chromium 뷰포트에서
실행한다. `pnpm run test:e2e`는 타입 검사와 운영 빌드의 크기 예산 검사를 완료한 뒤 synthetic
데이터가 포함된 별도 빌드를 Vite preview 서버에서 검증한다. 운영 빌드 뒤
`scripts/verify-build-output.mjs`가 초기와 전체 JavaScript, CSS, 웹폰트와 전체 정적 자산의
크기 예산을 검사한다. 실패한 테스트의 screenshot과 trace는 Git에서 제외한
`test-results/`에 저장한다.

빌드 크기 예산은 초기 JavaScript 260 KiB, 전체 JavaScript 750 KiB, CSS 50 KiB, 웹폰트
4 MiB와 전체 자산 5 MiB다. 날짜 녹화의 HLS light 모듈은 지연 로딩하며 전체 JavaScript 및
자산 예산에 포함한다. production에서 선택한 모니터링 및 영상 구현 전체에 같은
예산을 적용하며 초기 로딩과 전체 자산 예산은 별도로 유지한다.
녹화 상태의 hover, click과 키보드 상세 처리는 녹화 경로의 지연 로딩 코드에 포함하며
전체 JavaScript 예산으로 관리한다.
전체 JavaScript 예산은 Backend v2 API 연동 기능을 포함한 크기를 기준으로 한다.

현재 Playwright 테스트는 대시보드 진입, synthetic 실시간 갱신과 운영 주기 상태 전이, 상단 브랜드 이동, 알림함 읽음 처리와 닫기,
사용자 메뉴와 로그인 및 로그아웃, 비로그인 화면 제한, 관리자 경로 제한, 적재율 이력의
이벤트 상세 표시, 빈 목록, 필터와 페이지 이동, 대상 뷰포트의 수평 오버플로와 카드 잘림,
푸터 겹침, 대화형 요소의 접근 가능한 이름, 이미지 대체 텍스트와 외부 연동 전 요청
피드백을 검증한다. 계약 테스트 서버를 사용하는 브라우저 테스트는 로그인, session Cookie와
CSRF, 화면별 조회, SSE 갱신, 알림 읽음, 녹화 재생 및 다운로드, 관리자 설정과 알림 대상 변경,
테스트 알림, 로그아웃과 WHEP session 수명을 검증한다. Vitest는 synthetic data source의 기본 데이터,
상태와 빈 목록 시나리오, AbortSignal 취소, 구독 갱신과 상태 전이, 호출 간 데이터 격리,
페이지별 필터와 페이지 이동, 관리자 입력 검증과 로그인 입력 상호작용을 검증한다. HTTP
어댑터의 요청과 변환, 오류와 session 만료, SSE 순서와 재동기화 및 WHEP 정상, counter-offer,
ICE 전달, 종료와 재연결도 Vitest에서 검증한다. 계약 예제의 최근 24시간 표본 순서와 간격,
수거 필요 marker 및 당시 적용 임계율의 일치 여부도 함께 검증한다.

v2 fixture는 실제 생성 타입을 사용하고 제안 HTTP 및 SSE fixture와 구분한다.
v2 adapter 및 화면 테스트는 모든 dataState, 0%와 소수 및 결측값, 계약 위반 입력, 단일 pit,
인증 선행, event ID가 없는 SSE, 연결 끊김 및 동일 snapshot 복구와 session 종료를 검사한다.
공통 현황 화면의 카드 순서와 위치 및 크기는 실제 API와 synthetic data를 비교해 검사한다.
`e2e/layout-baseline.json`은 승인된 기본 화면의 배치 기준이며 세 viewport의 현황, 이력,
녹화 및 관리자 화면의 카드와 표 행 및 영상 영역을 검사한다. 긴 상세 내용의 표시와 종료도
기본 화면 좌표 및 크기를 바꾸지 않는지 검사한다. 배치 차이를 해소하기 위해 이 기준을
자동 갱신하지 않는다.
경보 평가와 작업 상태의 분리, 수거 요약 기반 경과 시간 및 평균 주기와 새 경보 ID의 알림함 재조회도
검사한다. 예상 도달, LiDAR 높이 곡선, 활성 알림(장비 항목과 확인 범위 포함), 측정 영역 배치 상태의 응답 검증과 시뮬레이션 표기도 검사한다. 표시 시간대 고정, 30일 및 90일 적재율 조회, 이력 오류 코드와 관리자 설정의 검증 오류 분배도 검사한다. 경보 5개 상태와 미제공의 표시, 위험 복귀 기준 위의 CRITICAL 유지 및 연결 중단과
복구의 표시도 검사한다. 읽음 응답 지연 중 새 경보 도착, 읽음 성공 후 목록 조회 실패, 실패한 재조회의
대기 요청 처리와 구독 종료 뒤의 늦은 응답 격리도 검사한다.
browser fixture는 영상 decode, 무응답 및 오류와 재시도, 확대 dialog의 키보드 종료 및 focus
복원과 동시에 활성화되는 영상 연결 수를 검사한다. MJPEG parser와 컴포넌트는 chunk 경계,
header 및 frame 크기 제한, timeout, 취소, decode 실패, 인증 오류, StrictMode와 Blob URL
회수를 검사한다. 녹화 및 이력 lifecycle 테스트는 처리 상태 전이, 목록 조회 취소, 선택 변경,
역순 응답 격리와 다운로드 재조회의 접근 불가 응답을 검사한다.
이력 이벤트 표와 이벤트 녹화 목록은 요청 횟수, 요청한 `page`와 `pageSize`, 전체 건수의 서버 값 사용,
이전 요청 취소와 늦은 응답 격리, 그래프와 표의 독립 표시를 검사한다.
이벤트 녹화는 목록과 상세의 계약 검증, 90일 범위 제한, part 사이 이동과 마지막 끝의 정지,
다른 part로의 탐색과 `downloadPath` 노출 거부를 검사한다. 날짜 녹화 삭제는 CSRF 전달, 204와
409 및 5xx 뒤 재조회, 관리자에게만 표시되는 버튼과 확인창을 검사한다. 브라우저 테스트는
이벤트 녹화의 v2 목록과 상세, 날짜 녹화 삭제의 취소, 409, 204와 카드 배치 유지,
조회 사용자에게 버튼이 없음을 검사한다.
날짜 녹화는 대량 구간의 표시 요소 수, 재생 시각 갱신 시 시간축 재사용, 단건 조회의
제한된 재시도와 기존 player 유지 및 권한 오류의 재생 중단도 검사한다.
서비스 통합 검증은 `pnpm run check`와 분리해 실행하며 검증 범위와 fixture 구성은
`docs/contracts/backend/README.md`를 따른다.

Continuous Integration (CI)의 호스트 runner는 Ubuntu 24.04로 고정한다. CI 작업은 `@playwright/test` 1.62.1과
버전이 일치하는 공식 Playwright Noble 컨테이너
`mcr.microsoft.com/playwright:v1.62.1-noble`에서 실행하고 OCI image digest를 고정한다.
컨테이너는 사용자 `1001`로 실행한다. 컨테이너가 Chromium과 실행에 필요한 Linux 시스템
라이브러리를 제공하므로 CI에서 브라우저 또는 시스템 패키지를 별도로 설치하지 않는다.
Node.js와 pnpm은 컨테이너 안에서도 각각 `.node-version`과 `package.json`의
`packageManager`에 기록된 버전을 사용한다. CI가 사용하는 외부 GitHub Action은 upstream
Repository의 전체 commit SHA로 고정한다.

검증 컨테이너의 `pnpm run check`는 비밀 파일 추적 및 Docker build context 제외, 계약 검사,
정적 검사, 검증 도구 및 컴포넌트 테스트, 타입 검사, 프로덕션 빌드와 브라우저 테스트를 순서대로 실행하는
전체 검증 명령이다. Container job은 임시 Root CA, Intermediate CA와 서버 인증서를
생성하고 fullchain, 개인 키, Docker Secret, Nginx HTTPS, 신뢰 체인과 SAN 불일치를
검증한다. 임시 CA 개인 키와 서버 개인 키는 job의 임시 디렉토리에서만 사용하고 종료 시
삭제한다.

## 컨테이너 통합 검증

`scripts/verify-container-integration.sh`는 `test/container/Dockerfile`로 Node.js, Git, curl,
OpenSSL, Docker CLI (Command-Line Interface)와 Compose plugin을 포함한 검증 이미지를 만든다.
Docker CLI 29.8.0 이미지와 Node.js 이미지는 digest로 고정한다. Docker CLI의 Apache-2.0
license는 검증 도구에만 적용되며 제품 이미지에는 이 도구가 포함되지 않는다.
wrapper는 local Unix Docker socket과 host의 같은 절대 경로를 사용해 runtime, TLS와 reverse
proxy 검사를 호출한다. host에 Node.js나 OpenSSL을 설치하지 않는다.

두 통합 wrapper는 실행마다 다른 이름을 사용하고 자신이 만든 container, network, volume과
image만 정리한다. INT 및 TERM은 각각 130과 143으로 종료하며 테스트 실패 코드를 보존한다.
cleanup 실패도 비정상 종료로 처리한다. SIGKILL과 daemon 중단 등으로 자동 cleanup이
불가능하면 출력된 `Recovery command`를 실행한다. 두 스크립트의 `--cleanup`은 출력된
실행 디렉토리만 허용하고 같은 실행의 recovery를 반복할 수 있다.

실제 서비스 실행의 정보는 `test-results/service-integration/run.<id>/`에 저장한다.
`artifacts/`에는 정제한 `summary.json`과 synthetic screenshot만 공개한다.
실패한 검사의 공개 요약은 양의 정수 행 번호만 추가하며 오류 경로와 원문은 포함하지 않는다.
원본 Playwright trace, request 및 response, Cookie, 비밀번호, token과 오류 원문은 공개
artifact에 넣지 않는다. `private/`는 mode 700이며 원본 report와 로그를 저장한다.
`private/service-logs.txt`는 자원 회수 전 수집한 격리 환경의 Backend, Media와 synthetic 입력 로그다.
임시 `compose.env`는 mode 600이고 cleanup 성공 후 삭제한다. runtime 및 TLS wrapper의
로그는 출력된 `/tmp/dashboard-container-integration.<id>/`에 남으며 임시 개인 키는 자원
회수 뒤 삭제한다. source checkout은 출력된 임시 경로에 유지한다.
`.gitignore`와 `.dockerignore`는 로컬 `.env`, 비밀 파일, pnpm cache, build cache, 로그와
검증 산출물을 제외한다. 계약 snapshot, 생성 타입과 재현 fixture는 추적 대상이다.

대기 상한은 단계마다 적용한다.

| 대상 | 상한 |
| --- | --- |
| source clone | source당 180초 |
| 실제 서비스 build | 1200초 |
| service readiness | wrapper 150초, Compose wait 120초 |
| Browser 의존성 설치 | 180초 |
| Edge 입력 | 120초 |
| 실제 서비스 browser 테스트 | 300초 |
| 실제 서비스 cleanup | 45초 |
| runtime 도구 및 production build | 각각 600초 |
| runtime, TLS 및 reverse proxy 검사 | 각각 120초 |

현재 CI는 공식 Playwright 컨테이너에서 frozen 설치, 정적 검사, 컴포넌트 테스트,
검증 도구 테스트, 타입 검사, 프로덕션 빌드와 세 뷰포트의 브라우저 테스트를 실행한다. 별도 container
job은 `linux/amd64` 이미지를 빌드한 뒤 Nginx 설정 문법, 읽기 전용 root file system에서
Nginx 상태, SPA fallback, 보안 헤더, 자산 캐시, 라이선스 고지, source map과 런타임 빌드 도구
부재를 검사한다. 같은 job은 테스트 전용 FastAPI 대역 컨테이너와 Docker DNS를 사용해 API
reverse proxy, forwarded header와 request ID, API rate limit와 request body 제한, read timeout,
즉시 전달되는 SSE와 buffering 비활성화, WHEP 형태의 `POST`, `PATCH` 및 `DELETE`, WebSocket
Upgrade 호환성, upstream DNS 재해석과 구조화 access log를 검증한다. 테스트 전용 경로,
upstream 이름, resolver와 timeout 값은 운영 계약이 아니다.

별도 `Service integration` job은 고정한 실제 서비스의 동일 검증 스크립트를 실행한다.
job timeout은 35분이며 같은 workflow 및 ref의 이전 실행을 취소한다.
checkout 자격 증명은 보관하지 않고 `contents: read` 권한만 사용한다.
정제 검사를 통과한 `artifacts/`만 7일간 업로드하며 image나 Release를 게시하지 않는다.
workflow 구현과 로컬 실행은 GitHub runner의 성공 결과를 대신하지 않는다.

## 변경 검증과 리뷰

문서만 변경하면 로컬 링크와 제목 anchor, 지침 진입점의 심링크와 `git diff --check`를
검사한다. 제품 코드를 변경하면 해당 영역의 재현 테스트와 전체 회귀 검사 및 빌드를
수행한다. 실제 서비스 계약 또는 영상 경로 변경은 격리된 서비스와 production 이미지로
검증하며 fixture의 성공을 운영 배포 검증으로 대신하지 않는다.

리뷰는 Codex로 수행하며 agy는 사용하지 않는다. 인증, 데이터 의미, 요청 순서, 늦은 응답,
캐시 무효화, 자원 정리와 디자인 회귀를 우선 검토한다. timeout과 답변 부재는 리뷰 통과가
아니며 지적을 수정하면 관련 테스트와 영향을 받는 전체 검사를 다시 실행한다.

실제 서버의 기존 데이터를 읽는 확인과 격리 환경의 상태 변경 테스트를 구분한다.
관리자 저장, 알림 읽음과 테스트 발송, export 생성 및 데이터 삭제를 읽기 전용 확인에
포함하지 않는다. 자격 증명과 현장 데이터는 공개 문서, artifact와 PR에 포함하지 않는다.
