# Vite

## 학습 목표

Vite가 개발 중 소스를 제공하는 과정과 프로덕션 정적 파일을 생성하는 과정을
구분하고, TypeScript와 React plugin이 어느 단계에 참여하는지 이해한다.

## 구성 요소

현재 구조의 구성 요소는 8개다.

| 구성 요소 | 위치 | 역할 |
| --- | --- | --- |
| Vite Command-Line Interface (CLI) | `node_modules/vite` | 개발 서버, build와 preview 명령 제공 |
| Vite 설정 | `vite.config.ts` | plugin과 build 동작 구성 |
| React plugin | `@vitejs/plugin-react` | React 변환과 Fast Refresh 지원 |
| Hypertext Markup Language (HTML) 진입점 | `index.html` | module graph의 시작점과 HTML 문서 제공 |
| 애플리케이션 source | `src/*.tsx` | 변환하고 bundle할 코드 |
| 개발 서버 | `vite` process | source를 개발용으로 변환하고 제공 |
| 프로덕션 builder | `vite build` process | 최적화된 정적 파일 생성 |
| build 산출물 | `dist/` | 웹 서버에 전달할 정적 파일 |

`vite.config.ts`, `index.html`과 `src/`는 입력 파일이다. 개발 서버 process와
`dist/`는 명령 실행으로 생기는 실행 상태 또는 부산물이다.

## Vite 설정 실행 위치

`vite.config.ts`는 브라우저가 실행하는 코드가 아니다. Node.js가 Vite를 시작할 때
이 파일을 읽고 실행한다.

현재 설정은 React plugin 하나를 등록한다.

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
```

`defineConfig`는 설정 객체 작성 시 TypeScript 편집 지원을 제공한다. `react()`가
반환한 plugin을 `plugins` 배열에 넣으면 Vite가 개발과 build pipeline에 해당
plugin을 연결한다.

## `index.html`의 역할

Vite에서 `index.html`은 단순 복사 대상이 아니라 module graph의 진입점이다.
현재 script element는 원본 진입 module을 가리킨다.

```html
<script type="module" src="/src/main.tsx"></script>
```

개발 서버는 이 요청을 처리하면서 TSX를 변환한다. 프로덕션 build는
`src/main.tsx`에서 이어지는 import graph를 분석하고, script 경로를 생성한
JavaScript asset 경로로 바꾼 HTML을 `dist/`에 기록한다.

## 개발 서버 흐름

`pnpm run dev`의 실행 흐름은 7단계다.

1. pnpm이 `package.json`의 `dev` script를 읽는다.
2. pnpm이 프로젝트에 설치된 Vite CLI를 실행한다.
3. Node.js가 `vite.config.ts`를 읽어 React plugin을 등록한다.
4. Vite가 로컬 Hypertext Transfer Protocol (HTTP) 개발 서버를 연다.
5. 브라우저가 `index.html`과 `/src/main.tsx`를 요청한다.
6. Vite가 요청된 module을 필요할 때 변환해 응답한다.
7. source가 바뀌면 Vite와 React plugin이 변경 사항을 브라우저에 전달한다.

```text
Source -> Vite Dev Server -> Transformed Modules -> Browser
                  ^                              |
                  +--------- Source Update ------+
```

개발 서버는 source file을 빠르게 확인하는 도구다. `dist/`를 먼저 만들지 않고
요청된 module을 개발 환경에 맞게 제공한다.

## 프로덕션 build 흐름

`pnpm run build`는 2개 상위 작업을 순서대로 실행한다.

```text
TypeScript type check -> Vite production build -> dist
```

Vite build 내부 흐름은 5단계다.

1. Vite가 `index.html`을 진입점으로 읽는다.
2. Vite가 `src/main.tsx`에서 이어지는 import graph를 수집한다.
3. Vite와 React plugin이 TypeScript와 TSX를 JavaScript로 변환한다.
4. Vite가 필요한 package code와 애플리케이션 code를 bundle하고 최적화한다.
5. Vite가 변환된 HTML과 hash가 포함된 asset을 `dist/`에 기록한다.

현재 build 결과는 최소한 다음 구조를 가진다.

```text
dist/
  index.html
  assets/
    index-<content-hash>.js
