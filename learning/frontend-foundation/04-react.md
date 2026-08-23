# React

## 학습 목표

브라우저가 Hypertext Markup Language (HTML) 진입 파일인 `index.html`을 연 뒤
React가 애플리케이션 컴포넌트를 실제 Document Object Model (DOM)에 연결하는
과정을 이해한다.

## 구성 요소

현재 구조의 구성 요소는 6개다.

| 구성 요소 | 위치 | 역할 |
| --- | --- | --- |
| HTML mount 지점 | `index.html`의 `div#root` | React가 관리할 DOM 영역 제공 |
| JavaScript 진입 module | `src/main.tsx` | React root 생성과 최상위 컴포넌트 렌더링 |
| 애플리케이션 root | `src/App.tsx` | 제품 컴포넌트 트리의 시작점 |
| `react` package | `dependencies` | 컴포넌트, JSX runtime과 React Application Programming Interface (API) 제공 |
| `react-dom` package | `dependencies` | React 트리와 브라우저 DOM 연결 |
| `StrictMode` | `src/main.tsx` | 개발 중 문제 탐지를 위한 추가 검사 활성화 |

현재 `App`은 빈 `main` element만 반환한다. 제품 화면, router, 외부 상태와 데이터
요청은 아직 이 구조에 포함되지 않는다.

## 브라우저 실행 흐름

현재 화면이 만들어지는 과정은 8단계다.

1. 브라우저가 웹 서버에서 `index.html`을 받는다.
2. 브라우저가 HTML을 해석하고 `div#root`를 DOM에 만든다.
3. 브라우저가 Vite가 연결한 JavaScript module을 불러온다.
4. `src/main.tsx`의 module 코드가 실행된다.
5. `document.getElementById("root")`가 mount 지점을 찾는다.
6. `createRoot(rootElement)`가 해당 DOM element를 관리하는 React root를 만든다.
7. React가 `StrictMode` 안의 `App` 컴포넌트를 평가한다.
8. React DOM이 `App`이 반환한 `main` element를 실제 DOM에 반영한다.

```text
index.html -> div#root
          -> main.tsx -> createRoot -> StrictMode -> App -> main element
```

`App` 함수를 애플리케이션 코드가 직접 호출하지 않는다. React가 렌더링 과정에서
컴포넌트 함수를 호출하고 반환값을 현재 React 트리와 비교해 필요한 DOM 변경을
적용한다.

## `index.html`의 mount 지점

`index.html`에는 다음 element가 있다.

```html
<div id="root"></div>
```

`id="root"`는 HTML과 `src/main.tsx` 사이의 계약이다. HTML에서 id를 바꾸면
`getElementById`의 인자도 함께 바꿔야 한다.

현재 코드는 mount 지점을 찾지 못하면 다음 오류를 발생시킨다.

```ts
if (rootElement === null) {
  throw new Error("Root element not found.");
}
```

이 검사는 `createRoot`에 `null`을 넘기지 않게 하고, HTML 진입점이 잘못된 경우를
즉시 드러낸다.

## React와 React DOM의 차이

두 package의 책임은 다르다.

| package | 책임 |
| --- | --- |
| `react` | 컴포넌트 모델, hook, JSX runtime과 공통 React API |
| `react-dom` | React 컴포넌트 트리를 브라우저 DOM에 렌더링 |

`StrictMode`는 `react`에서 가져오고 `createRoot`는 `react-dom/client`에서 가져온다.
React의 컴포넌트 개념과 브라우저 DOM 연결을 분리한 구조다.

## TSX와 JSX runtime

`src/main.tsx`와 `src/App.tsx`는 TypeScript에서 JSX를 사용하는 TypeScript JSX
(TSX) 파일이다. JSX (JavaScript XML) 문법은 코드 안에서 User Interface (UI)
구조를 표현할 수 있게 한다.

브라우저는 원본 TSX를 그대로 실행하지 않는다. TypeScript가 타입을 검사하고
Vite가 TSX를 브라우저가 실행할 JavaScript로 변환한다. `jsx: react-jsx` 설정은
현대 React JSX runtime을 기준으로 타입 검사와 변환 도구의 동작을 맞춘다.

## `StrictMode`의 역할

`StrictMode`는 개발 중에 다음 문제를 찾기 위한 React 기능이다.

- 순수하지 않은 render logic 탐지
- effect cleanup 누락 탐지
- ref cleanup 누락 탐지
- 사용 중단 예정 React API 탐지

React는 개발 환경에서 일부 render와 effect 관련 동작을 추가로 실행해 문제를
드러낼 수 있다. 이 추가 검사는 프로덕션 빌드에는 적용되지 않는다. 개발 중 같은
로그나 요청이 두 번 관찰되면 `StrictMode`의 검사인지 먼저 구분해야 한다.

`StrictMode`가 오류를 자동으로 수정하거나 타입 검사를 대신하지는 않는다.

## `App` 컴포넌트

현재 `App`은 다음 한 가지 DOM element를 표현한다.

```tsx
export function App() {
  return <main aria-label="스크랩 모니터링 대시보드" />;
}
```

함수 이름의 첫 글자를 대문자로 작성하면 JSX가 이를 HTML tag가 아니라 React
컴포넌트로 해석한다. `export`는 다른 module인 `src/main.tsx`가 `App`을 import할
수 있게 한다.

`aria-label`은 빈 `main` 영역에도 접근 가능한 이름을 제공한다. 실제 화면을
구현하면 문서 구조와 화면 제목을 기준으로 적절한 접근성 이름을 다시 검토한다.

## 개발 중 갱신

Vite 개발 서버와 React plugin은 Fast Refresh를 제공한다. 소스 컴포넌트를
저장하면 Vite가 변경된 module을 브라우저에 전달하고 React가 가능한 경우 현재
컴포넌트 상태를 유지하면서 화면을 갱신한다.

Fast Refresh는 개발 기능이다. 프로덕션 `dist/`에는 개발 서버 연결을 포함하지
않는다.

## 생성되는 부산물

| 부산물 | 생성 시점 | 위치 | Git 추적 |
| --- | --- | --- | --- |
| 변환된 React JavaScript | Vite build | `dist/assets/` | 제외 |
| React가 만든 DOM | 브라우저 실행 | 브라우저 memory | 제외 |
| Fast Refresh 상태 | 개발 서버 실행 | 개발 서버와 브라우저 memory | 제외 |

React source file은 입력이고 DOM과 bundle은 실행 또는 빌드 결과다. `dist/`의
JavaScript를 직접 편집하지 않고 `src/`를 수정한 뒤 다시 빌드한다.

## 확인 방법

```sh
pnpm run dev
```

브라우저 개발자 도구에서 다음 내용을 확인한다.

- Elements panel의 `div#root`와 하위 `main` element
- Network panel의 HTML과 JavaScript module 요청
- Console panel의 mount 오류 유무
- source 변경 후 Fast Refresh 동작

## 공식 자료

- [React의 `createRoot`](https://react.dev/reference/react-dom/client/createRoot)
- [React의 `StrictMode`](https://react.dev/reference/react/StrictMode)
- [React의 JSX 작성](https://react.dev/learn/writing-markup-with-jsx)
