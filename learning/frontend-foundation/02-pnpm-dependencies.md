# pnpm과 의존성 관리

## 학습 목표

pnpm이 패키지 선언, 버전 해석, 설치, 명령 실행을 어떻게 연결하는지 이해하고,
`package.json`, `pnpm-lock.yaml`, pnpm store와 `node_modules/`의 역할을 구분한다.

## 구성 요소

현재 구조의 구성 요소는 6개다.

| 구성 요소 | 위치 | 역할 |
| --- | --- | --- |
| pnpm 실행 파일 | 개발 컴퓨터와 Continuous Integration (CI) | 패키지 해석, 설치와 script 실행 |
| `package.json` | Repository 루트 | 직접 의존성, 도구 버전 범위와 명령 선언 |
| `.npmrc` | Repository 루트 | pnpm이 읽는 프로젝트 설치 설정 |
| `pnpm-lock.yaml` | Repository 루트 | 전이 의존성을 포함한 해석 결과 고정 |
| pnpm store | Repository 바깥 | 내려받은 패키지 내용의 사용자별 저장 공간 |
| `node_modules/` | Repository 루트 | 이 프로젝트가 사용할 패키지 연결 구조 |

`package.json`, `.npmrc`와 `pnpm-lock.yaml`은 Git으로 추적한다. pnpm store와
`node_modules/`는 설치로 재생성할 수 있으므로 추적하지 않는다.

## `package.json`의 역할

`package.json`은 Node.js 패키지의 manifest다. 현재 파일은 8개 영역을 사용한다.

| 영역 | 현재 역할 |
| --- | --- |
| `name` | 패키지 식별자 |
| `private` | Registry publish 방지 |
| `type` | `.js` 파일의 ECMAScript Module (ESM) 해석 방식 |
| `packageManager` | 정확한 pnpm 버전 `11.23.0` 선언 |
| `engines` | 허용하는 Node.js 주 버전 선언 |
| `scripts` | 반복 실행할 프로젝트 명령 선언 |
| `dependencies` | 애플리케이션 코드가 사용하는 직접 의존성 |
| `devDependencies` | 정적 검사, 테스트, 타입 검사와 빌드에 사용하는 직접 의존성 |

`dependencies`와 `devDependencies`의 패키지를 합치면 직접 의존성은 21개다.

## 직접 의존성과 전이 의존성

직접 의존성은 이 프로젝트가 이름과 버전을 `package.json`에 직접 선언한 패키지다.
전이 의존성은 직접 의존성이 내부적으로 필요로 하는 다른 패키지다.

React를 예로 들면 이 프로젝트는 `react`를 직접 선택한다. React 또는 Vite가
필요로 하는 하위 패키지는 pnpm이 함께 해석하고 `pnpm-lock.yaml`에 기록한다.
전이 의존성을 프로젝트가 직접 사용하지 않는다면 `package.json`에 다시 선언하지
않는다.

## `dependencies`와 `devDependencies`

현재 두 분류의 의미는 다음과 같다.

| 분류 | 현재 패키지 | 사용 시점 |
| --- | --- | --- |
| `dependencies` | `react`, `react-dom` | 애플리케이션 소스 구성과 번들 생성 |
| `devDependencies` | ESLint 계열, Vitest와 Testing Library, Playwright, TypeScript, Vite와 type 패키지 | 정적 검사, 테스트, 개발, 타입 검사와 빌드 |

정적 프론트엔드에서는 React 패키지의 필요한 코드가 Vite 빌드 결과에 포함된다.
운영 브라우저가 서버의 `node_modules/`를 직접 읽거나 pnpm을 실행하지 않는다.
Vite와 TypeScript는 개발 도구이므로 프로덕션 정적 산출물 안에서 실행되지 않는다.

## 정확한 버전과 lock file

`.npmrc`의 `save-exact=true`는 `pnpm add`가 새 직접 의존성을 범위 표현 없이 정확한
버전으로 `package.json`에 기록하게 한다. 예를 들어 `19.2.8`을 기록하고
`^19.2.8`을 기록하지 않는다.

`pnpm-lock.yaml`은 직접 의존성과 전이 의존성의 실제 해석 결과, 패키지 무결성
정보와 패키지 사이의 연결을 기록한다. 직접 의존성을 정확히 고정해도 전이
의존성을 재현하려면 lock file이 필요하다.

