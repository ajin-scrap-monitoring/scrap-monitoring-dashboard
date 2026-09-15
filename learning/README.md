# 프론트엔드 기반 학습 자료

## 문서 역할

이 디렉터리는 현재 Repository의 프론트엔드 기반을 이해하기 위한 학습 자료다.
프로젝트 요구사항과 구현 결정의 정본이 아니며, 프로젝트 개발 문서인 `docs/`와
분리해 관리한다.

제품 요구사항은 `docs/project-spec.md`, 채택한 기술과 현재 구현 상태는
`docs/implementation.md`, 개발 단계와 완료 조건은 `docs/development-workflow.md`를
따른다. 학습 자료와 실제 설정이 다르면 실제 설정과 프로젝트 정본을 먼저 확인한다.

## 학습 범위

학습 범위는 7개 묶음이다.

| 순서 | 묶음 | 핵심 질문 | 문서 |
| --- | --- | --- | --- |
| 1 | Node.js와 fnm | 어떤 프로그램이 개발 도구를 실행하는가 | [`01-node-fnm.md`](frontend-foundation/01-node-fnm.md) |
| 2 | pnpm과 의존성 관리 | 패키지를 어떻게 선언하고 같은 상태로 설치하는가 | [`02-pnpm-dependencies.md`](frontend-foundation/02-pnpm-dependencies.md) |
| 3 | TypeScript | 어떤 파일을 어떤 규칙으로 타입 검사하는가 | [`03-typescript.md`](frontend-foundation/03-typescript.md) |
| 4 | React | Hypertext Markup Language (HTML) 진입점에 컴포넌트가 어떻게 연결되는가 | [`04-react.md`](frontend-foundation/04-react.md) |
| 5 | Vite | 소스가 개발 서버와 정적 산출물로 어떻게 변환되는가 | [`05-vite.md`](frontend-foundation/05-vite.md) |
| 6 | GitHub Actions 기반 Continuous Integration (CI) | 로컬 검증이 원격의 새 환경에서 어떻게 반복되는가 | [`06-github-actions-ci.md`](frontend-foundation/06-github-actions-ci.md) |
| 7 | Nginx 런타임과 reverse proxy | 정적 산출물과 외부 요청이 운영 컨테이너에서 어떻게 처리되는가 | [`07-nginx-runtime.md`](frontend-foundation/07-nginx-runtime.md) |

앞 묶음이 뒤 묶음의 실행 기반이 되므로 표의 순서대로 읽는다.

## 전체 실행 구조

현재 기준선의 주요 실행 주체는 12개다.

| 실행 주체 | 역할 |
| --- | --- |
| 셸 | 명령 해석과 실행 파일 탐색 |
| fnm | Node.js 버전 설치와 전환 |
| Node.js | TypeScript, Vite와 package script의 JavaScript 실행 |
| pnpm | 패키지 설치와 `package.json` script 실행 |
| TypeScript 컴파일러 | TypeScript와 TypeScript JSX (TSX) 타입 검사 |
| Vite | 개발 서버, 소스 변환과 프로덕션 빌드 |
| 브라우저 | 빌드된 JavaScript 실행과 화면 렌더링 |
| GitHub Actions runner | 새 Linux 환경에서 설치와 빌드 반복 |
| Docker Buildx | `linux/amd64` OCI 이미지 빌드 |
| Playwright 실행 컨테이너 | CI 브라우저 테스트에 필요한 Chromium과 Linux 라이브러리 제공 |
| Docker Engine | OCI 이미지의 Nginx 컨테이너 실행 |
| Nginx | 정적 파일, health endpoint와 reverse proxy 제공 |

로컬 개발 흐름은 다음과 같다.

```text
Node Runtime: .node-version -> fnm -> Node.js
Dependencies: package.json + pnpm-lock.yaml -> pnpm -> node_modules
Type Check: tsconfig files + source files -> TypeScript -> type result
Development: index.html + source files + vite.config.ts -> Vite -> Browser
Frontend Build: index.html + source files + vite.config.ts -> Vite -> dist
Container Build: dist + Nginx config + Dockerfile -> Docker Buildx -> OCI Image
Container Runtime: OCI Image -> Docker Engine -> Nginx -> Browser
```

Continuous Integration (CI) 흐름은 다음과 같다.

```text
CI Entry: GitHub Event -> Runner -> Checkout
Frontend Setup: Checkout -> Node.js + pnpm -> Frozen Install
Frontend Checks: Frozen Install -> Lint -> Component Test -> Build -> Browser Test
Container Setup: Checkout -> Docker Buildx -> linux/amd64 Image
Container Checks: linux/amd64 Image -> Runtime Test -> Proxy Test -> TLS Test
```

## 파일과 부산물 구분

현재 학습 대상은 9개 종류로 구분한다.

| 종류 | 예시 | Git 추적 | 생성 주체 |
| --- | --- | --- | --- |
| 도구 버전 입력 | `.node-version`, `package.json` | 대상 | 사람과 패키지 관리자 |
| 패키지 설치 입력 | `.npmrc`, `pnpm-lock.yaml` | 대상 | 사람과 pnpm |
| 타입 검사 입력 | `tsconfig*.json` | 대상 | 사람 |
| 애플리케이션 소스 | `index.html`, `src/*.tsx` | 대상 | 사람 |
| 빌드 설정 | `vite.config.ts` | 대상 | 사람 |
| 컨테이너와 웹 서버 입력 | `Dockerfile`, `nginx/` | 대상 | 사람 |
| 로컬 설치 및 검사 부산물 | `node_modules/`, `*.tsbuildinfo` | 제외 | pnpm과 TypeScript |
| 프로덕션 빌드 부산물 | `dist/` | 제외 | Vite |
| 컨테이너 이미지 | OCI image | 제외 | Docker Buildx |

pnpm store는 Repository 바깥의 사용자별 저장 공간이며 Git 추적 대상이 아니다.
GitHub Actions runner의 작업 디렉터리와 캐시도 GitHub가 관리하는 실행 환경이며
Repository 파일이 아니다.

## 학습 방법

각 문서는 다음 순서로 사용한다.

1. 구성 요소 표에서 파일과 실행 프로그램의 경계를 확인한다.
2. 실행 흐름에서 각 프로그램의 입력과 출력을 연결한다.
3. Repository의 실제 파일을 함께 열어 설정값을 대조한다.
4. 확인 명령으로 현재 실행 결과를 관찰한다.
5. 생성된 부산물이 Git 추적 대상인지 확인한다.

학습 중 확인한 일반 지식은 이 디렉터리에 기록한다. 프로젝트에서 새 기술을
채택하거나 설정을 변경하면 `docs/implementation.md`와 실제 설정을 먼저 갱신하고,
필요한 경우에만 이 자료를 현재 구조에 맞게 고친다.
