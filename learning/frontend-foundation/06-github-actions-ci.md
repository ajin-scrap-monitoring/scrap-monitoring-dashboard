# GitHub Actions 기반 Continuous Integration (CI)

## 학습 목표

로컬에서 실행한 검증을 GitHub가 별도의 새 환경에서 다시 실행하는 이유를
이해한다. workflow, event, job, runner, step과 action이 각각 무엇을 가리키는지도
현재 `.github/workflows/ci.yml`을 기준으로 구분한다.

## 구성 요소

현재 CI 실행에 참여하는 구성 요소는 11개다.

| 구성 요소 | 현재 위치 또는 값 | 역할 |
| --- | --- | --- |
| workflow 파일 | `.github/workflows/ci.yml` | GitHub가 실행할 절차 기록 |
| event | `pull_request`, `push` | workflow 시작 조건 |
| permission | `contents: read` | workflow token의 Repository 권한 제한 |
| job | `ci`, `container` | 검증 범위별 작업 묶음 |
| runner | `ubuntu-24.04` | 명령을 실제로 실행할 임시 Linux 환경 |
| 실행 컨테이너 | Playwright Noble 이미지 | `ci` job의 브라우저 검증 환경 |
| step | workflow의 `steps` | runner가 순서대로 실행할 개별 작업 |
| action | `actions/checkout`, `actions/setup-node`, `pnpm/setup` | step에서 사용하는 재사용 프로그램 |
| shell 명령 | `pnpm install`, lint, test, image 검증 | Repository의 실제 검증 수행 |
| cache | pnpm store cache | package 다운로드 시간 단축 |
| check 결과 | `CI`, `Container` | 성공 또는 실패를 GitHub에 표시 |

workflow 파일만 Git으로 추적한다. runner, cache와 check 결과는 GitHub가 실행 중에
만들고 관리한다.

## CI가 필요한 이유

개발 컴퓨터에서 `pnpm run build`가 성공해도 다음 로컬 상태가 결과에 영향을 줄 수
있다.

- 이전에 설치한 `node_modules/`
- 전역으로 설치한 개발 도구
- 개발 컴퓨터에만 존재하는 파일
- macOS와 Linux의 차이

GitHub Actions는 Repository에 기록된 파일만 받은 새 runner에서 설치와 빌드를
다시 실행한다. 이 과정이 성공하면 다른 환경에서도 현재 commit을 재현할 수 있다는
근거가 생긴다.

현재 CI는 코드를 배포하지 않는다. Repository 파일만으로 의존성, 정적 검사, 테스트,
프로덕션 빌드와 컨테이너 런타임을 재현할 수 있는지 확인한다.

## 로컬 검증과 CI 검증

두 검증은 같은 명령을 사용하지만 실행 위치가 다르다.

| 항목 | 로컬 검증 | CI 검증 |
| --- | --- | --- |
| 실행 위치 | 개발 컴퓨터 | GitHub runner |
| 운영체제 | macOS | Ubuntu Linux |
| 시작 상태 | 기존 파일이 남아 있을 수 있음 | Repository checkout부터 시작 |
| Node.js 버전 입력 | `.node-version` | `.node-version` |
| pnpm 버전 입력 | `packageManager` | `packageManager` |
| 의존성 입력 | `pnpm-lock.yaml` | `pnpm-lock.yaml` |
| 핵심 빌드 명령 | `pnpm run build` | `pnpm run build` |

CI가 로컬 검증을 대신하지 않는다. 개발자는 먼저 로컬에서 오류를 확인하고,
GitHub Actions는 같은 결과가 별도 환경에서도 재현되는지 확인한다.

## workflow 파일의 최상위 설정

현재 workflow 파일의 최상위 설정은 4개다.

| 설정 | 현재 값 | 역할 |
| --- | --- | --- |
| `name` | `CI` | GitHub 화면에 표시할 workflow 이름 |
| `on` | `pull_request`, `push` | workflow를 시작할 event |
| `permissions` | `contents: read` | 자동 발급 token의 Repository contents 권한을 읽기로 제한 |
| `jobs` | `ci`, `container` | 실행할 job 정의 |

GitHub는 workflow 실행마다 자동 token을 제공한다. 현재 `contents: read`는 이
token으로 Repository 내용을 읽을 수 있지만 변경 내용을 push할 수는 없게 한다.

## workflow 실행을 시작하는 event

event는 GitHub에서 발생한 사건이다. 현재 workflow를 시작하는 event는 2개다.

| event | 현재 조건 |
| --- | --- |
| `pull_request` | `main` 대상 Pull Request (PR) 생성, 재개방 또는 새 commit 반영 |
| `push` | `main` branch에 commit이 반영된 push |

로컬에서 commit만 만들면 GitHub event가 발생하지 않는다. 로컬 commit을 원격에
push하지 않은 현재 상태에서는 이 workflow도 실행되지 않는다.

현재 작업 branch를 원격에 push하는 것만으로는 `push` 조건에 맞지 않는다. 해당
branch로 `main` 대상 PR을 만들면 `pull_request` event가 발생한다.

