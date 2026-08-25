# React

## 학습 목표

`index.html`, `src/main.tsx`와 `src/App.tsx`가 어떻게 연결되는지 이해한다.
React가 담당하는 일과 브라우저가 담당하는 일도 구분한다.

## 구성 요소

현재 화면 생성에 참여하는 구성 요소는 8개다.

| 구성 요소 | 위치 | 역할 |
| --- | --- | --- |
| Hypertext Markup Language (HTML) 파일 | `index.html` | 브라우저가 처음 받는 문서 |
| React 연결 위치 | `index.html`의 `div#root` | React가 화면을 넣을 빈 영역 |
| JavaScript 진입 파일 | `src/main.tsx` | HTML과 React 애플리케이션 연결 |
| 최상위 컴포넌트 | `src/App.tsx` | 애플리케이션 화면 구조의 시작점 |
| `react` package | `dependencies` | 컴포넌트와 React 기능 제공 |
| `react-dom` package | `dependencies` | React 화면을 브라우저 Document Object Model (DOM)에 반영 |
| `StrictMode` | `src/main.tsx` | 개발 중 React 코드의 문제 탐지 지원 |
| Vite | 개발 서버와 빌드 도구 | TSX를 브라우저용 JavaScript로 변환 |

현재 `App` 컴포넌트는 내용이 없는 `main` element 하나만 만든다. 따라서
애플리케이션이 정상 실행돼도 화면에는 별도의 문구가 표시되지 않는다.

## HTML 파일과 DOM

HTML 파일과 DOM은 같은 대상이 아니다.

| 대상 | 존재 위치 | 의미 |
| --- | --- | --- |
| `index.html` | Repository와 웹 서버 | 브라우저가 받을 문서 원본 |
| DOM | 브라우저 메모리 | 브라우저가 HTML을 읽어 만든 객체 구조 |

브라우저는 `index.html`의 문자열을 읽고 `html`, `body`, `div` 같은 HTML
element(요소)를 DOM 객체로 만든다. JavaScript는 이 DOM을 조회하거나 변경할 수
있다.

현재 HTML에는 React가 사용할 빈 `div`가 있다.

```html
<div id="root"></div>
```

`id="root"`는 React 애플리케이션을 넣을 위치를 식별한다. React 문서에서는 React를
이 DOM 위치에 연결하는 일을 mount라고 부른다.

## 화면이 만들어지는 전체 과정

현재 화면이 만들어지는 과정은 9단계다.

1. 브라우저가 웹 서버에서 `index.html`을 받는다.
2. 브라우저가 HTML을 읽어 DOM을 만든다.
3. DOM에 빈 `div#root`가 만들어진다.
4. 브라우저가 HTML에 연결된 JavaScript를 실행한다.
5. `src/main.tsx`가 `document.getElementById("root")`로 빈 `div`를 찾는다.
6. `createRoot(rootElement)`가 이 `div`를 React가 관리할 영역으로 지정한다.
7. React가 `App` 컴포넌트를 실행한다.
8. `App`이 `main` element 구조를 반환한다.
9. `react-dom`이 `main` element를 실제 DOM에 반영한다.

```text
index.html -> div#root -> main.tsx -> App -> main element -> Browser DOM
```

브라우저가 원본 `.tsx` 파일을 직접 이해하는 것은 아니다. 개발 중에는 Vite가
`.tsx`를 JavaScript로 변환해서 브라우저에 전달한다. 프로덕션에서는 Vite가 미리
변환한 `dist/`의 JavaScript를 브라우저가 받는다.

## `src/main.tsx`의 역할

현재 파일의 역할은 4개다.

1. React와 `createRoot`를 가져온다.
2. `App` 컴포넌트를 가져온다.
3. HTML의 `div#root`를 찾는다.
4. 해당 위치에 `App`을 렌더링한다.

현재 핵심 코드는 다음과 같다.