```

asset 이름의 hash는 내용에 따라 달라질 수 있다. HTML은 해당 build에서 생성된
정확한 asset 이름을 참조한다.

## 개발 서버와 `dist/`의 차이

| 항목 | 개발 서버 | 프로덕션 build |
| --- | --- | --- |
| 명령 | `pnpm run dev` | `pnpm run build` |
| source 처리 | 요청 시 변환 | 전체 graph 분석과 bundle 생성 |
| 출력 위치 | 개발 서버 응답 | `dist/` |
| Fast Refresh | 포함 | 제외 |
| 사용 목적 | 개발 중 확인 | 배포할 정적 산출물 생성 |

개발 서버를 운영 웹 서버로 사용하지 않는다. 배포 Repository의 Nginx가 검증된
정적 산출물을 제공한다.

## preview의 역할

`pnpm run preview`는 이미 생성된 `dist/`를 로컬 HTTP 서버로 제공한다. source를
개발 방식으로 변환하는 `pnpm run dev`와 달리 build 결과를 확인한다.

preview는 배포 전에 HTML과 asset 경로가 실제 HTTP 요청으로 열리는지 확인하는
도구다. 성능, 보안 header, TLS, reverse proxy와 운영 장애 대응을 제공하는
프로덕션 웹 서버가 아니다.

## 세 가지 호환성 설정

프론트엔드 호환성은 3개 층으로 나뉜다. Web API의 API는 Application Programming
Interface를 뜻한다.

| 층 | 현재 관련 설정 | 결정 대상 |
| --- | --- | --- |
| TypeScript 검사 언어 수준 | `target: ES2023`, `lib` | source 타입과 사용 가능한 타입 선언 |
| Vite build 출력 문법 | Vite의 기본 build target | 변환된 JavaScript 문법 범위 |
| 브라우저 Web API | 애플리케이션 source에서 호출한 API | 실제 브라우저 기능 제공 여부와 fallback |

Vite가 최신 JavaScript 문법을 이전 문법으로 변환해도 브라우저에 없는 Web API를
자동 구현하지는 않는다. Web API는 실제 대상 브라우저 지원 여부를 확인하고,
필요하면 기능 탐지, 대체 동작 또는 별도 polyfill을 결정한다.

현재 Vite build target은 별도로 재정의하지 않는다. 정확한 대상 브라우저와
Web API 지원 정책은 프로젝트 구현 결정 문서에서 별도로 확정한다.

## 기본 경로와 웹 서버 경계

현재 Vite의 기본 base path를 사용하므로 생성된 asset URL은 웹 서버 root를
기준으로 한다. 이 동작은 현재 빈 애플리케이션 build를 확인하기 위한 기준선이며,
실제 배포 기본 경로 계약은 아직 확정되지 않은 상태다.

Nginx 설정, Transport Layer Security (TLS), API reverse proxy와 container 구성은
이 Repository의 Vite 설정이 아니라 배포 Repository의 책임이다.

## 생성되는 부산물

| 부산물 | 생성 명령 | Git 추적 | 처리 원칙 |
| --- | --- | --- | --- |
| `dist/index.html` | `pnpm run build` | 제외 | source와 함께 재생성 |
| `dist/assets/*.js` | `pnpm run build` | 제외 | source와 함께 재생성 |
| 개발 서버 process | `pnpm run dev` | 제외 | 개발 종료 시 중단 |
| preview server process | `pnpm run preview` | 제외 | 확인 종료 시 중단 |

`dist/` 안의 파일을 직접 수정하지 않는다. 입력 source 또는 Vite 설정을 수정하고
다시 build한다.

## 확인 명령

```sh
pnpm run dev
pnpm run build
find dist -maxdepth 2 -type f -print
pnpm run preview
```

개발 서버에서는 원본 module 요청과 Fast Refresh를 관찰한다. preview에서는
`dist/index.html`이 hash가 포함된 asset을 요청하는지 관찰한다.

## 공식 자료

- [Vite 시작 안내](https://vite.dev/guide/)
- [Vite 기능과 TypeScript 처리](https://vite.dev/guide/features.html#typescript)
- [Vite 프로덕션 build](https://vite.dev/guide/build.html)
- [Vite React plugin](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react)
