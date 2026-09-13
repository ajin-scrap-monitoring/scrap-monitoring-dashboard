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
이력, 녹화 영상, 로그인과 관리자 설정의 UI MVP가 구현되어 있다. 다단계 Dockerfile,
Nginx 런타임 설정, reverse proxy 배포 경계, 이미지 검증과 Git tag 기반 Release 구성이
구현되어 있다. 외부 연동 제안의 OpenAPI 생성 타입, HTTP adapter, Server-Sent Events
(SSE) 상태 갱신과 WebRTC-HTTP Egress Protocol (WHEP) 형태의 영상 연결도 구현되어 있다.

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
다단계 빌드는 Node.js와 pnpm으로 정적 파일을 생성하고 Nginx 런타임 단계에는 정적 파일,
환경 독립적인 Single Page Application (SPA) 기본 설정과 reverse proxy 공통 설정만 복사한다.
최종 이미지에는 Node.js, pnpm, 소스 코드, 자격 증명, 환경별 주소와 실제 proxy 경로를
포함하지 않는다.

릴리스 이미지는 컨테이너 실행 시 환경변수를 읽지 않는다. Vite 환경변수는 정적 파일을
생성하는 빌드 시점 입력이며 실행 중인 Nginx가 브라우저 번들을 다시 만들지 않는다. 운영
프론트엔드는 same-origin 경로를 사용하므로 API upstream 주소를 브라우저 설정으로
주입하지 않는다. Repository 루트의 `.env.example`은 검증된 이미지 digest, 컨테이너 이름,
플랫폼, 단독 실행 bind 주소와 port 및 `/tmp` 크기의 공개 기본값을 제공한다. 사용자가
복사한 `.env`는 Docker 명령을 실행하는 shell이나 배포 Repository의 Docker Compose가
보간하며 컨테이너 내부에는 전달하지 않는다. Nginx 설정은 파일 mount로 제공하고 자격
증명, TLS 개인 키와 인증서는 secret 또는 읽기 전용 파일 mount로 제공한다.

배포 Repository는 이 Repository가 게시한 이미지의 digest를 선택하고 환경별 Nginx
설정, FastAPI upstream, Transport Layer Security (TLS), 인증서, 컨테이너 네트워크,
Docker Compose, 이미지 버전 결합과 롤백을 관리한다. CA 개인 키와 서버 개인 키는 Git
Repository와 컨테이너 이미지에 포함하지 않는다.

빌드 단계는 digest로 고정한 `node:24.19.0-bookworm-slim` 이미지와 pnpm 11.23.0을
사용한다. 런타임 단계는 digest로 고정한
`nginxinc/nginx-unprivileged:1.30.4-alpine3.24-slim` 이미지를 사용한다. Nginx는 사용자
`101`과 TCP 8080 포트로 실행한다. 컨테이너는 root file system을 읽기 전용으로 두고
`/tmp`에 임시 파일 시스템을 연결해 실행할 수 있다. `/healthz`는 컨테이너 상태 확인
경로다. HTML은 저장하지 않고 해시가 포함된 `/assets/` 자산은 장기 캐시한다. 이미지에는
배포되는 글꼴과 JavaScript 런타임의 라이선스 고지를 포함하며 source map은 포함하지
않는다.

이미지 Registry는 GitHub Container Registry (GHCR)이며 이미지 이름은
`ghcr.io/ajin-scrap-monitoring/scrap-monitoring-dashboard`다. 지원 플랫폼은
`linux/amd64`다. Pull Request (PR)와 `main` push의 CI는 이미지를 빌드하고 런타임을
검증하지만 게시하지 않는다. `vX.Y.Z` 형식의 Git tag가 Release workflow를 시작하며,
동일한 이미지를 `X.Y.Z`와 `sha-<full-git-sha>` tag로 게시한다. `latest` tag는 게시하지
않는다. Release workflow는 게시된 image digest를 workflow summary에 기록하고, 배포
Repository는 tag가 아닌 digest로 이미지를 선택한다. 화면의 버전은 Release tag의
`X.Y.Z` 값으로 빌드한다.

운영 브라우저는 고정 사설 Internet Protocol (IP) 주소로 Nginx에 접속한다. 인터넷에서
모니터링 서버로 들어오는 연결, 공개 도메인, 공개 Domain Name System (DNS)과 public
Certificate Authority (CA)를 사용하지 않는다. 내부 브라우저에서 Nginx의
Transmission Control Protocol (TCP) 443 포트로 연결할 수 있어야 한다.