```tsx
const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Root element not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`getElementById`가 실패하면 결과는 `null`이다. 현재 코드는 `null`을 확인하고
오류를 발생시킨다. 이 검사가 없으면 React를 연결할 DOM element가 없는 상태로
`createRoot`를 호출하게 된다.

`render`는 `App`에서 시작하는 React 컴포넌트 구조를 화면에 반영하라는 호출이다.

## 컴포넌트와 `App`

React 컴포넌트는 화면의 일부를 표현하는 JavaScript 함수다. 현재 `App`은
애플리케이션 전체의 시작 컴포넌트다.

```tsx
export function App() {
  return <main aria-label="스크랩 모니터링 대시보드" />;
}
```

이 코드의 각 부분은 다음 역할을 한다.

| 코드 | 역할 |
| --- | --- |
| `export` | 다른 파일이 `App`을 import할 수 있게 함 |
| `function App()` | `App`이라는 React 컴포넌트 정의 |
| `return` | 컴포넌트가 표현할 화면 구조 반환 |
| `<main />` | 문서의 주요 콘텐츠 영역 표현 |
| `aria-label` | `main` 영역의 접근 가능한 이름 제공 |

컴포넌트 이름은 대문자로 시작한다. JSX가 소문자 이름을 HTML element로 해석하고
대문자 이름을 React 컴포넌트로 해석하기 때문이다.

애플리케이션 코드가 `App()`을 직접 호출하지 않는다. `<App />`을 전달받은 React가
첫 화면을 계산할 때 `App` 함수를 호출한다. 개발 환경의 `StrictMode`는 검사를 위해
이 함수를 추가 호출할 수 있다.

## JSX와 TSX

JavaScript XML (JSX)은 JavaScript 코드 안에서 화면 구조를 element 형태로 적는
문법이다. 다음 코드는 문자열이나 완성된 HTML 파일이 아니다.

```tsx
<main aria-label="스크랩 모니터링 대시보드" />
```

TypeScript 파일에서 JSX를 사용하면 파일 확장자를 `.tsx`로 작성한다. 이 형식을
TypeScript JSX (TSX)라고 부른다.

브라우저는 JSX와 TypeScript 타입 문법을 그대로 실행하지 않는다. Vite가 TSX를
JavaScript로 변환한다. TypeScript는 변환 전에 JSX 표현과 component property의
타입이 올바른지 검사한다.

## `react`와 `react-dom`

두 package의 책임은 2개로 구분된다.

| package | 책임 |
| --- | --- |
| `react` | 컴포넌트 모델, JSX 변환 결과용 함수와 `StrictMode` 제공 |
| `react-dom` | React 컴포넌트 결과를 브라우저 DOM에 반영 |

`StrictMode`는 `react`에서 가져온다. 브라우저 연결 함수인 `createRoot`는
`react-dom/client`에서 가져온다.

## `StrictMode`

`StrictMode`는 개발 중에 React 코드의 잘못된 작성 방식을 더 쉽게 발견하도록
다음 4개 검사를 추가한다.

| 검사 | 개발 환경의 추가 동작 |
| --- | --- |
| 컴포넌트 순수성 | 컴포넌트 함수를 추가 호출해 실행 중 외부 상태 변경 탐지 지원 |
| effect 정리 | 외부 시스템 동기화 코드의 설정과 정리 추가 실행 |
| ref 정리 | DOM 참조 callback의 설정과 정리 추가 실행 |
| 사용 중단 Application Programming Interface (API) | React가 사용 중단을 예고한 API 사용 경고 |

현재 `App`에는 effect와 ref callback이 없다. 현재 코드에서 직접 관찰할 수 있는
동작은 개발 환경에서 `App` 함수가 추가 호출될 수 있다는 점이다. 이후 effect나
네트워크 요청을 추가하면 개발 중 같은 로그나 요청이 두 번 관찰되는 원인을
`StrictMode`와 실제 중복 호출로 나눠 확인해야 한다.

프로덕션 빌드에서는 `StrictMode`의 추가 검사를 실행하지 않는다.

`StrictMode`는 TypeScript 타입 검사나 테스트를 대신하지 않는다.

## 개발 중 파일을 저장하면 일어나는 일

개발 서버에서 컴포넌트 파일을 저장하면 Vite와 React plugin이 변경된 코드를
브라우저에 다시 전달한다. React Fast Refresh는 가능한 경우 현재 화면 상태를
유지하면서 변경된 컴포넌트를 갱신한다.

Fast Refresh는 개발 서버 기능이다. `dist/`의 프로덕션 JavaScript에는 개발 서버와
연결하는 기능이 포함되지 않는다.

## 생성되는 결과

현재 React 실행과 빌드에서 생기는 결과는 3개다.

| 결과 | 생성 주체 | 위치 | Git 추적 |
| --- | --- | --- | --- |
| 브라우저용 JavaScript | Vite build | `dist/assets/` | 제외 |
| 화면 DOM | 브라우저와 `react-dom` | 브라우저 메모리 | 제외 |
| Fast Refresh 상태 | Vite 개발 서버와 React | 실행 중인 프로세스와 브라우저 | 제외 |

React 소스는 `src/`에서 수정한다. `dist/`의 JavaScript와 브라우저 메모리의 DOM은
직접 수정해서 소스에 반영하는 대상이 아니다.

## 확인 방법

```sh
pnpm run dev
```

Vite가 출력한 주소를 브라우저에서 열고 개발자 도구의 Elements panel을 확인한다.
`div#root` 아래에 `main` element가 있으면 `index.html`, `main.tsx`, `App.tsx`와
React DOM 연결이 동작한 것이다.

## 공식 자료

- [React의 첫 컴포넌트](https://react.dev/learn/your-first-component)
- [React의 JSX 작성](https://react.dev/learn/writing-markup-with-jsx)
- [React의 `createRoot`](https://react.dev/reference/react-dom/client/createRoot)
- [React의 `StrictMode`](https://react.dev/reference/react/StrictMode)
