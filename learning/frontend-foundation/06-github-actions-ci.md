# GitHub Actions 기반 Continuous Integration (CI)

## 학습 목표

GitHub Actions가 새 Linux runner에서 Repository를 checkout하고, 로컬과 같은
도구 버전과 lock file을 사용해 build를 재현하는 과정을 이해한다.

Continuous Integration (CI)은 여러 작업자의 변경을 자주 합치고 자동 검증하는
방식이다. 현재 Repository에서 `CI`는 GitHub Actions job의 이름이기도 하다.

## 구성 요소

현재 workflow의 구성 요소는 9개다.

| 구성 요소 | 현재 설정 | 역할 |
| --- | --- | --- |
| event trigger | `pull_request`, `push` | workflow 시작 조건 |
| branch filter | `main` | 검증 대상 branch 제한 |
| token permission | `contents: read` | Repository 읽기 권한 제한 |
| job | `ci` | 하나의 runner에서 실행할 step 묶음 |
| runner | `ubuntu-latest` | 임시 Linux 실행 환경 |
| checkout Action | `actions/checkout@v7` | commit 파일을 runner에 배치 |
| Node.js Action | `actions/setup-node@v7` | `.node-version`의 Node.js 준비 |
| pnpm Action | 고정 commit의 `pnpm/setup` | `packageManager`의 pnpm 준비와 store cache |
| shell command | frozen install과 build | 실제 프로젝트 검증 |

workflow file은 `.github/workflows/ci.yml`이다. GitHub가 이 경로의 YAML 파일을
읽고 event, job과 step을 해석한다.

## trigger

현재 workflow는 2개 event에서 실행된다.

| event | 조건 |
| --- | --- |
| `pull_request` | 대상 branch가 `main`인 Pull Request (PR) |
| `push` | `main` branch에 반영된 push |

로컬 작업 branch에 push하는 것만으로는 현재 `CI` workflow가 실행되지 않는다.
해당 branch에서 `main` 대상 PR을 만들면 `pull_request` event로 실행된다.

## job과 step

workflow에는 `ci` job 하나가 있다. GitHub Actions는 이 job에 Ubuntu runner 하나를
할당하고 step을 작성된 순서대로 실행한다.

```text
Checkout
  -> Setup Node.js
  -> Setup pnpm
  -> Frozen install
  -> Build
```

앞 step이 실패하면 뒤 step은 기본적으로 실행되지 않는다. `Build` step이
성공하려면 checkout, 도구 준비와 의존성 설치가 모두 성공해야 한다.

## checkout

runner는 처음 만들어질 때 이 Repository의 작업 파일을 자동으로 갖고 있지 않다.
`actions/checkout`이 검증할 commit을 runner의 작업 디렉터리에 내려놓는다.

checkout 이후에 `.node-version`, `package.json`, `pnpm-lock.yaml`, source와 설정
파일을 사용할 수 있다. 로컬의 `node_modules/`와 `dist/`는 Git으로 추적하지
않으므로 runner에 전달되지 않는다.

## Node.js 준비

`actions/setup-node`는 다음 입력을 사용한다.

```yaml
with:
  node-version-file: .node-version
```

Action은 `.node-version`의 `24.19.0`을 읽고 해당 Node.js를 runner의 `PATH`에서
사용할 수 있게 한다. CI는 fnm을 사용하지 않지만 로컬 fnm과 같은 버전 파일을
읽는다.

## pnpm 준비와 cache

`pnpm/setup`은 `package.json`의 `packageManager`에서 pnpm 11.23.0을 읽어 설치한다.
workflow는 Action tag가 가리킨 정확한 commit을 사용하고 주석에 `v2.0.0`을
기록한다.

현재 입력은 2개다.

| 입력 | 값 | 효과 |
| --- | --- | --- |
| `cache` | `true` | lock file을 기준으로 pnpm store cache 사용 |
| `install` | `false` | Action 내부 자동 설치 생략 |

