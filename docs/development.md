# 개발 환경과 원격 화면 확인

## 문서 역할

이 문서는 로컬 개발 컨테이너, 원격 source 동기화와 브라우저 확인 절차의 정본이다.
제품 구현은 [구현 정보](implementation.md), 검사 범위와 통합 실행의 자원 회수는
[검증 기준](testing.md), 운영 이미지는 [배포 경계](deployment.md)를 따른다.

## 작업 환경 확인

새 세션은 기존 개발 서버와 source 동기화의 실행 여부를 확인한 뒤 필요한 동작만 수행한다.
이전 세션의 실행 여부를 전제해 중복 watch나 개발 컨테이너를 시작하지 않는다.
접속 대상과 경유 host는 현재 작업 환경의 비공개 설정을 사용하고 공개 문서에 복제하지 않는다.
SSH (Secure Shell) 접속이 불가능해도 구현과 격리 테스트는 원격 확인과 구분해 수행한다.

소스 자동 동기화가 실행 중이면 commit하지 않은 변경도 개발 화면에 반영된다.
읽기 중심 진단은 기존 서비스를 변경하지 않으며 재시작, 설정 변경과 새 연결의 시작 및 종료는
현재 작업 요청의 범위를 확인한 뒤 수행한다. 브라우저 컴퓨터의 local port forwarding은
사용자가 관리한다.

## 개발과 검증 컨테이너

개발과 검증은 Docker Engine과 Docker Compose에서 실행한다. `development` service는 Node.js,
pnpm과 Vite를 포함하고 Repository를 `/app`에 bind mount하며, 의존성은
`development_node_modules` Docker volume에 설치한다. Vite는 host의 `127.0.0.1:5173`에서
접속하며 파일 변경을 감시한다. `verification` service는 같은 Node.js와 pnpm에 Git, OpenSSL,
Playwright Chromium을 추가하고 Repository를 bind mount하며, 의존성은
`verification_node_modules` Docker volume에 설치한다. `.git`을 포함한 작업 트리를 mount하므로
비밀 파일 추적 검사가 Git 추적 상태를 확인한다. `verification` service는
`VITE_ENABLE_MOCK_DATA=false`를 설정해 빠른 시작 `.env`의 mock 설정과 무관하게 release 정적 파일을
검증한다.
두 컨테이너의 시작 명령은 `CI=true pnpm install --frozen-lockfile`로 대화형 확인 없이 의존성을 설치한다.

```sh
# 소스 변경을 감시하는 개발 서버를 실행한다.
sudo docker compose up --build development

# 전체 검사에 필요한 검증 이미지를 빌드하고 일회성 검증 컨테이너를 실행한다.
sudo docker compose build verification
sudo docker compose run --rm verification

# production runtime, TLS와 reverse proxy를 검증하고 실행별 자원을 회수한다.
sudo ./scripts/verify-container-integration.sh

# 고정한 실제 서비스를 검증하고 실행별 자원을 회수한다.
sudo ./scripts/verify-service-integration.sh

# 개발 컨테이너와 network를 제거하고 의존성 volume은 유지한다.
sudo docker compose down

# 개발과 검증 종료 후 의존성 volume까지 제거한다.
sudo docker compose down --volumes
```

## 원격 개발 컨테이너

`compose.remote-development.yaml`은 기존 `development` service에 API 모드와 내부 gateway를
추가하는 개발용 override다. 컨테이너는 2개다.

| Service | 역할 |
| --- | --- |
| `development` | 서버의 source mirror를 bind mount하는 Vite 개발 서버와 Hot Module Replacement (HMR) |
| `development-gateway` | 기존 Backend의 API와 session 검사 및 Media Service의 영상 전달 |

Vite는 서버의 `127.0.0.1:5173`에만 공개한다. gateway에는 host port를 공개하지 않고 기존
서비스의 external Docker network에 연결한다. v2와 MJPEG를 사용하며 API 실패를 v1이나
synthetic data로 대체하지 않는다. Backend와 Media Service의 배포 및 상태 확인은 이
script의 범위가 아니다.