TLS는 프로젝트 전용 사설 Public Key Infrastructure (PKI)를 사용한다. CA 구성, 서버
인증서 주입, Nginx TLS 설정과 갱신 절차는 배포 Repository의 책임이다.

GHCR container package는 public이다. 배포 환경은 공개 image를 pull할 때 별도 image pull
자격 증명을 사용하지 않는다. 고정 사설 IP의 실제 값과 미디어 서비스의 ICE 후보 및 허용
포트는 결정 대기 상태다.

## Nginx reverse proxy 배포 경계

Nginx 설정은 3개 영역으로 분리한다.

| 영역 | 이미지 제공 내용 | 배포 Repository 책임 |
| --- | --- | --- |
| 기본 서버 | SPA fallback, `/healthz`, gzip, HTML 캐시 방지, 정적 자산 장기 캐시, 보안 헤더와 구조화 access log | 없음 |
| HTTP 컨텍스트 | WebSocket Upgrade map과 `/etc/nginx/upstreams/*.conf` include | Docker DNS resolver, FastAPI upstream, `limit_req_zone` |
| server 컨텍스트 | `/etc/nginx/runtime/*.conf` include와 HTTP, SSE 및 WebSocket proxy snippet | API와 signaling location, upstream 선택, rate limit 적용, request body 크기와 timeout |

배포 Repository는 `/etc/nginx/upstreams/`와 `/etc/nginx/runtime/`을 함께 주입한다.
전자는 `resolver`, shared memory `upstream`과 `server <docker-service>:<port> resolve`를
선언한다. Docker Compose 환경에서는 Docker embedded DNS를 resolver로 사용하고 `resolve`와
upstream `zone`을 함께 선언해 컨테이너 IP 변경 뒤 Nginx가 이름을 다시 해석할 수 있게 한다.
후자는 확정된 API, SSE와 signaling 경로별 `location`에서 공통 proxy snippet을 포함하고
`proxy_pass`, `proxy_connect_timeout`, `proxy_send_timeout`, `proxy_read_timeout`,
`client_max_body_size`와 API `limit_req`를 선언한다.

공통 HTTP proxy snippet은 HTTP/1.1, 빈 `Connection` 헤더, `Host`, `X-Real-IP`,
`X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`와 Nginx `$request_id`를 upstream에
전달한다. WebSocket signaling snippet은 같은 헤더에 `Upgrade`, map으로 만든 `Connection`을
추가하고 `proxy_buffering off`를 적용한다. SSE streaming snippet은 buffering과 cache를
비활성화한다. access log는 standard output에 JSON 한 줄로
기록하며 시각, request ID, 원격 주소, method, query string을 제외한 URI, 상태, 전송량,
처리 시간과 upstream 응답 정보를 포함한다.

WebRTC 미디어 location은 이미지와 배포 설정에 만들지 않는다. Nginx는 API와 signaling 요청만
FastAPI에 reverse proxy하고 브라우저는 ICE 후보가 가리키는 미디어 서비스에 직접 연결한다.
FastAPI readiness endpoint는 upstream 컨테이너의 healthcheck와 배포 orchestration이 사용한다.
Nginx `/healthz`는 정적 웹 컨테이너의 readiness만 나타내며 FastAPI readiness를 대체하지 않는다.

