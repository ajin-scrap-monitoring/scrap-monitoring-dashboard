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
`.node-version`은 개발 및 검증 컨테이너와 CI가 사용하는 정확한 Node.js 버전의 정본이다.
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
현재 개발 및 브라우저 검증 기준은 데스크톱 Chrome, 최소 너비 1280 Cascading Style
Sheets (CSS) 픽셀, 기본 Full HD (FHD) 1920 x 1080 뷰포트다. 높이를 초과하는
콘텐츠는 페이지 세로 스크롤을 사용한다. 정확한 Chrome 최소 버전은 결정 대기 상태다. 실제
접속 단말의 Chrome 버전을 확인한 뒤 Vite 빌드 출력과 브라우저 Web API (Application
Programming Interface) 호환성을 검증한다.

## 코드 구조와 작업 재개 기준

### 진입점과 화면 구성

`src/main.tsx`는 data source를 생성해 `App`에 주입한다. 운영 이미지의
`RuntimeConfiguredApp`은 검증한 runtime 설정 뒤 HTTP data source를 초기화하며,
개발 및 synthetic source의 선택 경계는 아래 데이터 소스 절을 따른다.

`src/App.tsx`는 `/`, `/history`, `/recordings`, `/login`과 `/admin`을 분기한다.
메뉴 이동은 document navigation이며 앱과 session 조회를 다시 시작한다. 이력, 녹화와
관리자 모듈은 해당 화면의 초기 데이터 조회와 병렬로 로드하며 로그인 모듈은 로그인
화면에서만 로드한다. Client-side routing과 화면 간 공통 캐시는 현재 구현에 포함하지 않는다.

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
성공한 뒤 실시간 구독을 시작한다. HTTP adapter의 초기 조회는 session, monitoring snapshot과
화면별 조회 순서이며 알림을 포함한 병렬 조회 묶음이 끝난 뒤 결과를 반환한다. 보조 조회의
실패는 영역별 상태로 처리하지만 느린 응답의 대기까지 분리되어 있지는 않다.

HTTP 요청은 응답 body 수신을 포함해 10초로 제한한다. 같은 화면 초기화 요청에 같은
AbortSignal을 전달하고 화면 종료는 요청을 취소한다. Timeout은 `REQUEST_TIMEOUT`으로
구분하며 이미 수신한 401과 403은 권한 오류로 유지한다. `DataAreaState`는 실패, 미지원과
이전 응답 사용을 구분한다. 권한 오류는 보조 실패로 숨기지 않는다.

`src/use-latest-request.ts`는 후속 목록 조회, source 변경과 화면 종료 시 이전 요청을
취소하며 화면은 취소한 요청의 늦은 성공 및 오류를 적용하지 않는다. 현황 전용 최근
24시간 추이와 최근 완료 이력은 현황에서만 조회하고 약 1분 간격으로 갱신한다.
같은 snapshot의 재수신은 완료 조회 간격을 줄이지 않으며 같은 경보 ID의 알림 조회를
중복 실행하지 않는다.

화면 시각의 표시와 기간 입력의 해석은 `src/display-time.ts`의 `Asia/Seoul`(+09:00)로
고정하며 브라우저 시간대를 사용하지 않는다. HTTP 요청은 offset을 포함한 ISO 8601을
사용하고 서버의 UTC 원본은 보존한다.

### 데이터 소스와 synthetic 시나리오

`src/data/http-dashboard-data-source.ts`는 Backend 응답 변환, HTTP 요청과
Server-Sent Events (SSE)를 처리한다. 운영 빌드는 HTTP adapter를 사용한다.
개발 서버는 `VITE_DEV_DATA_SOURCE`로 기본 source를 선택하며 미설정은 synthetic이다.
`source=api`, `source=mock`과 session에 저장한 선택은 개발 기본값보다 우선한다.
Production은 이 선택과 제안 검증용 sessionStorage 값을 사용하지 않는다.

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

