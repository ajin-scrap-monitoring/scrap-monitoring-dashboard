# 스크랩 모니터링 대시보드

스크랩 적재 상태, 장비 상태, 이력, 녹화 영상과 관리자 설정을 브라우저에서 제공하는
React 기반 대시보드다. 브라우저는 Backend의 same-origin Application Programming Interface
(API)와 Camera Media Service의 영상 연결을 사용한다.

## 주요 기능

- Backend v2의 현재 판단, 데이터 유효성, 장비 상태와 판단 기능 표시
- Camera Media Service의 Motion JPEG (MJPEG) 실시간 영상과 MP4 녹화 영상 재생
- 기간과 유형을 사용하는 이력 및 녹화 영상 조회
- 로그인, 알림 읽음 처리와 관리자 설정 사용자 흐름

v2가 제공하지 않는 LiDAR profile, 추이, 예측과 자동 알림은 현재 판단 화면에 표시하지
않는다. 이력과 관리자 설정은 v1 API를 사용한다.

## 사전 조건

| 의존성 | 최소 버전 | 용도 | 설치 대상 |
| --- | --- | --- | --- |
| Docker Engine | 29.8.0 | 이미지 빌드와 컨테이너 실행 | Ubuntu amd64 host |
| Docker Compose plugin | 5.5.1 | 개발 및 전체 검증 컨테이너 | Ubuntu amd64 host |
| Docker Buildx plugin | 0.37.1 | Host에서 이미지 빌드 | Ubuntu amd64 host |

Ubuntu 22.04, 24.04, 26.04 amd64 host에서 Docker를 설치하려면 다음 명령을 실행한다.

```bash
sudo ./scripts/install-docker.sh
```

## 설정

`.env.example`은 공개 이미지 단독 확인과 배포 Docker Compose가 사용하는 공개 기본값을
제공한다. 설정을 적용하려면 다음 명령으로 `.env`를 만든다.

```bash
cp .env.example .env
```

| 값 | 적용 대상 | 입력 값 |
| --- | --- | --- |
| `VITE_APP_VERSION` | 개발 서버와 빠른 시작 정적 이미지 | 표시할 버전 문자열 |
| `VITE_ENABLE_MOCK_DATA` | 빠른 시작 정적 이미지 | `true` 또는 `false` |
| `VITE_MONITORING_API_VERSION` | 개발 서버와 정적 이미지 | 현재 Backend의 `v2` 또는 기존 모니터링의 `v1` |
| `VITE_LIVE_VIDEO_MODE` | 개발 서버와 정적 이미지 | 현재 Media Service의 `mjpeg` 또는 v1 및 WebRTC-HTTP Egress Protocol (WHEP) 서비스의 `webrtc` |
| `VITE_PIT_ID` | Vite 개발 서버 | Backend에 등록된 pit 식별자 |
| `VITE_CAMERA_ID` | Vite 개발 서버 | Media Service에 등록된 camera 식별자 |
| `DASHBOARD_RUNTIME_CONFIG_FILE` | HTTP data source를 사용하는 로컬 이미지의 read-only mount | runtime JSON file host 경로 |
| `DASHBOARD_IMAGE` | 배포 Repository Docker Compose | GHCR image digest 참조 |
| `DASHBOARD_CONTAINER_NAME` | 배포 Repository Docker Compose | Docker container name |
| `DASHBOARD_PLATFORM` | 배포 Repository Docker Compose | OCI platform 값 |
| `DASHBOARD_BIND_ADDRESS` | 배포 Repository Docker Compose | bind address |
| `DASHBOARD_HOST_PORT` | 배포 Repository Docker Compose | 사용하지 않는 TCP port 번호 |
| `DASHBOARD_TMPFS_SIZE` | 배포 Repository Docker Compose | Docker tmpfs size |
| `DASHBOARD_TLS_CERTIFICATE_FILE` | 배포 Repository TLS certificate mount | fullchain file host 경로 |
| `DASHBOARD_TLS_PRIVATE_KEY_FILE` | 배포 Repository Docker Secret | private key file host 경로 |
| `DASHBOARD_ROOT_CA_FILE` | TLS material 검증 | Root CA certificate file host 경로 |

운영 pit 및 camera 식별자는 build 입력이 아니라 `/runtime-config.json`에서 읽는다.
공개 예시를 복사해 해당 환경의 등록된 식별자를 입력하고 읽기 전용으로 mount한다.

```bash
# Git에서 제외되는 운영 runtime 설정을 만들고 Nginx 사용자 101의 읽기를 허용한다.
cp runtime-config.example.json runtime-config.json
chmod 644 runtime-config.json
```

