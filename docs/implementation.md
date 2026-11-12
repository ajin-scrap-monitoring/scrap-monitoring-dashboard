# 프론트엔드 구현 정보

## 문서 역할

이 문서는 채택한 기술, 의존성과 클라이언트의 현재 구현 상태를 기록한다.
구현 계획은 현재 기능의 설명이나 실행 승인이 아니다. 계획의 적용 범위와 문서 선택은
[문서 안내](README.md)를 따른다.

## 현재 구현 범위

현재 구현 상태는 5개 영역으로 구분한다.

| 영역 | 구현 상태 |
| --- | --- |
| 도구와 품질 기준선 | Node.js, pnpm, React, TypeScript, Vite, ESLint, Vitest와 Playwright 구성 |
| UI (User Interface) | 공통 현황의 v2 상태 및 추이, 이벤트 및 녹화 범위 상세, 이력과 날짜 및 이벤트 녹화와 관리 기능 및 synthetic 상태 구현 |
| 외부 연동 경계 | 실제 Backend OpenAPI 생성 타입, HTTP (Hypertext Transfer Protocol) adapter, v2 Server-Sent Events (SSE), Motion JPEG (MJPEG) client와 v1 제안 및 WebRTC-HTTP Egress Protocol (WHEP) 대역 검증 |
| 배포 산출물 | Nginx 기반 Open Container Initiative (OCI) 이미지, reverse proxy 공통 설정, Transport Layer Security (TLS) 주입 경계, Continuous Integration (CI)와 Git tag 기반 Release 구성 |
| 실제 시스템 통합 | 고정한 Backend, Camera Media Service와 Edge Orchestrator의 synthetic 입력 통합 검증 범위, 실제 hardware와 현장 측정 검증 제외 |

실제 서비스 계약의 revision, 데이터 의미, 인증, 영상 경로와 통합 검증 경계는
`docs/contracts/backend/README.md`를 따른다. `docs/contracts/proposal/`은 v1 제안 및 WHEP
대역 검증용이며 실제 서비스 계약으로 취급하지 않는다. 운영 배포 환경과 현장 측정 정확도는
로컬 통합 검증의 완료 범위에 포함하지 않는다.

## 제품 구현 기준선

프론트엔드 빌드 런타임은 Node.js 24.19.0 Long-Term Support (LTS)를 사용한다.
`.node-version`은 CI가 사용하는 정확한 Node.js 버전의 정본이며 개발 및 검증 컨테이너는 Dockerfile의 기본 이미지에 같은 버전을 직접 지정한다.
`package.json`의 `engines.node`는 허용하는 24 주 버전을 선언한다. 개발 컴퓨터는
Docker Engine과 Docker Compose로 개발 및 검증 컨테이너를 실행하며 호스트에 Node.js를
설치하지 않는다. Node.js는 개발 도구, 검사, 테스트와 정적 산출물 빌드에만 사용하며 운영
Linux 서버에 설치하지 않는다.

패키지 관리자는 pnpm 11.23.0을 사용한다. `package.json`의 `packageManager`는
정확한 pnpm 버전의 정본이며 `pnpm-lock.yaml`만 lock file로 사용한다. 의존성
추가, 제거와 갱신에는 pnpm 명령을 사용한다. CI는 lock file을 변경하지 않는
`pnpm install --frozen-lockfile`로 설치 재현성을 검사한다.

Node.js 24의 patch 버전과 pnpm 11의 minor 및 patch 버전은 별도 변경에서
정확한 버전, lock file과 CI를 함께 갱신한다. Node.js와 pnpm의 주 버전 변경은
직접 의존성과 빌드 도구의 지원 범위를 다시 확인한 뒤 채택한다.

사용자 인터페이스는 React 19.2와 React DOM 19.2, 구현 언어는 TypeScript 6.0,
개발 서버와 프로덕션 정적 빌드는 Vite 8.2를 사용한다. Vite의 공식 React
플러그인은 React Fast Refresh와 JSX (JavaScript XML) 변환을 제공한다.
TypeScript는 컴파일러 API를 사용하는 개발 도구와의 호환성을 유지하는 6.0
안정 계열을 사용한다.

직접 의존성은 다음과 같다.

