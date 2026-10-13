# 프론트엔드 구현 정보

## 문서 역할

이 문서는 제품 구현에 실제로 채택한 기술, 의존성, 내부 구조, 실행,
검증과 배포 방법을 기록한다. 아직 채택하지 않은 기술을 현재 구현으로
기록하지 않는다.

## 현재 구현 범위

현재 구현 상태는 5개 영역으로 구분한다.

| 영역 | 구현 상태 |
| --- | --- |
| 도구와 품질 기준선 | Node.js, pnpm, React, TypeScript, Vite, ESLint, Vitest와 Playwright 구성 완료 |
| UI (User Interface) | v2 현재 판단 및 장비 상태, 이력, 녹화 영상, 로그인과 관리자 설정 및 synthetic 상태 구현 |
| 외부 연동 경계 | 실제 Backend OpenAPI 생성 타입, HTTP adapter, v2 Server-Sent Events (SSE), MJPEG client와 v1 제안 및 WebRTC-HTTP Egress Protocol (WHEP) 대역 검증 |
| 배포 산출물 | Nginx 기반 Open Container Initiative (OCI) 이미지, reverse proxy 공통 설정, TLS 주입 경계, CI와 Git tag 기반 Release 구성 완료 |
| 실제 시스템 통합 | 고정한 Backend, Camera Media Service와 Edge Orchestrator의 synthetic 입력 통합 검증, 실제 hardware와 현장 측정 검증 제외 |

실제 서비스 계약의 revision, 데이터 의미, 인증, 영상 경로와 통합 검증 경계는
`docs/contracts/backend/README.md`를 따른다. `docs/contracts/proposal/`은 v1 제안 및 WHEP
대역 검증용이며 실제 서비스 계약으로 취급하지 않는다. 운영 배포 환경과 현장 측정 정확도는
로컬 통합 검증의 완료 범위에 포함하지 않는다.

## 제품 배포 경계

브라우저의 진입점은 FastAPI와 분리된 Nginx 웹 서버다. Nginx는
프론트엔드 정적 산출물을 제공하고 Application Programming Interface (API) 요청을 FastAPI로
전달한다. MJPEG와 MP4는 Nginx가 FastAPI의 session 검사를 거쳐 Camera Media Service에서
전달한다. FastAPI는 정적 산출물이나 영상 byte를 직접 제공하지 않는다. 선택적인 Web
Real-Time Communication (WebRTC) 모드는 별도 WHEP 서비스를 요구하며 현재 Camera Media
Service의 기본 영상 방식이 아니다.

단일 Linux 호스트에서 Nginx와 FastAPI를 별도 컨테이너로 실행한다. 브라우저의
Hypertext Transfer Protocol (HTTP) 진입점은 Nginx만 사용하며 FastAPI와 Camera Media Service는
내부 컨테이너 네트워크에서 요청을 받는다. 인증이 없는 Media Service HTTP API를 브라우저에
직접 노출하지 않는다. 통합 테스트의 gateway는 운영 배포 설정의 예시가 아니라 해당
revision의 연동 검증 fixture다.

컨테이너 엔진은 Docker Engine, 다중 컨테이너 구성 도구는 Docker Compose를
사용한다. 서비스별 이미지는 Open Container Initiative (OCI) 호환 형식을 유지한다.

개발 host 의존성은 3개다.