Source 동기화 client에는 Git, OpenSSH와 `--from0`, `--delete-missing-args`를 지원하는 rsync가
필요하다. 서버에는 Docker Engine, Compose plugin, 기존 서비스 network와 비대화형
`sudo docker` 권한이 필요하다. 서버의 source mirror 경로는
`/scrap-monitoring-dashboard-dev`로 끝나는 절대 경로를 사용한다. 첫 실행은 빈 디렉토리만
사용하며 기존 Git worktree는 덮어쓰지 않는다.

Git이 제외하지 않은 source와 작업 중인 변경을 전달하며 `.git`, 로컬 환경변수, 비밀 파일과
루트 runtime JSON은 전달하지 않는다. `start`만 `.env.remote`를 서버에 mode `0600`으로 복사한다.
동기화 client는 Git 디렉토리에 대상별 성공 및 진행 중 전송 목록을 보관한다.
성공 목록은 전송 성공 뒤 갱신한다. 전송 중단 시 부분 전송한 경로도 삭제 추적에 포함하며,
파일 삭제는 stage 및 commit 여부와 무관하게 다음 동기화에 반영한다.
설정에는 다음 5개 값이 필요하다. 예시는 `development/.env.example`이다.

| 변수 | 값 |
| --- | --- |
| `DASHBOARD_DEV_NETWORK` | Backend와 Media Service가 연결된 기존 Docker network 이름 |
| `DASHBOARD_BACKEND_UPSTREAM` | Backend의 내부 DNS 이름과 port |
| `DASHBOARD_MEDIA_UPSTREAM` | Media Service의 내부 DNS 이름과 port |
| `VITE_PIT_ID` | Backend에 등록한 pit 식별자 |
| `VITE_CAMERA_ID` | Media Service에 등록한 camera 식별자 |

```sh
# 기존 서비스에 맞게 network, upstream과 식별자를 입력한다.
cp development/.env.example .env.remote

# Source mirror의 SSH 대상과 전용 경로를 지정한다.
export DASHBOARD_DEV_SSH_TARGET='<server-user>@<server-host>'
export DASHBOARD_DEV_REMOTE_PATH='/home/<server-user>/scrap-monitoring-dashboard-dev'

# 선택한 SSH host를 경유할 때만 지정한다.
# export DASHBOARD_DEV_SSH_RELAY='<relay-host>'

# Source와 설정을 전달하고 개발 컨테이너 2개를 빌드 및 시작한다.
bash scripts/remote-development.sh start

# 2초 간격으로 source를 동기화하며 Ctrl+C로 중지한다.
bash scripts/remote-development.sh watch
```

Source 변경은 rsync가 서버에 반영하고 Vite가 HMR로 브라우저에 적용한다. 의존성, 환경변수와
gateway 설정 변경은 `start`를 다시 실행해 개발 컨테이너를 재생성한다. SSH 연결이 끊기면
source 반영도 중지되며 `watch`는 연결 복구 후 동기화를 재개한다.

브라우저를 사용할 컴퓨터의 다른 터미널에서 서버의 Vite port를 forwarding한다.

```sh
# 서버의 loopback port를 브라우저 컴퓨터의 loopback port로 연결한다.
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:5173:127.0.0.1:5173 '<server-user>@<server-host>'
```

브라우저는 `http://127.0.0.1:5173/?source=api`로 접속한다. 영상 요청은 gateway가 Backend의
session을 확인한 뒤 전달한다. Media Service에는 `Host`, `Range`, `If-Range` header와 클립
다운로드의 `download=true` query만 전달한다. Session 검사 실패는 영상 요청을 거부한다.

종료할 때는 `watch`와 forwarding 터미널을 각각 `Ctrl+C`로 중지한 뒤 실행한다.