배포 mount 경로, JSON schema와 오류 처리는
[`docs/implementation.md`](docs/implementation.md#runtime-설정)를 따른다.
synthetic 빠른 시작에는 이 파일이 필요하지 않다.
버전, synthetic 포함 여부, API 버전과 영상 모드의 `VITE_*` 값은 정적 빌드 때 적용한다.
실행 중인 컨테이너의 환경변수로 이미 생성된 브라우저용 정적 파일을 변경할 수 없다. 전체 설정 경계는
[`docs/implementation.md`](docs/implementation.md)를 따른다.

## 빠른 시작

빠른 시작은 `.env`의 `VITE_ENABLE_MOCK_DATA=true`로 synthetic data가 포함된 이미지를
빌드해 Backend 없이 대시보드 기능을 체험한다. Repository 루트에서 다음 명령을 실행한다.

```bash
# synthetic data를 포함한 이미지를 빌드하고 대시보드 컨테이너를 시작한다.
sudo ./scripts/quick-start.sh start
```

브라우저에서 `http://127.0.0.1:8080`을 연다. 빠른 시작을 끝낼 때는 다음 두 방법 중 하나를
실행한다.

### 컨테이너 종료

```bash
# 빠른 시작 컨테이너를 중지하고 제거한다.
sudo ./scripts/quick-start.sh stop
```

### 전체 정리

```bash
# 컨테이너와 빠른 시작 이미지를 함께 제거해 Docker 저장 공간을 회수한다.
sudo ./scripts/quick-start.sh clean
```

## 개발 및 검증

사전 조건의 의존성으로 개발과 전체 검증을 실행한다.

### 개발

개발 서버는 현재 터미널에서 실행되며 `Ctrl+C`로 중지한다.

```bash
# 소스 변경을 감시하고 host의 127.0.0.1:5173에 Vite 개발 서버를 시작한다.
sudo docker compose up --build development
```

### 전체 검증

전체 검증은 개발 서버를 중지한 뒤 또는 다른 터미널에서 실행한다.

```bash
# Git, OpenSSL, Playwright Chromium을 포함한 전체 검증 이미지를 빌드한다.
sudo docker compose build verification

# 보안 경계, 계약, 정적 검사, 테스트와 브라우저 테스트를 실행한 뒤 검증 컨테이너를 제거한다.
sudo docker compose run --rm verification
```

개발 컨테이너와 검증 범위의 전체 내용은
[`docs/implementation.md`](docs/implementation.md)를 따른다.

### Production 이미지 검증

```bash
# 검증 컨테이너에서 production runtime, TLS와 reverse proxy를 확인한다.
# 종료 시 이 검증이 만든 container, network와 image를 제거한다.
sudo ./scripts/verify-container-integration.sh
```

### 실제 서비스 통합 검증

이 검증은 host의 Git과 GitHub 및 image registry에 접근할 수 있는 네트워크를 추가로
사용한다. 고정한 Backend, Camera Media Service와 Edge Platform 소스로 별도 컨테이너를
실행하고 synthetic 입력으로 인증, v2 상태 갱신, 실시간 영상, 녹화 재생과 다운로드를
검증한다. 실제 센서와 현장 측정 정확도는 검증하지 않는다.

```bash
# 실제 서비스와 production 프론트엔드 이미지를 빌드하고 브라우저에서 연동을 검증한다.
# 종료 시 이 검증이 만든 컨테이너, volume과 image를 제거한다.
sudo ./scripts/verify-service-integration.sh
```

검증 계약과 제약은 [`docs/contracts/backend/README.md`](docs/contracts/backend/README.md)를
따른다.

### 종료와 자원 회수

```bash
# 개발 컨테이너와 Compose network를 제거하고 의존성 volume은 유지한다.
sudo docker compose down

# 의존성 cache까지 회수하려면 개발과 검증을 모두 종료한 뒤 실행한다.
sudo docker compose down --volumes
```

두 통합 검증 스크립트는 정상 종료, 실패와 `Ctrl+C` 시 실행별 자원을 정리한다.
SIGKILL 등으로 정리하지 못한 실행은 출력된 `Recovery command`로 회수한다.
검증 로그와 산출물은 Git 추적 대상이 아니며 저장 위치와 recovery 절차는
[`docs/implementation.md`](docs/implementation.md#개발과-검증-컨테이너)를 따른다.

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
| [`docs/contracts/backend/README.md`](docs/contracts/backend/README.md) | 실제 서비스 계약 snapshot과 통합 검증 경계 |

## 이용 조건

> 이 Repository는 코드 검토와 참고를 위해 Public으로 제공하며 프로젝트 소스 코드에 별도 라이선스를 부여하지 않는다.
