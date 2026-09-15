# Vite

## 학습 목표

Vite가 왜 필요한지 이해하고, 개발 서버와 프로덕션 빌드가 서로 다른 작업이라는
점을 구분한다. `pnpm run dev`, `pnpm run build`와 `pnpm run preview`가 실제로
실행하는 명령과 생성 결과도 이해한다.

## 구성 요소

현재 Vite 처리에 참여하는 구성 요소는 8개다.

| 구성 요소 | 위치 | 역할 |
| --- | --- | --- |
| pnpm script | `package.json` | 사람이 입력할 Vite 관련 명령 정의 |
| Vite | `node_modules/vite` | 개발 서버, 소스 변환과 프로덕션 빌드 제공 |
| Vite 설정 | `vite.config.ts` | React plugin과 Vitest 실행 환경 등록 |
| React plugin | `@vitejs/plugin-react` | React JavaScript XML (JSX) 변환과 Fast Refresh 지원 |
| Hypertext Markup Language (HTML) 진입 파일 | `index.html` | 브라우저가 처음 받을 문서 |
| JavaScript 진입 파일 | `src/main.tsx` | 애플리케이션 소스 연결 시작점 |
| 애플리케이션 소스 | `src/*.tsx` | 개발 서버와 빌드의 변환 입력 |
| 프로덕션 산출물 | `dist/` | 웹 서버가 제공할 HTML과 JavaScript |

`vite.config.ts`, `index.html`과 `src/`는 Git으로 추적하는 입력이다. `dist/`는
입력으로 다시 만들 수 있는 빌드 결과이므로 추적하지 않는다.

## Vite가 필요한 이유

현재 소스에는 브라우저가 그대로 실행할 수 없는 내용이 있다.

- TypeScript 타입 문법
- TypeScript JSX (TSX)
- React JSX 변환
- npm package에서 가져오는 module

브라우저는 JavaScript를 실행한다. Vite는 개발 중 또는 빌드할 때 TypeScript와
TSX 소스를 브라우저가 실행할 JavaScript로 변환한다.

Vite의 현재 책임은 3개다.

1. 개발 중 사용할 로컬 웹 서버 실행
2. TypeScript와 TSX 소스의 JavaScript 변환
3. 배포할 정적 파일을 `dist/`에 생성

Vite는 TypeScript 타입 오류를 검사하지 않는다. 타입 검사는 `tsc`가 담당한다.

## 먼저 구분할 세 명령

현재 Vite와 관련된 프로젝트 명령은 3개다.

| 내가 입력하는 명령 | `package.json`이 실행하는 내용 | 사용 목적 | `dist/` 생성 |
| --- | --- | --- | --- |
| `pnpm run dev` | `vite` | 개발 중 브라우저 확인 | 생성하지 않음 |
| `pnpm run build` | `tsc -b && vite build` | 타입 검사 후 배포 파일 생성 | 생성 |
| `pnpm run preview` | `vite preview` | 생성된 `dist/`를 로컬에서 확인 | 새로 생성하지 않음 |

세 명령은 모두 웹 화면과 관련되지만 실행 목적과 입력이 다르다.

## `pnpm run dev`

이 명령은 개발 서버를 실행한다. 개발 서버는 명령을 실행한 terminal에서 계속
동작하며, 종료하기 전까지 브라우저 요청을 기다린다.

실행 과정은 7단계다.

1. 사람이 `pnpm run dev`를 입력한다.
2. pnpm이 `package.json`의 `dev` script를 찾는다.
3. pnpm이 `vite`를 실행한다.
4. Vite가 `vite.config.ts`를 읽는다.
5. Vite가 로컬 Hypertext Transfer Protocol (HTTP) 서버를 연다.
6. 브라우저가 개발 서버에 HTML과 JavaScript를 요청한다.
7. Vite가 요청된 소스를 변환해 브라우저에 응답한다.

```text
Source Files -> Vite Dev Server -> Browser
```

개발 서버는 `dist/`를 먼저 만들지 않는다. 브라우저가 필요한 소스를 요청할 때
Vite가 개발용으로 변환해 응답한다.

개발 서버를 종료하려면 실행 중인 terminal에서 `Ctrl-C`를 입력한다. 개발 서버는
개발 컴퓨터에서만 사용하며 운영 웹 서버로 사용하지 않는다.

## 브라우저가 처음 요청하는 파일