기본 보안 응답 헤더는 `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
Content Security Policy (CSP), `frame-ancestors`, Permissions-Policy와 request ID다. 기본 CSP는
same-origin 정적 파일만 허용하고 framing을 금지한다. 실제 API, signaling 또는 미디어 origin이
확정되어 CSP 연결 출처가 필요하면 배포 Repository가 `/etc/nginx/security-headers.conf`를
환경별 허용 출처로 주입한다.

API 경로, signaling 경로, FastAPI upstream 이름, Docker service 이름과 port, resolver 주소,
timeout, rate limit, request body 최대 크기, FastAPI readiness endpoint와 CSP 추가 출처는 외부
계약 결정 대기 상태다. 이 값은 이미지의 기본 Nginx 설정에 넣지 않는다.

외부 연동과 배포 계약에서 결정할 전체 항목, 순서와 완료 조건은
`docs/contracts/README.md`를 따른다. 실제 환경별 값은 배포 Repository에서 주입하는 Nginx
설정과 FastAPI 구현에 기록한다. 이 Repository에는 환경 독립적인 공통 설정과 검증만
유지한다.

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
| `@redocly/cli` | 2.52.1 | OpenAPI 문법, 참조와 권장 규칙 검사 | [npm](https://www.npmjs.com/package/@redocly/cli) | MIT |
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
`DashboardDataSource`는 AbortSignal을 받는 초기 조회와 선택적 스냅샷 구독을 정의한다.
`src/data/use-dashboard-data.ts`는 초기 조회, 취소, 오류, 재시도와 구독 스냅샷을 화면 상태로
변환한다. 초기 조회가 성공한 뒤 실시간 구독을 시작하므로 기준 snapshot을 적용하기 전에
후속 event를 처리하지 않는다. HTTP 어댑터는 화면 진입 시 함께 수행하는 모든 요청에 같은
AbortSignal을 전달한다.
`src/main.tsx`가 데이터 소스를 선택해 `App`에 주입하므로 화면 컴포넌트는 구현체를 직접
생성하지 않는다.

`src/data/mock-dashboard-data-source.ts`는 현황, 이력, 녹화 목록, 알림과 관리자 설정의
합성 데이터를 제공한다. 현황의 대표 적재율, 수거 임계율, 수거 주기, 예상 도달 시각,
마지막 측정 시각과 영상 시각도 이 데이터 소스가 제공한다. 기본 시나리오는 `normal`이며 개발 환경에서 URL query의
`scenario`로 `collection-required`, `measurement-error`, `disconnected`, `no-data`,
`loading`, `request-error`, `live-update`, `operation-cycle` 상태를 선택할 수 있다. `/?scenario=measurement-error`은
LiDAR 2 측정 오류 데이터를 표시한다. `loading`은 1.2초 뒤 정상 데이터를 반환하고,
`request-error`는 데이터 소스 요청 실패와 재시도 화면을 표시한다. `live-update`는 초기
스냅샷 뒤 1.2초에 새 측정 스냅샷을 구독자로 전달한다. `operation-cycle`은 수거 필요,
수거 완료, LiDAR 측정 오류, 연결 끊김, 정상 복구 순서의 스냅샷을 0.5초 간격으로 전달한다.
`empty-lists`는 현황 측정값을 유지하면서 활성 알림, 이력 이벤트, 녹화 목록과 알림 대상이
없는 상태를 제공한다.

합성 데이터 소스의 인스턴스는 화면에서 수행한 설정과 알림 변경을 유지하며 다른 인스턴스와
상태를 공유하지 않는다. `src/data/http-dashboard-data-source.ts`의 HTTP 어댑터는 제안 계약의
응답을 같은 도메인 모델로 변환하고 HTTP 요청과 SSE 구독을 처리한다. 화면 컴포넌트는 서버
DTO (Data Transfer Object)에 직접 의존하지 않는다. 운영 빌드는 HTTP 어댑터를 사용한다.
개발 환경과 브라우저 테스트 빌드는 기본적으로 합성 데이터 소스를 사용하며 `source=api`와
`source=mock` query로 session 단위 데이터 소스를 선택할 수 있다. 현황 영상, 녹화 목록의
썸네일, 녹화 재생 화면과 확대 화면은
`src/assets/camera-frame.png`의 현장 구성 합성 이미지를 예시로 사용한다. 개발 환경과
배포 빌드에 같은 이미지를 포함한다. 이미지는 정적인 예시이며 실제 영상 재생 상태를
나타내지 않는다.

합성 데이터 소스의 녹화 영상 다운로드와 테스트 알림은 요청 확인 상태만 표시한다. HTTP
어댑터는 계약이 제공한 다운로드 경로를 사용하고 테스트 알림 endpoint의 접수 여부만
확인한다. 실제 채널 수신 여부는 사용자가 별도로 확인한다.

이력의 빠른 기간 선택은 최근 24시간, 최근 7일, 최근 30일과 최근 90일이며 기본값은 최근 7일이다.
선택 시 데이터 소스가 제공한 이력 종료 시각을 기준으로 시작과 종료 시각을 채우고,
직접 입력하면 빠른 선택을 해제한다. 기간과 이벤트 유형은 조회 버튼을 눌러 함께 적용한다.
기간은 적재율 추세와 이벤트 목록에, 유형은 이벤트 목록과 그래프 이벤트 표시 및 범례에
적용한다. 수거 필요의 유형은 알림, 수거 완료의 유형은 수거다. 적재율 추세선과 임계율
기준선은 이벤트 유형으로 필터링하지 않는다. 역전된 기간은 오류로 표시하며 기존 결과를
유지한다. 예시 데이터의 시간 기준은 `history.startsAt`과 `history.endsAt`이다.

녹화 영상의 조회 조건은 이력과 같은 빠른 기간 선택, 입력칸 배치와 조회 버튼 적용 방식을
사용한다. 빠른 기간은 데이터 소스가 제공한 서버 기준 조회 종료 시각으로 계산하며 기본값은
최근 7일이다. 선택 기간과 녹화 구간이 겹치고 이벤트 유형이 일치하는 영상을 조회한다.
조회 시 목록 첫 페이지와 첫 영상으로 이동하고 재생 및 다운로드 요청 표시를 초기화한다.
이력의 관련 녹화 링크로 진입하면 녹화 식별자로 메타데이터를 직접 조회하고 해당 영상의
시작 및 종료 시각을 초기 조회 구간으로 사용한다.
빠른 기간 목록과 날짜 계산은 `src/date-range.ts`, 입력칸 배치는 공통 `.query-controls`로
관리한다.

이력과 녹화 영상의 날짜/시간 입력은 공통 `DateTimeField`를 사용한다. 직접 입력 형식은
`YYYY-MM-DD HH:mm`이며 달력과 24시간제 시/분 입력을 제공한다. 선택 날짜와 포커스는
주황색 테마로 표시한다. 달력은 방향키로 날짜 이동, PageUp과 PageDown으로 월 이동,
Escape와 바깥 클릭으로 닫기를 지원한다. 직접 입력한 날짜의 형식과 유효성을 조회 시 검증한다.

녹화 정보의 보관 기간은 데이터 소스의 `retentionStartsAt`과 `retentionEndsAt`을 표시한다.
합성 데이터의 보관 시각은 화면 검토용 예시이며 실제 보관 정책과 자동 삭제 동작을
정의하지 않는다. HTTP 어댑터는 서버 응답의 보관 시작 시각과 만료 시각을 표시 형식으로
변환한다.

현황의 수거 임계율 아래에는 monitoring snapshot의 사전 알림 기준을 보조 정보로
표시하며 비활성 상태는 사전 알림 꺼짐으로 표시한다. 관리자 화면은 알림 설정 응답으로
초기화한다.

관리자 수거 설정은 1~100의 정수 임계율과 그보다 낮은 사전 알림 기준을 검증한다.
잘못된 입력은 현재 적용값을 유지하며 오류를 표시한다. 알림 정책 저장은 데이터 소스를
통해 반영하고 취소는 마지막 저장값을 복원한다. 테스트 알림 대상은 등록된 전체
인원에서 선택하며 빈 목록에서는 대상 선택을 비활성화한다. 설정 저장 피드백은 서버
응답을 기준으로 표시한다. 알림 대상 추가 모달은 dialog 의미와 키보드 포커스 복원을 제공한다.
조회나 대상 변경으로 요청 표시를 초기화하면 이전 완료 타이머도 취소한다.

관리자 설정의 발송 시점, 반복 알림, 최대 반복 횟수와 등록 대상 선택은
`Dropdown` 공통 컴포넌트를 사용한다. 목록은 입력칸 아래에 이어지는 테두리와 공통 테마를
사용하며 방향키, Home, End로 이동하고 Enter 또는 Space로 선택한다. Escape는 선택 변경
없이 닫고, Tab과 바깥 클릭도 목록을 닫는다.

합성 데이터 소스의 로그인은 `sessionStorage`에 상태를 기록하고 로그아웃은 이를 삭제한다.
HTTP 어댑터는 same-origin session Cookie를 포함한 요청, session 응답의 CSRF token과 사용자
역할을 사용한다. 비로그인 사용자는 현황, 이력과 녹화 영상을 조회할 수 있으며 관리자 설정,
사용자 메뉴와 개인 알림함은 표시하지 않는다. 관리자 역할이 아닌 사용자의 `/admin` 직접
접근은 접근 제한 상태를 표시한다. 인증된 session이 API `401` 또는 SSE `session.expired`로
만료되면 로그인 화면으로 이동한다.

## 코드 구조와 작업 재개 기준

브라우저 진입과 경로 분기는 `src/App.tsx`가 담당한다.
`src/components/DashboardShell.tsx`의 `DashboardPageShell`은 현황, 이력, 녹화 영상과
관리자 설정 화면의 상단 헤더와 하단 푸터를 공통으로 조립한다. 공통 헤더는 인증 상태,
갱신된 알림 목록과 기존 읽음 상태 병합, 팝오버 닫기와 로그아웃 상호작용을 관리한다.
로그인, 이력, 녹화 영상과 관리자 설정은 `src/pages/`에서 화면별 상태와 상호작용을
관리한다. 이력, 녹화 영상과 관리자 설정 모듈은 해당 경로에 진입할 때 지연 로딩한다.
`src/components/DashboardPrimitives.tsx`, `MonitoringVisuals.tsx`와 `Pagination.tsx`는
공통 제목, 상태, 아이콘, 차트, 측정 영역과 페이지 이동을 제공한다. 경로와 합성 인증 세션
키는 `src/app-routing.ts`에서 관리한다.

측정 영역의 각 측정선은 스크랩 표면과 벽면이 만나는 경계에서 시작하고 끝나며,
A와 B 원의 중심은 해당 끝점과 일치한다. 반투명 면은 센서 위치와 측정선 전체를 연결한다.
이 그림은 개략적인 배치 표현이며 실제 측정 좌표를 나타내지 않는다.

`src/domain/dashboard.ts`는 화면 데이터 모델의 정본이다.
`src/data/dashboard-data-source.ts`는 단일 읽기와 선택적 갱신 경계인 `DashboardDataSource`를
정의한다. `src/data/use-dashboard-data.ts`는 데이터 소스 수명 주기와 화면 상태를 관리한다.
`src/data/mock-dashboard-data-source.ts`는 개발과 합성 시나리오 테스트에 사용하는 구현이다.
`src/data/http-dashboard-data-source.ts`는 제안 API를 호출하고 응답을 도메인 모델로 변환하는
운영 구현이다. `src/components/whep-client.ts`와 `WhepVideo.tsx`는 WHEP 형태의 signaling,
미디어 연결, 종료와 재연결을 처리한다. 제안 계약, 실시간 규칙과 화면별 API 매핑은
`docs/contracts/proposal/`에 있다. OpenAPI 생성 타입은 `src/generated/api-contract.ts`에
추적하며 계약 변경 시 함께 갱신한다.

HTTP 어댑터의 최초 이력 및 녹화 조회와 이후 사용자 조회는 monitoring snapshot의
`serverTime`에 포함된 명시적 UTC offset을 유지한다. 브라우저 운영체제의 시간대는 조회
구간에 영향을 주지 않는다. LiDAR profile은 LiDAR 1과 LiDAR 2 카드로 고정하며 응답에서
누락된 profile은 정보 없음으로 표시한다. 유효하지 않은 최근 적재율과 LiDAR 표본은 축의
시각 또는 위치는 유지하되 그래프 선을 연결하지 않는다. 알림 대상 생성과 변경은 요청값이
아니라 서버가 반환한 대상 및 수신 설정을 화면에 적용한다.

SSE 구독은 최근 event ID 1024개로 중복을 제거하고 개인 알림 목록은 최근 20건으로 제한한다.
재동기화는 snapshot과 인증 사용자의 개인 알림함을 다시 조회한다. 재조회 중 같은 영역의
새 event가 도착하면 해당 영역의 늦은 응답을 폐기한다. WHEP client는
`201 Created` 응답에서 Entity Tag (ETag)와 trickle ICE 협상을 확인한 뒤 후보와 수집 완료를 전송한다.
`406 Not Acceptable` counter-offer에서는 ICE 수집을 완료하고 전체 SDP answer를 `If-Match`
없이 먼저 전송한다. 서버의 `Retry-After`가 있으면 재연결 지연에 사용한다. 영상 확대 전환과
화면 종료는 기존 WHEP session을 닫으며 동시에 활성화되는 재생 session은 하나다.

UI와 합성 데이터를 변경할 때는 `pnpm run dev`로 실행하고 필요한 상태를 `scenario` query로
확인한다. 제안 API 동작은 `source=api`와 계약 테스트 서버로 확인한다. 변경 완료 전에는
`pnpm run check`를 실행한다. 제안 계약은 외부 담당자의 승인 전까지 확정 계약으로 취급하지
않는다.

## 정적 검사와 테스트 기준선

검증 계층은 4개다.

| 계층 | 도구 | 범위 |
| --- | --- | --- |
| 계약 검사 | Redocly CLI와 openapi-typescript | OpenAPI 문법, 참조, 권장 규칙과 생성 타입 일치 |
| 정적 검사 | ESLint와 typescript-eslint | TypeScript 타입 기반 규칙, React Hooks와 Fast Refresh 경계 |
| 컴포넌트 테스트 | Vitest, jsdom과 Testing Library | `src/`의 렌더링, 상태와 사용자 상호작용 |
| 브라우저 테스트 | Playwright Chromium | 합성 데이터와 제안 API의 사용자 흐름 및 대상 뷰포트 렌더링 |

`eslint.config.js`는 ESLint flat config, 권장 TypeScript 타입 검사, React Hooks와 Vite
Fast Refresh 규칙을 적용한다. `pnpm run lint`는 경고를 허용하지 않는다.

Vitest는 `src/**/*.{test,spec}.{ts,tsx}`만 수집하고 jsdom에서 실행한다. Testing Library는
구현 세부 구조 대신 브라우저의 역할, 이름과 사용자 상호작용을 기준으로 컴포넌트를
검증한다. `pnpm run test`는 테스트를 한 번 실행하고 `pnpm run test:watch`는 변경을
감시한다.

Playwright는 `e2e/`의 브라우저 테스트를 1440 x 900과 1920 x 1080 Chromium 뷰포트에서
실행한다. `pnpm run test:e2e`는 타입 검사와 운영 빌드의 크기 예산 검사를 완료한 뒤 합성
데이터가 포함된 별도 빌드를 Vite preview 서버에서 검증한다. 운영 빌드 뒤
`scripts/verify-build-output.mjs`가 초기와 전체 JavaScript, CSS, 웹폰트와 전체 정적 자산의
크기 예산을 검사한다. 실패한 테스트의 screenshot과 trace는 Git에서 제외한
`test-results/`에 저장한다.

현재 Playwright 테스트는 대시보드 진입, 합성 실시간 갱신과 운영 주기 상태 전이, 상단 브랜드 이동, 알림함 읽음 처리와 닫기,
관리자 메뉴와 로그인 및 로그아웃, 비로그인 화면 제한, 관리자 경로 제한, 적재율 이력의
이벤트 상세 표시, 빈 목록, 필터와 페이지 이동, 대상 뷰포트의 수평 오버플로와 카드 잘림,
푸터 겹침, 대화형 요소의 접근 가능한 이름, 이미지 대체 텍스트와 외부 연동 전 요청
피드백을 검증한다. 계약 테스트 서버를 사용하는 브라우저 테스트는 로그인, session Cookie와
CSRF, 화면별 조회, SSE 갱신, 알림 읽음, 녹화 재생 및 다운로드, 관리자 설정과 알림 대상 변경,
테스트 알림, 로그아웃과 WHEP session 수명을 검증한다. Vitest는 합성 데이터 소스의 기본 데이터,
상태와 빈 목록 시나리오, AbortSignal 취소, 구독 갱신과 상태 전이, 호출 간 데이터 격리,
페이지별 필터와 페이지 이동, 관리자 입력 검증과 로그인 입력 상호작용을 검증한다. HTTP
어댑터의 요청과 변환, 오류와 session 만료, SSE 순서와 재동기화 및 WHEP 정상, counter-offer,
ICE 전달, 종료와 재연결도 Vitest에서 검증한다. 계약 예제의 최근 24시간 표본 순서와 간격,
수거 필요 marker 및 당시 적용 임계율의 일치 여부도 함께 검증한다.

CI의 호스트 runner는 Ubuntu 24.04로 고정한다. CI 작업은 `@playwright/test` 1.62.1과
버전이 일치하는 공식 Playwright Noble 컨테이너
`mcr.microsoft.com/playwright:v1.62.1-noble`에서 실행하고 OCI image digest를 고정한다.
컨테이너는 사용자 `1001`로 실행한다. 컨테이너가 Chromium과 실행에 필요한 Linux 시스템
라이브러리를 제공하므로 CI에서 브라우저 또는 시스템 패키지를 별도로 설치하지 않는다.
Node.js와 pnpm은 컨테이너 안에서도 각각 `.node-version`과 `package.json`의
`packageManager`에 기록된 버전을 사용한다. CI가 사용하는 외부 GitHub Action은 upstream
Repository의 전체 commit SHA로 고정한다.

`pnpm run check`는 계약 검사, 정적 검사, 컴포넌트 테스트, 타입 검사, 프로덕션 빌드와
브라우저 테스트를 순서대로 실행하는 전체 로컬 검증 명령이다.

## UI 구현과 검토 기준선

추적되는 React, TypeScript와 CSS 코드가 UI 구조와 스타일의 정본이다. 구현 작업자는
확정된 요구사항, 데이터 의미와 화면 상태를 입력으로 합성 데이터를 구성하고 실행 가능한
UI 초안을 구현한다. 작업 요청자는 대상 Chrome 뷰포트에 렌더링된 화면을 검토하고,
확인된 피드백은 Issue의 완료 조건과 코드에 반영한다.

세부 배치, 크기, 색상, 문구와 상호작용은 브라우저 검토와 코드 보정을 반복해 확정한다.
확정된 공통 값은 코드의 디자인 토큰 또는 공통 스타일로 관리한다. 작업 순서와 단계별
완료 조건은 `docs/development-workflow.md`를 따른다.

배포 웹폰트는 전체 글리프를 유지한 WOFF2 형식이며 `font-display: swap`을 사용한다. 합성
영상은 PNG 형식으로 제공한다. 1440 x 900에서는 1920 x 1080과 같은 카드 높이와 간격을
유지하고 페이지 세로 스크롤을 사용한다. 하단 푸터는 문서 흐름에 배치해 카드 위에
겹치지 않는다.

## 제품 구현 결정 상태

다음 항목은 결정 대기 상태다.

- Chrome 최소 버전, 빌드 출력 호환성과 브라우저 Web API 지원 범위
- 시각 회귀 테스트 범위
- 코드 포맷 정책
- 제안 API의 외부 승인과 계약 정본
- 인증, 접근 권한, CSRF와 session 수명
- 측정 의미, 표본 주기, 이력 집계와 결측 처리
- SSE event 보관, keep-alive, 재시도와 timeout
- 미디어 서비스 WHEP 지원, offer 전 ICE server 전달, codec와 시청자 제한
- 환경별 upstream, DNS, readiness, timeout, 요청 제한, TLS와 CSP 값

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
pnpm run contract:generate
pnpm run contract:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run verify:build-output
pnpm run preview
pnpm exec playwright install chromium
pnpm run test:e2e
pnpm run check
docker build --platform linux/amd64 --tag scrap-monitoring-dashboard:local .
docker run --read-only --tmpfs /tmp --publish 8080:8080 scrap-monitoring-dashboard:local
```

