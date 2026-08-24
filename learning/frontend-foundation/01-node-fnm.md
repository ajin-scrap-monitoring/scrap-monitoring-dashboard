# Node.js와 fnm

## 학습 목표

Node.js와 Fast Node Manager (fnm)의 책임을 구분하고, Repository에 기록한
버전이 개발 컴퓨터와 Continuous Integration (CI)에서 어떻게 사용되는지 이해한다.

## 구성 요소

현재 구조의 구성 요소는 5개다.

| 구성 요소 | 위치 | 역할 |
| --- | --- | --- |
| 셸 연동 | 사용자 셸 설정 | fnm 환경과 Node.js 실행 경로 설정 |
| fnm 실행 파일 | 개발 컴퓨터 | Node.js 설치와 활성 버전 전환 |
| `.node-version` | Repository 루트 | 정확한 Node.js 버전 `24.19.0` 선언 |
| Node.js 설치 | 개발 컴퓨터의 fnm 관리 경로 | TypeScript, Vite와 package script 실행 |
| `engines.node` | `package.json` | 프로젝트가 허용하는 Node.js 24 주 버전 선언 |

fnm과 fnm이 설치한 Node.js 실행 파일은 Repository에 포함되지 않는다.
Repository에는 필요한 버전을 알려 주는 입력 파일만 저장한다.

## Node.js의 역할

Node.js는 브라우저 밖에서 JavaScript를 실행하는 런타임이다. 이 Repository에서는
TypeScript 컴파일러와 Vite 같은 개발 도구가 Node.js 프로세스 안에서 실행된다.
pnpm은 package를 설치하고 script를 시작하며, script 안의 TypeScript와 Vite는
현재 선택된 Node.js를 사용한다.

브라우저는 Vite가 만든 HTML과 JavaScript 정적 파일을 Nginx에서 내려받아
자체 JavaScript 엔진으로 실행한다.

## fnm의 역할

fnm은 여러 Node.js 버전을 개발 컴퓨터에 설치하고 현재 셸에서 사용할 버전을
선택한다. fnm이 셸의 `PATH` 앞부분에 선택한 Node.js 실행 경로를 놓으면, 셸이
`node` 명령을 해당 버전으로 실행한다.

## 두 버전 선언의 차이

`.node-version`과 `engines.node`는 목적이 다르다.

| 선언 | 현재 값 | 의미 | 주요 소비자 |
| --- | --- | --- | --- |
| `.node-version` | `24.19.0` | 실제로 선택할 정확한 버전 | fnm, `actions/setup-node` |
| `engines.node` | `24.x` | 패키지가 허용하는 주 버전 범위 | pnpm과 Node.js 생태계 도구 |

`.node-version`은 설치와 실행의 재현성을 제공한다. `engines.node`는 호환성 범위를
표현한다.

## 로컬 실행 흐름

로컬 실행 흐름은 5단계다.

1. 셸이 fnm 환경을 로드한다.
2. `fnm install`이 `.node-version`의 버전을 설치한다.
3. `fnm use`가 해당 버전을 현재 셸에서 활성화한다.
4. 셸이 활성화된 `node` 실행 파일을 찾는다.
5. pnpm이 package script를 시작하여 실행 경로를 찾고
Node.js가 TypeScript와 Vite를 실행한다.

```sh
fnm install
fnm use
node --version
```

## CI 실행 흐름

GitHub Actions에서는 `actions/setup-node`가 `.node-version`을 읽어
runner에 Node.js 24.19.0을 준비한다.

## 생성되는 부산물

| 부산물 | 위치 | Git 추적 |
| --- | --- | --- |
| fnm 실행 파일 | 개발 컴퓨터의 패키지 설치 경로 | 제외 |
| Node.js 24.19.0 | fnm 관리 경로 또는 CI tool cache | 제외 |
| 셸 환경 변수와 `PATH` 변경 | 현재 셸 프로세스 | 제외 |

## 확인 명령

```sh
fnm current
node --version
node -p 'process.execPath'
node -p 'process.platform + " " + process.arch'
```

## 공식 자료

- [Node.js 릴리스 주기](https://nodejs.org/en/about/previous-releases)
- [fnm Repository와 셸 설정](https://github.com/Schniz/fnm)