Vite는 Repository 루트의 `index.html`을 브라우저 진입 파일로 사용한다. 현재
HTML에는 다음 script가 있다.

```html
<script type="module" src="/src/main.tsx"></script>
```

브라우저가 `/src/main.tsx`를 요청하면 개발 서버의 Vite가 원본 TSX를 JavaScript로
변환해 응답한다. 브라우저가 TypeScript를 직접 실행하는 것이 아니다.

`src/main.tsx`가 `src/App.tsx`를 import하므로 Vite는 `App.tsx`도 찾아서 변환한다.
`App.tsx`가 다른 파일을 import하면 Vite는 그 파일도 이어서 처리한다.

## module과 import 연결

module은 import 또는 export를 사용하는 코드 파일이다. 현재 주요 module 연결은
다음과 같다.

```text
index.html -> src/main.tsx -> src/App.tsx
                          -> react
                          -> react-dom
             -> src/data/mock-dashboard-data-source.ts
```

한 module이 다른 module을 import하는 연결 전체를 module graph라고 부른다.
Vite는 이 연결을 따라 필요한 애플리케이션 파일과 package를 찾는다.

module graph라는 용어는 새로운 실행 단계가 아니다. 어떤 파일이 어떤 파일을
가져오는지 나타내는 관계의 이름이다.

## `vite.config.ts`

`vite.config.ts`는 브라우저에 전달하는 애플리케이션 코드가 아니다. Vite가 시작할
때 Node.js 환경에서 읽는 도구 설정이다.

현재 설정은 다음과 같다.

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

이 설정은 React plugin을 Vite에 등록하고 Vitest가 사용할 테스트 환경과 파일 범위를
함께 선언한다.

| 코드 | 역할 |
| --- | --- |
| `defineConfig` | Vite와 Vitest 설정 객체 작성 지원 |
| `react()` | React용 Vite plugin 생성 |
| `plugins: [react()]` | 개발 서버와 빌드에 React plugin 적용 |
| `test` | Vitest의 jsdom 환경, 수집 범위와 초기화 파일 설정 |

React plugin은 React JSX 변환과 개발 중 Fast Refresh를 지원한다. Fast Refresh는
컴포넌트 파일을 저장했을 때 가능한 경우 현재 화면 상태를 유지하면서 변경된
컴포넌트를 갱신한다.

## `pnpm run build`

이 명령은 개발 서버를 여는 명령이 아니다. 배포할 정적 파일을 만드는 명령이다.

상위 실행 과정은 5단계다.

1. 사람이 `pnpm run build`를 입력한다.
2. pnpm이 `tsc -b`로 TypeScript 타입을 검사한다.
3. 타입 오류가 있으면 빌드를 중단한다.
4. 타입 오류가 없으면 pnpm이 `vite build`를 실행한다.
5. Vite가 결과를 `dist/`에 기록한다.

Vite 내부에서는 다음 작업을 수행한다.

1. `index.html`을 읽는다.
2. `src/main.tsx`부터 import 연결을 따라 필요한 파일을 찾는다.
3. TypeScript와 JSX 문법을 JavaScript로 변환한다.
4. 애플리케이션 코드와 필요한 package 코드를 배포에 적합한 파일로 묶는다.
5. HTML의 script 경로를 생성한 JavaScript 파일 경로로 바꾼다.

여러 source와 package 코드를 배포에 적합한 파일 구조로 묶는 작업을 bundling이라고
부른다.

현재 빌드 결과의 기본 구조는 다음과 같다.

```text
dist/
  index.html
  assets/
    index-<content-hash>.js
    index-<content-hash>.css
    camera-frame-<content-hash>.png
    NotoSansKR-<content-hash>.ttf
```

파일 이름의 hash는 파일 내용을 기준으로 만든 식별값이다. JavaScript 내용이
바뀌면 파일 이름의 hash도 달라질 수 있다. `dist/index.html`은 같은 빌드에서
생성된 정확한 JavaScript 파일 이름을 참조한다.

## 개발 서버와 프로덕션 빌드

두 실행 방식을 다음처럼 구분한다.

