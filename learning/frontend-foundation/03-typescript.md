# TypeScript

## 학습 목표

TypeScript 타입 검사가 무엇인지 이해하고, 내가 입력하는 pnpm 명령과 실제로
실행되는 TypeScript 명령을 구분한다. TypeScript 타입 검사와 Vite의 프로덕션
빌드도 구분한다.

## 구성 요소

현재 TypeScript 처리에 참여하는 구성 요소는 8개다.

| 구성 요소 | 위치 | 역할 |
| --- | --- | --- |
| TypeScript 소스 | `src/*.tsx`, `vite.config.ts`, `playwright.config.ts`, `e2e/` | 타입 검사 입력 |
| TypeScript 컴파일러 | `node_modules/typescript` | `tsc` 명령과 타입 검사 제공 |
| pnpm script | `package.json` | 사람이 입력할 프로젝트 명령 정의 |
| 루트 TypeScript 설정 | `tsconfig.json` | 검사할 하위 설정 2개 연결 |
| 브라우저 코드 설정 | `tsconfig.app.json` | `src/` 검사 규칙 정의 |
| Node.js 코드 설정 | `tsconfig.node.json` | Vite와 Playwright 설정 및 End-to-End (E2E) 코드 검사 규칙 정의 |
| Vite | `node_modules/vite` | 검사 완료 후 브라우저용 JavaScript 생성 |
| 검사 부산물 | `node_modules/.tmp/*.tsbuildinfo` | TypeScript 검사 정보 저장 |

TypeScript 설정과 소스는 Git으로 추적한다. `node_modules/`, `.tsbuildinfo`와
`dist/`는 명령으로 다시 만들 수 있으므로 추적하지 않는다.

## 가장 먼저 구분할 두 명령

현재 자주 사용하는 명령은 2개다.

| 내가 입력하는 명령 | `package.json`이 실행하는 내용 | 최종 결과 |
| --- | --- | --- |
| `pnpm run typecheck` | `tsc -b` | 타입 오류 검사 |
| `pnpm run build` | `tsc -b && vite build` | 타입 오류 검사 후 `dist/` 생성 |

`typecheck`와 `build`는 pnpm에 원래 존재하는 고정 명령 이름이 아니다. 이
Repository가 `package.json`에 정한 script 이름이다. pnpm은 script 이름의
오른쪽에 적힌 실제 명령을 실행한다.

## 타입 검사 예시

다음 코드는 변수에 숫자만 넣을 수 있다고 선언한 뒤 문자열을 넣는다.

```ts
const count: number = "10";
```

브라우저에서 실행하기 전에 TypeScript는 `number`와 `string`이 맞지 않는다는
오류를 찾을 수 있다. 이 확인 과정이 타입 검사다.

타입 검사는 프로그램의 모든 오류를 찾지 않는다. 서버가 잘못된 데이터를 보내는
문제, 네트워크 연결 실패와 실제 브라우저에 없는 Web API (Application Programming
Interface)를 호출하는 문제는 별도 검증이 필요하다.

## `pnpm run typecheck` 실행 과정

실행 과정은 6단계다.

1. 사람이 `pnpm run typecheck`를 입력한다.
2. pnpm이 `package.json`의 `typecheck` script를 찾는다.
3. pnpm이 script에 적힌 `tsc -b`를 실행한다.
4. `tsc`가 루트 `tsconfig.json`을 읽는다.
5. `tsc`가 연결된 앱 설정과 Node.js 설정을 모두 읽어 소스를 타입 검사한다.
6. 오류가 없으면 종료 코드(exit code) 0, 오류가 있으면 0이 아닌 종료 코드로 끝난다.

이 명령은 `dist/`를 만들지 않는다. 현재 설정에서는 TypeScript가 JavaScript도
생성하지 않는다.

## `pnpm run build` 실행 과정

`package.json`의 build script는 다음과 같다.

```json
{
  "build": "tsc -b && vite build"
}
```

실행 과정은 4단계다.

1. pnpm이 `tsc -b`를 실행한다.
2. TypeScript 타입 오류가 있으면 명령을 중단한다.
3. 타입 오류가 없으면 `&&` 뒤의 `vite build`를 실행한다.
4. Vite가 브라우저용 JavaScript와 HTML을 `dist/`에 생성한다.

