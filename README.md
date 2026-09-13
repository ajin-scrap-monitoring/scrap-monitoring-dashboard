# 스크랩 모니터링 대시보드

공장 관리자가 스크랩 적재 상태, 장비 상태, 이력, 녹화 영상과 알림 정책을 확인하고
관리하는 브라우저 대시보드의 프론트엔드 Repository다.

최종 산출물은 Vite 정적 파일과 Nginx를 포함한 Open Container Initiative (OCI)
이미지다. Nginx는 정적 파일을 제공하고 같은 origin의 Hypertext Transfer Protocol
(HTTP) Application Programming Interface (API), Server-Sent Events (SSE)와 WebRTC
signaling 요청을 FastAPI로 전달한다. WebRTC 미디어는 Nginx와 FastAPI를 통과하지 않고
브라우저와 미디어 서비스 사이에서 전송된다.

## 현재 상태

현재 화면과 사용자 흐름은 합성 데이터로 실행할 수 있고 제안 계약을 사용하는 클라이언트
연동 경계까지 구현되어 있다. 실제 FastAPI와 미디어 서비스의 계약은 확정되지 않았으며
실제 서비스 연동과 환경별 Nginx 설정은 진행하지 않은 상태다.

| 영역 | 현재 상태 |
| --- | --- |
| 사용자 화면 | 현황, 이력, 녹화 영상, 로그인과 관리자 설정 UI 구현 및 브라우저 검증 완료 |
| 개발 데이터 | 정상, 오류, 결측, 연결 변경과 운영 주기를 재현하는 합성 데이터 소스 구현 완료 |
| 외부 연동 클라이언트 | 제안 OpenAPI 기반 HTTP adapter, SSE 갱신과 WHEP signaling 구현 및 대역 서버 검증 완료 |
| 실제 서비스 연동 | 백엔드와 미디어 계약 승인 후 진행 |
| 배포 산출물 | Nginx와 정적 파일을 포함한 `linux/amd64` OCI 이미지 및 Public GHCR 게시 절차 구현 완료 |
| 운영 배포 | upstream, 경로, timeout, CSP와 실제 서비스 연결값 확정 후 배포 Repository에서 진행 |

제안 계약은 [`docs/contracts/proposal/README.md`](docs/contracts/proposal/README.md)에 있으며
승인 전까지 제품의 확정 계약으로 취급하지 않는다. 현재 구현과 남은 결정의 상세 내용은
[`docs/implementation.md`](docs/implementation.md)에서 확인한다.

## 구현된 화면과 클라이언트 기능

- 대표 적재율, Light Detection and Ranging (LiDAR) profile, 장비 상태와 활성 알림 현황
- 적재율 및 운영 이벤트 이력 조회
- 녹화 영상 조회, 재생과 다운로드
- 로그인, 개인 알림함과 관리자 접근 제어
- 수거 임계율, 알림 정책과 알림 대상 관리
- 제안 OpenAPI 기반 HTTP adapter, SSE 갱신과 WebRTC-HTTP Egress Protocol (WHEP) 형태의 영상 연결

## 빠른 시작

Node.js 24.19.0과 Corepack을 사용할 수 있어야 한다. Repository 루트에서 다음 명령을
실행한다.

```bash
test -f .env || cp .env.example .env
corepack enable
corepack install --global pnpm@11.23.0
pnpm install --frozen-lockfile
pnpm run dev
```

브라우저에서 `http://localhost:5173`에 접속한다. 개발 서버는 기본적으로 합성 데이터
소스를 사용하므로 FastAPI와 미디어 서비스 없이 화면과 상호작용을 확인할 수 있다.

| 경로 | 화면 |
| --- | --- |
| `/` | 현재 모니터링 |
| `/history` | 적재율 및 이벤트 이력 |
| `/recordings` | 녹화 영상 |
| `/login` | 로그인 |
| `/admin` | 관리자 설정 |

합성 로그인은 비어 있지 않은 아이디와 비밀번호를 사용한다. 데이터 상태는 URL의
`scenario` query로 선택하며 지원하는 이름은 `normal`, `collection-required`,
`measurement-error`, `disconnected`, `no-data`, `empty-lists`, `live-update`,
`operation-cycle`, `loading`과 `request-error`다.

## 설정

Repository의 [`.env.example`](.env.example)은 개발, 검증과 배포 명령에 사용하는 공개
기본값을 제공한다.