## workflow, job과 step

세 용어의 포함 관계는 다음과 같다.

```text
Workflow
  -> Job
      -> Step
      -> Step
      -> Step
```

| 용어 | 현재 의미 |
| --- | --- |
| workflow | `.github/workflows/ci.yml`에 기록된 전체 자동화 절차 |
| job | runner 하나에서 실행하는 `ci` 또는 `container` 작업 묶음 |
| step | checkout, 도구 준비, 설치와 빌드 같은 개별 작업 |

현재 workflow에는 2개 job이 있다. `ci` job은 GitHub 화면에 `CI`로 표시되고 20분
제한 안에서 Playwright Noble 컨테이너로 실행한다. `container` job은 `Container`로
표시되고 15분 제한 안에서 Linux host runner로 실행한다. GitHub는 각 job에 runner를
할당하고 step을 위에서 아래로 실행한다.

앞 step이 실패하면 뒤 step은 기본적으로 실행하지 않는다. 따라서 마지막 build
step이 실행됐다는 것은 앞의 checkout, Node.js 준비, pnpm 준비와 의존성 설치가
성공했다는 뜻이다.

## runner

runner는 workflow 명령을 실제로 실행하는 환경이다. 현재 `runs-on: ubuntu-24.04`가
Ubuntu 24.04 환경을 요청한다. `ci` job은 이 host에서 Playwright Noble 컨테이너를 추가로
실행하고 `container` job은 host에서 Docker Buildx와 컨테이너 검증을 실행한다.

runner는 프로젝트 전용 운영 서버가 아니다. CI job을 실행하기 위한 임시
환경이다. runner에는 현재 Repository의 로컬 `node_modules/`와 `dist/`가 전달되지
않는다.

job이 끝나면 runner의 작업 디렉터리도 배포 파일 저장소로 유지되지 않는다.

## action과 shell 명령

step이 실행하는 대상은 2종류다.

| 종류 | workflow 표기 | 의미 |
| --- | --- | --- |
| action 사용 | `uses:` | 다른 Repository에 만들어진 재사용 프로그램 실행 |
| shell 명령 실행 | `run:` | runner의 shell에서 명령 직접 실행 |

현재 action은 Repository checkout, Node.js 준비와 pnpm 준비에 사용한다. 실제
프로젝트 설치와 빌드는 `run:`으로 pnpm 명령을 실행한다.

action은 현재 프로젝트의 npm package가 아니다. `package.json`이나
`node_modules/`에 설치하지 않고 GitHub Actions가 workflow 실행 중에 가져온다.

## 현재 step 실행 순서

현재 `ci` job의 step은 7개고 `container` job의 step은 6개다.

```text
Checkout Repository
  -> Setup Node.js
  -> Setup pnpm
  -> Frozen Install
  -> Lint
  -> Component Test
  -> Build and Browser Test
```

각 step의 입력과 결과는 다음과 같다.

| 순서 | step | 주요 입력 | 결과 |
| --- | --- | --- | --- |
| 1 | Checkout repository | event가 가리키는 commit | Repository 파일 준비 |
| 2 | Set up Node.js | `.node-version` | Node.js 24.19.0 준비 |
| 3 | Set up pnpm | `packageManager` | pnpm 11.23.0 준비 |
| 4 | Verify dependency installation | `package.json`, `pnpm-lock.yaml` | `node_modules/` 설치 |
| 5 | Lint | ESLint 설정과 소스 | 경고 없는 정적 검사 |
| 6 | Run component tests | Vitest 설정과 소스 | 컴포넌트와 데이터 소스 검증 |
| 7 | Build and run browser tests | 소스와 Playwright 설정 | 타입 검사, `dist/` 생성과 Chromium 검증 |

## checkout

새 runner는 실행할 commit의 파일을 처음부터 갖고 있지 않다.
`actions/checkout@v7`은 event가 가리키는 commit을 runner의 작업 디렉터리에
내려놓는다. 이 작업을 checkout이라고 부른다.

checkout 후에 runner는 `.node-version`, `package.json`, `pnpm-lock.yaml`, TypeScript
설정과 소스를 읽을 수 있다. Git으로 추적하지 않는 로컬 `node_modules/`와
`dist/`는 checkout 결과에 포함되지 않는다.

## Node.js 준비

`actions/setup-node@v7`은 다음 설정을 사용한다.

```yaml
with:
  node-version-file: .node-version
```

action은 `.node-version`에서 `24.19.0`을 읽고 runner가 해당 Node.js를 사용하게
한다. 로컬에서는 fnm이 이 파일을 읽고, CI에서는 `actions/setup-node`가 읽는다.

두 환경의 설치 도구는 다르지만 Node.js 버전의 입력 파일은 같다.

## pnpm 준비

`pnpm/setup` action은 `package.json`의 다음 값을 읽는다.

```json
{
  "packageManager": "pnpm@11.23.0"
}
```

action은 runner에 pnpm 11.23.0을 준비한다. workflow는 action의 `v2.0.0` tag가
가리키는 정확한 commit을 사용한다.

