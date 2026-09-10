# 프론트엔드 구현 정보

## 문서 역할

이 문서는 제품 구현에 실제로 채택한 기술, 의존성, 내부 구조, 실행,
검증과 배포 방법을 기록한다. 아직 채택하지 않은 기술을 현재 구현으로
기록하지 않는다.

## 현재 구현 범위

현재 Node.js와 pnpm 도구 기준선, React와 TypeScript 애플리케이션 진입점,
Vite 개발 및 빌드 기준선, Continuous Integration (CI) 검증, 제품 배포 경계,
코드 기반 UI (User Interface) 구현과 브라우저 검토 방식이 채택된 상태다. 최종 Open
Container Initiative (OCI) 이미지의 책임 경계도 채택되어 있다. ESLint 정적 검사,
Vitest 컴포넌트 테스트와 Playwright 브라우저 검증이 구현되어 있다. 현재 모니터링,
이력, 녹화 영상, 로그인과 관리자 설정의 UI MVP가 구현되어 있다. Dockerfile, 이미지
게시와 Release 구성은 구현되지 않은 상태다.

## 제품 배포 경계

브라우저의 진입점은 FastAPI와 분리된 Nginx 웹 서버다. Nginx는
프론트엔드 정적 산출물을 제공하고 Application Programming Interface (API)와 Web
Real-Time Communication (WebRTC) signaling 요청을 FastAPI로 전달한다. FastAPI는
프론트엔드 정적 산출물을 포함하거나 직접 제공하지 않는다. FastAPI가 WebRTC
연결 정보를 중개한 뒤 브라우저는 미디어 서비스와 직접 연결하며 실제 영상은 Nginx와
FastAPI를 통과하지 않는다.

단일 Linux 호스트에서 Nginx와 FastAPI를 별도 컨테이너로 실행한다. 브라우저의
Hypertext Transfer Protocol (HTTP)과 signaling 진입점은 Nginx만 사용하며 FastAPI는
내부 컨테이너 네트워크에서 요청을 받는다. 미디어 서비스는 브라우저가 실제 영상을 직접
수신할 수 있는 Interactive Connectivity Establishment (ICE) 후보와 미디어 포트를
제공한다. 통합 검증과 운영 환경은 같은 라우팅 및 미디어 연결 구조를 사용한다.

컨테이너 엔진은 Docker Engine, 다중 컨테이너 구성 도구는 Docker Compose를
사용한다. 서비스별 이미지는 Open Container Initiative (OCI) 호환 형식을 유지한다.

이 Repository의 최종 배포 산출물은 Nginx와 Vite 정적 산출물을 포함한 OCI 이미지다.
다단계 빌드는 Node.js와 pnpm으로 정적 파일을 생성하고 Nginx 런타임 단계에는 정적 파일과
환경 독립적인 Single Page Application (SPA) 기본 설정만 복사한다. 최종 이미지에는
Node.js, pnpm, 소스 코드, 자격 증명과 환경별 주소를 포함하지 않는다.

배포 Repository는 이 Repository가 게시한 이미지의 digest를 선택하고 환경별 Nginx
설정, FastAPI upstream, Transport Layer Security (TLS), 인증서, 컨테이너 네트워크,
Docker Compose, 이미지 버전 결합과 롤백을 관리한다. CA 개인 키와 서버 개인 키는 Git
Repository와 컨테이너 이미지에 포함하지 않는다.

운영 브라우저는 고정 사설 Internet Protocol (IP) 주소로 Nginx에 접속한다. 인터넷에서
모니터링 서버로 들어오는 연결, 공개 도메인, 공개 Domain Name System (DNS)과 public
Certificate Authority (CA)를 사용하지 않는다. 내부 브라우저에서 Nginx의
Transmission Control Protocol (TCP) 443 포트로 연결할 수 있어야 한다.

TLS는 프로젝트 전용 사설 Public Key Infrastructure (PKI)를 사용한다. CA 구성, 서버
인증서 주입, Nginx TLS 설정과 갱신 절차는 배포 Repository의 책임이다.

고정 사설 IP의 실제 값, 미디어 서비스의 ICE 후보와 허용 포트, Nginx base image,
이미지 Registry, 이름, 지원 플랫폼, 태그, digest 기록과 게시 방식은 결정 대기 상태다.

## 제품 구현 기준선

프론트엔드 빌드 런타임은 Node.js 24.19.0 Long-Term Support (LTS)를 사용한다.
`.node-version`은 개발 컴퓨터와 CI가 사용하는 정확한 Node.js 버전의 정본이다.
`package.json`의 `engines.node`는 허용하는 24 주 버전을 선언한다. 개발 컴퓨터는
Fast Node Manager (fnm)로 Node.js를 설치하고 Repository 진입 시 버전을 전환한다.
Node.js는 개발 도구, 검사, 테스트와 정적 산출물 빌드에만 사용하며 운영 Linux
서버에 설치하지 않는다.

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
Sheets (CSS) 픽셀, 기본 1440 x 900 뷰포트와 확장 1920 x 1080 뷰포트다. 높이를 초과하는
콘텐츠는 페이지 세로 스크롤을 사용한다. 정확한 Chrome 최소 버전은 결정 대기 상태다. 실제
접속 단말의 Chrome 버전을 확인한 뒤 Vite 빌드 출력과 브라우저 Web API (Application
Programming Interface) 호환성을 검증한다.