Runtime 설정, 최초 데이터와 화면 모듈의 로딩 중에는 메뉴 탭과 사용자 도구를 숨기고
헤더 높이를 유지한다. 준비 뒤 확인한 session과 역할에 맞는 메뉴를 한 번에 표시한다.
조회 오류 화면은 확인된 사용자 정보를 사용한다. 긴 사용자명은 title에 원문을 유지하고
생략 표시한다. `viewer`의 기본 이름인 현장 운영자는 조회 사용자로 표시하며 다른 이름은
Backend 응답을 유지한다.

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
bucket 및 결측을 검사한다. `load-one-hour-ago.ts`는 같은 이력의 과거 관측을 선택하며
초기 조회, snapshot과 약 1분 간격 조회에 적용한다. Source 변경과 조회 실패는 값을 지우고
별도 요청이나 장기 저장소는 사용하지 않는다. 수치와 상태의 해석은
[화면 데이터 매핑](contracts/backend/frontend-mapping.md)이 정본이다.

`collection-summary-v2.ts`, `fill-forecast-v2.ts`, `lidar-profiles-v2.ts`,
`active-alerts-v2.ts`와 `measurement-layout-v2.ts`는 현황 보조 응답을 검증해 화면 모델로
변환한다. HTTP adapter는 이 응답들을 하나의 묶음으로 조회해 약 1분마다 갱신하며, 보조
조회의 실패는 해당 값만 정보 없음으로 표시하고 인증 오류는 숨기지 않는다. 예상 도달은
`validUntil` 경과와 재연결 중에 숨기고 적재율 활성 알림은 평가 상태가 snapshot과 같을
때만 표시한다. 장비 활성 알림은 평가 상태와 무관하게 표시한다. `error-body.ts`는 Backend의
3가지 오류 본문을 하나의 코드, 메시지와 검증 항목으로 정규화한다.
`simulated`가 true인 값은 기존 카드 안에 시뮬레이션 보조 표기를 더한다.

추정 적재율 아래 6개 지표는 같은 크기의 2행 3열 카드다. 제목은 작고 옅게, 값은 같은
글자색으로 크고 진하게 표시한다. 판단 불가는 경보 색상 대신 중립 회색과 작은 글씨를
사용하며 수치와 같은 높이의 영역을 유지한다. 경보 평가 미제공은 미지원으로 표시하고
원본 판단 사유와 capability는 모델에 보존하되 별도 진단 버튼은 제공하지 않는다.

장비 카드는 장비명과 보고된 상태만 표시하고 scan 및 진행 시각과 latency는 표시하지
않는다. 확인한 코드는 한국어로 변환하고 알 수 없는 코드는 원문을 표시한다.
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
적용하며 임계율과 추이 선은 이벤트 유형으로 필터링하지 않는다. 잘못된 기간과 조회 실패는
기존 결과를 유지하고 조회 조건 제목 행의 한 줄 안내와 title 및 접근성 설명을 사용한다.
이벤트 표는 표에 보이는 페이지만 서버에 요청한다. `queryHistoryEvents`는 표의 페이지 크기(8건),
0부터 시작하는 페이지, 기간과 유형을 서버의 `page`, `pageSize`, `from`, `to`, `category`로
전달하고 응답의 `page.totalItems`와 `page.totalPages`를 총 건수와 페이지 수로 쓴다.
페이지 이동과 필터 변경은 `useLatestRequest`로 이전 요청을 취소하고 늦은 응답을 무시한다.
이력 화면은 진입 직후 적재율 그래프와 이벤트 표를 각각 조회하며 한쪽 응답을 기다리지 않고
표시한다. `queryHistory`는 적재율만 조회하고 이벤트 전체 목록을 만들지 않는다.
`queryHistoryEvents`가 없는 source는 `queryHistory`의 이벤트를 화면에서 나누어 표시한다.
적재율 조회는 최대 90일이며 90일 초과는 요청 전에 안내한다. 장기 조회 중에는 진행 안내를
표시한다.