TypeScript는 코드가 타입 규칙에 맞는지 검사한다. Vite는 검사된 소스를
브라우저가 실행할 정적 파일로 변환한다.

## `tsc`의 역할

`tsc`는 TypeScript compiler의 Command-Line Interface (CLI) 명령이다. `noEmit`이
`false`인 일반 설정에서는 타입 검사 후 JavaScript도 생성할 수 있다.

현재 프로젝트는 TypeScript 설정에 `noEmit: true`를 사용한다. `emit`은 compiler가
결과 파일을 출력하는 동작을 뜻한다. 따라서 현재 `tsc`는 타입을 검사하지만
JavaScript 파일은 출력하지 않는다.

```text
TypeScript source -> tsc -> Type result
TypeScript source -> Vite -> JavaScript files
```

Vite는 빠른 변환을 담당하지만 TypeScript 타입 오류를 검사하지 않는다. 그래서
프로덕션 빌드 script가 `tsc -b`를 먼저 실행한다.

## TypeScript 설정이 3개인 이유

검사 대상 코드의 실행 환경은 2개다.

| 코드 | 실제 실행 환경 | 필요한 전역 기능과 타입 |
| --- | --- | --- |
| `src/` | 브라우저 | `document`, Document Object Model (DOM), 브라우저 기능 |
| `vite.config.ts`, `playwright.config.ts`, `e2e/` | Node.js와 Playwright | Node.js module, Playwright Application Programming Interface (API)와 실행 환경 |

DOM은 브라우저가 Hypertext Markup Language (HTML) 문서를 메모리에 표현하는
객체 구조다. `document` 객체는 브라우저가 제공하므로 Node.js에서 기본 제공되지
않는다.

두 실행 환경의 타입을 섞지 않기 위해 설정을 2개로 나눈다. 루트 설정 1개는
두 설정을 한 명령으로 검사할 수 있게 연결한다.

```text
tsconfig.json
  -> tsconfig.app.json  -> src
  -> tsconfig.node.json -> vite.config.ts, playwright.config.ts, e2e
```

## 루트 `tsconfig.json`과 `-b`

루트 설정의 전체 내용은 다음과 같다.

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`files: []`는 루트 설정이 직접 검사할 소스가 없다는 뜻이다. `references`는
이 명령이 처리할 하위 TypeScript 설정의 경로다.

`tsc -b`의 `-b`는 TypeScript가 build mode라고 부르는 실행 선택지다. build
mode는 루트 설정의 `references`를 따라 여러 TypeScript 설정을 처리한다.
현재 두 하위 설정은 서로를 참조하지 않으며, `tsc -b`는 두 설정과 연결된 소스를 모두 검사한다.

여기서 build mode는 Vite의 프로덕션 빌드와 같은 뜻이 아니다.

| 용어 | 현재 프로젝트에서 하는 일 |
| --- | --- |
| TypeScript build mode | `references`에 연결된 설정 모두 처리 |
| `vite build` | 브라우저용 정적 파일 생성 |
| `pnpm run build` | 타입 검사 후 `vite build` 실행 |

현재 하위 설정은 모두 `noEmit: true`이므로 TypeScript build mode가 애플리케이션
JavaScript를 생성하지 않는다.

## `tsconfig.app.json`

이 설정은 `include: ["src"]`에 따라 `src/` 아래의 TypeScript와 TypeScript JSX
(TSX) 파일을 검사한다. 파일에 기록된 설정은 20개다.

