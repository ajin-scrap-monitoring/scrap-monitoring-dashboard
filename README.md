# 스크랩 모니터링 대시보드

스크랩 적재 상태, LiDAR profile, 이력, 녹화 영상과 관리자 설정을 브라우저에서 제공하는
React 기반 대시보드다. 브라우저는 Backend의 same-origin Application Programming Interface
(API)와 Camera Media Service의 영상
연결을 사용하며, 센서 입력 처리와 미디어 송출은 이 Repository의 책임이 아니다.

## 주요 기능

- 현재 적재 상태, LiDAR profile, 장비 상태와 활성 알림 표시
- 기간과 유형을 사용하는 이력 및 녹화 영상 조회
- 로그인, 알림 읽음 처리와 관리자 설정 사용자 흐름
- 합성 상태와 제안 API 계약을 사용하는 브라우저 검증

## 빠른 시작

Node.js 24.19.0과 Corepack이 필요하다. Repository 루트에서 다음 명령을 실행한다.

```bash
corepack enable
corepack install --global pnpm@11.23.0
pnpm install --frozen-lockfile
pnpm run dev
```

브라우저에서 `http://localhost:5173`을 연다. 개발 서버는 합성 데이터를 기본으로 사용한다.
`?scenario=measurement-error`처럼 상태를 지정하거나 `?source=api`로 제안 API 데이터
소스를 선택할 수 있다.

## 설정

`.env.example`은 개발, 컨테이너 검증과 단독 실행에 사용하는 공개 기본값을 제공한다.
로컬 값을 바꿀 때만 다음 명령으로 Git 추적 대상이 아닌 `.env`를 만든다.

```bash
cp .env.example .env
```

`VITE_*` 값은 정적 번들 생성 시에만 적용한다. 실행 중인 컨테이너의 환경변수로 브라우저
번들을 변경할 수 없다. 환경변수, Transport Layer Security (TLS)와 Nginx 설정의 책임은
[`docs/implementation.md`](docs/implementation.md)를 따른다.

## 개발 및 검증

전체 검증은 다음 명령으로 실행한다.

```bash
pnpm run check
```

이 명령은 Repository 보안 경계, OpenAPI 검사, 정적 검사, 단위 테스트, 프로덕션 빌드와
Playwright 브라우저 테스트를 실행한다.

## 배포

`vMAJOR.MINOR.PATCH` Git tag는 Public GitHub Container Registry (GHCR) 이미지 게시를
시작한다. 배포는 version tag가 아니라 image digest를 사용한다.

정적 파일과 Nginx health endpoint만 단독으로 확인하려면 다음 명령을 실행한다.

```bash
test -f .env || cp .env.example .env
set -a
. ./.env
set +a
docker pull "$DASHBOARD_IMAGE"
docker run --detach \
  --name "$DASHBOARD_CONTAINER_NAME" \
  --platform "$DASHBOARD_PLATFORM" \
  --read-only \
  --tmpfs "/tmp:rw,noexec,nosuid,size=$DASHBOARD_TMPFS_SIZE" \
  --publish "$DASHBOARD_BIND_ADDRESS:$DASHBOARD_HOST_PORT:8080" \
  "$DASHBOARD_IMAGE"
curl --fail "http://$DASHBOARD_BIND_ADDRESS:$DASHBOARD_HOST_PORT/healthz"
```

실제 Backend, Camera Media Service, TLS, Nginx upstream과 컨테이너 네트워크의 배포 조합은
Deployment Repository가 관리한다.

## 문서

| 문서 | 역할 |
| --- | --- |
| [`.agents/AGENTS.md`](.agents/AGENTS.md) | Repository 작업 지침과 문서 확인 순서 |
| [`docs/project-spec.md`](docs/project-spec.md) | 제품 목적, 범위와 외부 경계 |
| [`docs/implementation.md`](docs/implementation.md) | 현재 구현, 실행, 검증과 이미지 책임 |
| [`docs/development-workflow.md`](docs/development-workflow.md) | 작업 단위와 단계별 완료 조건 |
| [`docs/contracts/README.md`](docs/contracts/README.md) | 외부 연동 계약 항목과 확정 절차 |
| [`docs/design-reference.md`](docs/design-reference.md) | 비정본 설계 참고안의 사용 경계 |
| [`docs/mockups/README.md`](docs/mockups/README.md) | 목업 자산과 렌더링 방법 |
| [`learning/README.md`](learning/README.md) | 정본이 아닌 기술 학습 자료 |

## 이용 조건

> 이 Repository는 코드 검토와 참고를 위해 Public으로 제공하며 프로젝트 소스 코드에 별도 라이선스를 부여하지 않는다.