```yaml
uses: pnpm/setup@c9883cc79df532ad1a7b81bf9ab944ceb090d65c # v2.0.0
```

현재 action 입력은 2개다.

| 입력 | 값 | 역할 |
| --- | --- | --- |
| `cache` | `true` | pnpm store cache 사용 |
| `install` | `false` | action 내부의 자동 `pnpm install` 사용 안 함 |

`install: false`이므로 다음 step이 의존성 설치 명령을 명시적으로 실행한다.

## frozen install

runner는 다음 명령으로 package를 설치한다.

```sh
pnpm install --frozen-lockfile
```

이 명령은 `package.json`과 `pnpm-lock.yaml`이 일치하는지 검사한다. 두 파일이
일치하지 않으면 lock file을 자동 수정하지 않고 실패한다.

runner에는 기존 `node_modules/`가 없으므로 pnpm이 새로 만든다. CI에서 이 설치가
성공해야 Repository에 기록한 파일만으로 의존성을 재현할 수 있다.

## cache

cache는 이전 workflow 실행에서 내려받은 pnpm store 내용을 다음 실행에서 다시
사용하기 위한 임시 저장소다. package 다운로드 시간을 줄이지만 설치 결과를
결정하지 않는다.

| 대상 | 역할 |
| --- | --- |
| `pnpm-lock.yaml` | 설치할 package version과 관계의 정본 |
| pnpm store cache | 이미 내려받은 package 내용 재사용 |

cache가 비어 있어도 package registry에 접근할 수 있으면 frozen install은 동작해야
한다. cache를 삭제하거나 cache를 사용하지 않아도 의존성 version이 바뀌지 않는다.

## 빌드와 브라우저 테스트 step

`ci` job의 마지막 step은 다음 명령을 실행한다.

```sh
pnpm run test:e2e
```

이 명령은 `pnpm run build` 뒤 Playwright Chromium 테스트를 실행한다. `pnpm run build`의
실제 실행 내용은 `tsc -b && vite build`다.

1. TypeScript가 앱 소스와 Vite 설정을 타입 검사한다.
2. 타입 오류가 있으면 step이 실패한다.
3. 타입 오류가 없으면 Vite가 `dist/`를 생성한다.
4. Vite 빌드와 Chromium 테스트가 모두 성공하면 마지막 step이 성공한다.
5. 모든 `ci` step이 성공하면 `CI` check가 성공한다.

현재 CI가 검증하는 대상은 7개다.

| 검증 대상 | 명령 |
| --- | --- |
| 정적 검사 | `pnpm run lint` |
| 컴포넌트와 데이터 소스 | `pnpm run test` |
| TypeScript 타입 | `tsc -b` |
| 프로덕션 정적 빌드 | `vite build` |
| Chromium 브라우저 흐름 | `playwright test` |
| OCI 이미지 런타임 | `verify-container-image.sh` |
| reverse proxy 통합 | `test/proxy/integration.mjs` |

`container` job은 `linux/amd64` OCI 이미지를 별도로 빌드하고 Nginx 런타임과 reverse
proxy 통합을 검증한다.

## CI가 현재 하지 않는 일

현재 CI workflow가 하지 않는 일은 4개다.

1. `dist/`를 GitHub Actions artifact로 보존하지 않는다.
2. GitHub Release를 만들지 않는다.
3. 배포 Repository에 파일을 전달하지 않는다.
4. 운영 서버에 배포하지 않는다.

GitHub Actions artifact는 workflow가 생성한 파일을 job 종료 후에도 내려받을 수
있게 GitHub에 업로드한 결과다. 현재 workflow에는 artifact upload step이 없다.
runner에서 생성한 `dist/`는 build 성공 확인에만 사용된다.

## 성공과 실패 확인

GitHub의 workflow run 화면에서 확인할 대상은 5개다.

- workflow를 시작한 event와 commit ID
- `CI`와 `Container` job의 성공 또는 실패
- 실패한 첫 step
- 해당 step의 명령 출력
- 명령의 종료 코드(exit code)와 오류 메시지

CI 오류는 실패한 첫 step부터 확인한다. 뒤 step이 실행되지 않은 것은 대개 앞
step 실패의 결과이며 별도의 두 번째 오류가 아니다.

## 로컬에서 같은 핵심 명령 실행

GitHub에 push하기 전에는 다음 명령으로 핵심 절차를 로컬에서 확인한다.

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm run build
```

로컬에서 이 명령이 성공해도 CI 성공을 완전히 보장하지는 않는다. CI는 별도 Linux
환경에서 같은 입력과 명령을 다시 검증한다.

## 공식 자료

- [GitHub Actions 이해](https://docs.github.com/en/actions/about-github-actions/understanding-github-actions)
- [GitHub Actions workflow 문법](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub Actions에서 Node.js 빌드와 테스트](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)
- [pnpm의 GitHub Actions 구성](https://pnpm.io/continuous-integration)
- [`pnpm/setup` action](https://github.com/pnpm/setup)