`pnpm run preview`는 로컬에서 프로덕션 빌드 결과를 확인하는 명령이며 운영 웹
서버로 사용하지 않는다. Chromium 설치는 Playwright 버전을 변경한 뒤 다시 실행한다.
현재 CI는 공식 Playwright 컨테이너에서 frozen 설치, 정적 검사, 컴포넌트 테스트,
타입 검사, 프로덕션 빌드와 두 뷰포트의 브라우저 테스트를 실행한다. 별도 container
job은 `linux/amd64` 이미지를 빌드한 뒤 Nginx 설정 문법, 읽기 전용 root file system에서
Nginx 상태, SPA fallback, 보안 헤더, 자산 캐시, 라이선스 고지, source map과 런타임 빌드 도구
부재를 검사한다. 같은 job은 테스트 전용 FastAPI 대역 컨테이너와 Docker DNS를 사용해 API
reverse proxy, forwarded header와 request ID, API rate limit와 request body 제한, read timeout,
즉시 전달되는 SSE와 buffering 비활성화, WHEP 형태의 `POST`, `PATCH` 및 `DELETE`, WebSocket
Upgrade 호환성, upstream DNS 재해석과 구조화 access log를 검증한다. 테스트 전용 경로,
upstream 이름, resolver와 timeout 값은 운영 계약이 아니다.