| 환경변수 | 기본값의 의미 |
| --- | --- |
| `DASHBOARD_IMAGE` | 검증된 Public GHCR 이미지 digest |
| `DASHBOARD_CONTAINER_NAME` | Docker 컨테이너 이름 |
| `DASHBOARD_PLATFORM` | 지원 이미지 플랫폼 `linux/amd64` |
| `DASHBOARD_BIND_ADDRESS` | 단독 실행의 host bind 주소 `127.0.0.1` |
| `DASHBOARD_HOST_PORT` | 단독 실행의 host port `8080` |
| `DASHBOARD_TMPFS_SIZE` | 읽기 전용 컨테이너의 `/tmp` 크기 `16m` |
| `DASHBOARD_TLS_CERTIFICATE_FILE` | Nginx에 읽기 전용으로 mount할 서버 인증서와 Intermediate CA 체인의 host 경로 |
| `DASHBOARD_TLS_PRIVATE_KEY_FILE` | Docker Secret으로 제공할 서버 개인 키의 host 경로 |
| `DASHBOARD_ROOT_CA_FILE` | 운영 브라우저의 신뢰 저장소에 설치할 Root CA 인증서의 host 경로 |

로컬에서 값을 바꿀 때는 추적되지 않는 `.env`를 만든다.

```bash
cp .env.example .env
```

`.secrets/`는 Git 추적과 Docker build context에서 제외되는 로컬 주입 경로이며 인증서의
정본이나 백업 위치가 아니다. 인증서 갱신과 복구에 필요한 원본은 별도의 PKI 보관소에서
관리한다.

Vite 개발 및 빌드 입력은 다음과 같다.

| 입력 | 기본값 | 적용 시점 | 용도 |
| --- | --- | --- | --- |
| `VITE_APP_VERSION` | `0.0.0-dev` | Vite 빌드 | 화면 하단의 애플리케이션 버전 |
| `VITE_ENABLE_MOCK_DATA` | `false` | Vite 빌드 | `true`일 때 브라우저 테스트용 합성 데이터 포함 |
| `?source=mock` 또는 `?source=api` | 개발 환경의 `mock` | 개발 및 테스트 실행 | session 단위 데이터 소스 선택 |
| `?scenario=<name>` | `normal` | 합성 데이터 실행 | 로딩, 오류, 결측과 운영 상태 시나리오 선택 |

릴리스 이미지는 컨테이너 실행 시 환경변수를 읽지 않는다. Vite의 `VITE_*` 값은 정적
파일을 만들 때 번들에 포함되므로 `docker run -e`로 변경할 수 없다. 운영 프론트엔드는
same-origin API 경로를 사용하고, 배포 Repository가 Nginx 설정 파일을 실행 시점에
마운트한다.

이 Repository의 `.env`는 아래 Docker 명령을 실행하는 shell에 이미지 digest, 실행 옵션과
TLS 파일의 host 경로를 전달하며 브라우저 JavaScript나 컨테이너 내부에 주입되지 않는다.
배포 Repository는 같은 변수 이름을 Docker Compose 보간 입력으로 사용할 수 있다. 자격
증명과 Transport Layer Security (TLS) 파일의 내용은 `.env`에 넣지 않는다. 서버 개인 키는
Docker Secret, 서버 인증서와 Intermediate CA 체인은 읽기 전용 파일 mount로 제공한다.
Root CA 인증서는 컨테이너가 아니라 운영 브라우저의 신뢰 저장소에 설치한다.

## 개발 및 검증

전체 프론트엔드 검증은 다음 명령으로 실행한다.

```bash
pnpm run check
```

이 명령은 비밀 파일의 Repository 추적 여부와 Docker build context 제외, OpenAPI와 생성
타입 일치, 정적 검사, 컴포넌트 테스트, 프로덕션 빌드, 정적 자산 크기 예산과 Chromium
브라우저 테스트를 검사한다.

Docker가 설치된 환경에서는 릴리스와 같은 `linux/amd64` 이미지를 빌드하고 Nginx 및
reverse proxy와 임시 인증서를 사용하는 HTTPS 통합 동작을 확인할 수 있다.

```bash
test -f .env || cp .env.example .env
set -a
. ./.env
set +a
docker build \
  --platform "$DASHBOARD_PLATFORM" \
  --build-arg APP_VERSION="$VITE_APP_VERSION" \
  --tag scrap-monitoring-dashboard:dev \
  .
./scripts/verify-container-image.sh \
  scrap-monitoring-dashboard:dev \
  scrap-monitoring-dashboard-readme \
  "$VITE_APP_VERSION"
./test/tls/integration.sh scrap-monitoring-dashboard:dev
node test/proxy/integration.mjs scrap-monitoring-dashboard:dev
```

TLS 통합 검사는 임시 Root CA, Intermediate CA, 서버 인증서와 개인 키를 생성하고 종료 시
삭제한다. 실제 운영 인증서를 사용하지 않는다.

로컬 TLS 파일은 `.env`의 경로를 읽어 인증서 체인, 유효 기간, 서버 인증 용도와 개인 키
일치 여부를 검사한다.

```bash
test -f .env || cp .env.example .env
set -a
. ./.env
set +a
pnpm run tls:check
```