`index.html`, `src/main.tsx`, `src/App.tsx`와 `src/App.css`는 브라우저 진입점,
화면 구조, 상태 기반 상호작용과 공통 스타일을 제공한다. 현재 경로는 `/`, `/history`,
`/recordings`, `/login`, `/admin`이다. 상단 브랜드와 전역 메뉴는 각 화면을 연결하고,
영상 확대, 알림 팝오버, 알림 대상 설정 패널과 페이지 이동을 제공한다.

화면은 `src/domain/dashboard.ts`의 클라이언트 도메인 모델과
`src/data/dashboard-data-source.ts`의 데이터 소스 인터페이스를 사용한다.
`src/data/mock-dashboard-data-source.ts`는 현황, 이력, 녹화 목록, 알림과 관리자 설정의
합성 데이터를 제공한다. 현황의 대표 적재율, 수거 임계율, 수거 주기, 예상 도달 시각,
마지막 측정 시각과 영상 시각도 이 데이터 소스가 제공한다. 기본 시나리오는 `normal`이며 개발 환경에서 URL query의
`scenario`로 `collection-required`, `measurement-error`, `disconnected`, `no-data`,
`loading`, `request-error` 상태를 선택할 수 있다. `/?scenario=measurement-error`은
LiDAR 2 측정 오류 데이터를 표시한다. `loading`은 1.2초 뒤 정상 데이터를 반환하고,
`request-error`는 데이터 소스 요청 실패 화면을 표시한다.

합성 데이터 소스는 외부 API를 호출하지 않고 호출마다 독립된 데이터를 반환한다. 이후
서버 계약이 확정되면 실제 API 어댑터가 같은 데이터 소스 인터페이스를 구현하고 서버
응답을 클라이언트 도메인 모델로 변환한다. 화면 컴포넌트는 서버 DTO (Data Transfer
Object)에 직접 의존하지 않는다. 실시간 영상과 녹화 영상에는
`src/assets/camera-frame.png`의 합성 라이브뷰 예시를 사용한다.

로그인은 UI MVP의 브라우저 세션 상태다. 로그인 제출은 `sessionStorage`에 상태를
기록하고 로그아웃은 이를 삭제한다. 비로그인 사용자는 현황, 이력과 녹화 영상을 조회할
수 있으며 관리자 설정, 사용자 메뉴와 개인 알림함은 표시하지 않는다. `/admin` 직접
접근은 로그인 화면으로 이동한다. 실제 인증, 역할, 토큰, 세션 만료와 서버 요청 보호는
백엔드 계약 뒤 구현한다.

## 코드 구조와 작업 재개 기준

브라우저 진입과 경로 분기는 `src/App.tsx`가 담당한다. `DashboardPageShell`은 현황,
이력, 녹화 영상과 관리자 설정 화면의 상단 헤더와 하단 푸터를 공통으로 조립한다.
화면별 상태와 상호작용은 같은 파일의 화면 컴포넌트가 관리한다.

`src/domain/dashboard.ts`는 화면 데이터 모델의 정본이다.
`src/data/dashboard-data-source.ts`는 단일 읽기 경계인 `DashboardDataSource`를 정의한다.
`src/data/mock-dashboard-data-source.ts`는 개발과 테스트에 사용하는 구현이다. 실제 API
어댑터는 이 인터페이스를 구현하고 서버 응답을 도메인 모델로 변환한다.

다음 세션에서 UI와 합성 데이터를 변경할 때는 `pnpm run dev`로 실행하고 필요한 상태를
`scenario` query로 확인한다. 변경 완료 전에는 `pnpm run check`를 실행한다. 실제 API,
인증, 실시간 갱신과 미디어 계약은 외부 역할의 확정 없이 구현하지 않는다.

## 정적 검사와 테스트 기준선

검증 계층은 3개다.

| 계층 | 도구 | 범위 |
| --- | --- | --- |
| 정적 검사 | ESLint와 typescript-eslint | TypeScript 타입 기반 규칙, React Hooks와 Fast Refresh 경계 |
| 컴포넌트 테스트 | Vitest, jsdom과 Testing Library | `src/`의 렌더링, 상태와 사용자 상호작용 |
| 브라우저 테스트 | Playwright Chromium | 프로덕션 빌드의 사용자 흐름과 대상 뷰포트 렌더링 |

`eslint.config.js`는 ESLint flat config, 권장 TypeScript 타입 검사, React Hooks와 Vite
Fast Refresh 규칙을 적용한다. `pnpm run lint`는 경고를 허용하지 않는다.

