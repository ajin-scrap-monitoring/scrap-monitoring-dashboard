# 프론트엔드 구현 정보

## 문서 역할

이 문서는 제품 구현에 실제로 채택한 기술, 의존성, 내부 구조, 실행,
검증과 배포 방법을 기록한다. 아직 채택하지 않은 기술을 현재 구현으로
기록하지 않는다.

## 현재 구현 범위

현재 Node.js와 pnpm 도구 기준선, React와 TypeScript 애플리케이션 진입점,
Vite 개발 및 빌드 기준선, 최소 Continuous Integration (CI), 제품 배포 경계가
채택된 상태다. 제품 화면, 추가 직접 의존성, 정적 검사, 테스트, 배포 패키지와
Release 구성은 구현되지 않은 상태다.

## 제품 배포 경계

브라우저의 진입점은 FastAPI와 분리된 Nginx 웹 서버다. Nginx는
프론트엔드 정적 산출물을 제공하고 백엔드 요청을 FastAPI로 전달한다.
FastAPI는 프론트엔드 정적 산출물을 포함하거나 직접 제공하지 않는다.

단일 Linux 호스트에서 Nginx와 FastAPI를 별도 컨테이너로 실행한다. 브라우저에
공개하는 포트는 Nginx 컨테이너만 사용하며 FastAPI는 내부 컨테이너 네트워크에서
요청을 받는다. 통합 검증과 운영 환경은 같은 웹 서버 라우팅 구조를 사용한다.

컨테이너 엔진은 Docker Engine, 다중 컨테이너 구성 도구는 Docker Compose를
사용한다. 서비스별 이미지는 Open Container Initiative (OCI) 호환 형식을 유지한다.

이 Repository는 프로덕션 정적 산출물을 배포 Repository에 제공한다. Nginx
이미지와 설정, FastAPI 라우팅, TLS, 컨테이너 네트워크, Docker Compose,
이미지 버전 결합과 롤백은 배포 Repository에서 관리한다. 이 Repository는
Nginx 설정, 서버 인증서와 전체 시스템의 Docker Compose 정의를 산출물에
포함하지 않는다.

운영 브라우저는 고정 사설 IP로 Nginx에 접속한다. 인터넷에서 모니터링 서버로
들어오는 연결, 공개 도메인, 공개 Domain Name System (DNS)과 public
Certificate Authority (CA)를 사용하지 않는다. 내부 브라우저에서 Nginx의 `443/TCP`
포트로 연결할 수 있어야 한다.

Transport Layer Security (TLS)는 프로젝트 전용 사설 Public Key Infrastructure
(PKI)를 사용한다. CA 구성, 서버 인증서 주입, Nginx TLS 설정과
갱신 절차는 배포 Repository의 책임이다. CA 개인 키와 서버 개인 키는
Git Repository와 컨테이너 이미지에 포함하지 않는다.

고정 사설 IP의 실제 값, 정적 산출물의 패키지 형식, 버전 식별과 배포
Repository로의 전달 방식은 결정 대기 상태다.

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

| 패키지 | 버전 | 역할 | 라이선스 |
| --- | --- | --- | --- |
| `react` | 19.2.8 | 컴포넌트와 상태 기반 사용자 인터페이스 | MIT |
| `react-dom` | 19.2.8 | 브라우저 Document Object Model (DOM) 렌더링 | MIT |
| `typescript` | 6.0.3 | 정적 타입 검사 | Apache-2.0 |
| `vite` | 8.2.2 | 개발 서버와 프로덕션 정적 빌드 | MIT |
| `@vitejs/plugin-react` | 6.1.0 | Vite의 React 변환과 Fast Refresh | MIT |
| `@types/node` | 24.13.3 | Vite 설정의 Node.js 타입 | MIT |
| `@types/react` | 19.2.18 | React 타입 | MIT |
| `@types/react-dom` | 19.2.4 | React DOM 타입 | MIT |

직접 의존성은 `package.json`에 정확한 버전으로 기록한다. `.npmrc`의
`save-exact=true`는 pnpm이 새 직접 의존성을 정확한 버전으로 저장하게 한다.
`pnpm-lock.yaml`은 전이 의존성을 포함한 전체 설치 결과를 고정한다.

Vite는 TypeScript 파일을 JavaScript로 변환하지만 타입 검사를 수행하지 않는다.
`pnpm run typecheck`는 TypeScript 프로젝트 참조 전체를 검사한다. `pnpm run build`는
같은 타입 검사를 통과한 뒤 Vite가 `dist/`에 정적 산출물을 생성한다. 현재 Vite
빌드 출력 대상은 별도로 재정의하지 않으며 고정된 Vite 버전의 기본값을 사용한다.
이는 대상 브라우저 지원 정책을 확정한 것으로 간주하지 않는다.

`index.html`, `src/main.tsx`와 `src/App.tsx`는 브라우저 진입점과 빈 React
애플리케이션 루트만 제공한다. 제품 화면과 사용자 흐름은 구현하지 않은 상태다.

## 제품 구현 결정 상태

다음 항목은 결정 대기 상태다.

- 대상 브라우저, 빌드 출력 호환성과 브라우저 Web API (Application Programming
  Interface) 지원 정책
- 라우팅, 외부 상태, 입력, 시간, 시각화와 미디어 처리 방식
- 디자인 토큰의 정본과 Figma 및 코드 동기화 방식
- Storybook, 단위 테스트, 개발 대역 서비스와 Playwright 구성
- 정적 검사 도구와 코드 포맷 정책
- 실행 시점 설정과 자격 증명 경계
- 정적 산출물의 패키지 형식과 배포 Repository 인계 계약
- 정적 검사와 테스트를 포함한 CI 품질 게이트
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
pnpm run typecheck
pnpm run build
pnpm run preview
```

`pnpm run preview`는 로컬에서 프로덕션 빌드 결과를 확인하는 명령이며 운영 웹
서버로 사용하지 않는다. 현재 CI는 frozen 설치와 `pnpm run build`를 실행한다.
정적 검사와 테스트는 관련 도구를 채택한 뒤 추가한다.