| 항목 | 개발 서버 | 프로덕션 빌드 |
| --- | --- | --- |
| 명령 | `pnpm run dev` | `pnpm run build` |
| 실행 상태 | 종료 전까지 계속 실행 | 파일 생성 후 종료 |
| 소스 처리 시점 | 브라우저 요청 시 | 빌드 명령 실행 시 |
| Fast Refresh | 사용 | 포함하지 않음 |
| 파일 결과 | `dist/` 없음 | `dist/` 생성 |
| 목적 | 개발 중 확인 | 배포 산출물 생성 |

개발 서버에서 화면이 열린다는 사실만으로 프로덕션 빌드가 성공한다고 판단하지
않는다. 배포 전에는 `pnpm run build`를 별도로 실행한다.

## `pnpm run preview`

preview는 기존 `dist/`를 로컬 HTTP 서버로 제공한다. 이 명령은 TypeScript와 TSX
소스를 다시 변환하지 않으며 새 `dist/`도 만들지 않는다.

실행 전에 `pnpm run build`가 성공해 `dist/`가 존재해야 한다.

```sh
pnpm run build
pnpm run preview
```

preview는 빌드된 HTML이 JavaScript asset을 올바르게 불러오는지 확인하는 용도다.
Transport Layer Security (TLS), 보안 header, reverse proxy와 장애 대응을 제공하는
운영 웹 서버가 아니다.

## Vite와 브라우저 호환성

브라우저 호환성과 관련된 층은 3개다.

| 층 | 결정하는 대상 | 현재 담당 |
| --- | --- | --- |
| TypeScript 검사 설정 | 소스에서 사용할 수 있다고 판단할 타입 | `tsconfig.app.json` |
| Vite build target | 최종 JavaScript 문법 변환 범위 | Vite 기본값 |
| 브라우저 Web API (Application Programming Interface) | 브라우저가 실제 제공하는 기능 | 실제 브라우저 |

Vite는 JavaScript 문법을 대상 브라우저에 맞게 변환할 수 있다. 그러나 브라우저에
없는 Web API를 자동으로 추가하지 않는다.

현재 Vite build target은 별도로 설정하지 않아 Vite 8.2.2의 기본값을 사용한다.
정확한 대상 브라우저와 Web API 정책은 아직 프로젝트 구현 결정으로 확정하지
않았다.

## 웹 서버와의 경계

Vite가 이 Repository에서 만드는 배포 결과는 `dist/`다. 운영 환경에서는 배포
이미지가 이 `dist/`와 Nginx를 함께 포함하고, 배포 Repository는 해당 이미지를 실행하며
환경별 Nginx 설정을 주입한다.

현재 Vite의 기본 base path는 웹 서버 root를 기준으로 asset 경로를 만든다. 실제
배포 기본 경로는 배포 계약을 정할 때 확정한다.

환경 독립적인 Nginx 공통 설정과 image 구성은 이 Repository에서 관리한다. TLS 인증서,
FastAPI upstream, 실제 proxy 경로와 Docker Compose는 배포 Repository에서 관리한다.
상세한 실행 경계는 [`07-nginx-runtime.md`](07-nginx-runtime.md)를 따른다.

## 생성되는 결과

| 결과 | 생성 명령 | Git 추적 | 처리 방법 |
| --- | --- | --- | --- |
| 개발 서버 프로세스 | `pnpm run dev` | 제외 | 개발 종료 시 중단 |
| `dist/index.html` | `pnpm run build` | 제외 | 소스에서 다시 생성 |
| `dist/assets/*.js` | `pnpm run build` | 제외 | 소스에서 다시 생성 |
| `dist/assets/*.css`, 이미지와 글꼴 | `pnpm run build` | 제외 | 소스와 자산에서 다시 생성 |
| preview 서버 프로세스 | `pnpm run preview` | 제외 | 확인 종료 시 중단 |

`dist/` 안의 파일을 직접 수정하지 않는다. `index.html`, `src/` 또는 Vite 설정을
수정하고 다시 빌드한다.

## 확인 명령

```sh
pnpm run dev
pnpm run build
find dist -maxdepth 2 -type f -print
pnpm run preview
```

개발 서버와 preview는 동시에 실행할 필요가 없다. 확인 목적에 맞는 명령 하나를
실행하고 끝나면 중단한다.

## 공식 자료

- [Vite 시작 안내](https://vite.dev/guide/)
- [Vite 기능과 TypeScript 처리](https://vite.dev/guide/features.html#typescript)
- [Vite 프로덕션 빌드](https://vite.dev/guide/build.html)
- [Vite React plugin](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react)
