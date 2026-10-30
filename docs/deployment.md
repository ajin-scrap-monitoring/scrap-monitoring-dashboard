# 배포와 runtime 설정

## 문서 역할

이 문서는 제품 이미지, runtime 설정, Nginx 주입과 인증서 운영의 정본이다.
클라이언트 구현은 [구현 정보](implementation.md), 개발 환경은 [개발 환경](development.md),
검증 범위와 실행 자원 회수는 [검증 기준](testing.md)을 따른다.
실제 환경의 배포와 서비스 변경은 현재 작업 요청이 허용한 범위에서만 수행한다.

## 제품 배포 경계

브라우저의 진입점은 FastAPI와 분리된 Nginx 웹 서버다. Nginx는
프론트엔드 정적 산출물을 제공하고 Application Programming Interface (API) 요청을 FastAPI로
전달한다. Motion JPEG (MJPEG), HTTP Live Streaming (HLS)과 MP4는 Nginx가 FastAPI의 session 검사를 거쳐 Camera Media Service에서
전달한다. FastAPI는 정적 산출물이나 영상 byte를 직접 제공하지 않는다. 선택적인 Web
Real-Time Communication (WebRTC) 모드는 별도 WebRTC-HTTP Egress Protocol (WHEP) 서비스를 요구하며 현재 Camera Media
Service의 기본 영상 방식이 아니다.

단일 Linux 호스트에서 Nginx와 FastAPI를 별도 컨테이너로 실행한다. 브라우저의
Hypertext Transfer Protocol (HTTP) 진입점은 Nginx만 사용하며 FastAPI와 Camera Media Service는
내부 컨테이너 네트워크에서 요청을 받는다. 인증이 없는 Media Service HTTP API를 브라우저에
직접 노출하지 않는다. 통합 테스트의 gateway는 운영 배포 설정의 예시가 아니라 해당
revision의 연동 검증 fixture다.

컨테이너 엔진은 Docker Engine, 다중 컨테이너 구성 도구는 Docker Compose를
사용한다. 서비스별 이미지는 Open Container Initiative (OCI) 호환 형식을 유지한다.