## 배포

`vMAJOR.MINOR.PATCH` Git tag가 GitHub Container Registry (GHCR)에 Public 이미지를
게시한다. Release workflow는 `MAJOR.MINOR.PATCH`와 `sha-<full-git-sha>` tag를 만들며
`latest` tag는 만들지 않는다. 배포 Repository는 Release workflow summary 또는 GHCR
Package에서 확인한 digest로 이미지를 고정한다.

현재 운영 배포는 외부 계약과 환경별 upstream 설정의 확정을 기다리는 상태다. 아래 단독
실행은 게시된 이미지의 정적 파일, Nginx와 health endpoint만 확인하며 실제 API나 영상을
연결하지 않는다.

`.env.example`을 복사한 뒤 변수들을 현재 shell에 내보내면 기본 이미지로 정적 웹
컨테이너와 health endpoint를 확인할 수 있다. 다른 릴리스를 배포할 때는 `.env`의
`DASHBOARD_IMAGE`를 해당 릴리스가 게시한 digest로 바꾼다.

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

실제 데이터를 표시하려면 FastAPI 및 미디어 서비스와 합의한 계약을 클라이언트에 반영하고
다음 Nginx 설정을 함께 배포해야 한다.

전체 시스템 배포에서는 배포 Repository가 같은 이미지에 다음 실행 시점 설정을 제공한다.

| 대상 | 배포 Repository의 입력 |
| --- | --- |
| `/etc/nginx/upstreams/*.conf` | Docker Domain Name System (DNS) resolver, FastAPI upstream과 rate limit zone |
| `/etc/nginx/runtime/*.conf` | API, SSE와 signaling location, body 제한과 timeout |
| `/etc/nginx/security-headers.conf` | 환경별 Content Security Policy (CSP) 허용 출처 |
| `/etc/nginx/conf.d/default.conf` | TLS listener와 인증서 경로가 필요한 환경의 server 설정 |

Docker Secret 구성, 파일 권한, 인증서 발급, 교체, Nginx 반영과 롤백 절차는
[`docs/implementation.md`](docs/implementation.md)의 `TLS 인증서 운영`을 따른다.

배포 Repository는 FastAPI와 연결되는 Docker network, 설정 및 인증서의 읽기 전용 mount,
`/tmp`의 임시 file system, host Transmission Control Protocol (TCP) 443 연결과
`/healthz` 검사를 Docker Compose에
구성한다. 실제 upstream, 경로, timeout, TLS와 CSP 값은 외부 계약을 확정한 뒤 배포
Repository에서 관리한다. 상세한 이미지 책임과 주입 경계는
[`docs/implementation.md`](docs/implementation.md)의 `제품 배포 경계`와
`Nginx reverse proxy 배포 경계`를 따른다.

## 다음 연동 조건

실제 서비스 연동은 다음 조건을 확정한 뒤 시작한다.

1. OpenAPI 정본, 경로, schema, 오류와 인증 및 권한 규칙 승인
2. SSE 상태 갱신과 WHEP signaling 및 재연결 규칙 승인
3. Nginx upstream, Docker DNS, readiness, timeout, 요청 제한과 CSP 값 확정
4. 실제 API, 실시간 영상, 녹화 영상과 운영 브라우저를 사용할 수 있는 통합 환경 준비

확정할 전체 항목과 반영 순서는
[`docs/contracts/README.md`](docs/contracts/README.md)를 따른다. 계약 확정 시 OpenAPI,
생성 타입, adapter, Nginx 배포 설정과 통합 테스트를 같은 변경 단위로 갱신한다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [`.agents/AGENTS.md`](.agents/AGENTS.md) | 사람과 코딩 에이전트가 공유하는 Repository 작업 지침 |
| [`docs/project-spec.md`](docs/project-spec.md) | 프로젝트 목적, 범위와 외부 경계 |
| [`docs/implementation.md`](docs/implementation.md) | 채택한 기술, 실행, 검증과 배포 상태 |
| [`docs/development-workflow.md`](docs/development-workflow.md) | 요구사항, 설계, 구현, 검증과 배포 순서 |
| [`docs/contracts/README.md`](docs/contracts/README.md) | 외부 연동 계약 항목, 결정 순서와 완료 조건 |
| [`docs/design-reference.md`](docs/design-reference.md) | 미확정된 구체적 설계 참고안 |
| [`docs/mockups/README.md`](docs/mockups/README.md) | 코드 기반 화면 목업과 렌더링 방법 |
| [`learning/README.md`](learning/README.md) | 프로젝트 결정의 정본이 아닌 기술 학습 자료 |

## 이용 조건

> 이 Repository는 코드 검토와 참고를 위해 Public으로 제공하며 프로젝트 소스 코드에 별도 라이선스를 부여하지 않는다.