```sh
# 개발 컨테이너와 전용 network만 제거하고 의존성 volume 및 source mirror는 유지한다.
bash scripts/remote-development.sh stop
```

기존 Backend, Media Service와 external network는 제거하거나 재시작하지 않는다.

### 원격 화면 확인

`scripts/remote-browser.sh`는 위 SSH 대상과 source mirror 설정을 사용해 서버에서
Playwright Chromium을 실행한다. 별도 port나 SSH forwarding은 필요하지 않다.
브라우저는 개발 서버의 `http://127.0.0.1:5173`에 접속하며 기본 경로는
`/recordings?source=api`, viewport는 FHD 1920 x 1080이다. 개인 브라우저와 로그인
세션을 공유하지 않는다.

브라우저 이미지는 `Dockerfile`의 `browser-inspection` target으로 생성한다. 실행은
non-root 사용자, read-only root filesystem과 제한된 임시 저장소를 사용한다. 캡처마다
임시 컨테이너를 실행하고 종료 시 제거한다. 기존 개발 컨테이너와 Backend 및 Media Service는
변경하지 않는다. 브라우저 요청은 same-origin GET, HEAD와 로그인 POST만 허용한다.
관리 설정, 알림 상태와 계정 변경 요청은 차단한다.

로그인에 사용할 기존 개발 계정은 로컬 `.secrets/dashboard-browser/credentials.json`에
`{"username":"<development-user>","password":"<development-password>"}` 형식으로 저장한다.
디렉토리 권한은 `0700`, 파일 권한은 `0600`이다. script는 SSH를 통해 이 파일을 서버의
source mirror 아래 같은 경로로 전달한다. 계정 생성과 인증 정책 변경은 수행하지 않는다.

```sh
# 기존 source 동기화를 실행한 상태에서 캡처용 이미지를 빌드한다.
bash scripts/remote-browser.sh build

# 기존 계정으로 로그인한 녹화 화면을 기본 viewport로 캡처한다.
bash scripts/remote-browser.sh capture

# 현재 목록의 첫 항목을 선택하고 화면 높이를 넘는 영역도 캡처한다.
bash scripts/remote-browser.sh capture --path /recordings --recording-index 0 --full-page

# 녹화 상태의 상세 popover를 열어 캡처한다.
bash scripts/remote-browser.sh capture --recording-status

# 로그인 화면을 캡처한다.
bash scripts/remote-browser.sh capture --path /login

# 캡처 브라우저의 저장된 세션 파일만 제거한다.
bash scripts/remote-browser.sh clear-session
```

`--path`는 `/`, `/login`, `/history`, `/recordings`, `/admin`을 허용한다.
`--width`와 `--height`로 viewport를 지정하며 `--recording-index`는 현재 녹화 목록의
0부터 시작하는 위치다. 기존 역할의 접근 권한은 그대로 적용한다. 로그인 실패 시 계정이나
인증 정책을 변경하지 않는다. 이미지 build 상한은 900초, 캡처 실행 상한은 120초다.

캡처 결과는 서버의 `.secrets/dashboard-browser/captures/run.<id>/`에 생성하고 로컬
`test-results/browser-inspection/run.<id>/`로 가져온다. `capture.png`는 화면 원본이고
`metadata.json`은 viewport, 카드 좌표, 가로 overflow, 오류 개수와 녹화 API 진단 요약을
기록한다. 진단 요약은 HTTP 상태, 조회 조건의 형식 검사, 녹화 상태, 누락 메타데이터와
짧은 오류 코드를 포함하며 식별자, 실제 시각과 오류 원문은 기록하지 않는다.
자격 증명과 `session.json`은 서버의 `.secrets/dashboard-browser/`에 유지하며 세션 만료 시
기존 계정으로 다시 로그인한다. 이 경로와 캡처 산출물은 Git, Docker build context와 source
자동 동기화에서 제외한다. 화면에는 현장 정보가 포함될 수 있으므로 공개 artifact와 PR에
첨부하지 않는다.