lock file은 pnpm이 생성하고 갱신한다. 사람이 일반 문서처럼 직접 편집하지 않는다.

## 설치 흐름

`pnpm install --frozen-lockfile`의 실행 흐름은 5단계다.

1. pnpm이 `package.json`과 `pnpm-lock.yaml`을 읽는다.
2. pnpm이 두 파일의 의존성 선언이 일치하는지 검사한다.
3. pnpm이 pnpm store에 없는 패키지를 내려받고 무결성을 확인한다.
4. pnpm이 store의 패키지를 기반으로 `node_modules/` 연결 구조를 만든다.
5. pnpm이 lock file을 변경하지 않고 설치를 끝낸다.

`package.json`과 lock file이 일치하지 않으면 frozen 설치는 실패한다. CI가 이
명령을 사용하는 이유는 임의로 새 버전을 해석하지 않고 Repository에 기록된
설치 상태를 그대로 재현하기 위해서다.

## script 실행 흐름

현재 script는 9개다.

| 명령 | 실제 실행 | 역할 |
| --- | --- | --- |
| `pnpm run dev` | `vite` | 개발 서버 실행 |
| `pnpm run lint` | `eslint . --max-warnings 0` | 경고 없는 정적 검사 |
| `pnpm run typecheck` | `tsc -b` | TypeScript 프로젝트 전체 타입 검사 |
| `pnpm run test` | `vitest run` | 단위, 컴포넌트와 데이터 소스 테스트 1회 실행 |
| `pnpm run test:watch` | `vitest` | 테스트 감시 실행 |
| `pnpm run test:e2e` | `pnpm run build && playwright test` | 프로덕션 빌드와 Chromium 브라우저 테스트 |
| `pnpm run build` | `tsc -b && vite build` | 타입 검사 후 프로덕션 빌드 |
| `pnpm run preview` | `vite preview` | 생성된 `dist/`의 로컬 확인 |
| `pnpm run check` | `pnpm run lint && pnpm run test && pnpm run test:e2e` | 로컬 전체 검증 |

pnpm은 script를 실행할 때 `node_modules/.bin`의 로컬 실행 파일을 찾을 수 있게
환경을 구성한다. 따라서 전역으로 TypeScript나 Vite를 별도 설치하지 않아도 된다.

## 의존성 변경 명령

| 목적 | 명령 | 변경 대상 |
| --- | --- | --- |
| 애플리케이션 의존성 추가 | `pnpm add <package>` | `package.json`, `pnpm-lock.yaml`, `node_modules/` |
| 개발 의존성 추가 | `pnpm add -D <package>` | `package.json`, `pnpm-lock.yaml`, `node_modules/` |
| 직접 의존성 제거 | `pnpm remove <package>` | `package.json`, `pnpm-lock.yaml`, `node_modules/` |
| 선언된 상태 설치 | `pnpm install` | `pnpm-lock.yaml`, `node_modules/` |
| 고정된 상태 설치 | `pnpm install --frozen-lockfile` | `node_modules/` |

의존성을 변경하면 `package.json`과 `pnpm-lock.yaml`을 같은 변경으로 검토한다.
`node_modules/`는 검토하거나 commit하는 대상이 아니다.

## 생성되는 부산물

| 부산물 | 생성 주체 | 삭제 후 복구 방법 | Git 추적 |
| --- | --- | --- | --- |
| pnpm store 내용 | pnpm | `pnpm install` | 제외 |
| `node_modules/` | pnpm | `pnpm install --frozen-lockfile` | 제외 |
| `node_modules/.bin` | pnpm | `pnpm install --frozen-lockfile` | 제외 |

`pnpm store path`는 현재 pnpm store 위치를 출력한다. store는 여러 프로젝트가
공유할 수 있지만 `node_modules/`는 현재 프로젝트의 의존성 관계를 나타낸다.

## 확인 명령

```sh
pnpm --version
pnpm install --frozen-lockfile
pnpm list --depth 0
pnpm store path
pnpm why react
```

`pnpm list --depth 0`은 직접 의존성 설치 상태를 보여 준다. `pnpm why react`는
현재 의존성 그래프에서 React가 필요한 경로를 보여 준다.

## 공식 자료

- [pnpm의 `package.json` 설명](https://pnpm.io/package_json)
- [pnpm install 명령](https://pnpm.io/cli/install)
- [pnpm Command-Line Interface (CLI) 명령 목록](https://pnpm.io/cli/add)