Host 의존성과 설치는 [README 사전 조건](../README.md#사전-조건)을 따른다.

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
pit 및 camera 식별자는 [Runtime 설정](#runtime-설정)을 따른다. v2와 WHEP 조합은 거부하며 WHEP는 v1에서만 선택한다.
`src/build-features.ts`는 production 빌드에서 선택하지 않은 모니터링과 영상 구현을 제외한다.
v1 및 WHEP 선택 빌드는 해당 기능을 유지하며 개발과 synthetic 빌드에는 회귀 검증에 필요한
모든 모드를 포함한다. 이 선택은 runtime의 pit 및 camera 설정을 변경하지 않는다.
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
`linux/amd64`다. Pull Request (PR)와 `main` push의 Continuous Integration (CI)는 이미지를 빌드하고 런타임을
검증하지만 게시하지 않는다. `vX.Y.Z` 형식의 Git tag가 Release workflow를 시작하며,
동일한 이미지를 `X.Y.Z`와 `sha-<full-git-sha>` tag로 게시한다. `latest` tag는 게시하지
않는다. Release workflow는 tag의 커밋이 원격 `main` 이력에 포함되는지 먼저 검사한다.
게시된 image digest는 workflow summary와 `image-reference.txt`에 기록한다. 배포
Repository는 tag가 아닌 digest로 이미지를 선택한다. 화면의 버전은 Release tag의
`X.Y.Z` 값으로 빌드한다. 개발 화면과 로컬 이미지의 기본 버전은
`VITE_APP_VERSION`과 `APP_VERSION`으로 지정하며, 개발 화면에 값이 없으면
`src/application-version.ts`의 기본값을 사용한다.

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

브라우저 gateway와 Edge ingress는 역할 2개로 구분한다.

| 역할 | 요청과 인증 경계 |
| --- | --- |
| Dashboard gateway | Backend session과 Cross-Site Request Forgery (CSRF)를 사용하는 API, Server-Sent Events (SSE), MJPEG 및 HLS와 MP4 조회, 미디어 요청별 Backend session 검사 |
| Edge ingress | Edge token을 사용하는 측정 POST와 카메라 업로드 WebSocket, Dashboard 화면과 조회 API 제공 대상 아님 |

Dashboard는 카메라 업로드의 `/api/v1/cameras/{id}/stream`이 아닌 인증된
`/media/cameras/{id}/live`로 영상을 조회한다. Edge ingress의 업로드용 header, body 크기와
timeout을 브라우저 조회 설정에 복제하지 않는다. 개발 gateway는 API를 Backend에, 영상
byte를 Media Service에 전달하며 Edge token과 현장 upstream을 브라우저 설정에 포함하지 않는다.

Nginx 설정은 3개 영역으로 분리한다.

| 영역 | 이미지 제공 내용 | 배포 Repository 책임 |
| --- | --- | --- |
| 기본 서버 | SPA fallback, `/healthz`, gzip, HTML 캐시 방지, 정적 자산 장기 캐시, 보안 헤더, 구조화 access log와 runtime 설정 제공 경로 | Runtime 설정의 파일 주입 |
| HTTP 컨텍스트 | WebSocket Upgrade map과 `/etc/nginx/upstreams/*.conf` include | Docker DNS resolver, FastAPI upstream, `limit_req_zone` |
| server 컨텍스트 | `/etc/nginx/runtime/*.conf` include와 HTTP, SSE, WebSocket 및 날짜 녹화 proxy snippet | API, 미디어와 선택적 signaling location, session 검사, upstream 선택, rate limit 적용, request body 크기와 timeout |

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

MJPEG, HLS와 MP4 location은 Backend의 session 검사와 Media Service proxy를 조합하며 인증 Cookie와
service token을 Media Service에 전달하지 않는다. MP4의 Range header와 응답은 보존하고
MJPEG의 buffering을 비활성화한다. 기본 이미지에는 환경별 location을 포함하지 않는다.
날짜 녹화 location은 `integration/nginx/runtime.conf`처럼 각 요청에 `auth_request`를 적용하고
`/etc/nginx/includes/proxy-daily-recording.conf`와 Media upstream을 지정한다. 이 snippet은
`GET`과 `HEAD` 및 허용한 경로만 전달하고 Media 경로와 HLS 목록 내부 경로를 변환한다.
실제 브라우저와 Media의 경로 목록 및 인증 계약은
[실제 서비스 계약](contracts/backend/README.md#실시간-영상과-녹화-파일)을 따른다.
선택적 WebRTC 모드는 signaling만 FastAPI에 전달하고 미디어는 Nginx를 경유하지 않는다.
FastAPI readiness endpoint는 upstream 컨테이너의 healthcheck와 배포 orchestration이 사용한다.
Nginx `/healthz`는 정적 웹 컨테이너의 readiness만 나타내며 FastAPI readiness를 대체하지 않는다.

기본 보안 응답 헤더는 `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
Content Security Policy (CSP), `frame-ancestors`, Permissions-Policy와 request ID다. 기본 CSP는
same-origin 정적 파일과 HLS 재생에 필요한 `media-src blob:`을 허용하고 framing을 금지한다.
실제 API, signaling 또는 미디어 origin이
확정되어 CSP 연결 출처가 필요하면 배포 Repository가 `/etc/nginx/security-headers.conf`를
환경별 허용 출처로 주입한다.

현재 API와 미디어 경로는 실제 서비스 계약을 따른다. 환경별 upstream 이름, Docker service
이름과 port, resolver 주소, timeout, rate limit, request body 최대 크기, readiness 및 CSP
추가 출처는 배포 Repository에서 결정한다. 이 값은 이미지의 기본 Nginx 설정에 넣지 않는다.

외부 연동과 배포 계약에서 결정할 전체 항목, 순서와 완료 조건은
[외부 연동 계약](contracts/README.md)을 따른다. 실제 환경별 값은 배포 Repository에서 주입하는 Nginx
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