Vitest는 `src/**/*.{test,spec}.{ts,tsx}`만 수집하고 jsdom에서 실행한다. Testing Library는
구현 세부 구조 대신 브라우저의 역할, 이름과 사용자 상호작용을 기준으로 컴포넌트를
검증한다. `pnpm run test`는 테스트를 한 번 실행하고 `pnpm run test:watch`는 변경을
감시한다.

Playwright는 `e2e/`의 브라우저 테스트를 1440 x 900과 1920 x 1080 Chromium 뷰포트에서
실행한다. `pnpm run test:e2e`는 타입 검사와 프로덕션 빌드를 완료한 뒤 Vite preview
서버에서 브라우저 테스트를 수행한다. 실패한 테스트의 screenshot과 trace는 Git에서
제외한 `test-results/`에 저장한다.

현재 Playwright 테스트는 대시보드 진입, 상단 브랜드 이동, 알림함 읽음 처리와 닫기,
관리자 메뉴와 로그인 및 로그아웃, 비로그인 화면 제한, 관리자 경로 제한, 적재율 이력의
이벤트 상세 표시를 검증한다. Vitest는 합성 데이터 소스의 기본 데이터, 상태 시나리오와
호출 간 데이터 격리를 검증한다.

CI의 호스트 runner는 Ubuntu 24.04로 고정한다. CI 작업은 `@playwright/test` 1.62.1과
버전이 일치하는 공식 Playwright Noble 컨테이너
`mcr.microsoft.com/playwright:v1.62.1-noble`에서 실행하고 OCI image digest를 고정한다.
컨테이너는 사용자 `1001`로 실행한다. 컨테이너가 Chromium과 실행에 필요한 Linux 시스템
라이브러리를 제공하므로 CI에서 브라우저 또는 시스템 패키지를 별도로 설치하지 않는다.
Node.js와 pnpm은 컨테이너 안에서도 각각 `.node-version`과 `package.json`의
`packageManager`에 기록된 버전을 사용한다. CI가 사용하는 외부 GitHub Action은 upstream
Repository의 전체 commit SHA로 고정한다.

`pnpm run check`는 정적 검사, 컴포넌트 테스트, 타입 검사, 프로덕션 빌드와 브라우저
테스트를 순서대로 실행하는 전체 로컬 검증 명령이다.

## UI 구현과 검토 기준선

추적되는 React, TypeScript와 CSS 코드가 UI 구조와 스타일의 정본이다. 구현 작업자는
확정된 요구사항, 데이터 의미와 화면 상태를 입력으로 합성 데이터를 구성하고 실행 가능한
UI 초안을 구현한다. 작업 요청자는 대상 Chrome 뷰포트에 렌더링된 화면을 검토하고,
확인된 피드백은 Issue의 완료 조건과 코드에 반영한다.

세부 배치, 크기, 색상, 문구와 상호작용은 브라우저 검토와 코드 보정을 반복해 확정한다.
확정된 공통 값은 코드의 디자인 토큰 또는 공통 스타일로 관리한다. 작업 순서와 단계별
완료 조건은 `docs/development-workflow.md`를 따른다.

## 제품 구현 결정 상태

다음 항목은 결정 대기 상태다.

- Chrome 최소 버전, 빌드 출력 호환성과 브라우저 Web API 지원 범위
- 라우팅, 외부 상태, 입력, 시간, 시각화와 미디어 처리 방식
- 디자인 토큰, 공통 스타일과 컴포넌트 재사용 경계
- 개발 대역 서비스와 시각 회귀 테스트 범위
- 코드 포맷 정책
- 실행 시점 설정과 자격 증명 경계
- Nginx base image, 이미지 Registry, 지원 플랫폼, 태그와 digest 게시 계약
- Release 조건과 배포 산출물

각 항목은 `docs/development-workflow.md`의 구현 기준선 단계에서 조사하고,
채택한 결과와 근거만 이 문서에 반영한다.

## 로컬 도구 설정

fnm을 운영체제에 설치하고 셸 연동을 활성화한 뒤 다음 명령으로 Repository의
도구 버전과 패키지 설치 상태를 재현한다.

```sh
fnm install
fnm use
npx get-pnpm "$(node -p 'require("./package.json").packageManager.split("@").at(-1)')"
pnpm install --frozen-lockfile
pnpm run dev
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run preview
pnpm exec playwright install chromium
pnpm run test:e2e
pnpm run check
```

`pnpm run preview`는 로컬에서 프로덕션 빌드 결과를 확인하는 명령이며 운영 웹
서버로 사용하지 않는다. Chromium 설치는 Playwright 버전을 변경한 뒤 다시 실행한다.
현재 CI는 공식 Playwright 컨테이너에서 frozen 설치, 정적 검사, 컴포넌트 테스트,
타입 검사, 프로덕션 빌드와 두 뷰포트의 브라우저 테스트를 실행한다.