| 의존성 | 최소 버전 | 용도 | 출처 |
| --- | --- | --- | --- |
| Docker Engine | 29.8.0 | 이미지 빌드와 컨테이너 실행 | [Docker 공식 APT Repository](https://docs.docker.com/engine/install/ubuntu/) |
| Docker Compose plugin | 5.5.1 | 개발과 전체 검증 service 실행 | [Docker Compose plugin](https://docs.docker.com/compose/install/linux/) |
| Docker Buildx plugin | 0.37.1 | Host에서 이미지 빌드 | [Docker Buildx](https://docs.docker.com/build/buildx/) |

`scripts/install-docker.sh`은 Ubuntu 22.04, 24.04, 26.04 amd64 host에 Docker 공식 APT
Repository를 등록하고 세 의존성을 설치한 뒤 최소 버전을 검사한다. Docker daemon 접근이 필요한
명령은 `sudo docker`로 실행한다. Docker group은 사용하지 않는다.

`scripts/quick-start.sh`은 `.env`의 Vite 설정을 Docker build argument로 전달해 읽기 전용
대시보드 컨테이너를 시작한다. `start` 인수는 host의
`127.0.0.1:8080`을 사용한다. `stop` 인수는 빠른 시작 컨테이너를 중지하고 제거하며, `clean`
인수는 컨테이너와 빠른 시작 이미지를 함께 제거한다. `start`는 컨테이너 health check가
`healthy`가 된 뒤 대시보드 주소를 출력한다.

이 Repository의 최종 배포 산출물은 Nginx와 Vite 정적 산출물을 포함한 OCI 이미지다.
다단계 빌드는 Node.js와 pnpm으로 정적 파일을 생성하고 Nginx 런타임 단계에는 정적 파일,
환경 독립적인 Single Page Application (SPA) 기본 설정과 reverse proxy 공통 설정만 복사한다.
최종 이미지에는 Node.js, pnpm, 소스 코드, 자격 증명, 환경별 주소와 실제 proxy 경로를
포함하지 않는다.

릴리스 이미지는 컨테이너 실행 시 환경변수를 읽지 않는다. Vite 환경변수는 정적 파일을
생성하는 빌드 시점 입력이며 실행 중인 Nginx가 브라우저용 정적 파일을 다시 만들지 않는다.
Dockerfile의 `VITE_ENABLE_MOCK_DATA` build argument는 기본값 `false`를 사용하며, `true`로
빌드한 이미지는 synthetic data를 포함해 Backend 없이 대시보드 기능을 체험한다. 운영
프론트엔드는 기본적으로 v2 모니터링과 MJPEG를 선택한다. API 버전과 영상 모드는 빌드 입력이며
pit 및 camera 식별자는 `Runtime 설정`을 따른다. v2와 WHEP 조합은 거부하며 WHEP는 v1에서만 선택한다.
same-origin 경로를 사용하므로 API upstream 주소를
브라우저 설정으로 주입하지 않는다. Repository 루트의 `.env.example`은 검증된 이미지 digest, 컨테이너 이름,
플랫폼, 단독 실행 bind 주소와 port, `/tmp` 크기 및 TLS 파일 host 경로의 공개 기본값을
제공한다. 사용자가 복사한 `.env`는 빠른 시작 script, Vite 개발 서버나 배포 Repository의
Docker Compose가 읽는다. `VITE_PIT_ID`와 `VITE_CAMERA_ID`는 개발 서버에서만 사용하고
운영 runtime 설정 누락을 대신하지 않는다. TLS 관련 환경변수는
인증서 파일의 host 경로만 나타내며 인증서 내용을 포함하지 않는다. Nginx 설정은 파일
mount로 제공하며 인증서와 개인 키의 주입 및 검증은 `TLS 인증서 운영`을 따른다.

배포 Repository는 이 Repository가 게시한 이미지의 digest를 선택하고 환경별 Nginx
설정, FastAPI upstream, Transport Layer Security (TLS), 인증서, 컨테이너 네트워크,
Docker Compose, 이미지 버전 결합과 롤백을 관리한다. CA 개인 키와 서버 개인 키는 Git
Repository와 컨테이너 이미지에 포함하지 않는다.

빌드 단계는 digest로 고정한 `node:24.19.0-bookworm-slim` 이미지와 pnpm 11.23.0을
사용한다. 런타임 단계는 digest로 고정한
`nginxinc/nginx-unprivileged:1.30.4-alpine3.24-slim` 이미지를 사용한다. Nginx는 사용자
`101`과 TCP 8080 포트로 실행한다. 컨테이너는 root file system을 읽기 전용으로 두고
`/tmp`에 임시 파일 시스템을 연결해 실행할 수 있다. `/healthz`는 컨테이너 상태 확인
경로다. HTML은 저장하지 않고 해시가 포함된 `/assets/` 자산은 장기 캐시한다. 이미지에는
배포되는 글꼴과 JavaScript 런타임의 라이선스 고지를 포함하며 source map은 포함하지
않는다.

이미지 Registry는 GitHub Container Registry (GHCR)이며 이미지 이름은
`ghcr.io/ajin-scrap-monitoring/scrap-monitoring-dashboard`다. 지원 플랫폼은
`linux/amd64`다. Pull Request (PR)와 `main` push의 CI는 이미지를 빌드하고 런타임을
검증하지만 게시하지 않는다. `vX.Y.Z` 형식의 Git tag가 Release workflow를 시작하며,
동일한 이미지를 `X.Y.Z`와 `sha-<full-git-sha>` tag로 게시한다. `latest` tag는 게시하지
않는다. Release workflow는 tag의 커밋이 원격 `main` 이력에 포함되는지 먼저 검사한다.
게시된 image digest는 workflow summary와 `image-reference.txt`에 기록한다. 배포
Repository는 tag가 아닌 digest로 이미지를 선택한다. 화면의 버전은 Release tag의
`X.Y.Z` 값으로 빌드한다.

Release workflow는 공개 runtime 설정 예시, JSON schema, Git 추적 Nginx 설정 archive,
image 참조와 `SHA256SUMS`를 draft Release에 첨부한 뒤 게시한다. Release의 tag와 asset은
게시 후 변경하지 않는다. job에 부여한 `contents: write`는 Release 게시에,
`packages: write`는 image 게시에 사용한다.

운영 브라우저는 사설 Domain Name System (DNS) 이름으로 고정 사설 Internet Protocol
(IP) 주소의 Nginx에 접속한다. 인터넷에서 모니터링 서버로 들어오는 연결, 공개 도메인,
공개 DNS와 public Certificate Authority (CA)를 사용하지 않는다. 내부 브라우저에서
Nginx의 Transmission Control Protocol (TCP) 443 포트로 연결할 수 있어야 한다. 서버
인증서의 Subject Alternative Name (SAN)은 브라우저가 사용하는 사설 DNS 이름을 포함한다.

TLS는 프로젝트 전용 사설 Public Key Infrastructure (PKI)를 사용한다. CA 구성, 서버
인증서 주입, Nginx TLS 설정과 갱신 절차는 배포 Repository의 책임이다.

GHCR container package는 public이다. 배포 환경은 공개 image를 pull할 때 별도 image pull
자격 증명을 사용하지 않는다. 고정 사설 IP와 환경별 내부 service port는 배포 환경에서
결정한다.

## Runtime 설정

운영 Browser는 같은 origin의 `/runtime-config.json`을 cache 없이 읽고 검증한 뒤 HTTP data
source를 초기화한다. 파일 누락, 네트워크 오류 및 10초 timeout, 잘못된 JSON, Content-Type,
미지원 schema와 유효하지 않은 식별자는 설정 오류 화면을 표시한다. 설정 오류에서는 session,
모니터링과 영상 요청을 시작하지 않고 build의 pit 및 camera 기본값으로 대체하지 않는다.
설정 응답은 UTF-8과 최대 4 KiB로 제한하며 header 수신 뒤의 timeout도 stream reader를 취소한다.
화면 종료는 설정 요청을 취소하고 늦은 응답을 적용하지 않는다.

JSON 계약의 정본은 [`runtime-config.schema.json`](contracts/runtime-config.schema.json)이다.
`schemaVersion`은 숫자 `1`이며 Backend monitoring의 `schemaVersion="2"`와 별개다.
필드는 `schemaVersion`, `pitId`와 `cameraId` 3개이며 추가 필드는 허용하지 않는다.
공개 예시는 [`runtime-config.example.json`](../runtime-config.example.json)이다.
파일에는 token, password, 개인 키, 내부 upstream과 현장 데이터를 넣지 않는다.

Backend v2 pit identifier는 1~128자이며 Media 연결의 `MEDIA_PIT_ID`는 1~50자다.
runtime `pitId`는 두 경계가 함께 사용하는 1~50자의 공통 범위를 적용한다.
문자 pattern은 없으며 값을 정규화하지 않고 query parameter로 encode한다.
Unicode 길이는 code point로 계산한다.
`cameraId`는 Backend의 `MEDIA_CAMERA_ID`와 gateway 경로 규칙을 따라 1~128자의
`[A-Za-z0-9][A-Za-z0-9._~-]*` 전체 일치만 허용한다. Media Service에 등록된 camera와
Backend의 `MEDIA_PIT_ID`, `MEDIA_CAMERA_ID` 및 `EDGE_V2_MONITORING_SOURCES` 설정을 맞추는
책임은 배포 Repository에 있다. 이 검증은 서비스의 등록 여부 조회나 접근 권한 검사를
대신하지 않는다. 확인한 외부 source revision은 Backend 계약의 manifest를 따른다.

배포 Repository는 Git 외부의 host JSON 파일을 `/usr/share/nginx/html/runtime-config.json`에
읽기 전용으로 mount한다. Nginx 사용자 `101`이 읽을 수 있는 `0644` 등 적절한 mode를 사용한다.
이미지에는 runtime JSON 기본 파일이나 환경별 식별자를 넣지 않는다.

```yaml
services:
  dashboard:
    volumes:
      - type: bind
        source: "${DASHBOARD_RUNTIME_CONFIG_FILE:?}"
        target: /usr/share/nginx/html/runtime-config.json
        read_only: true
```

이미지의 HTTP server는 `/etc/nginx/includes/runtime-config.conf`를 포함한다. 배포 Repository의
별도 HTTPS server에도 같은 snippet을 server context에 포함한다.

```nginx
include /etc/nginx/includes/runtime-config.conf;
```

snippet은 exact location에서 JSON 파일을 제공하고 `Cache-Control: no-store`를 적용한다.
파일이 없으면 `404`를 반환하고 SPA fallback을 사용하지 않는다. API upstream과 TLS 설정은
기존 Nginx 주입 경계를 유지한다. 설정은 다음 전체 페이지 로드에 적용하며 이미 열린 화면의
대상을 자동으로 변경하지 않는다. 파일을 원자적으로 교체하면 single-file bind mount의
새 inode를 반영하도록 컨테이너를 다시 생성한다. image 재빌드는 필요하지 않다.

`scripts/quick-start.sh`는 synthetic 모드에서 runtime 파일 없이 실행한다. HTTP data source를
선택한 로컬 이미지는 `.env`의 `DASHBOARD_RUNTIME_CONFIG_FILE`을 같은 경로에 mount한다.
Vite 개발 서버는 기존 pit 및 camera 환경변수를 사용한다. production 이미지와 production
Browser 테스트의 HTTP data source는 synthetic build에서도 runtime 설정을 먼저 검증한다.

수락 조건 1부터 6까지는 runtime loader, 동일 이미지의 두 설정에 대한 Browser 요청, 오류 및
요청 차단, 사용자 `101` 및 read-only mount와 HTTP 및 HTTPS 응답 검증 범위다.
공유 token 없는 실제 Media 연결과 운영 HTTPS 배포를 결합하는 조건 7은 Backend 변경 및
배포 통합 검증의 별도 경계다. 현재 실제 서비스 검증의 임시 token을 운영 인증 정책이나
조건 7의 성공 근거로 취급하지 않는다.

## Nginx reverse proxy 배포 경계

Nginx 설정은 3개 영역으로 분리한다.

| 영역 | 이미지 제공 내용 | 배포 Repository 책임 |
| --- | --- | --- |
| 기본 서버 | SPA fallback, `/healthz`, gzip, HTML 캐시 방지, 정적 자산 장기 캐시, 보안 헤더, 구조화 access log와 runtime 설정 제공 경로 | Runtime 설정의 파일 주입 |
| HTTP 컨텍스트 | WebSocket Upgrade map과 `/etc/nginx/upstreams/*.conf` include | Docker DNS resolver, FastAPI upstream, `limit_req_zone` |
| server 컨텍스트 | `/etc/nginx/runtime/*.conf` include와 HTTP, SSE 및 WebSocket proxy snippet | API, 미디어와 선택적 signaling location, session 검사, upstream 선택, rate limit 적용, request body 크기와 timeout |

배포 Repository는 `/etc/nginx/upstreams/`와 `/etc/nginx/runtime/`을 함께 주입한다.
전자는 `resolver`, shared memory `upstream`과 `server <docker-service>:<port> resolve`를
선언한다. Docker Compose 환경에서는 Docker embedded DNS를 resolver로 사용하고 `resolve`와
upstream `zone`을 함께 선언해 컨테이너 IP 변경 뒤 Nginx가 이름을 다시 해석할 수 있게 한다.
후자는 확정된 API, SSE와 미디어 경로별 `location`에서 공통 proxy snippet을 포함하고
`proxy_pass`, `proxy_connect_timeout`, `proxy_send_timeout`, `proxy_read_timeout`,
`client_max_body_size`와 API `limit_req`를 선언한다.

공통 HTTP proxy snippet은 HTTP/1.1, 빈 `Connection` 헤더, `Host`, `X-Real-IP`,
`X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`와 Nginx `$request_id`를 upstream에
전달한다. WebSocket signaling snippet은 같은 헤더에 `Upgrade`, map으로 만든 `Connection`을
추가하고 `proxy_buffering off`를 적용한다. SSE streaming snippet은 buffering과 cache를
비활성화한다. access log는 standard output에 JSON 한 줄로
기록하며 시각, request ID, 원격 주소, method, query string을 제외한 URI, 상태, 전송량,
처리 시간과 upstream 응답 정보를 포함한다.

MJPEG와 MP4 location은 Backend의 session 검사와 Media Service proxy를 조합하며 인증 Cookie와
service token을 Media Service에 전달하지 않는다. MP4의 Range header와 응답은 보존하고
MJPEG의 buffering을 비활성화한다. 기본 이미지에는 환경별 location을 포함하지 않는다.
선택적 WebRTC 모드는 signaling만 FastAPI에 전달하고 미디어는 Nginx를 경유하지 않는다.
FastAPI readiness endpoint는 upstream 컨테이너의 healthcheck와 배포 orchestration이 사용한다.
Nginx `/healthz`는 정적 웹 컨테이너의 readiness만 나타내며 FastAPI readiness를 대체하지 않는다.

기본 보안 응답 헤더는 `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
Content Security Policy (CSP), `frame-ancestors`, Permissions-Policy와 request ID다. 기본 CSP는
same-origin 정적 파일만 허용하고 framing을 금지한다. 실제 API, signaling 또는 미디어 origin이
확정되어 CSP 연결 출처가 필요하면 배포 Repository가 `/etc/nginx/security-headers.conf`를
환경별 허용 출처로 주입한다.

현재 API와 미디어 경로는 실제 서비스 계약을 따른다. 환경별 upstream 이름, Docker service
이름과 port, resolver 주소, timeout, rate limit, request body 최대 크기, readiness 및 CSP
추가 출처는 배포 Repository에서 결정한다. 이 값은 이미지의 기본 Nginx 설정에 넣지 않는다.

외부 연동과 배포 계약에서 결정할 전체 항목, 순서와 완료 조건은
`docs/contracts/README.md`를 따른다. 실제 환경별 값은 배포 Repository에서 주입하는 Nginx
설정과 FastAPI 구현에 기록한다. 이 Repository에는 환경 독립적인 공통 설정과 검증만
유지한다.

## TLS 인증서 운영

TLS 배포 산출물은 4개로 구분한다.

| 산출물 | 사용 위치 | 보안 경계 |
| --- | --- | --- |
| Root CA 인증서 | 운영 브라우저 신뢰 저장소 | 승인된 단말에만 배포하는 공개 인증서 |
| Intermediate CA 인증서 | 서버 fullchain | 서버 인증서 뒤에 연결하는 공개 인증서 |
| 서버 인증서 | Nginx | 사설 DNS SAN과 서버 인증 용도를 포함하는 공개 인증서 |
| 서버 개인 키 | Nginx Docker Secret | Repository, 이미지, 환경변수와 로그에서 제외하는 비밀키 |

Root CA와 Intermediate CA의 개인 키는 PKI 발급 환경에만 보관하며 배포 host와 대시보드
컨테이너에 제공하지 않는다. 서버 인증서는 Intermediate CA가 서명하고 Extended Key Usage
(EKU)에 TLS server authentication을 포함한다. `dashboard-fullchain.pem`은 서버 인증서,
Intermediate CA 인증서 순서로 구성하며 Root CA 인증서를 포함하지 않는다.

### 인증서 검사

`/absolute/tls-directory`를 인증서 파일을 보관한 host 디렉토리의 절대 경로로 바꾸고 다음
명령을 실행한다. 검증 컨테이너는 해당 디렉토리를 읽기 전용으로 연결하고 DNS SAN,
전체 인증서 chain의 서버 인증 용도, 개인 키 일치와 남은 유효 기간을 검사한다.

```bash
sudo docker compose build verification
sudo docker compose run --rm \
  --volume /absolute/tls-directory:/tls:ro \
  --env DASHBOARD_TLS_CERTIFICATE_FILE=/tls/dashboard-fullchain.pem \
  --env DASHBOARD_TLS_PRIVATE_KEY_FILE=/tls/dashboard-private-key.pem \
  --env DASHBOARD_ROOT_CA_FILE=/tls/root-ca.crt \
  verification ./scripts/verify-tls-material.sh
```

Container 내부 경로는 host에서 사용하는 `.env` 경로와 별개다. 파일 이름이 다르면 위
3개 입력을 맞춘다. 인증서의 남은 유효 기간이 30일 미만이면 검사는 실패한다.

### 최초 발급과 배포

1. 배포 담당자는 배포 host의 보호 디렉토리 또는 전용 키 관리 환경에서 서버 개인 키와 Certificate Signing Request (CSR)를 생성하고 브라우저가 사용하는 사설 DNS 이름을 SAN에 기록한다.
2. Intermediate CA는 서버 인증 용도의 인증서를 발급한다.
3. 배포 담당자는 서버 인증서 뒤에 Intermediate CA 인증서를 연결해 `dashboard-fullchain.pem`을 만든다.
4. 배포 담당자는 Secret source의 상위 디렉토리를 `0700`으로 제한하고 서버 개인 키를 소유자와 Nginx GID `101`만 읽는 `0640`으로 제공한다. fullchain은 Nginx가 읽을 수 있는 `0644`로 제공한다.
5. 배포 담당자는 `.env.example`을 복사한 `.env`에 인증서 경로만 기록하고 인증서 또는 개인 키 내용은 기록하지 않는다.
6. 배포 담당자는 `인증서 검사`의 컨테이너 명령을 실행한다.
7. 배포 Repository의 Docker Compose는 서버 개인 키를 `dashboard_tls_private_key` Secret으로 부여하고 fullchain을 읽기 전용으로 mount한다.
8. 배포 담당자는 Root CA 인증서를 운영 브라우저의 신뢰 저장소에 설치한 뒤 HTTPS 연결을 확인한다.

배포 Repository의 Docker Compose는 다음 경계를 사용한다.

```yaml
services:
  dashboard:
    secrets:
      - dashboard_tls_private_key
    volumes:
      - "${DASHBOARD_TLS_CERTIFICATE_FILE}:/run/certs/dashboard-fullchain.pem:ro"

secrets:
  dashboard_tls_private_key:
    file: "${DASHBOARD_TLS_PRIVATE_KEY_FILE}"
```

배포 Repository가 주입하는 Nginx server 설정은 다음 경로를 참조한다.

```nginx
ssl_certificate /run/certs/dashboard-fullchain.pem;
ssl_certificate_key /run/secrets/dashboard_tls_private_key;
```

일반 Docker Compose는 file 기반 Secret source를 bind mount하며 host의 소유권과 접근
mode를 유지한다. 배포 담당자는 `sudo docker compose config --quiet`로 보간 결과를 확인하고,
컨테이너 안에서 `/run/secrets/dashboard_tls_private_key`를 Nginx UID와 GID `101`이 읽고
쓸 수는 없는지 검사한다.

### 인증서 갱신과 교체

1. 배포 담당자는 활성 파일과 다른 보호 디렉토리에 새 서버 개인 키, 서버 인증서와 fullchain을 준비한다.
2. 배포 담당자는 새 파일의 host 디렉토리로 `인증서 검사`의 컨테이너 명령을 실행한다.
3. 배포 담당자는 `.env`의 `DASHBOARD_TLS_CERTIFICATE_FILE`과 `DASHBOARD_TLS_PRIVATE_KEY_FILE`을 새 파일 경로로 함께 변경한다.
4. 배포 담당자는 `sudo docker compose config --quiet`로 Secret source와 fullchain mount를 확인한다.
5. 배포 담당자는 `sudo docker compose up --detach --force-recreate dashboard`로 컨테이너를 다시 생성한다.
6. 배포 담당자는 `/healthz`, 인증서 체인, SAN과 만료 시각을 확인한다.
7. 배포 담당자는 롤백 확인 기간이 끝난 뒤 이전 서버 개인 키와 인증서를 폐기한다.

file 기반 Docker Secret은 컨테이너 생성 시 source에 연결되므로 인증서와 개인 키 교체는
Nginx reload만 실행하지 않고 컨테이너를 다시 생성한다. 인증서가 아닌 Nginx 설정만
변경하면 다음 순서로 문법을 검사하고 worker를 교체한다.

```bash
sudo docker compose exec --no-TTY dashboard nginx -t
sudo docker compose exec --no-TTY dashboard nginx -s reload
```

### 만료 확인과 롤백

배포 환경은 `인증서 검사`의 컨테이너 명령을 정기 실행하고 실패 전에 갱신 작업을 시작한다.

롤백은 `.env`의 두 TLS 파일 경로를 함께 이전 버전으로 되돌리고
`sudo docker compose up --detach --force-recreate dashboard`를 실행한다. Root CA 또는
Intermediate CA를 교체할 때는 새 Root CA를 운영 브라우저에 먼저 배포하고 새 체인의
HTTPS 연결을 검증한 뒤 서버 인증서를 전환한다.

## 제품 구현 기준선

프론트엔드 빌드 런타임은 Node.js 24.19.0 Long-Term Support (LTS)를 사용한다.
`.node-version`은 개발 및 검증 컨테이너와 CI가 사용하는 정확한 Node.js 버전의 정본이다.
`package.json`의 `engines.node`는 허용하는 24 주 버전을 선언한다. 개발 컴퓨터는
Docker Engine과 Docker Compose로 개발 및 검증 컨테이너를 실행하며 호스트에 Node.js를
설치하지 않는다. Node.js는 개발 도구, 검사, 테스트와 정적 산출물 빌드에만 사용하며 운영
Linux 서버에 설치하지 않는다.

패키지 관리자는 pnpm 11.23.0을 사용한다. `package.json`의 `packageManager`는
정확한 pnpm 버전의 정본이며 `pnpm-lock.yaml`만 lock file로 사용한다. 의존성
추가, 제거와 갱신에는 pnpm 명령을 사용한다. CI는 lock file을 변경하지 않는
`pnpm install --frozen-lockfile`로 설치 재현성을 검사한다.

Node.js 24의 patch 버전과 pnpm 11의 minor 및 patch 버전은 별도 변경에서
정확한 버전, lock file과 CI를 함께 갱신한다. Node.js와 pnpm의 주 버전 변경은
직접 의존성과 빌드 도구의 지원 범위를 다시 확인한 뒤 채택한다.

사용자 인터페이스는 React 19.2와 React DOM 19.2, 구현 언어는 TypeScript 6.0,
개발 서버와 프로덕션 정적 빌드는 Vite 8.2를 사용한다. Vite의 공식 React
플러그인은 React Fast Refresh와 JSX (JavaScript XML) 변환을 제공한다.
TypeScript는 컴파일러 API를 사용하는 개발 도구와의 호환성을 유지하는 6.0
안정 계열을 사용한다.

직접 의존성은 다음과 같다.

| 패키지 | 버전 | 역할 | 출처 | 라이선스 |
| --- | --- | --- | --- | --- |
| `react` | 19.2.8 | 컴포넌트와 상태 기반 사용자 인터페이스 | [npm](https://www.npmjs.com/package/react) | MIT |
| `react-dom` | 19.2.8 | 브라우저 Document Object Model (DOM) 렌더링 | [npm](https://www.npmjs.com/package/react-dom) | MIT |
| `typescript` | 6.0.3 | 정적 타입 검사 | [npm](https://www.npmjs.com/package/typescript) | Apache-2.0 |
| `vite` | 8.2.2 | 개발 서버와 프로덕션 정적 빌드 | [npm](https://www.npmjs.com/package/vite) | MIT |
| `@vitejs/plugin-react` | 6.1.0 | Vite의 React 변환과 Fast Refresh | [npm](https://www.npmjs.com/package/@vitejs/plugin-react) | MIT |
| `@types/node` | 24.13.3 | Vite 설정의 Node.js 타입 | [npm](https://www.npmjs.com/package/@types/node) | MIT |
| `@types/react` | 19.2.18 | React 타입 | [npm](https://www.npmjs.com/package/@types/react) | MIT |
| `@types/react-dom` | 19.2.4 | React DOM 타입 | [npm](https://www.npmjs.com/package/@types/react-dom) | MIT |
| `eslint` | 10.8.0 | JavaScript와 TypeScript 정적 검사 실행기 | [npm](https://www.npmjs.com/package/eslint) | MIT |
| `@eslint/js` | 10.0.1 | JavaScript 권장 정적 검사 규칙 | [npm](https://www.npmjs.com/package/@eslint/js) | MIT |
| `typescript-eslint` | 8.67.0 | 타입 정보를 사용하는 TypeScript 정적 검사 | [npm](https://www.npmjs.com/package/typescript-eslint) | MIT |
| `eslint-plugin-react-hooks` | 7.1.1 | React Hooks 규칙 검사 | [npm](https://www.npmjs.com/package/eslint-plugin-react-hooks) | MIT |
| `eslint-plugin-react-refresh` | 0.5.4 | Fast Refresh 경계 검사 | [npm](https://www.npmjs.com/package/eslint-plugin-react-refresh) | MIT |
| `globals` | 17.11.0 | 브라우저와 Node.js 전역 변수 정의 | [npm](https://www.npmjs.com/package/globals) | MIT |
| `vitest` | 4.1.11 | Vite 기반 단위 및 컴포넌트 테스트 실행기 | [npm](https://www.npmjs.com/package/vitest) | MIT |
| `jsdom` | 30.0.1 | 컴포넌트 테스트의 DOM 환경 | [npm](https://www.npmjs.com/package/jsdom) | MIT |
| `@testing-library/react` | 16.3.2 | 사용자 관점의 React 렌더링 검사 | [npm](https://www.npmjs.com/package/@testing-library/react) | MIT |
| `@testing-library/dom` | 10.4.1 | DOM 질의와 상태 검사 | [npm](https://www.npmjs.com/package/@testing-library/dom) | MIT |
| `@testing-library/user-event` | 14.6.6 | 사용자 입력과 상호작용 재현 | [npm](https://www.npmjs.com/package/@testing-library/user-event) | MIT |
| `@testing-library/jest-dom` | 7.0.1 | DOM 상태 단언 | [npm](https://www.npmjs.com/package/@testing-library/jest-dom) | MIT |
| `@playwright/test` | 1.62.1 | Chromium 브라우저 사용자 흐름 검증 | [npm](https://www.npmjs.com/package/@playwright/test) | Apache-2.0 |
| `@redocly/cli` | 2.52.1 | OpenAPI 문법, 참조와 권장 규칙 검사 | [npm](https://www.npmjs.com/package/@redocly/cli) | MIT |
| `@redocly/openapi-core` | 1.34.20 | API별 생성 설정과 Redocly 규칙 로딩 | [npm](https://www.npmjs.com/package/@redocly/openapi-core) | MIT |
| `openapi-typescript` | 7.13.0 | OpenAPI schema의 TypeScript 타입 생성과 생성물 일치 검사 | [npm](https://www.npmjs.com/package/openapi-typescript) | MIT |

직접 의존성은 `package.json`에 정확한 버전으로 기록한다. `.npmrc`의
`save-exact=true`는 pnpm이 새 직접 의존성을 정확한 버전으로 저장하게 한다.
`pnpm-lock.yaml`은 전이 의존성을 포함한 전체 설치 결과를 고정한다.
`pnpm-workspace.yaml`은 `typescript-eslint` 내부 패키지 2개를 채택한 8.67.0으로 고정해
같은 도구 계열의 버전과 공급망 검증 결과를 일치시킨다.

Vite는 TypeScript 파일을 JavaScript로 변환하지만 타입 검사를 수행하지 않는다.
`pnpm run typecheck`는 TypeScript 프로젝트 참조 전체를 검사한다. `pnpm run build`는
같은 타입 검사를 통과한 뒤 Vite가 `dist/`에 정적 산출물을 생성한다. 현재 Vite
빌드 출력 대상은 별도로 재정의하지 않으며 고정된 Vite 버전의 기본값을 사용한다.
현재 개발 및 브라우저 검증 기준은 데스크톱 Chrome, 최소 너비 1280 Cascading Style
Sheets (CSS) 픽셀, 기본 1440 x 900 뷰포트와 확장 1920 x 1080 뷰포트다. 높이를 초과하는
콘텐츠는 페이지 세로 스크롤을 사용한다. 정확한 Chrome 최소 버전은 결정 대기 상태다. 실제
접속 단말의 Chrome 버전을 확인한 뒤 Vite 빌드 출력과 브라우저 Web API (Application
Programming Interface) 호환성을 검증한다.

`index.html`, `src/main.tsx`, `src/App.tsx`와 `src/App.css`는 브라우저 진입점,
화면 구조, 상태 기반 상호작용과 공통 스타일을 제공한다. 현재 경로는 `/`, `/history`,
`/recordings`, `/login`, `/admin`이다. 상단 브랜드와 전역 메뉴는 각 화면을 연결하고,
영상 확대, 알림 팝오버, 알림 대상 설정 패널과 페이지 이동을 제공한다.

화면은 `src/domain/dashboard.ts`의 클라이언트 도메인 모델과
`src/data/dashboard-data-source.ts`의 데이터 소스 인터페이스를 사용한다.
`DashboardDataSource`는 AbortSignal을 받는 초기 조회, 선택적으로 AbortSignal을 받는 이력 및
녹화 조회와 선택적 스냅샷 구독을 정의한다.
`src/data/use-dashboard-data.ts`는 초기 조회, 취소, 오류, 재시도와 구독 스냅샷을 화면 상태로
변환한다. 초기 조회가 성공한 뒤 실시간 구독을 시작하므로 기준 snapshot을 적용하기 전에
후속 event를 처리하지 않는다. HTTP 어댑터는 화면 진입 시 함께 수행하는 모든 요청에 같은
AbortSignal을 전달한다.
`src/main.tsx`가 데이터 소스를 선택해 `App`에 주입하므로 화면 컴포넌트는 구현체를 직접
생성하지 않는다.
`src/use-latest-request.ts`는 후속 목록 조회, data source 변경과 화면 종료 시 이전 요청을
취소한다. 화면은 취소한 요청의 늦은 성공 및 오류 응답을 적용하지 않는다.

`src/data/mock-dashboard-data-source.ts`는 현황, 이력, 녹화 목록, 알림과 관리자 설정의
synthetic data를 제공한다. 현황의 대표 적재율, 수거 임계율, 수거 주기, 예상 도달 시각,
마지막 측정 시각과 영상 시각도 이 데이터 소스가 제공한다. 기본 시나리오는 `normal`이며 개발 환경에서 URL query의
`scenario`로 `collection-required`, `measurement-error`, `disconnected`, `no-data`,
`loading`, `request-error`, `live-update`, `operation-cycle` 상태를 선택할 수 있다. `/?scenario=measurement-error`은
LiDAR 2 측정 오류 데이터를 표시한다. `loading`은 1.2초 뒤 정상 데이터를 반환하고,
`request-error`는 데이터 소스 요청 실패와 재시도 화면을 표시한다. `live-update`는 초기
스냅샷 뒤 1.2초에 새 측정 스냅샷을 구독자로 전달한다. `operation-cycle`은 수거 필요,
수거 완료, LiDAR 측정 오류, 연결 끊김, 정상 복구 순서의 스냅샷을 0.5초 간격으로 전달한다.
`empty-lists`는 현황 측정값을 유지하면서 활성 알림, 이력 이벤트, 녹화 목록과 알림 대상이
없는 상태를 제공한다.

synthetic data source의 인스턴스는 화면에서 수행한 설정과 알림 변경을 유지하며 다른
인스턴스와 상태를 공유하지 않는다. `src/data/http-dashboard-data-source.ts`의 HTTP adapter는
실제 Backend 응답을 도메인 모델로 변환하고 HTTP 요청과 SSE 구독을 처리한다. 화면 컴포넌트는 서버
DTO (Data Transfer Object)에 직접 의존하지 않는다. 운영 빌드는 HTTP 어댑터를 사용한다.
개발 환경과 브라우저 테스트 빌드는 기본적으로 synthetic data source를 사용하며 `source=api`와
`source=mock` query로 session 단위 데이터 소스를 선택할 수 있다. 현황 영상, 녹화 목록의
썸네일, 녹화 재생 화면과 확대 화면은
`src/assets/camera-frame.png`의 synthetic 이미지를 예시로 사용한다. 개발 환경과
배포 빌드에 같은 이미지를 포함한다. 이미지는 정적인 예시이며 실제 영상 재생 상태를
나타내지 않는다.

synthetic data source의 녹화 영상 다운로드와 테스트 알림은 요청 확인 상태만 표시한다. HTTP
어댑터는 계약이 제공한 다운로드 경로를 사용하고 테스트 알림 endpoint의 접수 여부만
확인한다. 실제 채널 수신 여부는 사용자가 별도로 확인한다.

이력의 빠른 기간 선택은 최근 24시간, 최근 7일, 최근 30일과 최근 90일이며 기본값은 최근 7일이다.
선택 시 데이터 소스가 제공한 이력 종료 시각을 기준으로 시작과 종료 시각을 채우고,
직접 입력하면 빠른 선택을 해제한다. 기간과 이벤트 유형은 조회 버튼을 눌러 함께 적용한다.
기간은 적재율 추세와 이벤트 목록에, 유형은 이벤트 목록과 그래프 이벤트 표시 및 범례에
적용한다. 수거 필요의 유형은 알림, 수거 완료의 유형은 수거다. 적재율 추세선과 임계율
기준선은 이벤트 유형으로 필터링하지 않는다. 역전된 기간은 오류로 표시하며 기존 결과를
유지한다. 예시 데이터의 시간 기준은 `history.startsAt`과 `history.endsAt`이다.

녹화 영상의 조회 조건은 이력과 같은 빠른 기간 선택, 입력칸 배치와 조회 버튼 적용 방식을
사용한다. 빠른 기간은 데이터 소스가 제공한 서버 기준 조회 종료 시각으로 계산하며 기본값은
최근 7일이다. 실제 Backend의 초기 조회 종료 시각은 다음 분 경계로 올려 현재 분에 생성된
녹화가 누락되지 않게 한다. 선택 기간과 녹화 구간이 겹치고 이벤트 유형이 일치하는 영상을 조회한다.
조회 시 목록 첫 페이지와 첫 영상으로 이동하고 재생 및 다운로드 요청 표시를 초기화한다.
MP4 확대는 기본 player를 pause하고 같은 재생 위치에서 시작한다. 확대 화면을 닫으면
재생 위치를 기본 player에 반영하며 확대 중 기본 player의 time update는 촬영 시각을 변경하지 않는다.
data source 변경은 진행 중 다운로드 재조회를 취소하고 이전 완료 표시를 적용하지 않는다.
이력의 관련 녹화 링크로 진입하면 녹화 식별자로 메타데이터를 직접 조회하고 해당 영상의
시작 시각의 분 경계와 종료 시각 이후의 분 경계를 초기 조회 구간으로 사용한다.
빠른 기간 목록과 날짜 계산은 `src/date-range.ts`, 입력칸 배치는 공통 `.query-controls`로
관리한다.

이력과 녹화 영상의 날짜/시간 입력은 공통 `DateTimeField`를 사용한다. 직접 입력 형식은
`YYYY-MM-DD HH:mm`이며 달력과 24시간제 시/분 입력을 제공한다. 선택 날짜와 포커스는
주황색 테마로 표시한다. 달력은 방향키로 날짜 이동, PageUp과 PageDown으로 월 이동,
Escape와 바깥 클릭으로 닫기를 지원한다. 직접 입력한 날짜의 형식과 유효성을 조회 시 검증한다.

녹화 정보의 보관 기간은 데이터 소스의 `retentionStartsAt`과 `retentionEndsAt`을 표시한다.
synthetic data의 보관 시각은 화면 검토용 예시이며 실제 보관 정책과 자동 삭제 동작을
정의하지 않는다. HTTP 어댑터는 서버 응답의 보관 시작 시각과 만료 시각을 표시 형식으로
변환한다.

v1 현황의 수거 임계율 아래에는 monitoring snapshot의 사전 알림 기준을 보조 정보로
표시하며 비활성 상태는 사전 알림 꺼짐으로 표시한다. 관리자 화면은 알림 설정 응답으로
초기화한다.

관리자 수거 설정은 1~100의 정수 임계율과 그보다 낮은 사전 알림 기준을 검증한다.
잘못된 입력은 현재 적용값을 유지하며 오류를 표시한다. 알림 정책 저장은 데이터 소스를
통해 반영하고 취소는 마지막 저장값을 복원한다. 테스트 알림 대상은 등록된 전체
인원에서 선택하며 빈 목록에서는 대상 선택을 비활성화한다. 설정 저장 피드백은 서버
응답을 기준으로 표시한다. 알림 대상 추가 모달은 dialog 의미와 키보드 포커스 복원을 제공한다.
조회나 대상 변경으로 요청 표시를 초기화하면 이전 완료 타이머도 취소한다.

관리자 설정의 발송 시점, 반복 알림, 최대 반복 횟수와 등록 대상 선택은
`Dropdown` 공통 컴포넌트를 사용한다. 목록은 입력칸 아래에 이어지는 테두리와 공통 테마를
사용하며 방향키, Home, End로 이동하고 Enter 또는 Space로 선택한다. Escape는 선택 변경
없이 닫고, Tab과 바깥 클릭도 목록을 닫는다.

synthetic data source의 로그인은 `sessionStorage`에 상태를 기록하고 로그아웃은 이를 삭제한다.
HTTP 어댑터는 same-origin session Cookie를 포함한 요청, session 응답의 CSRF token과 사용자
역할을 사용한다. 실제 v2 및 녹화 조회는 비로그인 상태에서 로그인으로 이동한다. synthetic
화면은 비로그인 조회를 허용하며 관리자 설정, 사용자 메뉴와 개인 알림함은 표시하지 않는다.
관리자 역할이 아닌 사용자의 `/admin` 직접
접근은 접근 제한 상태를 표시한다. 인증된 session이 API `401` 또는 SSE `session.expired`로
만료되면 로그인 화면으로 이동한다.

## 코드 구조와 작업 재개 기준

브라우저 진입과 경로 분기는 `src/App.tsx`가 담당한다.
`src/components/DashboardShell.tsx`의 `DashboardPageShell`은 현황, 이력, 녹화 영상과
관리자 설정 화면의 상단 헤더와 하단 푸터를 공통으로 조립한다. 공통 헤더는 인증 상태,
갱신된 알림 목록과 기존 읽음 상태 병합, 팝오버 닫기와 로그아웃 상호작용을 관리한다.
로그인, 이력, 녹화 영상과 관리자 설정은 `src/pages/`에서 화면별 상태와 상호작용을
관리한다. v2 모니터링, 이력, 녹화 영상과 관리자 설정 모듈은 해당 경로에 진입할 때 지연 로딩한다.
`src/components/DashboardPrimitives.tsx`, `MonitoringVisuals.tsx`와 `Pagination.tsx`는
공통 제목, 상태, 아이콘, 차트, 측정 영역과 페이지 이동을 제공한다. 경로와 synthetic 인증 세션
키는 `src/app-routing.ts`에서 관리한다.

측정 영역의 각 측정선은 스크랩 표면과 벽면이 만나는 경계에서 시작하고 끝나며,
A와 B 원의 중심은 해당 끝점과 일치한다. 반투명 면은 센서 위치와 측정선 전체를 연결한다.
이 그림은 개략적인 배치 표현이며 실제 측정 좌표를 나타내지 않는다.

`src/domain/dashboard.ts`는 화면 데이터 모델의 정본이다.
`src/data/dashboard-data-source.ts`는 단일 읽기와 선택적 갱신 경계인 `DashboardDataSource`를
정의한다. `src/data/use-dashboard-data.ts`는 데이터 소스 수명 주기와 화면 상태를 관리한다.
`src/data/mock-dashboard-data-source.ts`는 개발과 synthetic 시나리오 테스트에 사용하는 구현이다.
`src/data/http-dashboard-data-source.ts`는 실제 Backend와 기존 제안 API를 구분해 호출한다.
`src/data/monitoring-v2.ts`는 v2 현재 판단과 장비 상태를 별도 모델로 변환하며
`src/pages/MonitoringV2Page.tsx`가 이를 표시한다. `LiveVideo.tsx`는 MJPEG 또는 WHEP 모드를
선택한다. `mjpeg-client.ts`와 `MjpegVideo.tsx`는 JPEG frame 수신 및 영상 연결 수명을,
`whep-client.ts`와 `WhepVideo.tsx`는 선택적 WHEP signaling과 미디어 연결을 처리한다.
실제 서비스 타입은 `src/generated/backend-contract.ts`, 제안 타입은
`src/generated/api-contract.ts`에 추적하며 각 OpenAPI 변경 시 함께 갱신한다.

HTTP 어댑터의 최초 이력 및 녹화 조회와 이후 사용자 조회는 monitoring snapshot의
`serverTime`에 포함된 명시적 UTC offset을 유지한다. 브라우저 운영체제의 시간대는 조회
구간에 영향을 주지 않는다. v1 LiDAR profile은 LiDAR 1과 LiDAR 2 카드로 고정하며 응답에서
누락된 profile은 정보 없음으로 표시한다. 유효하지 않은 최근 적재율과 LiDAR 표본은 축의
시각 또는 위치는 유지하되 그래프 선을 연결하지 않는다. 알림 대상 생성과 변경은 요청값이
아니라 서버가 반환한 대상 및 수신 설정을 화면에 적용한다.

v1 SSE 구독은 최근 event ID 1024개로 중복을 제거하고 개인 알림 목록은 최근 20건으로 제한한다.
재동기화는 snapshot과 인증 사용자의 개인 알림함을 다시 조회한다. 재조회 중 같은 영역의
새 event가 도착하면 해당 영역의 늦은 응답을 폐기한다. WHEP client는
`201 Created` 응답에서 Entity Tag (ETag)와 trickle ICE 협상을 확인한 뒤 후보와 수집 완료를 전송한다.
`406 Not Acceptable` counter-offer에서는 ICE 수집을 완료하고 전체 SDP answer를 `If-Match`
없이 먼저 전송한다. 서버의 `Retry-After`가 있으면 재연결 지연에 사용한다. 영상 확대 전환과
화면 종료는 기존 live stream을 닫으며 동시에 활성화되는 live stream은 하나다.

UI와 synthetic data를 변경할 때는 `sudo docker compose up --build development`로 Vite 개발 서버를
실행하고 필요한 상태를 `scenario` query로 확인한다. 실제 API는 `source=api`로 선택하며
개발 서버의 별도 same-origin gateway가 필요하다. 기존 제안 계약 테스트만 개발 빌드의
`scrap-monitoring-api-contract=proposal` sessionStorage 값을 사용하고 운영 빌드는 이 값을
무시한다. 변경 완료 전에는 `sudo docker compose build verification`과
`sudo docker compose run --rm verification`을 실행한다. 실제 연동 변경은 README의 서비스
통합 검증도 실행한다.

## 정적 검사와 테스트 기준선

검증 계층은 7개다.

| 계층 | 도구 | 범위 |
| --- | --- | --- |
| 계약 검사 | snapshot 추출기, Redocly CLI와 openapi-typescript | manifest 일치, OpenAPI 문법 및 참조와 생성 타입 일치 |
| 정적 검사 | ESLint와 typescript-eslint | TypeScript 타입 기반 규칙, React Hooks와 Fast Refresh 경계 |
| 검증 도구 테스트 | Node.js test runner와 OpenSSL | 계약 추출, 공개 artifact 정제, runner 종료 및 cleanup과 TLS material 오류 거부 |
| 컴포넌트 테스트 | Vitest, jsdom과 Testing Library | `src/`의 렌더링, 상태와 사용자 상호작용 |
| 브라우저 테스트 | Playwright Chromium | synthetic data, 실제 v2 fixture와 v1 제안 API의 사용자 흐름 및 대상 뷰포트 렌더링 |
| 컨테이너 통합 테스트 | Docker, Nginx와 OpenSSL | OCI 이미지, reverse proxy, 임시 PKI와 TLS Secret 주입 |
| 실제 서비스 통합 테스트 | 고정한 Backend, Media Service, Edge와 Chromium | 실제 서비스의 계약 snapshot, 인증, 상태 갱신과 영상 사용자 흐름 |

`docs/contracts/backend/manifest.json`은 외부 source revision과 선택 경로의 정본이다.
`scripts/backend-contract.ts`는 해당 경로와 참조하는 component를 재귀 추출하고 key를 정렬해
일정한 JSON을 생성한다. 선택 경로 누락, 참조 누락과 외부 참조는 실패한다.
`contract:snapshot`의 기본 동작과 `--check`는 읽기 전용이며 local manifest 및 snapshot의
일치 여부를 검사한다. 실행한 Backend의 OpenAPI와의 비교는 실제 서비스 통합 검증에서
수행한다. `--write`는 명시한 입력이 있어야 snapshot을 갱신한다.

`redocly.yaml`은 실제 및 제안 OpenAPI와 각각의 생성 파일을 구분한다.
실제 Backend가 제공하지 않는 servers, security 선언과 license를 생성물에 추가하지 않고
해당 권장 규칙만 제외한다. 제안 계약에는 기존 권장 규칙을 유지한다.
`scripts/generate-api-contracts.ts`는 두 계약을 모두 처리하고 검사 중 생성 파일을 변경하지 않는다.
`redocly.yaml`은 API별 source, output과 생성 옵션의 정본이다. Backend의 `defaultNonNullable=false`는
OpenAPI의 optional default 입력을 보존하며 `emptyObjectsUnknown=true`는 미지정 object 속성을 허용한다.
두 옵션은 [openapi-typescript 생성 규칙](https://openapi-ts.dev/cli#flags)을 따른다.
`contract:generate`는 두 계약의 immutable TypeScript 타입을 명시적으로 생성하고 `contract:check`는
snapshot 검사, 두 OpenAPI lint와 생성 타입의 읽기 전용 일치 검사를 실행한다.
실제 API adapter는 Backend 생성 타입을 사용하며 공통 v1 fixture는 두 생성 타입의 호환성을
컴파일 단계에서 검사한다.

고정한 Backend에서 추출한 전체 OpenAPI JSON을 `test-results/backend-openapi.json`에 둔 뒤
snapshot과 타입을 갱신한다. 외부 revision 변경은 외부 계약 절차를 따른다.

```bash
# 명시한 실제 OpenAPI 입력으로 추적 대상 snapshot을 갱신한다.
sudo docker compose run --rm verification pnpm run contract:snapshot --input /app/test-results/backend-openapi.json --write

# 실제 계약과 제안 계약의 생성 타입을 함께 갱신한다.
sudo docker compose run --rm verification pnpm run contract:generate

# 생성물을 변경하지 않고 manifest, 문법 및 생성 타입 일치를 검사한다.
sudo docker compose run --rm verification pnpm run contract:check
```

`eslint.config.js`는 ESLint flat config, 권장 TypeScript 타입 검사, React Hooks와 Vite
Fast Refresh 규칙을 적용한다. `pnpm run lint`는 경고를 허용하지 않는다.

Vitest는 `src/**/*.{test,spec}.{ts,tsx}`만 수집하고 jsdom에서 실행한다. Testing Library는
구현 세부 구조 대신 브라우저의 역할, 이름과 사용자 상호작용을 기준으로 컴포넌트를
검증한다. `pnpm run test`는 테스트를 한 번 실행하고 `pnpm run test:watch`는 변경을
감시한다.

Playwright는 `e2e/`의 브라우저 테스트를 1280 x 900, 1440 x 900과 1920 x 1080 Chromium 뷰포트에서
실행한다. `pnpm run test:e2e`는 타입 검사와 운영 빌드의 크기 예산 검사를 완료한 뒤 synthetic
데이터가 포함된 별도 빌드를 Vite preview 서버에서 검증한다. 운영 빌드 뒤
`scripts/verify-build-output.mjs`가 초기와 전체 JavaScript, CSS, 웹폰트와 전체 정적 자산의
크기 예산을 검사한다. 실패한 테스트의 screenshot과 trace는 Git에서 제외한
`test-results/`에 저장한다.

빌드 크기 예산은 초기 JavaScript 260 KiB, 전체 JavaScript 320 KiB, CSS 50 KiB, 웹폰트
4 MiB와 전체 자산 4.5 MiB다. 전체 JavaScript 예산은 기존 v1/WHEP 호환 코드와 추가한 v2 및
MJPEG client를 포함하며 초기 로딩과 전체 자산 예산은 별도로 유지한다.

현재 Playwright 테스트는 대시보드 진입, synthetic 실시간 갱신과 운영 주기 상태 전이, 상단 브랜드 이동, 알림함 읽음 처리와 닫기,
관리자 메뉴와 로그인 및 로그아웃, 비로그인 화면 제한, 관리자 경로 제한, 적재율 이력의
이벤트 상세 표시, 빈 목록, 필터와 페이지 이동, 대상 뷰포트의 수평 오버플로와 카드 잘림,
푸터 겹침, 대화형 요소의 접근 가능한 이름, 이미지 대체 텍스트와 외부 연동 전 요청
피드백을 검증한다. 계약 테스트 서버를 사용하는 브라우저 테스트는 로그인, session Cookie와
CSRF, 화면별 조회, SSE 갱신, 알림 읽음, 녹화 재생 및 다운로드, 관리자 설정과 알림 대상 변경,
테스트 알림, 로그아웃과 WHEP session 수명을 검증한다. Vitest는 synthetic data source의 기본 데이터,
상태와 빈 목록 시나리오, AbortSignal 취소, 구독 갱신과 상태 전이, 호출 간 데이터 격리,
페이지별 필터와 페이지 이동, 관리자 입력 검증과 로그인 입력 상호작용을 검증한다. HTTP
어댑터의 요청과 변환, 오류와 session 만료, SSE 순서와 재동기화 및 WHEP 정상, counter-offer,
ICE 전달, 종료와 재연결도 Vitest에서 검증한다. 계약 예제의 최근 24시간 표본 순서와 간격,
수거 필요 marker 및 당시 적용 임계율의 일치 여부도 함께 검증한다.

v2 fixture는 실제 생성 타입을 사용하고 제안 HTTP 및 SSE fixture와 구분한다.
v2 adapter 및 화면 테스트는 모든 dataState, 0%와 소수 및 결측값, 계약 위반 입력, 단일 pit,
인증 선행, event ID가 없는 SSE, 연결 끊김 및 동일 snapshot 복구와 session 종료를 검사한다.
browser fixture는 영상 decode, 무응답 및 오류와 재시도, 확대 dialog의 키보드 종료 및 focus
복원과 동시에 활성화되는 영상 연결 수를 검사한다. MJPEG parser와 컴포넌트는 chunk 경계,
header 및 frame 크기 제한, timeout, 취소, decode 실패, 인증 오류, StrictMode와 Blob URL
회수를 검사한다. 녹화 및 이력 lifecycle 테스트는 처리 상태 전이, 목록 조회 취소, 선택 변경,
역순 응답 격리와 다운로드 재조회의 접근 불가 응답을 검사한다.
서비스 통합 검증은 `pnpm run check`와 분리해 실행하며 검증 범위와 fixture 구성은
`docs/contracts/backend/README.md`를 따른다.

CI의 호스트 runner는 Ubuntu 24.04로 고정한다. CI 작업은 `@playwright/test` 1.62.1과
버전이 일치하는 공식 Playwright Noble 컨테이너
`mcr.microsoft.com/playwright:v1.62.1-noble`에서 실행하고 OCI image digest를 고정한다.
컨테이너는 사용자 `1001`로 실행한다. 컨테이너가 Chromium과 실행에 필요한 Linux 시스템
라이브러리를 제공하므로 CI에서 브라우저 또는 시스템 패키지를 별도로 설치하지 않는다.
Node.js와 pnpm은 컨테이너 안에서도 각각 `.node-version`과 `package.json`의
`packageManager`에 기록된 버전을 사용한다. CI가 사용하는 외부 GitHub Action은 upstream
Repository의 전체 commit SHA로 고정한다.

검증 컨테이너의 `pnpm run check`는 비밀 파일 추적 및 Docker build context 제외, 계약 검사,
정적 검사, 검증 도구 및 컴포넌트 테스트, 타입 검사, 프로덕션 빌드와 브라우저 테스트를 순서대로 실행하는
전체 검증 명령이다. Container job은 임시 Root CA, Intermediate CA와 서버 인증서를
생성하고 fullchain, 개인 키, Docker Secret, Nginx HTTPS, 신뢰 체인과 SAN 불일치를
검증한다. 임시 CA 개인 키와 서버 개인 키는 job의 임시 디렉토리에서만 사용하고 종료 시
삭제한다.

## 제품 구현 결정 상태

다음 항목은 결정 대기 상태다.

- Chrome 최소 버전, 빌드 출력 호환성과 브라우저 Web API 지원 범위
- 시각 회귀 테스트 범위
- 코드 포맷 정책
- 장기 운영의 계정 제공, session 저장 및 수명 정책과 v1 관리자 API의 서버 권한 검사
- 실제 적재율 산출, calibration과 현장 측정 정확도
- v2 profile, 이력, 예측, 자동 알림의 제공 여부와 계약
- 다중 pit 및 camera 선택, 수동 clip 생성과 미디어 정책 관리의 제품 범위
- 선택적 WHEP 서비스의 지원 계약과 시청자 제한
- 환경별 upstream, DNS, readiness, timeout, 요청 제한, TLS와 CSP 값

각 항목은 `docs/development-workflow.md`의 구현 기준선 단계에서 조사하고,
채택한 결과와 근거만 이 문서에 반영한다.

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

`scripts/verify-container-integration.sh`는 `test/container/Dockerfile`로 Node.js, Git, curl,
OpenSSL, Docker CLI (Command-Line Interface)와 Compose plugin을 포함한 검증 이미지를 만든다.
Docker CLI 29.8.0 이미지와 Node.js 이미지는 digest로 고정한다. Docker CLI의 Apache-2.0
license는 검증 도구에만 적용되며 제품 이미지에는 이 도구가 포함되지 않는다.
wrapper는 local Unix Docker socket과 host의 같은 절대 경로를 사용해 runtime, TLS와 reverse
proxy 검사를 호출한다. host에 Node.js나 OpenSSL을 설치하지 않는다.

두 통합 wrapper는 실행마다 다른 이름을 사용하고 자신이 만든 container, network, volume과
image만 정리한다. INT 및 TERM은 각각 130과 143으로 종료하며 테스트 실패 코드를 보존한다.
cleanup 실패도 비정상 종료로 처리한다. SIGKILL과 daemon 중단 등으로 자동 cleanup이
불가능하면 출력된 `Recovery command`를 실행한다. 두 스크립트의 `--cleanup`은 출력된
실행 디렉토리만 허용하고 같은 실행의 recovery를 반복할 수 있다.

실제 서비스 실행의 정보는 `test-results/service-integration/run.<id>/`에 저장한다.
`artifacts/`에는 정제한 `summary.json`과 synthetic screenshot만 공개한다.
원본 Playwright trace, request 및 response, Cookie, 비밀번호, token과 오류 원문은 공개
artifact에 넣지 않는다. `private/`는 mode 700이며 원본 report와 로그를 저장한다.
임시 `compose.env`는 mode 600이고 cleanup 성공 후 삭제한다. runtime 및 TLS wrapper의
로그는 출력된 `/tmp/dashboard-container-integration.<id>/`에 남으며 임시 개인 키는 자원
회수 뒤 삭제한다. source checkout은 출력된 임시 경로에 유지한다.
`.gitignore`와 `.dockerignore`는 로컬 `.env`, 비밀 파일, pnpm cache, build cache, 로그와
검증 산출물을 제외한다. 계약 snapshot, 생성 타입과 재현 fixture는 추적 대상이다.

대기 상한은 단계마다 적용한다.

| 대상 | 상한 |
| --- | --- |
| source clone | source당 180초 |
| 실제 서비스 build | 1200초 |
| service readiness | wrapper 150초, Compose wait 120초 |
| Browser 의존성 설치 | 180초 |
| Edge 입력 | 120초 |
| 실제 서비스 browser 테스트 | 300초 |
| 실제 서비스 cleanup | 45초 |
| runtime 도구 및 production build | 각각 600초 |
| runtime, TLS 및 reverse proxy 검사 | 각각 120초 |

현재 CI는 공식 Playwright 컨테이너에서 frozen 설치, 정적 검사, 컴포넌트 테스트,
검증 도구 테스트, 타입 검사, 프로덕션 빌드와 세 뷰포트의 브라우저 테스트를 실행한다. 별도 container
job은 `linux/amd64` 이미지를 빌드한 뒤 Nginx 설정 문법, 읽기 전용 root file system에서
Nginx 상태, SPA fallback, 보안 헤더, 자산 캐시, 라이선스 고지, source map과 런타임 빌드 도구
부재를 검사한다. 같은 job은 테스트 전용 FastAPI 대역 컨테이너와 Docker DNS를 사용해 API
reverse proxy, forwarded header와 request ID, API rate limit와 request body 제한, read timeout,
즉시 전달되는 SSE와 buffering 비활성화, WHEP 형태의 `POST`, `PATCH` 및 `DELETE`, WebSocket
Upgrade 호환성, upstream DNS 재해석과 구조화 access log를 검증한다. 테스트 전용 경로,
upstream 이름, resolver와 timeout 값은 운영 계약이 아니다.

별도 `Service integration` job은 고정한 실제 서비스의 동일 검증 스크립트를 실행한다.
job timeout은 35분이며 같은 workflow 및 ref의 이전 실행을 취소한다.
checkout 자격 증명은 보관하지 않고 `contents: read` 권한만 사용한다.
정제 검사를 통과한 `artifacts/`만 7일간 업로드하며 image나 Release를 게시하지 않는다.
workflow 구현과 로컬 실행은 GitHub runner의 성공 결과를 대신하지 않는다.