`DateTimeField`는 `YYYY-MM-DD HH:mm` 직접 입력, 달력과 24시간제 시각 입력을 제공한다.
달력은 방향키, PageUp, PageDown, Escape와 바깥 클릭을 지원한다. 달력의 선택과 focus는
기존 주황색 테마를 사용한다. 기간 계산은 `src/date-range.ts`, 배치는 `.query-controls`가
공유한다.

`DetailDialog`는 화면 위에서 내부 스크롤, 키보드 종료와 focus 복원을 제공한다.
내용 셀을 선택하면 이미 조회한 사건의 시각, 유형, 상태, 서버 제목 및 설명, 서버가 제공한
부가 필드(수거 확인 구분, 감지 기준, 시뮬레이션 출처, reason code)와 관련 영상 링크를
모달에 표시한다. 이벤트 조회는 `collection_scope=all`을 적용하고 관련 영상 링크는 자동
수거를 제외한 이력 `id`로 이벤트 녹화에 연결한다. 서버 원문을 번역하거나 자유 형식 설명으로 재분류하지 않는다.
이벤트 유형 열과 상태 표시 조건은 계약 매핑을 따르며 값이 없는 상태 칸과 색상 원 및
모달 항목은 비워 둔다. 별도 판단 근거 조회와 목록, pit 이름 조회는 제공하지 않는다.
상세 모듈은 선택할 때 로드하고 기본 표와 카드에 상시 설명을 추가하지 않는다.

### 녹화 조회와 재생

기본 빠른 기간은 7일이며 선택 기간과 겹치는 영상을 조회한다. 이벤트 녹화의 최초 종료
시각은 다음 분 경계로 올리고 관련 영상 링크 진입은 단건 식별자로 조회한 영상의 시작 및
종료 분 경계를 사용한다. 이벤트 녹화의 기간은 최대 90일이며 초과하면 조회하지 않고
종료 시각 입력에 안내한다. 조회는 첫 페이지와 첫 영상을 선택하고 요청 표시를 초기화한다.
실제 v2의 기본 source는 날짜 녹화이며 API 날짜와 pagination 변환은 계약을 따른다.

녹화 유형은 전체, 날짜, 수거, 알림과 오류다. 전체는 날짜와 이벤트 목록을 병렬 조회하고
시작 시각 내림차순으로 통합한다. 하나라도 실패하면 기존 결과를 유지하며 식별자는 source와
ID의 조합이다. 날짜 필터는 날짜만, 나머지 유형은 해당 이벤트 녹화만 조회한다.

이벤트 녹화 목록은 `recording-list.ts`의 목록 핸들로 필요한 서버 페이지만 가져온다. 날짜 녹화는
모두 조회하고 이벤트는 첫 화면에 서버 1페이지(20건)만 받는다. 목록 페이지를 이동할 때
표시에 필요한 순위까지 이벤트가 확보되지 않았으면 다음 서버 페이지(100건)를 순서대로 가져오고
확보된 순위에 닿으면 더 요청하지 않는다. 전체 건수는 날짜 녹화 수와 이벤트 `totalItems`의
합이며 `eventId` 중복은 제거하고 선택한 영상은 유지한다. 기간, 유형과 필터를 바꾸면
처음부터 다시 조회한다. 이벤트만 보는 필터는 서버 `category`와 페이지를 그대로 쓴다. 서버 이벤트
순서가 시작 시각 내림차순에 가깝다는 전제로 합친다. v1 녹화 목록은 서버 페이지 정렬 계약이 없어
한 번에 가져온다. `queryRecordings`는 전체 목록이 필요한 다른 기능을 위해 모든 페이지를
조회하는 별도 경로로 유지한다.

`event-recordings.ts`는 이벤트 녹화 목록과 상세의 검증 및 화면 모델 변환, `daily-recordings.ts`는
날짜와 확보 및 누락 및 압축 재생 시각의 검증, `daily-recording-api.ts`는 날짜 목록과 단건,
export 및 삭제를 처리한다. `recording-coverage.ts`는 제안 모드의 clip 범위를 처리한다. 날짜 모듈은 필요할 때 로드하고 Media 내부 경로를 직접 요청하지 않는다.

