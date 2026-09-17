# 스크랩 모니터링 대시보드

스크랩 적재 상태, LiDAR profile, 이력, 녹화 영상과 관리자 설정을 브라우저에서 제공하는
React 기반 대시보드다. 브라우저는 Backend의 same-origin Application Programming Interface
(API)와 Camera Media Service의 영상 연결을 사용한다.

## 주요 기능

- 현재 적재 상태, LiDAR profile, 장비 상태와 활성 알림 표시
- 기간과 유형을 사용하는 이력 및 녹화 영상 조회
- 로그인, 알림 읽음 처리와 관리자 설정 사용자 흐름

## 사전 조건

| 의존성 | 최소 버전 | 용도 | 설치 대상 |
| --- | --- | --- | --- |
| Docker Engine | 29.8.0 | 이미지 빌드와 컨테이너 실행 | Ubuntu amd64 host |
| Docker Compose plugin | 5.5.1 | 개발 및 전체 검증 컨테이너 | Ubuntu amd64 host |

Ubuntu 22.04, 24.04, 26.04 amd64 host에서 Docker를 설치하려면 다음 명령을 실행한다.

```bash
./scripts/install-docker.sh
```

스크립트는 실행 사용자를 `docker` group에 추가한다. 로그아웃 없이 현재 터미널에서 권한을
적용하려면 다음 명령을 실행한다.

```bash
newgrp docker
```

## 설정

`.env.example`은 공개 이미지 단독 확인과 배포 Docker Compose가 사용하는 공개 기본값을
제공한다. 설정을 적용하려면 다음 명령으로 `.env`를 만든다.

```bash
cp .env.example .env
```

빠른 시작 스크립트는 `.env`의 `VITE_APP_VERSION`과 `VITE_ENABLE_MOCK_DATA`를 Docker build
argument로 전달한다. 나머지 `DASHBOARD_*` 값은 배포 Repository Docker Compose와 TLS 검증이
사용한다.

| 값 | 적용 대상 | 입력 값 |
| --- | --- | --- |
| `VITE_APP_VERSION` | 개발 서버와 빠른 시작 정적 이미지 | 표시할 버전 문자열 |
| `VITE_ENABLE_MOCK_DATA` | 빠른 시작 정적 이미지 | `true` 또는 `false` |
| `DASHBOARD_IMAGE` | 배포 Repository Docker Compose | GHCR image digest 참조 |
| `DASHBOARD_CONTAINER_NAME` | 배포 Repository Docker Compose | Docker container name |
| `DASHBOARD_PLATFORM` | 배포 Repository Docker Compose | OCI platform 값 |
| `DASHBOARD_BIND_ADDRESS` | 배포 Repository Docker Compose | bind address |
| `DASHBOARD_HOST_PORT` | 배포 Repository Docker Compose | 사용하지 않는 TCP port 번호 |
| `DASHBOARD_TMPFS_SIZE` | 배포 Repository Docker Compose | Docker tmpfs size |
| `DASHBOARD_TLS_CERTIFICATE_FILE` | 배포 Repository TLS certificate mount | fullchain file host 경로 |
| `DASHBOARD_TLS_PRIVATE_KEY_FILE` | 배포 Repository Docker Secret | private key file host 경로 |
| `DASHBOARD_ROOT_CA_FILE` | TLS material 검증 | Root CA certificate file host 경로 |

`VITE_*` 값은 Vite가 정적 파일을 생성할 때 적용한다. 실행 중인 컨테이너의 환경변수로
이미 생성된 브라우저용 정적 파일을 변경할 수 없다. 전체 설정 경계는
[`docs/implementation.md`](docs/implementation.md)를 따른다.

## 빠른 시작

Dockerfile은 Vite로 synthetic data가 포함된 테스트용 정적 파일을 빌드한다. `newgrp docker`로
연 새 셸의 Repository 루트에서 다음 명령을 실행한다.

```bash
# synthetic data를 포함한 이미지를 빌드하고 대시보드 컨테이너를 시작한다.
./scripts/quick-start.sh start
```

브라우저에서 `http://127.0.0.1:8080`을 연다. 빠른 시작을 끝낼 때는 다음 두 방법 중 하나를
실행한다.

### 컨테이너 종료

```bash
# 빠른 시작 컨테이너를 중지하고 제거한다.
./scripts/quick-start.sh stop
```

### 전체 정리

```bash
# 컨테이너와 빠른 시작 이미지를 함께 제거해 Docker 저장 공간을 회수한다.
./scripts/quick-start.sh clean
```

## 개발 및 검증

사전 조건의 의존성으로 개발과 전체 검증을 실행한다.

### 개발

개발 서버는 현재 터미널에서 실행되며 `Ctrl+C`로 중지한다.

```bash
# 소스 변경을 감시하고 host의 127.0.0.1:5173에 Vite 개발 서버를 시작한다.
docker compose up --build development
```

### 전체 검증

전체 검증은 개발 서버를 중지한 뒤 또는 다른 터미널에서 실행한다.

```bash
# Git, OpenSSL, Playwright Chromium을 포함한 전체 검증 이미지를 빌드한다.
docker compose build verification

# 보안 경계, 계약, 정적 검사, 테스트와 브라우저 테스트를 실행한 뒤 검증 컨테이너를 제거한다.
docker compose run --rm verification
```

개발 컨테이너와 검증 범위의 전체 내용은
[`docs/implementation.md`](docs/implementation.md)를 따른다.

## 배포

`vMAJOR.MINOR.PATCH` Git tag는 Public GitHub Container Registry (GHCR) 이미지 게시를
시작한다. 배포 환경은 image digest를 사용한다. 배포 경계와 운영 절차는
[`docs/implementation.md`](docs/implementation.md)를 따른다.

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