| 패키지 | 버전 | 역할 | 출처 | 라이선스 |
| --- | --- | --- | --- | --- |
| `react` | 19.2.8 | 컴포넌트와 상태 기반 사용자 인터페이스 | [npm](https://www.npmjs.com/package/react) | MIT |
| `react-dom` | 19.2.8 | 브라우저 Document Object Model (DOM) 렌더링 | [npm](https://www.npmjs.com/package/react-dom) | MIT |
| `hls.js` | 1.7.3 | 날짜 녹화 HTTP Live Streaming (HLS) 재생 | [npm](https://www.npmjs.com/package/hls.js) | Apache-2.0 |
| `typescript` | 6.0.3 | 정적 타입 검사 | [npm](https://www.npmjs.com/package/typescript) | Apache-2.0 |
| `vite` | 8.2.2 | 개발 서버와 프로덕션 정적 빌드 | [npm](https://www.npmjs.com/package/vite) | MIT |
| `@vitejs/plugin-react` | 6.1.0 | Vite의 React 변환과 Fast Refresh | [npm](https://www.npmjs.com/package/@vitejs/plugin-react) | MIT |
| `@types/node` | 24.13.3 | Vite 설정의 Node.js 타입 | [npm](https://www.npmjs.com/package/@types/node) | MIT |
| `@types/react` | 19.2.18 | React 타입 | [npm](https://www.npmjs.com/package/@types/react) | MIT |
| `@types/react-dom` | 19.2.4 | React DOM 타입 | [npm](https://www.npmjs.com/package/@types/react-dom) | MIT |
| `eslint` | 10.8.0 | JavaScript와 TypeScript 정적 검사 실행기 | [npm](https://www.npmjs.com/package/eslint) | MIT |
| `@eslint/js` | 10.0.1 | JavaScript 권장 정적 검사 규칙 | [npm](https://www.npmjs.com/package/@eslint/js) | MIT |
| `typescript-eslint` | 8.67.0 | 타입 정보를 사용하는 TypeScript 정적 검사 | [npm](https://www.npmjs.com/package/typescript-eslint) | MIT |
| `eslint-plugin-react-hooks` | 7.1.1 | React Hooks 규칙 검사 | [npm](https://www.npmjs.com/package/eslint-plugin-react-hooks) | MIT |
| `eslint-plugin-react-refresh` | 0.5.4 | Fast Refresh 경계 검사 | [npm](https://www.npmjs.com/package/eslint-plugin-react-refresh) | MIT |
| `globals` | 17.11.0 | 브라우저와 Node.js 전역 변수 정의 | [npm](https://www.npmjs.com/package/globals) | MIT |
| `vitest` | 4.1.11 | Vite 기반 단위 및 컴포넌트 테스트 실행기 | [npm](https://www.npmjs.com/package/vitest) | MIT |
| `jsdom` | 30.0.1 | 컴포넌트 테스트의 DOM 환경 | [npm](https://www.npmjs.com/package/jsdom) | MIT |
| `@testing-library/react` | 16.3.2 | 사용자 관점의 React 렌더링 검사 | [npm](https://www.npmjs.com/package/@testing-library/react) | MIT |
| `@testing-library/dom` | 10.4.1 | DOM 질의와 상태 검사 | [npm](https://www.npmjs.com/package/@testing-library/dom) | MIT |
| `@testing-library/user-event` | 14.6.6 | 사용자 입력과 상호작용 재현 | [npm](https://www.npmjs.com/package/@testing-library/user-event) | MIT |
| `@testing-library/jest-dom` | 7.0.1 | DOM 상태 단언 | [npm](https://www.npmjs.com/package/@testing-library/jest-dom) | MIT |
| `@playwright/test` | 1.62.1 | Chromium 브라우저 사용자 흐름 검증 | [npm](https://www.npmjs.com/package/@playwright/test) | Apache-2.0 |
| `@redocly/cli` | 2.52.1 | OpenAPI 문법, 참조와 권장 규칙 검사 | [npm](https://www.npmjs.com/package/@redocly/cli) | MIT |
| `@redocly/openapi-core` | 1.34.20 | API별 생성 설정과 Redocly 규칙 로딩 | [npm](https://www.npmjs.com/package/@redocly/openapi-core) | MIT |
| `openapi-typescript` | 7.13.0 | OpenAPI schema의 TypeScript 타입 생성과 생성물 일치 검사 | [npm](https://www.npmjs.com/package/openapi-typescript) | MIT |

직접 의존성은 `package.json`에 정확한 버전으로 기록한다. `.npmrc`의
`save-exact=true`는 pnpm이 새 직접 의존성을 정확한 버전으로 저장하게 한다.
`pnpm-lock.yaml`은 전이 의존성을 포함한 전체 설치 결과를 고정한다.
`pnpm-workspace.yaml`은 `typescript-eslint` 내부 패키지 2개를 채택한 8.67.0으로 고정해
같은 도구 계열의 버전과 공급망 검증 결과를 일치시킨다.

Vite는 TypeScript 파일을 JavaScript로 변환하지만 타입 검사를 수행하지 않는다.
`pnpm run typecheck`는 TypeScript 프로젝트 참조 전체를 검사한다. `pnpm run build`는
같은 타입 검사를 통과한 뒤 Vite가 `dist/`에 정적 산출물을 생성한다. 현재 Vite
빌드 출력 대상은 별도로 재정의하지 않으며 고정된 Vite 버전의 기본값을 사용한다.
제품 범위는 [프로젝트 명세](project-spec.md#범위)를 따른다. v1과 WHEP 코드는 선택 빌드
검증 경계로 유지한다.

코드 포맷은 별도 formatter 없이 ESLint 규칙만 적용한다.

현재 개발 및 브라우저 검증 기준은 데스크톱 Chrome 151 이상, 최소 너비 1280 Cascading Style
Sheets (CSS) 픽셀, 기본 Full HD (FHD) 1920 x 1080 뷰포트다. 높이를 초과하는
기본 페이지 콘텐츠는 페이지 세로 스크롤을 사용하며 알림 목록, 수신 대상 창과 상세 창은 영역 자체에 스크롤을 둔다. Chrome 최소 버전은 `@playwright/test` 1.62.1이
검증하는 Chromium 151.0.7922.34를 기준으로 한다.

## 코드 구조와 작업 재개 기준

### 진입점과 화면 구성

`src/main.tsx`는 data source를 생성해 `App`에 주입한다. 운영 이미지의
`RuntimeConfiguredApp`은 검증한 runtime 설정 뒤 HTTP data source를 초기화하며,
개발 및 synthetic source의 선택 경계는 아래 데이터 소스 절을 따른다.

`src/App.tsx`는 `/`, `/history`, `/recordings`, `/login`과 `/admin`을 분기한다.
같은 origin의 `/`, `/history`, `/recordings`, `/admin`(query parameter 포함)은 `AppLink`와
`navigate`를 통한 client-side 화면 전환을 지원한다. `/login`과 그 외 경로는 document 이동으로 동작한다.
로그인 성공, 로그아웃, session 만료, MJPEG 401, 설정 오류 재시도의 `window.location.assign`과 `reload`는
계정 전환 시 화면 데이터 격리를 위해 document 이동을 유지한다.

`src/app-router.ts`의 `useAppLocation`은 `useSyncExternalStore`로 브라우저의 `popstate`와 앱 내부 이동
알림을 구독한다. `navigate(to, { replace? })`는 `history.pushState` 또는 `replaceState`를 호출하고
구독자에게 알린다. 각 history entry는 `history.state`의 고유 key를 가지며 첫 document entry에도
router가 key를 부여한다. router는 push 이동 직전과 `popstate`를 화면에 반영하기 전(이전 화면이
DOM에 있는 동안)에 떠나는 entry의 scroll 위치를 key별로 메모리에 기억한다. 현재 위치와 대상 경로의
pathname 및 search가 같으면 새 history entry를 만들지 않는다. `AppLink`는 왼쪽 클릭,
보조키 없음, `target` 부재 또는 `_self`, `download` 없음 조건에서만 `preventDefault()` 후 `navigate`를
수행한다. 화면 모듈 loader(`loadAdminPage`, `loadHistoryPage`, `loadRecordingsPage`)는
`src/page-loaders.ts`로 분리해 화면 모듈 load와 선로딩에 공유하며, `AppLink`는 pointerenter와 focus
이벤트에서 대상 화면 모듈을 미리 로드한다.

화면 전환 시 push 이동은 새 화면이 렌더링된 뒤 맨 위로 scroll하고 새 화면의 h1(`tabIndex={-1}`)로
focus를 이동한다. 프로그램 focus 시 외곽선은 숨기되 키보드 focus 표시(`:focus-visible`)는 유지한다.
뒤로/앞으로 이동(popstate)은 이동한 entry를 떠나기 직전에 기억한 scroll 위치를 화면 렌더링 뒤
복원하며 기억한 위치가 없으면 맨 위로 둔다. 새로고침 뒤에는 기억한 위치를 복원하지 않는다. 브라우저의
`history.scrollRestoration`은 `manual`로 설정한다. 관리자 화면으로 앱 내부 이동할 때는 session을
재조회(`loadRouteData("admin", { revalidateSession: true })`)해 CSRF token과 session 정보를 갱신한다.
session이 만료되었으면 로그인 화면으로 이동하고 역할이 `administrator`가 아니면 관리자 데이터 조회를
생략하고 권한 없음 화면을 표시한다. 전체 페이지 첫 진입의 관리자 화면은 `getDashboardData`의 session을
사용하므로 중복 조회하지 않는다.

관리자, 이력, 녹화 화면 모듈은 별도 chunk이며 `usePageModule`이 모듈 load 상태를 화면 데이터
로딩과 같은 대기 상태에 포함한다. 모듈과 데이터를 기다리는 동안은 "데이터를 불러오는 중입니다."
로딩 화면을 표시하고 load가 끝난 모듈의 component를 Suspense 없이 직접 렌더링한다. 모듈 load
실패는 다시 시도할 수 있는 오류 화면으로 표시한다. 로그인 화면은 별도 document 경로로 `React.lazy`와
Suspense를 유지한다.

`application-root.ts`는 `pagehide`에서 React root를 unmount해 영상, SSE와 진행 중인
요청 및 timer를 정리한다. Back/forward cache에서 복원한 document는 `pageshow`의
`persisted`를 확인해 앱을 다시 mount하고 session 및 화면 데이터를 재조회한다.
페이지가 숨겨진 뒤 완료된 초기화는 document 복원 전까지 연결을 시작하지 않는다.

`DashboardPageShell`은 공통 헤더와 푸터를 조립하고 화면별 상태와 상호작용은
`src/pages/`에서 관리한다. 공통 제목과 아이콘, 차트 및 페이지 이동은
`DashboardPrimitives.tsx`, `MonitoringVisuals.tsx`와 `Pagination.tsx`를 사용한다.
경로와 synthetic 인증 키는 `src/app-routing.ts`가 정의한다.

네 화면의 페이지 제목은 장식 없이 같은 크기, 굵기와 정렬을 사용한다. 제목 영역은
76px이며 제목만 영역 안에서 정렬한다. 카드 위치, 크기와 간격은 변경하지 않는다.

### 데이터 소스와 요청 수명

`src/domain/dashboard.ts`는 화면 모델, `src/data/dashboard-data-source.ts`는
`DashboardDataSource`의 정본이다. 화면은 서버 DTO (Data Transfer Object)를 직접 해석하지
않고 adapter가 변환한 화면 모델을 사용한다. 실제 서비스 타입은
`src/generated/backend-contract.ts`, 제안 타입은 `src/generated/api-contract.ts`에 추적한다.

`use-dashboard-data.ts`는 초기 조회, 취소, 오류, 재시도와 구독을 관리한다. 초기 조회가
성공한 뒤 실시간 구독을 시작한다. HTTP adapter의 앱 공통 초기 조회는 session과 monitoring
snapshot만 대기하고 알림 응답을 기다리지 않고 반환한다. 알림은 백그라운드에서 조회해
결과를 발행한다. 화면별 초기 데이터는 `useRouteData`가 `loadRouteData`를 통해 화면 진입
시점에 독립적으로 조회하며, 현황 상세(collection summary와 최근 24시간 load-history)는
현황 화면이 `activateMonitoringDetails`를 활성화할 때만 조회하고 60초 이내 성공 결과를 재사용한다.
현황 화면은 해제할 때 준비 완료 기록을 지우므로 재진입 때 이전 활성화의 완료 기록을 사용하지
않는다. data source의 `isMonitoringDetailsReady`는 부수 효과 없이 마지막 성공 뒤 60초 이내인지
반환하며, 이 경우 현황 화면은 로딩 화면을 그리지 않고 첫 render부터 현황을 표시한다. 마지막
성공 뒤 60초가 지난 재진입은 collection summary, fill forecast, layout 조회와 첫 profile 조회의
완료를 기다린다. 조회 실패도 처리한 뒤 대기를 끝내며, 인증 오류가 먼저
발생하면 fill forecast와 layout의 완료는 기다리지 않지만 첫 profile 조회의 완료는 기다린다.
collection summary, fill forecast와 layout은 서로 독립적으로 반영하며 한 조회가 실패하면 해당 값만 정보 없음으로 둔다. 활성 알림 결합 조회는
이 대기에 포함하지 않고 활성 알림 카드만 확인 중으로 둔다. load-history 기준 시각은 서버 시각만
사용하며 서버 시각이 없으면 조회하지 않고 해당 영역을 오류 상태로 둔다. 브라우저 탭이 숨겨지면(`document.visibilityState === "hidden"`) 현황 상세 갱신 timer를
중지하고 `monitoring.snapshot` SSE 수신이 유발하는 60초 경과 상세 갱신, 판정 변경의 결합 재조회와
source 변경의 load-history 조회도 보내지 않는다.
최근 24시간 load-history 조회가 422 `HISTORY_*` 또는 503 `HISTORY_QUERY_TIMEOUT`으로 실패하면 현황 상세 갱신 timer와
탭 복귀는 최근 이력을 다시 요청하지 않으며 현황 상세 재활성화 또는 대상 변경 때 조회를 재개한다.
SSE 재연결과 대상(siteId 또는 edgeId) 변경은 적재율, LiDAR 곡선과 대표 평균의 유지 상태와 timer를 버린다.
대상 변경은 이전 대상의 LiDAR 곡선, collection summary, fill forecast, layout과 활성 알림 결합 결과도 버리고 진행 중인
결합 조회를 기다리지 않으며 새 대상 기준으로 다시 조회한다. 이전 대상 요청의 응답과 오류는 적용하지 않는다.
탭이 다시 표시되면 마지막 성공 시각 이후 60초가 지난 경우 현황 보조 조회와 최근 24시간
load-history를 즉시 재조회하고 timer를 다시 시작한다. 60초가 지난 load-history 표본은 비우고
loading 상태로 둔 뒤 조회한다. SSE 연결은 탭 숨김 중에도 유지한다. 보조 조회의 실패는
영역별 상태로 처리한다.

LiDAR 단면(`profiles`)은 collection summary와 분리한 루프로 갱신한다. 현황 상세가 활성화되고 브라우저 탭이
표시되는 동안 한 번에 하나의 요청만 보내고, 응답을 받으면 요청 시작 1초 뒤(응답이 1초보다 늦으면 응답 직후)
다음 요청을 예약한다. 루프마다 별도 AbortController를 두며, 탭 숨김과 현황 상세 해제는 진행 중 요청을 abort한다.
탭이 다시 표시되거나 현황 상세가 다시 활성화되면 새 루프가 단면 표본을 비우고 즉시 1회 조회하며 이전 루프의 응답은
적용하지 않는다. 새 응답은 이전 표본 배열을 교체하고, 401과 403은 기존 인증 처리 후 루프를 멈춘다.
센서별 대표 평균 준비 중과 profile 조회의 네트워크 오류, timeout 또는 5xx 실패 시 유지 조건과
만료 동작은 [LiDAR 높이 곡선](contracts/backend/frontend-mapping.md#lidar-높이-곡선)을 따른다.
단면 표시는 snapshot `dataState`와 분리해 profile 응답 결과로 표시한다.

`LoadChart`는 data source가 매번 새 배열로 복제하는 표본을 필드 값 단위로 비교하고, 표본 내용과 기간 및 시각 표시 방식이 같으면 정렬, 시각 문자열과 좌표 계산 결과를 재사용한다.

이력 화면의 적재율 그래프(`queryHistory`)는 성공한 load-history 결과를
`(pit, site, edge, from, to)` 키 기준으로 60초 동안 최대 4개까지 메모리에 보관하고 동일한 키의
요청은 재요청 없이 캐시 결과를 반환한다. 실패와 취소는 보관하지 않는다. 같은 기간에서 이벤트 유형만
변경한 조회는 그래프 재요청 없이 즉시 완료한다. 이벤트 표 조회(`queryHistoryEvents`)는 캐시를
적용하지 않는다.

HTTP 요청은 응답 body 수신을 포함해 기본 10초로 제한한다. v2 load-history는 25초, 날짜 녹화와
clip의 media-info는 30초로 제한한다. Timeout은 `REQUEST_TIMEOUT`으로 구분하며 v2
load-history는 `HISTORY_CLIENT_TIMEOUT`으로 변환한다. 같은 화면 초기화 요청에 같은
AbortSignal을 전달하고 화면 종료는 요청을 취소한다. 이미 수신한 401과 403은 권한 오류로 유지한다. `DataAreaState`는 실패, 미지원과
이전 응답 사용을 구분한다. 권한 오류는 보조 실패로 숨기지 않는다.

`src/use-latest-request.ts`는 후속 목록 조회, source 변경과 화면 종료 시 이전 요청을
취소하며 화면은 취소한 요청의 늦은 성공 및 오류를 적용하지 않는다. 현황 전용 최근
24시간 추이와 최근 완료 이력은 현황에서만 조회하고 약 1분 간격으로 갱신한다.
같은 snapshot의 재수신은 완료 조회 간격을 줄이지 않으며 같은 경보 ID의 알림 조회를
중복 실행하지 않는다.

화면 시각의 표시와 기간 입력의 해석은 `src/display-time.ts`의 `Asia/Seoul`(+09:00)로
고정하며 브라우저 시간대를 사용하지 않는다. HTTP 요청은 offset을 포함한 ISO 8601을
사용하며 서버 시각의 변환 범위는
[표시 시간대](contracts/backend/frontend-mapping.md#표시-시간대)를 따른다.

### 데이터 소스와 synthetic 시나리오

`src/data/http-dashboard-data-source.ts`는 Backend 응답 변환, HTTP 요청과
Server-Sent Events (SSE)를 처리한다. synthetic 기능이 비활성화된 운영 빌드는 HTTP adapter를 사용한다.
개발 서버는 `VITE_DEV_DATA_SOURCE`로 기본 source를 선택하며 미설정은 synthetic이다.
`source=api`, `source=mock`과 session에 저장한 선택은 개발 기본값보다 우선한다.
synthetic 기능이 비활성화된 production 빌드는 이 선택과 제안 검증용 sessionStorage 값을 사용하지 않는다.

`src/data/mock-dashboard-data-source.ts`는 현황, 이력, 녹화, 알림과 관리자 설정의
synthetic data를 제공한다. 인스턴스 안의 설정과 읽음 변경을 유지하며 인스턴스 간에는
공유하지 않는다. 다운로드와 테스트 발송은 요청 확인만 표시한다. HTTP source의 테스트
발송 접수는 실제 채널 수신과 구분한다.

시나리오는 URL (Uniform Resource Locator)의 `scenario`로 선택한다.

| 시나리오 | 동작 |
| --- | --- |
| `normal` | 기본 synthetic data |
| `collection-required`, `measurement-error`, `disconnected`, `no-data` | 수거 필요, LiDAR 2 오류, 연결 끊김과 데이터 없음 |
| `loading`, `request-error` | 1.2초 지연과 초기 조회 실패 및 재시도 |
| `live-update` | 초기 snapshot 뒤 1.2초에 새 측정 전달 |
| `operation-cycle` | 0.5초 간격의 수거 필요, 완료, 측정 오류, 연결 끊김과 복구 |
| `empty-lists` | 측정은 유지하고 알림, 이력, 녹화와 수신 대상은 빈 목록 |

Synthetic 영상과 썸네일은 `src/assets/camera-frame.png`를 사용하며 실제 재생을 의미하지
않는다. 개발은 `scenario`로 상태를 확인하고 실제 API는 `source=api`로 선택한다.
기존 제안 계약 테스트는 개발 빌드의 `scrap-monitoring-api-contract=proposal`만 사용한다.

### 공통 헤더와 인증

첫 화면 표시 전의 runtime 설정, 최초 공통 데이터 로딩 중에는 메뉴 탭과 사용자 도구를
숨기고 헤더 높이를 유지한다. 첫 화면이 표시된 뒤 앱 내부 화면 전환에서는 화면별 데이터 로딩과
화면 모듈 로딩 모두 확인된 session의 공통 헤더(메뉴, 사용자 도구, 알림)를
유지하고 본문 영역만 로딩 화면으로 표시한다. 활성 메뉴는 이동 대상 화면으로 즉시 반영된다.
알림 조회 중에는 헤더 알림 버튼에 badge 대신 "알림 확인 중"을 표시하고 popover에 로딩 상태를 표시한다.
준비 뒤 확인한 session과 역할에 맞는 메뉴를 한 번에 표시한다. 조회 오류 화면은 확인된 사용자 정보를
사용한다. 긴 사용자명은 title에 원문을 유지하고 생략 표시한다. `viewer`의 기본 이름인 현장 운영자는
조회 사용자로 표시하며 다른 이름은 Backend 응답을 유지한다.

로그인 화면은 계정 로그인만 제공한다. 실제 v2 및 녹화 조회는 Backend session이 필요하고
관리자 화면은 administrator 역할을 확인한다. API 401 또는 SSE `session.expired`는
로그인으로 이동한다. HTTP adapter는 session Cookie와 CSRF (Cross-Site Request Forgery)
token을 사용한다. Synthetic 로그인은 `sessionStorage`를 사용하고 비로그인 조회에는
관리 기능과 개인 알림함을 표시하지 않는다.

현황, 이력과 녹화의 우측 상단은 모니터링 수신 상태이며 대기 중에는 문구를 숨긴다.
유효한 snapshot 수신은 연결 정상, 조회 또는 SSE 오류는 연결 문제로 표시한다.
마지막 수신 시각은 브라우저가 유효한 snapshot을 받은 시각이며 Asia/Seoul의
`HH:mm:ss`와 상세 날짜를 제공한다. 알림과 부가 조회는 이 값을 갱신하지 않는다.
연결 오류에는 마지막 시각을 유지하며 같은 snapshot의 재수신도 상태와 시각을 복원한다.
메시지가 없다는 이유만으로 연결 오류로 판정하지 않는다.

알림 조회 실패는 기존 popover의 안내 영역에서 표시하며 오류 원문과 수동 재조회 버튼은
제공하지 않는다. 마지막 유효 목록은 안내와 함께 유지하고 최초 실패의 미읽음 수는
미확인으로 표시한다. Snapshot 기반 갱신과 읽음 후 재조회는 유지한다.
최근 알림은 popover 안에서 스크롤하며 제목과 이력 링크는 viewport 안에 유지한다.
공통 헤더의 알림과 사용자 메뉴 패널은 첫 렌더링 뒤 `loadHeaderPopovers()`로 지연 로드한다.
모듈 로딩 중 버튼을 열면 열린 패널 자리에 불러오는 중 상태를 표시하고, 로딩이 완료되면
실제 패널로 전환한다. 모듈 로딩 실패 시 캐시된 promise를 비우고 메뉴 로딩 실패 안내와
다시 시도 버튼을 표시하며, 버튼 재클릭 또는 다시 시도 클릭 시 재로딩을 시도한다.
패널의 포커스 이동, Escape 키와 바깥 영역 클릭 닫기 동작을 유지한다.

### 현황 화면

`monitoring-v2.ts`는 판단 및 장비 상태를 변환하고 `load-history-v2.ts`는 source와
bucket 및 결측을 검사한다. `load-history-v2.ts`는 `view=chart` 응답 시 표본의
`assessmentId`, `observationId`, `methodVersion` 생략을 허용하고 metadata에
`assessmentId` key를 생성하지 않으며, `view` 부재 또는 `"full"`인 경우 `assessmentId`만
검증한다. `load-one-hour-ago.ts`는 같은 이력의 과거 관측을 선택하며
초기 조회, snapshot과 약 1분 간격 조회에 적용한다. Source 변경과 조회 실패는 값을 지우고
별도 요청이나 장기 저장소는 사용하지 않는다. 수치와 상태의 해석은
[화면 데이터 매핑](contracts/backend/frontend-mapping.md)이 정본이다.

`collection-summary-v2.ts`, `fill-forecast-v2.ts`, `lidar-profiles-v2.ts`,
`active-alerts-v2.ts`와 `measurement-layout-v2.ts`는 현황 보조 응답을 검증해 화면 모델로
변환한다. `lidar-profiles-v2.ts`는 필수 `samples` 배열을 검증하며 누락이나 null이면 계약
오류로 처리하고 `samples=[]`는 표본 없음 상태로 보존한다. `ProfileChart`는 0~10m 높이축과
A~B 가로축 배치를 유지하고, `positionRatio`가 있는 표본의 최솟값~최댓값을 관측 범위로 계산한다.
가로축의 [0, 최솟값)과 (최댓값, 1] 구간은 미측정 영역으로 옅은 회색 음영을 렌더링하고,
SVG viewBox 좌표계에서 폭이 24단위 이상이면 "미측정" 글자를 표시한다. SVG aria-label과 음영 title에 미측정 구간 비율을 명시하고,
유효점이 없는 profile은 `samples`를 빈 배열로 바꿔 곡선을 비운다. `active-alerts-v2.ts`는 필수
`basis` 객체와 필수 `coverage` 배열을 검증하고, 장비 항목의 `CAMERA` 및 `MEDIA_CAMERA_STATUS`를
허용하며 카메라 항목 이름은 "카메라"로 지정한다. 선택 필드인 `validUntilAt`, `evaluatedAt`,
`evidenceSource`를 보존한다. HTTP adapter는 snapshot-with-alerts의 snapshot을 기존 v2
snapshot 검사로, activeAlerts를 `parseActiveAlertsV2`로 검사한다. 결합 요청은 진행 중인 요청이 있으면
새로 시작하지 않고, 요청마다 순번을 부여해 가장 최근 시작한 요청만 적용하며 현황 상세 release 뒤의
응답은 적용하지 않는다. 같은
snapshotId의 응답도 적용한다. 결합 조회와 판정 비교의 근거 및 강제 재조회 조건은
[활성 알림 매핑](contracts/backend/frontend-mapping.md#활성-알림)을 따른다.
예상 도달은 `validUntil` 경과와 재연결 중에 숨긴다.
적재율 활성 알림 평가 상태가 `UNKNOWN` 또는 `ERROR`이면 "적재율 판정 불가"로 표시하고
`lastKnownState`가 있으면 보조 표기한다. 장비 활성 알림은 평가 상태와 무관하게 표시한다.
`error-body.ts`는 Backend의 3가지 오류 본문을 하나의 코드, 메시지와 검증 항목으로 정규화한다.
`simulated`가 true인 값은 기존 카드 안에 시뮬레이션 보조 표기를 더한다.
`summary.filterState`는 WARMING이면 안정화 준비 중, UNAVAILABLE이면 안정화 불가 보조 표기를 추정 적재율 라벨에 덧붙인다.
시뮬레이션과 함께면 추정 적재율 (시뮬레이션, 안정화 준비 중) 형태로 조합하며 WARMING 안내는 title 속성으로 제공한다.
`src/data/http-dashboard-data-source.ts`는 적재율 일시 준비 중 상태에서 마지막 정상값을 최대 3초간 유지하며, 유지 중에는 "안정화 준비 중" 대신 "갱신 대기" 라벨과 마지막 정상 관측 시각 안내 title을 제공한다. 유지 조건과 만료 규칙의 정본은 [기준과 평가 분류](contracts/backend/frontend-mapping.md#기준과-평가-분류)를 따른다.
1280 CSS 픽셀 너비에서도 줄바꿈이나 카드 높이 변경 없이 카드의 크기를 유지한다.

추정 적재율 아래 6개 지표는 같은 크기의 2행 3열 카드다. 제목은 작고 옅게, 값은 같은
글자색으로 크고 진하게 표시한다. 판단 불가는 경보 색상 대신 중립 회색과 작은 글씨를
사용하며 수치와 같은 높이의 영역을 유지한다. 경보 평가 미제공은 미지원으로 표시하고
원본 판단 사유와 capability는 모델에 보존하되 별도 진단 버튼은 제공하지 않는다.

장비 카드는 장비명과 보고된 상태만 표시하고 scan 및 진행 시각과 latency는 표시하지
않는다. 카메라 행의 `useCameraStatus`는 data source의 `subscribeCameraStatus`를 구독한다.
HTTP data source는 앱 공용 SSE에서 검사한 마지막 카메라 상태와 단조 시계의 수신 시각을
보관하고 새 구독자에게 즉시 전달한다. 화면 종료는 카메라 구독만 해제하며 화면 이동은 SSE를
다시 연결하지 않는다. 숨김 탭은 기한 검사 timer를 멈추고 다시 보이면 즉시 기한을 판정한다.
로그아웃과 session.expired는 SSE를 닫는다. 상태 표시와 수신 유효 기한은
[카메라 상태 매핑](contracts/backend/frontend-mapping.md#카메라-상태)을 따른다.
확인한 코드는 한국어로 변환하고 알 수 없는 코드는 원문을 표시한다.
실측 좌표가 없는 측정 영역은 참고도이며 측정선의 끝점은 표면과 벽면의 경계에 맞춘다.
A 및 B 원의 중심은 끝점에 있고 반투명 면은 센서와 측정선 전체를 연결한다.

현황 및 이력의 시간축 눈금은 최소 1시간, 24시간 조회는 3시간 간격이며 여러 날짜는
자정 기준 날짜 눈금을 사용한다. 표본 좌표와 tooltip의 실제 시각은 변경하지 않는다.
현재 임계율 수치는 점선과 겹치지 않는 위쪽 여백에 표시하고 긴 소수 값은 원본을 유지하며
tooltip 너비를 조정한다. v2 tooltip과 눈금은 `Asia/Seoul`을 사용한다.
현재 임계율 선을 과거 적용 임계율로 표현하지 않는다.

`LiveVideo.tsx`는 Motion JPEG (MJPEG)와 선택적 WHEP (WebRTC-HTTP Egress Protocol)를
분기한다. `mjpeg-client.ts`와 `MjpegVideo.tsx`는 frame 및 연결 수명을,
`whep-client.ts`와 `WhepVideo.tsx`는 제안 검증의 signaling과 연결을 처리한다.
MJPEG는 최초 frame을 최대 3초, 이후 frame을 최대 2초 기다린다. 수신 중단이나 오류에는
기존 연결을 취소하고 250ms, 500ms와 1000ms 간격으로 자동 재연결하며 이후 간격은
1000ms로 유지한다. 정상 frame 표시 뒤에는 재시도 간격을 초기화하며 수동 재연결 버튼은
제공하지 않는다. 인증 오류와 화면 종료는 자동 재연결을 중단한다.
`VideoTimestamp`는 실제 촬영 시각을 우선하고 없으면 마지막으로 표시한 MJPEG frame의
브라우저 수신 시각을 사용한다. 촬영과 영상 수신을 구분하며 snapshot 시각은 사용하지
않는다. 최초 decode 전과 연결 오류에는 숨기고 새 frame 없이 현재 시각으로 갱신하지
않는다. 기본 및 확대 화면에 같은 규칙을 적용한다.

### 이력과 기간 조회

빠른 기간은 최근 24시간, 7일, 30일과 90일이며 기본은 7일이다. 데이터 source의 종료 시각을
기준으로 입력을 채우고 직접 입력은 preset을 해제한다. 기간과 유형은 조회 버튼으로
적용하며 임계율과 추이 선은 이벤트 유형으로 필터링하지 않는다. 잘못된 기간과 `queryHistory`의 Promise reject는
기존 결과를 유지하고 조회 조건 제목 행의 한 줄 안내와 title 및 접근성 설명을 사용한다. v2 적재율 오류 상태가 반환되면 적용된 결과의 그래프 영역에 적재율 오류를 표시한다.
새 조건의 이벤트 조회가 실패하면 이벤트 목록을 비우고 오류를 표시한다.
HTTP source의 이벤트 표는 표에 보이는 페이지만 서버에 요청하며 synthetic source는 메모리의 이벤트를 필터링해 페이지로 나눈다. `queryHistoryEvents`는 표의 페이지 크기(8건),
기간과 유형을 서버의 `pageSize`, `from`, `to`, `category`로 전달한다. 화면 페이지는 0부터
시작하며 서버의 `page`에는 화면 페이지에 1을 더해 전달한다. 화면은 응답의 `page.totalItems`와 `page.totalPages`를 총 건수와 페이지 수로 쓰되 페이지 수는 최소 1로 표시한다.
페이지 이동과 필터 변경은 `useLatestRequest`로 이전 요청을 취소하고 늦은 응답을 무시한다.
이력 화면은 초기 적재율 상태가 `loading`이고 `queryHistory`가 있을 때 진입 직후 적재율 그래프와 이벤트 표를 각각 조회하며 한쪽 응답을 기다리지 않고
표시한다. synthetic source는 기존 이력 데이터를 반환한다. HTTP source의 `queryHistory`는 적재율만 조회하고 이벤트 전체 목록을 만들지 않는다.
`queryHistoryEvents`가 없는 source는 `queryHistory`의 이벤트를 화면에서 나누어 표시한다.
v2 적재율 조회는 최대 90일이며 90일 초과는 요청 전에 안내한다. 장기 조회 중에는 진행 안내를
표시한다.

`DateTimeField`는 `YYYY-MM-DD HH:mm` 직접 입력, 달력과 24시간제 시각 입력을 제공한다.
달력은 방향키, PageUp, PageDown, Escape와 바깥 클릭을 지원한다. 달력의 선택과 focus는
기존 주황색 테마를 사용한다. 기간 계산은 `src/date-range.ts`, 배치는 `.query-controls`가
공유한다.

`DetailDialog`는 화면 위에서 내부 스크롤, 키보드 종료와 focus 복원을 제공한다.
내용 셀을 선택하면 이미 조회한 사건의 시각, 유형, 상태, 서버 제목 및 설명, 서버가 제공한
부가 필드(수거 확인 구분, 감지 기준, 시뮬레이션 출처, reason code)와 관련 영상 링크를
모달에 표시한다. 이벤트 조회는 `collection_scope=all`을 적용하고 관련 영상 링크는
Backend 응답의 유효한 `recordingEventId`로 이벤트 녹화에 연결한다. 서버 원문을 번역하거나 자유 형식 설명으로 재분류하지 않는다.
이벤트 유형 열과 상태 표시 조건은 계약 매핑을 따르며 값이 없는 상태 칸과 색상 원 및
모달 항목은 비워 둔다. 별도 판단 근거 조회와 목록, pit 이름 조회는 제공하지 않는다.
이력 화면 모듈은 화면 진입 때 로드하고 이벤트를 선택하면 상세 dialog를 렌더링하며 기본 표와 카드에 상시 설명을 추가하지 않는다.

### 녹화 조회와 재생

기본 빠른 기간은 7일이며 이벤트 녹화는 선택 기간과 겹치는 영상을 조회하고 날짜 녹화는 선택 범위가 포함하는 한국 날짜 단위로 조회한다. 이벤트 녹화의 최초 종료
시각은 다음 분 경계로 올리고 관련 영상 링크 진입은 단건 식별자로 조회한 영상의 시작 및
종료 분 경계를 사용한다. 이벤트 녹화의 기간은 최대 90일이며 초과하면 조회하지 않고
종료 시각 입력에 안내한다. 조회는 첫 페이지와 첫 영상을 선택하고 요청 표시를 초기화한다.
실제 v2의 기본 source는 날짜 녹화이며 API 날짜와 pagination 변환은 계약을 따른다.

녹화 유형은 전체, 날짜, 수거, 알림과 오류다. 전체는 날짜 목록을 먼저 조회한 뒤 이벤트 페이지를 조회하고
시작 시각 내림차순으로 통합하며 이벤트의 시각은 `occurredAt`을 사용한다. 하나라도 실패하면 기존 결과를 유지하며 식별자는 source와
ID의 조합이다. 날짜 필터는 날짜만, 나머지 유형은 해당 이벤트 녹화만 조회한다.

이벤트 녹화 목록은 `recording-list.ts`의 목록 핸들로 필요한 서버 페이지만 가져온다. 날짜 녹화는
모두 조회하고 이벤트는 첫 요청에 `stable=true&page=1&pageSize=50`을 전달하며 pageSize는 모든
페이지에서 50으로 고정한다. 다음 페이지는 이전 응답의 `snapshotToken`을 `snapshot_token`으로
전달하며 `from`과 `to`는 응답이 제공한 최신 값으로 갱신해 다음 요청에 사용한다. 목록 페이지를 이동할 때 표시에 필요한 순위까지
이벤트가 확보되지 않았으면 다음 서버 페이지를 순서대로 가져오고 확보된 순위에 닿으면 더 요청하지
않는다. 409 `EVENT_LIST_QUERY_CHANGED` 또는 410 `EVENT_LIST_SNAPSHOT_GONE`(오류 code가 없으면 409 또는 410 상태)을 수신하면 이전 페이지를
버리고 토큰 없이 1페이지부터 다시 조회한다. 만료 판단은 `snapshotExpiresAt`과 `asOf`의 차이로
계산한 수명을 응답 수신 시각에 더한 로컬 만료 시각을 기준으로 하며, 값이 없거나 해석할 수 없으면
사전 재시작을 하지 않고 서버의 410 응답에 맡긴다. 한 번의 ensure 호출 안에서 만료와 409 및 410
재시작의 합은 최대 1회로 제한한다. 제한을 소진한 뒤에는 만료로 보여도 재시작하지 않고 현재 토큰으로
요청하며, 재시작 뒤 다시 409나 410이 오면 오류로 던진다. snapshot 병합 중 선택된 영상 ID가 유지되면 선택을 유지하고 목록 페이지를 이동하면 새 페이지의 첫 영상을 선택한다.
날짜 녹화와 병합 시 이벤트 쪽 비교 시각은
`occurredAt`을 사용하고 서버 순서(`occurredAt` 내림차순, 같은 시각은 `eventId` 내림차순)를 보존한다.
전체 건수는 날짜 녹화 수와 이벤트 `totalItems`의 합이며 `eventId` 중복은 제거한다. 기간, 유형과 필터를 바꾸면 처음부터 다시 조회한다. 이벤트만 보는 필터는 서버 `category`와
페이지를 그대로 쓴다. v1 녹화 목록은 서버 페이지 정렬 계약이 없어 한 번에 가져온다.
`queryRecordings`는 전체 목록이 필요한 다른 기능을 위해 모든 페이지를 조회하는 별도 경로로 유지한다.

`domain/daily-recording.ts`의 `DailyRecording`은 구간 배열을 포함하는 `DailyRecordingFull`과
구간 수만 포함하는 `DailyRecordingSummary`의 판별 가능한 union(`view: "full" | "summary"`)으로
정의한다. `event-recordings.ts`는 이벤트 녹화 목록과 상세의 검증 및 화면 모델 변환,
`daily-recordings.ts`는 날짜 녹화의 full 및 summary parser 분기와 확보 및 누락 및 압축 재생
시각의 검증, `daily-recording-api.ts`는 날짜 목록과 단건, export 및 삭제를 처리한다.
`daily-recording-api.ts`의 목록 조회는 `view=summary`를 전달하고 요약 응답의 `gap_count`,
`available_interval_count` 및 `has_gaps` 일치를 검증하며 목록 단계의 `Recording.gaps`는 undefined로
둔다. 녹화 화면(`RecordingsPage.tsx`)은 요약 녹화 선택 시 단건 상세 GET으로 full 녹화를 받아
목록 항목을 교체하기 전까지 재생 로딩 상태를 표시하고 timeline 및 누락 구간 버튼 표시를 유보한다.
`recording-coverage.ts`는 제안 모드의 clip 범위를 처리한다. 날짜 모듈은 필요할 때 로드하고 Media
내부 경로를 직접 요청하지 않는다. 날짜 녹화 응답의 검증은 `gaps`와 `available_intervals`의 구간 경계를
숫자 값으로 저장해 범위 검증에 재사용하고, 날짜 형식 검증 결과는 날짜별로 재사용한다.

`DailyRecordingVideo`는 `hls.js/light`를 지연 로드하고 Media Source Extensions (MSE)
지원 시 사용하며 미지원은 native HLS (HTTP Live Streaming)를 사용한다. MSE의 첫 위치와
확대 복원은 `startPosition`, native HLS는 metadata 수신 후 한 번 적용한다. Worker는
사용하지 않고 session Cookie를 사용한다. `hls.js` 경로는 같은 origin의 같은 날짜 playlist와 segment만 요청하며
redirect를 거부한다. 종료 및 선택 변경은 player, 요청과 Blob URL을 정리한다.

`EventReplayPlayer`는 이벤트 구간을 `parts`의 날짜 녹화 HLS로 이어서 재생한다. 원본 video
controls 대신 재생 버튼과 0초부터 `playbackSeconds`까지의 재생바를 제공하며 part 사이의
경계를 표시한다. 재생바 탐색은 해당 part의 날짜 녹화 안 위치로 변환하고, part의 끝에서
다음 part의 시작으로 이동하며 마지막 part의 끝에서 정지한다. 확대는 기본 player를 정지하고
현재 재생바 위치에서 시작한다. 닫으면 확대 player를 정지하고 마지막 재생바 위치로 기본
player를 이동시키며 기본 player는 정지 상태를 유지한다. 확대 중 기본 player의 위치
보고는 표시 위치를 바꾸지 않는다.

날짜 녹화 삭제는 administrator의 상세 화면에서만 표시한다. 녹화 중, 마감 중과 내보내기
진행 중에는 숨기며 확인창은 같은 날짜 영상을 쓰는 이벤트 구간도 재생할 수 없게 됨을
알린다. 삭제 버튼은 녹화 파일 카드의 다운로드 버튼과 같은 줄에 두고, 삭제 완료 안내는
카드의 기존 안내 문단을 대체해 카드 높이를 바꾸지 않는다. 삭제 후 목록에서 해당 녹화를
제거하고 그 날짜 영상을 쓰던 이벤트 항목의 재생 정보를 무효화해 `processing`으로 표시하며 선택된 항목의 상세를 다시 조회한다.

확대는 기본 player를 pause하고 같은 위치에서 시작한다. 일반 video의 확대 player가 frame을 확보하고
seek가 끝난 경우에만 닫을 때 기본 player의 위치를 갱신하며 이벤트 player는 보고된 재생 위치를 사용한다. 확대 중 기본 player의
time update는 표시 시각을 변경하지 않는다. Source 변경은 다운로드 재조회와 이전 완료
표시를 취소한다. 확대 창의 Tab과 Shift+Tab 순환에는 닫기 버튼과 `controls`가 있는
video 및 audio를 포함한다. focus가 해당 media 요소에 있으면 Tab을 가로채지 않아 브라우저가
native controls로 focus를 옮기고, media 요소에서 Tab 또는 Shift+Tab을 누른 뒤 focus가 창 밖으로 나가면 이동 방향에 따라 창 안의 첫 요소
또는 마지막 요소로 되돌린다. Escape는 focus 위치와 무관하게 창을 닫는다. 제품의 HLS license는
`/usr/share/licenses/scrap-monitoring-dashboard/Hls-Apache-2.0.txt`에 포함한다.

날짜 시간축은 확보, 누락, 미확인과 미래 구간을 구분한다. 확보 구간은 압축 재생 시각으로
이동하고 누락은 재생 가능한 구간으로 표현하지 않는다. 경계를 한 번씩 파싱하고 정렬해
순차 탐색한다. 범위와 관측점이 256개를 초과하면 같은 상태를 SVG (Scalable Vector
Graphics)의 path로 묶으며 모든 원본 경계와 누락을 유지한다. 마우스 위치로 구간을 판별하고
256개 초과 표시에서는 방향키, Home과 End로 확보 구간을 선택한 뒤 Enter로 재생하며 그 외 표시에서는 각 확보 구간이 개별 버튼이다. 시간축 계산은 녹화 정보와
판단 시각이 변할 때 수행하며 재생 시각 갱신에는 재사용한다.

### 녹화 상태와 다운로드

녹화 화면은 데이터 상태와 무관하게 5개 카드와 영상 프레임을 유지하고 정보 카드에
스크롤을 제공하지 않는다. 후속 목록 조회 실패는 기존 결과를 유지하며 안내 문단을
추가하지 않는다. 실제 영상의 형식, codec과 크기 및 보관 시각은 서버 응답을 변환한다.
서버 기본값은 유지하되 파일 생성 성공으로 간주하지 않으며 미제공 metadata는 보충하지
않는다. 목록에서는 길이의 결측 문구를 숨기고 정보 카드에는 정보 없음을 유지한다.

상태 표시는 hover와 선택으로 popover를 열어 사용자용 사유, 짧은 오류 코드와 누락 수를
표시한다. 오류 원문 및 stack trace는 서버 로그에서 확인한다. 영상 없음은 별도 popup으로
표시하지 않는다. 녹화 범위 상세 창은 v1 media clip의 부분 저장 버튼뿐 아니라 누락 구간이 있는 이벤트 상세와 날짜 녹화의 누락 구간 버튼에서도 열린다.
v1 clip 상세는 `getRecordingCoverage`로 추가 조회하고 이벤트와 날짜 누락 상세는 선택한 녹화 객체의 데이터를 사용한다.
이벤트 창은 요청 구간, 요청 및 확보와 재생 길이, 누락 구간의 시작과 종료 시각 및 종류와 사유 코드를 표시한다.
날짜 창은 녹화 날짜와 누락 구간의 시작 및 종료 시각과 사유 코드를 표시한다.
v1 clip 상세의 요청과 확보 시각 및 누락 구간 시각도 한국 표준시로 표시한다.
구간별 누락 원인은 API에서 제공하지 않는다는 문구는 v1 clip 상세에만 유지한다.
녹화 목록 미리보기 썸네일은 날짜 녹화 및 이벤트 녹화에 대해 thumbnail-info API를 조회해 연결한다. 날짜 녹화는 status가 recording, finalizing, closed, failed인 항목을 조회 대상에 포함하며 expired와 deleted는 제외한다. 이벤트 녹화는 `dailyThumbnailInfoPath`가 제공되면 이를 날짜 대표 이미지 경로(`/api/v2/recordings/daily/by-date/{YYYY-MM-DD}/thumbnail-info`)로 우선 사용하고, 응답이 null, unavailable 또는 오류여도 clip 흐름으로 대체하지 않는다. `dailyThumbnailInfoPath`가 없을 때만 `thumbnailInfoPath`(`/api/v2/recordings/events/{event_id}/thumbnail-info`)와 기존 clip ID 흐름을 순차적으로 유지한다. 이벤트와 clip 대상의 ready 정보는 같은 data source와 계정의 화면 재진입에서 메모리로 재사용한다. 날짜 녹화의 ready 정보는 화면에서 status가 closed 또는 failed로 확인될 때 재사용한다. 날짜 대표 이미지는 화면 재진입 시 다시 조회한다. data source 또는 계정이 변경되거나 새 document가 로드되면 메모리 캐시를 폐기한다. 목록 이미지는 lazy loading과 비동기 decoding을 사용한다. 이미지 응답의 cache 정책은 [썸네일 location](deployment.md#nginx-reverse-proxy-배포-경계)을 따른다. 동시 요청은 최대 3개로 제한하며 화면에 보이는 항목과 선택 녹화만 조회하고, 페이지 이동이나 조건 변경 시 진행 중인 요청은 abort한다. 캐시 키는 날짜 대표 이미지와 이벤트 경로 대상 모두 전체 경로를 사용해 동일 날짜나 조건 변경을 분리한다. 날짜 대표 이미지 응답의 `recording_id`는 canonical 소문자 UUID여야 하며, ready 판정의 `content_path`는 `/media/daily-recordings/{recording_id}/thumbnail`과 일치해야 한다. ready이면서 `representative_at=null`, `time_basis=null`, `reason_code=TIMELINE_UNAVAILABLE`인 응답도 정상 이미지로 허용한다. 썸네일 응답이 `null`이면 정상 결과로 취급해 목록은 기존 "미리보기 없음", 녹화 상태 상세 popover의 대표 이미지는 날짜 대표 이미지 대상(`dailyDate`)의 경우 "날짜 대표 이미지 없음", 그 외 대상(이벤트와 날짜 녹화 `daily`)의 경우 "연결된 구간 파일 없음"으로 표시하고 원본 녹화 부재로 해석하지 않는다. `unavailable` 상태 중 사유가 `RECORDING_BUSY`인 항목은 보류로 취급해 pending과 동일하게 5초, 10초, 20초 간격으로 최대 3회 재조회하며 상태 상세 popover의 대표 이미지는 "녹화 중 생성 보류"로 표시한다. ready 상태는 `content_path`가 규칙과 일치할 때만 이미지 자리에 표시하고 선택 녹화의 재생 컴포넌트 poster로 연결하며, 날짜 대표 이미지는 상태 상세 문구 앞에 "날짜 대표 이미지" 접두어를 붙인다(예: "날짜 대표 이미지, 서버 수신 기준 {시각}", "날짜 대표 이미지, 시각 정보 없음"). 그 외 상태나 `content_path` 불일치 및 이미지 로드 실패 시에는 thumbnail-info 이미지를 제거하고 목록은 기존 `thumbnailUrl` 또는 sample 이미지가 있으면 이를 사용하며 없으면 "미리보기 없음"을 유지한다. 재생 컴포넌트 poster는 기존 `thumbnailUrl`로 대체한다. 404와 410 응답은 재사용하고 5xx와 네트워크 실패는 캐시하지 않는다. pending 상태는 5초, 10초, 20초 간격으로 최대 3회 재조회하며 failed 상태는 자동 재시도하지 않는다. 이벤트 대상과 날짜 녹화 대상의 ready 시각은 time_basis가 server_received_at이면 "서버 수신 기준 {시각}", 대표 시각이 없으면 "시각 정보 없음"으로 표시한다. 관리자에게만 미준비(`unavailable/NOT_PREPARED`) 또는 failed 상태의 준비/재시도 버튼을 제공한다. 이벤트 대상에서는 응답의 `clip_id`로 기존 clip 준비 POST를 호출하고 성공 뒤 해당 이벤트 대상을 다시 조회해 pending 재조회로 연계한다. 날짜 대표 이미지 대상과 `RECORDING_BUSY` 보류 상태에는 준비 버튼을 제공하지 않으며 날짜 대표 이미지 대상의 준비 요청은 거부한다.
`RecordingsPage`는 이벤트 선택 시 `findEventRecordingExport`로 서버 작업을 복구한다.
선택 변경은 조회와 준비 요청을 abort하고 늦은 응답을 무시한다. 복구와 POST 응답의 requestId는
이후 명시 재시도에 사용하고 상태 조회는 응답 statusPath를 사용한다. 서버 조회 복구, 요청별 UUID와
상태 및 다운로드 조건과 영상 없는 이벤트(`EVENT_RECORDING_UNAVAILABLE`)의 안내는
[녹화 매핑](contracts/backend/frontend-mapping.md#녹화)을 따른다.
녹화 중 상태에 누락 여부를 덧붙이지 않으며 시간축과 상세에서 확인한다.

녹화 정보 카드의 비디오 코덱, 해상도, 화면 비율, 프레임 속도와 파일 용량은 날짜 녹화의 경우
`GET /api/v2/recordings/daily/{recording_id}/media-info`, 이벤트 녹화는 구간 파일이 ready이고
`clipId`가 있을 때 `GET /api/v1/media/clips/{clip_id}/media-info`로 조회해 표시한다. 날짜 녹화의
file이 null이면 "날짜 MP4 준비 전", 이벤트 준비 전이면 "구간 파일 준비 후 확인", HTTP 409는
"준비 전", 410은 "파일 삭제 또는 만료", 그 외 실패는 "조회 안 됨", 정보 없으면 "정보 없음"으로 표시한다. 날짜 녹화의 조각(segments) 정보는 미디어 정보 다섯 항목의
`title`에 표시한다. 다섯 항목의 title에는 파일의 `measured_at`과 `metadata_origin`을
"파일 검사 시각: {시각} (한국 표준시), 측정값 출처: {출처}"로 덧붙이고 시각이 null이면 "정보 없음",
날짜 녹화의 file이 null이면 "파일 정보 없음"으로 둔다. 파일 검사 시각은 segments 줄에 쓰지 않는다.
서버가 성공으로 응답한 파일 정보는 완성 전이라도 화면 열람 중 메모리 캐시에 보관하여 재선택 시
재조회하지 않으며(deleted 및 expired 제외), `localStorage`에는 완성된 파일(ready)만 v2 key로 저장하고
검사 시각이 없는 v1 key는 읽지 않고 지운다. 미디어 정보 조회의 동시 요청은 2개로 제한하고 대기 큐와
동일 키 요청 병합을 적용한다. 실패 응답은 캐시하지 않으며 날짜 녹화의 현재 파일 크기와
캐시된 파일 크기가 모두 존재하고 다르면 캐시를 폐기하고 재조회한다.

오늘 녹화의 다운로드 불가는 정상적인 제한이다. 지난 날짜의 준비와 상태 조회는 같은
파일 카드에서 처리하고 준비된 경로만 다운로드한다. 재생 오류와 export 오류는 분리하며
한 경로의 실패로 다른 경로를 비활성화하지 않는다. 원본 보관 만료와 export cache 만료도
구분한다. 날짜 녹화는 `deleted_at`, `cleanup_state`, `cleanup_completed_at`, `cleanup_error`를
보존하고 `space_reclaimed`는 null만 허용한다. `status`가 deleted 또는 expired면 보관 만료에 "삭제됨" 또는
"만료됨"을 표시하며, 삭제 뒤 남은 `export_state`를 다운로드 가능으로 해석하지 않는다.
녹화 상태 상세 창은 파일 정리 상태(pending: "파일 정리 중", failed: "파일 정리 실패" 및 오류 코드,
complete: "파일 정리 완료" 및 완료 시각, null: "정보 없음")를 표시한다. `space_reclaimed`는 숫자나
회수 완료로 표시하지 않는다.

단건은 선택 및 조회 때 확인한다. `recordingId` 직접 링크로 연 녹화는 화면 진입 조회가 받은 단건을 첫
확인으로 재사용한다. 녹화 `status`가 `processing`(이벤트 구간 `PROCESSING`과 재생 상태가 `pending`인 날짜 녹화 포함)이거나 media 상태가 `collecting` 또는 `processing`이거나 날짜 녹화가 recording, finalizing 또는
export processing일 때만 2초 간격으로 갱신한다. 일시적인 네트워크 오류와
HTTP 408, 429, 500, 502, 503, 504는 2초, 4초와 8초 간격으로 최대 세 번 재시도한다.
확인된 재생은 유지하되 날짜 녹화의 다운로드와 준비는 재확인 전 제한한다. 이벤트 구간 파일 버튼은 단건 재확인과 무관하게 `exportPath`와 export 상태에 따른다. 권한 오류, 삭제와 만료는
재시도하지 않고 기존 재생을 중단한다. 별도 새로고침 버튼은 제공하지 않는다.

### 관리자 설정과 알림

관리자 화면은 서버 설정과 수신 대상으로 초기화한다. 수거 임계율은 5~100의 정수이고 사전
기준은 0 이상이며 수거 임계율보다 5%p 이상 낮은 정수로 검증한다. 저장은 서버 응답을 적용하고 취소는 마지막 저장값을 복원한다.
수거 및 알림 정책은 같은 resource여서 저장 중 두 영역의 입력과 버튼을 잠근다.
대상 생성과 편집은 저장 중 입력과 닫기를 잠근다. 알림 채널은 이메일만 제공하고
SMS (Short Message Service)는 선택지에서 제외하며 서버로 전송하지 않는다. 대상 전화번호는
연락처 정보로 유지하며 문자 수신용 전화번호 필수 검증은 적용하지 않는다. 수신 대상 표와
상세의 채널 표시는 이메일 또는 "-"로 나타낸다. 비어 있는 이벤트 목록을 전송하지 않으며
충돌에는 입력과 적용값을 보존한다. 서버의 실제 발송과 정책 적용 범위는
[관리자 협의 항목](contracts/backend/frontend-mapping.md#관리자-설정과-알림의-협의-항목)을 따른다.

저장 및 테스트 피드백은 기존 안내 위치를 사용하고 새 문단으로 카드를 늘리지 않는다.
422 검증 오류 중 `type=alert_threshold_gap`, `loc=["body","preCollectionAlert","thresholdPercent"]`는
사전 알림 임계율 입력 칸의 오류로 연결해 `aria-invalid`와 오류 스타일을 적용하고, `ctx.minimumGap`과
`ctx.collectionThresholdPercent`로 구성한 안내 문구를 기존 피드백 위치에 표시한다.
테스트 대상은 등록 인원의 사용 여부와 무관하게 전체 등록 인원에서 선택하며 채널은 이메일만
요청한다. 202 본문의 `emailDeliveryId`가 영문자, 숫자와 하이픈으로 구성된 36자 문자열이면 기존 안내 위치에 발송 상태를 표시하고 `QUEUED`와
`SENDING` 동안 최초 즉시 조회를 포함해 최대 20회 조회하며 이후 조회는 이전 응답을 받은 3초 뒤 시작한다. 새 테스트 요청, 대상 변경과 화면 이탈은 진행 중인
재조회를 중단한다. 상태 의미와 재전송 금지는 관리자 협의 항목을 따른다. 중복 요청을 막고 일반 관리자 요청에서는 이전
source의 늦은 응답을 막는다. 테스트 접수 후 알림함을 재조회하며 후속 실패로 접수를 실패로
바꾸지 않는다. 실제 수신을 접수 성공으로 단정하거나 고정 발송 본문을 표시하지 않는다.
대상 및 설정은 요청값이 아닌 서버가 반환한 값을 사용한다.

`Dropdown`은 방향키, Home, End, Enter와 Space를 지원하고 Escape는 변경 없이 닫는다.
Tab과 바깥 클릭도 닫으며 긴 연락처는 기존 너비에서 생략하고 title로 원문을 제공한다.
설정 패널의 닫기 및 focus 영역은 유지한다.

버튼 문구는 한국어 단어 단위로 줄바꿈하며 단어가 사용 가능한 너비보다 길 때만 단어 중간에서 끊는다. 1280 CSS 픽셀 너비의
"수거 설정 저장" 버튼도 버튼 크기를 바꾸지 않고 공백에서만 줄바꿈한다.

### 선택적 v1과 제안 검증

실제 v2의 미제공 측정값은 v1이나 synthetic 값으로 보충하지 않는다. 선택한 v1 모드의
LiDAR profile은 LiDAR 1 및 LiDAR 2 slot에 고정하고 결측과 무효 표본은 선으로 연결하지
않는다. v1 현황은 사전 기준과 활성 여부를 snapshot에서 표시한다.

v1 SSE는 최근 event ID 1024개로 중복을 제거하고 알림함은 최근 20건으로 제한한다.
재동기화는 snapshot과 개인 알림을 조회하며 같은 영역의 새 event 뒤 도착한 응답은
폐기한다. 선택적 WHEP는 `201 Created`의 ETag (Entity Tag)와 trickle ICE 협상을 확인하고,
`406 Not Acceptable`은 ICE 수집 후 `If-Match` 없이 전체 answer를 보낸다.
`Retry-After`는 재연결 지연에 사용한다. 확대와 종료는 기존 live stream을 닫고 동시에
활성인 영상 연결은 하나로 유지한다.

## 제품 구현 결정 상태

### 결정이 필요한 범위

다음 항목은 결정 대기 상태다.

- 장기 운영의 계정 제공, session 저장 및 수명 정책
- 실제 적재율 산출, calibration과 현장 측정 정확도
- 센서와 화면 slot의 대응, 측정 영역 실측 배치와 실제 수거 작업 상태의 계약

제품 및 외부 의미의 상세 책임은 [계약 매핑](contracts/backend/frontend-mapping.md)을
따른다. 환경별 upstream, DNS, readiness, timeout, 요청 제한, TLS와 Content Security
Policy (CSP) 값은 [배포 Repository 책임](deployment.md#제품-배포-경계)을 따른다.

## 제품 배포 경계

제품 이미지와 환경별 책임은 [배포 경계](deployment.md#제품-배포-경계)를 따른다.

## Runtime 설정

설정 검증과 mount는 [Runtime 설정](deployment.md#runtime-설정)을 따른다.

## Nginx reverse proxy 배포 경계

인증과 영상 경로 주입은 [Nginx 배포 경계](deployment.md#nginx-reverse-proxy-배포-경계)를 따른다.

## TLS 인증서 운영

인증서 검사와 교체는 [TLS 운영](deployment.md#tls-인증서-운영)을 따른다.

## 정적 검사와 테스트 기준선

검사 계층, 계약 갱신과 빌드 예산은 [검증 기준](testing.md)을 따른다.

## 개발과 검증 컨테이너

실행과 종료는 [개발 환경](development.md#개발과-검증-컨테이너)을 따른다.

### 원격 개발 컨테이너

Source 동기화와 읽기 중심 화면 확인은 [원격 개발](development.md#원격-개발-컨테이너)을 따른다.