`DailyRecordingVideo`는 `hls.js/light`를 지연 로드하고 Media Source Extensions (MSE)
지원 시 사용하며 미지원은 native HLS (HTTP Live Streaming)를 사용한다. MSE의 첫 위치와
확대 복원은 `startPosition`, native HLS는 metadata 수신 후 한 번 적용한다. Worker는
사용하지 않고 session Cookie로 같은 origin의 같은 날짜 playlist와 segment만 요청하며
redirect는 거부한다. 종료 및 선택 변경은 player, 요청과 Blob URL을 정리한다.

`EventReplayPlayer`는 이벤트 구간을 `parts`의 날짜 녹화 HLS로 이어서 재생한다. 원본 video
controls 대신 재생 버튼과 0초부터 `playbackSeconds`까지의 재생바를 제공하며 part 사이의
경계를 표시한다. 재생바 탐색은 해당 part의 날짜 녹화 안 위치로 변환하고, part의 끝에서
다음 part의 시작으로 이동하며 마지막 part의 끝에서 정지한다. 확대 화면은 현재 재생바
위치에서 시작한다.

날짜 녹화 삭제는 administrator의 상세 화면에서만 표시한다. 녹화 중, 마감 중과 내보내기
진행 중에는 숨기며 확인창은 같은 날짜 영상을 쓰는 이벤트 구간도 재생할 수 없게 됨을
알린다. 삭제 버튼은 녹화 파일 카드의 다운로드 버튼과 같은 줄에 두고, 삭제 완료 안내는
카드의 기존 안내 문단을 대체해 카드 높이를 바꾸지 않는다. 삭제 후 목록에서 해당 녹화를
제거하고 그 날짜 영상을 쓰던 이벤트 구간의 상세를 다시 조회한다.

확대는 기본 player를 pause하고 같은 위치에서 시작한다. 확대 player가 frame을 확보하고
seek가 끝난 경우에만 닫을 때 기본 player의 위치를 갱신한다. 확대 중 기본 player의
time update는 표시 시각을 변경하지 않는다. Source 변경은 다운로드 재조회와 이전 완료
표시를 취소한다. 제품의 HLS license는
`/usr/share/licenses/scrap-monitoring-dashboard/Hls-Apache-2.0.txt`에 포함한다.

날짜 시간축은 확보, 누락, 미확인과 미래 구간을 구분한다. 확보 구간은 압축 재생 시각으로
이동하고 누락은 재생 가능한 구간으로 표현하지 않는다. 경계를 한 번씩 파싱하고 정렬해
순차 탐색한다. 범위와 관측점이 256개를 초과하면 같은 상태를 SVG (Scalable Vector
Graphics)의 path로 묶으며 모든 원본 경계와 누락을 유지한다. 마우스 위치로 구간을 판별하고
방향키, Home과 End로 확보 구간을 선택한 뒤 Enter로 재생한다. 시간축 계산은 녹화 정보와
판단 시각이 변할 때 수행하며 재생 시각 갱신에는 재사용한다.

### 녹화 상태와 다운로드

녹화 화면은 데이터 상태와 무관하게 5개 카드와 영상 프레임을 유지하고 정보 카드에
스크롤을 제공하지 않는다. 후속 목록 조회 실패는 기존 결과를 유지하며 안내 문단을
추가하지 않는다. 실제 영상의 형식, codec과 크기 및 보관 시각은 서버 응답을 변환한다.
서버 기본값은 유지하되 파일 생성 성공으로 간주하지 않으며 미제공 metadata는 보충하지
않는다. 목록에서는 길이의 결측 문구를 숨기고 정보 카드에는 정보 없음을 유지한다.