| 설정 | 현재 값 | 역할 |
| --- | --- | --- |
| `tsBuildInfoFile` | `node_modules/.tmp/tsconfig.app.tsbuildinfo` | 앱 검사 정보 저장 위치 |
| `target` | `ES2023` | TypeScript 검사의 JavaScript 언어 기준 |
| `lib` | `ES2023`, `DOM`, `DOM.Iterable` | JavaScript와 브라우저 전역 타입 포함 |
| `module` | `ESNext` | 최신 import와 export module 형식 사용 |
| `types` | `vite/client` | Vite의 브라우저 측 전역 타입 포함 |
| `allowArbitraryExtensions` | `true` | TypeScript 이외 확장자의 type declaration import 허용 |
| `skipLibCheck` | `true` | 설치된 `.d.ts` 타입 정의 파일 내부 검사 생략 |
| `moduleResolution` | `Bundler` | Vite 같은 bundler 기준으로 import 경로 해석 |
| `allowImportingTsExtensions` | `true` | import 경로에 `.ts`와 `.tsx` 확장자 사용 허용 |
| `verbatimModuleSyntax` | `true` | 작성한 import와 export 형식을 임의로 바꾸지 않음 |
| `moduleDetection` | `force` | 모든 소스 파일을 module로 취급 |
| `noEmit` | `true` | JavaScript 파일 출력 금지 |
| `jsx` | `react-jsx` | TSX의 JSX (JavaScript XML) 문법 검사 |
| `strict` | `true` | TypeScript의 엄격한 타입 검사 묶음 활성화 |
| `isolatedModules` | `true` | 파일 하나씩 변환할 수 없는 작성 방식 검사 |
| `noUnusedLocals` | `true` | 사용하지 않는 지역 선언을 오류로 처리 |
| `noUnusedParameters` | `true` | 사용하지 않는 함수 매개변수를 오류로 처리 |
| `erasableSyntaxOnly` | `true` | 타입 제거만으로 JavaScript가 되는 TypeScript 문법만 허용 |
| `noFallthroughCasesInSwitch` | `true` | 의도하지 않은 switch case 통과를 오류로 처리 |
| `include` | `src` | `src/` 아래 파일을 검사 대상으로 지정 |

`lib`에 DOM 타입이 있다고 해서 모든 브라우저가 해당 기능을 실제로 제공하는 것은
아니다. TypeScript 타입 선언은 브라우저에 없는 기능을 JavaScript로 구현하는
polyfill이 아니다.

## `tsconfig.node.json`

이 설정은 `include: ["vite.config.ts", "playwright.config.ts", "e2e"]`에 따라 Vite 설정,
Playwright 설정과 End-to-End (E2E) 테스트 파일을 검사한다.

| 설정 | 역할 |
| --- | --- |
| `tsBuildInfoFile` | Node.js 도구 검사 정보를 별도 파일에 저장 |
| `target: ES2023` | TypeScript 검사의 JavaScript 언어 기준 지정 |
| `types: ["node"]` | Node.js가 제공하는 타입 포함 |
| `module: NodeNext` | Node.js의 module 해석 방식 적용 |
| `lib: ["ES2023"]` | 브라우저 DOM 타입을 제외한 JavaScript 타입 사용 |
| `noEmit: true` | JavaScript 출력 금지 |
| `include: ["vite.config.ts", "playwright.config.ts", "e2e"]` | Vite와 Playwright 설정 및 E2E 파일을 검사 대상으로 지정 |

`skipLibCheck`, `allowImportingTsExtensions`, `verbatimModuleSyntax`,
`moduleDetection`, `strict`, `isolatedModules`, `noUnusedLocals`,
`noUnusedParameters`, `erasableSyntaxOnly`와 `noFallthroughCasesInSwitch`는
앱 설정과 같은 역할로 적용된다.

`vite.config.ts`는 브라우저에 전달되는 코드가 아니다. Node.js가 Vite를 시작할 때
읽는 개발 도구 설정이다.

## 생성되는 부산물

TypeScript가 생성하는 현재 부산물은 2개다.

```text
node_modules/.tmp/tsconfig.app.tsbuildinfo
node_modules/.tmp/tsconfig.node.tsbuildinfo
```

`.tsbuildinfo`에는 TypeScript가 프로젝트를 처리하며 수집한 검사 정보가 들어간다.
애플리케이션 JavaScript나 배포 파일이 아니며 삭제해도 다음 타입 검사에서 다시
생성된다.

## 확인 명령

처음에는 다음 명령 2개만 사용한다.

```sh
pnpm run typecheck
pnpm run build
```

첫 번째 명령은 타입 검사만 수행한다. 두 번째 명령은 같은 타입 검사를 통과한 뒤
Vite가 `dist/`를 생성한다.

설정 해석 결과를 확인해야 할 때만 다음 명령을 사용한다.

```sh
pnpm exec tsc --showConfig -p tsconfig.app.json
pnpm exec tsc --showConfig -p tsconfig.node.json
```

## 공식 자료

- [TypeScript TSConfig reference](https://www.typescriptlang.org/tsconfig/)
- [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [Vite의 TypeScript 처리](https://vite.dev/guide/features.html#typescript)