의존성 설치는 다음 step에서 명시적으로 수행한다. 이 구조는 실제 설치 명령과
`--frozen-lockfile` 사용 여부를 workflow에서 직접 확인할 수 있게 한다.

cache는 내려받기 시간을 줄이는 최적화다. cache가 없어도 lock file과 package
registry에 접근할 수 있으면 같은 설치 명령이 동작해야 한다. cache는 의존성
버전의 정본이 아니며 `pnpm-lock.yaml`을 대신하지 않는다.

## frozen install

runner는 다음 명령으로 의존성을 설치한다.

```sh
pnpm install --frozen-lockfile
```

runner에는 로컬에서 사용하던 `node_modules/`가 없으므로 새로 설치한다. 명령은
`package.json`과 `pnpm-lock.yaml`이 일치하는지 확인하고 lock file을 수정하지
않는다.

로컬에서 우연히 남아 있던 package나 전역 설치에 의존하는 코드는 fresh runner에서
실패할 수 있다. 이 차이 때문에 CI는 Repository 파일만으로 build를 재현할 수
있는지 확인하는 역할을 한다.

## build step

마지막 step은 다음 명령을 실행한다.

```sh
pnpm run build
```

`package.json`에 따라 실제 순서는 `tsc -b && vite build`다. TypeScript 타입 검사가
실패하면 `&&` 뒤의 Vite build는 실행되지 않는다. 두 명령이 모두 exit code 0으로
끝나야 step과 `CI` job이 성공한다.

현재 CI 검증 범위는 2개다.

| 검증 | 실행 도구 |
| --- | --- |
| TypeScript 타입 검사 | `tsc -b` |
| 프로덕션 정적 build | `vite build` |

정적 검사, 단위 테스트, 컴포넌트 테스트와 End-to-End (E2E) 테스트는 아직 도구와
정책을 채택하지 않았으므로 현재 job에 포함되지 않는다.

## runner의 일시성

GitHub Actions runner의 작업 디렉터리는 job 실행을 위한 임시 환경이다. build가
만든 `dist/`는 현재 job 안에서는 존재하지만 workflow가 별도 artifact upload를
하지 않으므로 실행 종료 후 배포 산출물로 보존되지 않는다.

현재 workflow는 코드 품질 확인용이며 Release나 배포 workflow가 아니다. 정적
산출물의 package 형식과 배포 Repository 인계 계약이 확정되면 별도 결정에 따라
artifact 보존 방식을 구성한다.

## 로컬 실행과 CI의 관계

| 항목 | 로컬 | CI |
| --- | --- | --- |
| 운영체제 | 개발 컴퓨터의 macOS | GitHub의 Ubuntu runner |
| Node.js 버전 입력 | `.node-version` | `.node-version` |
| Node.js 준비 도구 | fnm | `actions/setup-node` |
| pnpm 버전 입력 | `packageManager` | `packageManager` |
| 의존성 해석 입력 | `pnpm-lock.yaml` | `pnpm-lock.yaml` |
| build 명령 | `pnpm run build` | `pnpm run build` |
| 기존 설치 상태 | 남아 있을 수 있음 | fresh runner에서 시작 |

같은 입력과 명령을 사용하더라도 운영체제, Central Processing Unit (CPU)과 파일
시스템 차이는 남는다. 로컬과 CI를 모두 통과시키는 것은 플랫폼 차이와 누락된
Repository 입력을 조기에 발견하는 데 도움이 된다.

## 확인 방법

로컬에서는 CI의 핵심 명령을 다음과 같이 재현한다.

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm run build
```

GitHub에서는 workflow run의 다음 정보를 확인한다.

- 실행을 시작한 event와 commit ID
- `CI` job에 배정된 runner 환경
- 각 Action의 입력과 실행 version
- frozen install 결과
- TypeScript와 Vite build 출력
- 실패한 첫 step과 exit code

## 공식 자료

- [GitHub Actions workflow 문법](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub Actions에서 Node.js build와 test](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)
- [pnpm의 GitHub Actions 구성](https://pnpm.io/continuous-integration)
- [`pnpm/setup` Action](https://github.com/pnpm/setup)