상태 표시는 hover와 선택으로 popover를 열어 사용자용 사유, 짧은 오류 코드와 누락 수를
표시한다. 오류 원문 및 stack trace는 서버 로그에서 확인한다. 영상 없음은 별도 popup으로
표시하지 않는다. 이벤트 부분 저장은 기존 범위 상세에서 요청과 확보 시각을 표시한다.
날짜와 이벤트 썸네일은 계약에 없어 같은 크기의 빈 미리보기를 사용한다. 이벤트 구간의
MP4 다운로드는 제공되지 않아 다운로드 불가를 안내하며 날짜 MP4로 대체하지 않는다. 녹화 중 상태에 누락 여부를
덧붙이지 않으며 시간축과 상세에서 확인한다.

오늘 녹화의 다운로드 불가는 정상적인 제한이다. 지난 날짜의 준비와 상태 조회는 같은
파일 카드에서 처리하고 준비된 경로만 다운로드한다. 재생 오류와 export 오류는 분리하며
한 경로의 실패로 다른 경로를 비활성화하지 않는다. 원본 보관 만료와 export cache 만료도
구분한다.

단건은 선택 및 조회 때 확인하고 이벤트 구간의 `PROCESSING`, 날짜의 recording 및
finalizing과 export processing에서만 2초 간격으로 갱신한다. 일시적인 네트워크 오류와
HTTP 408, 429, 500, 502, 503, 504는 2초, 4초와 8초 간격으로 최대 세 번 재시도한다.
확인된 재생은 유지하되 다운로드와 준비는 재확인 전 제한한다. 권한 오류, 삭제와 만료는
재시도하지 않고 기존 재생을 중단한다. 별도 새로고침 버튼은 제공하지 않는다.

### 관리자 설정과 알림

관리자 화면은 서버 설정과 수신 대상으로 초기화한다. 임계율은 1~100의 정수이고 사전
기준은 그보다 낮게 검증한다. 저장은 서버 응답을 적용하고 취소는 마지막 저장값을 복원한다.
수거 및 알림 정책은 같은 resource여서 저장 중 두 영역의 입력과 버튼을 잠근다.
대상 생성과 편집은 저장 중 입력과 닫기를 잠그고 SMS (Short Message Service)는 전화번호를
검사한다. 비어 있는 이벤트 목록을 전송하지 않으며 충돌에는 입력과 적용값을 보존한다.
서버의 실제 발송과 정책 적용 범위는
[관리자 협의 항목](contracts/backend/frontend-mapping.md#관리자-설정과-알림의-협의-항목)을 따른다.

저장 및 테스트 피드백은 기존 안내 위치를 사용하고 새 문단으로 카드를 늘리지 않는다.
테스트 대상은 등록 인원에서 선택하며 빈 목록은 선택을 비활성화한다. 중복 요청과 이전
source의 늦은 응답을 막는다. 테스트 접수 후 알림함을 재조회하며 후속 실패로 접수를
실패로 바꾸지 않는다. 실제 수신을 접수 성공으로 단정하거나 고정 발송 본문을 표시하지
않는다. 대상 및 설정은 요청값이 아닌 서버가 반환한 값을 사용한다.

`Dropdown`은 방향키, Home, End, Enter와 Space를 지원하고 Escape는 변경 없이 닫는다.
Tab과 바깥 클릭도 닫으며 긴 연락처는 기존 너비에서 생략하고 title로 원문을 제공한다.
설정 패널의 닫기 및 focus 영역은 유지한다.

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

- Chrome 최소 버전, 빌드 출력 호환성과 브라우저 Web API 지원 범위
- 코드 포맷 정책
- 장기 운영의 계정 제공, session 저장 및 수명 정책
- 실제 적재율 산출, calibration과 현장 측정 정확도
- 센서와 화면 slot의 대응, 측정 영역 실측 배치와 실제 수거 작업 상태의 계약
- 다중 pit 및 camera 선택, 수동 clip 생성과 미디어 정책 관리의 제품 범위
- 선택적 WHEP 서비스의 지원 계약과 시청자 제한
- 환경별 upstream, DNS, readiness, timeout, 요청 제한, TLS와 CSP 값

제품 및 외부 의미의 상세 책임은 [계약 매핑](contracts/backend/frontend-mapping.md)을
따른다. 확정한 기술 결정만 이 문서에 반영한다.

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
