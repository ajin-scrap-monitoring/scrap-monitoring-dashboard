# TypeScript

## 학습 목표

TypeScript 컴파일러가 어떤 파일을 어떤 환경 규칙으로 검사하는지 이해하고,
타입 검사와 Vite의 JavaScript 변환을 구분한다.

## 구성 요소

현재 구조의 구성 요소는 6개다.

| 구성 요소 | 위치 | 역할 |
| --- | --- | --- |
| TypeScript 컴파일러 | `node_modules/typescript` | `tsc` 명령과 타입 검사 제공 |
| solution 설정 | `tsconfig.json` | 하위 TypeScript 프로젝트 연결 |
| 브라우저 앱 설정 | `tsconfig.app.json` | `src/`의 TypeScript와 TypeScript JSX (TSX) 검사 |
| Node.js 도구 설정 | `tsconfig.node.json` | `vite.config.ts` 검사 |
| 검사 대상 소스 | `src/*.ts`, `src/*.tsx`, `vite.config.ts` | 타입 검사 입력 |
| 증분 검사 정보 | `node_modules/.tmp/*.tsbuildinfo` | 이전 검사 결과의 메타데이터 |

세 설정 파일은 Git으로 추적한다. `.tsbuildinfo`는 TypeScript가 다시 생성할 수
있는 부산물이며 `node_modules/` 안에 있으므로 추적하지 않는다.

## 프로젝트가 둘로 나뉜 이유

브라우저 애플리케이션과 빌드 설정은 실행 환경이 다르다.

```text
tsconfig.json
  -> tsconfig.app.json  -> src
  -> tsconfig.node.json -> vite.config.ts
```

`src/` 코드는 브라우저에서 실행되므로 Document Object Model (DOM) 타입이 필요하다.
`vite.config.ts`는 Node.js가 실행하므로 Node.js 전역과 module 해석 규칙이 필요하다.
설정을 나누면 브라우저 코드가 Node.js 전용 전역을 실수로 사용하는 문제와 도구
설정이 브라우저 전역에 의존하는 문제를 더 쉽게 발견할 수 있다.

## solution 설정

루트 `tsconfig.json`은 직접 소스 파일을 포함하지 않는다. `files`를 빈 목록으로
두고 `references`로 두 하위 설정을 연결한다.

`pnpm run typecheck`가 실행하는 `tsc -b`의 `-b`는 build mode다. TypeScript는
루트 설정의 참조를 읽고 앱 프로젝트와 Node.js 도구 프로젝트를 순서에 맞게
검사한다.

## 브라우저 앱 설정

`tsconfig.app.json`의 설정은 5개 범주로 나뉜다.

| 범주 | 주요 설정 | 의미 |
| --- | --- | --- |
| JavaScript 언어 모델 | `target: ES2023`, `lib` | 검사에 사용할 표준 내장 객체와 DOM 타입 |
| module 해석 | `module: ESNext`, `moduleResolution: Bundler` | Vite가 처리할 import와 export 해석 |
| React TSX | `jsx: react-jsx` | JSX를 React JSX runtime 기준으로 검사 |
| 단일 파일 변환 안전성 | `isolatedModules`, `erasableSyntaxOnly` | Vite의 파일별 변환과 맞는 문법 제한 |
| 오류 검출 강도 | `strict`, `noUnusedLocals`, `noUnusedParameters` | 타입 안전성과 사용하지 않는 선언 검사 |

`types: ["vite/client"]`는 Vite가 제공하는 브라우저 측 타입 선언을 포함한다.
`include: ["src"]`는 검사 대상을 `src/` 아래로 제한한다.

## Node.js 도구 설정

`tsconfig.node.json`은 `vite.config.ts`만 검사한다. `types: ["node"]`가 Node.js
타입을 제공하고 `module: NodeNext`가 Node.js의 ECMAScript Module (ESM) 해석
규칙을 사용한다.

브라우저의 DOM library는 이 설정에 포함되지 않는다. `vite.config.ts`는 브라우저에
전송되는 애플리케이션 소스가 아니라 Node.js가 빌드 전에 읽는 도구 설정이다.

## 타입 검사와 코드 변환

현재 처리 과정은 2개로 분리된다.

| 처리 | 실행 주체 | 결과 |
| --- | --- | --- |
| 타입 검사 | TypeScript의 `tsc -b` | 성공 또는 타입 오류 |
| JavaScript 변환과 번들 생성 | Vite | `dist/` 정적 파일 |

두 하위 TypeScript 설정 모두 `noEmit: true`를 사용한다. 따라서 TypeScript는
JavaScript 파일을 생성하지 않는다. `pnpm run build`가 먼저 타입 검사를 수행한 뒤
Vite가 TypeScript와 TSX를 JavaScript로 변환한다.

## `target`과 브라우저 지원의 차이

`target: ES2023`은 TypeScript가 소스를 검사할 때 사용하는 JavaScript 언어 수준과
관련된다. 현재 TypeScript가 파일을 emit하지 않으므로 이 값이 최종 Vite 산출물의
브라우저 지원 범위를 직접 결정하지 않는다.

최종 JavaScript 문법 변환 범위는 Vite의 build target이 결정한다. 브라우저 Web API
(Application Programming Interface)의 실제 제공 여부는 TypeScript와 Vite가 자동으로
해결하지 않는다.

`lib: ["DOM"]`이 어떤 Web API의 타입을 제공하더라도 해당 API가 모든 운영
브라우저에 실제로 존재한다는 뜻은 아니다. `lib`는 타입 선언이며 polyfill이나
브라우저 기능 구현이 아니다.

## 주요 검사 옵션

| 설정 | 검사 효과 |
| --- | --- |
| `strict` | 엄격한 타입 검사 묶음 활성화 |
| `isolatedModules` | 각 파일을 독립 변환할 때 문제가 되는 작성 방식 제한 |
| `verbatimModuleSyntax` | import와 export 작성 의도 보존 |
| `noUnusedLocals` | 사용하지 않는 지역 선언 오류 처리 |
| `noUnusedParameters` | 사용하지 않는 매개변수 오류 처리 |
| `noFallthroughCasesInSwitch` | 의도하지 않은 switch case 통과 오류 처리 |
| `skipLibCheck` | 설치한 declaration file 내부 검사 생략 |
| `noEmit` | TypeScript의 JavaScript 파일 생성 금지 |

`skipLibCheck`는 프로젝트 소스 타입 검사를 끄는 설정이 아니다. 설치된 type
declaration file 사이의 검사 비용을 줄이는 설정이다.

## 생성되는 부산물

`tsBuildInfoFile`은 다음 두 경로를 지정한다.

```text
node_modules/.tmp/tsconfig.app.tsbuildinfo
node_modules/.tmp/tsconfig.node.tsbuildinfo
```

TypeScript는 이 파일에 증분 검사에 필요한 메타데이터를 저장한다. 애플리케이션
JavaScript나 배포 산출물이 아니며 삭제해도 다음 타입 검사에서 다시 생성된다.

## 확인 명령

```sh
pnpm run typecheck
pnpm exec tsc -b --verbose
pnpm exec tsc --showConfig -p tsconfig.app.json
pnpm exec tsc --showConfig -p tsconfig.node.json
```

`--verbose`는 build mode가 어떤 프로젝트를 검사하는지 보여 준다. `--showConfig`는
TypeScript가 기본값과 상속을 반영한 최종 설정을 출력한다.

## 공식 자료

- [TypeScript TSConfig reference](https://www.typescriptlang.org/tsconfig/)
- [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [Vite의 TypeScript 처리](https://vite.dev/guide/features.html#typescript)
