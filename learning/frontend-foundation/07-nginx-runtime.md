# Nginx 런타임과 reverse proxy

## Nginx의 역할

Nginx는 네트워크 요청을 받아 응답하는 웹 서버다. 브라우저가 Hypertext Transfer Protocol
(HTTP) 요청을 보내면 Nginx가 연결을 받아 요청을 해석하고 응답을 만든다.

Nginx는 먼저 연결이 도착한 로컬 주소와 port에 대응하는 listen socket에서 TCP 연결을
수락한다. HTTPS listener라면 HTTP 요청을 읽기 전에 Transport Layer Security (TLS)
handshake를 수행한다. 이때 Server Name Indication (SNI)가 있으면 인증서와 TLS 설정에
사용할 가상 서버 (virtual server)가 선택될 수 있다.

HTTP 요청을 읽은 뒤에는 `Host` header를 `server_name`과 비교해 요청을 처리할 `server`
블록을 선택한다. 일치하는 이름이 없으면 해당 주소와 port의 default server를 사용한다.
그 안에서 정규화된 요청 URI와 일치하는 `location`을 선택한다. 선택된 `location`은 정적
파일 반환, `return` directive의 고정 응답 또는 upstream으로의 reverse proxy를 수행한다.
TLS는 이 응답 방식들과 같은 층위가 아니라 HTTP 요청 처리 전에 적용되는 연결 보안
계층이다.

```text
Connection: Local Address and Port -> Listen Socket -> TCP Connection
HTTPS Only: SNI -> TLS Configuration and Certificate
HTTP Routing: Host Header -> server_name or Default Server
URI Routing: Normalized Request URI -> Location
Response Option: Location -> Static File
Response Option: Location -> Fixed Response
Response Option: Location -> Upstream Proxy
```

Nginx는 React 소스를 빌드하지 않고 적재율을 계산하지도 않는다. 로그인 자격 증명과
관리자 권한도 FastAPI가 판단한다. Nginx는 브라우저의 진입점에서 파일 제공과 요청 전달을
담당한다.

## 개발 환경과 배포 환경

`pnpm run dev`로 개발할 때 브라우저에 화면을 제공하는 프로그램은 Vite다. Vite는 5173
port에서 소스를 변환하고 React Fast Refresh를 제공한다. 이 과정에서는 Nginx가 실행되지
않는다.

배포 이미지를 만들 때는 Vite가 소스를 정적 파일로 변환해 `dist/`에 저장한다. 그다음
Dockerfile이 `dist/`를 Nginx 이미지의 `/usr/share/nginx/html/`에 복사한다. 배포
컨테이너에서는 Vite와 Node.js가 사라지고 Nginx가 완성된 정적 파일을 8080 port에서
제공한다.

```text
Development: Source -> Vite -> Browser
Build: Source -> Vite -> dist
Production: Browser -> Nginx -> dist Files
```

Dockerfile이 `build`와 `runtime` 두 단계를 사용하는 이유가 여기에 있다. `build` 단계에는
Node.js, pnpm, 소스와 `node_modules`가 필요하다. `runtime` 단계에는 빌드 결과와 Nginx만
필요하다. 최종 Open Container Initiative (OCI) 이미지에는 빌드 도구와 소스가 들어가지
않는다.

## 프로젝트 런타임 이미지 구성

`runtime` 단계의 출발점은 `nginxinc/nginx-unprivileged` 기반 이미지다. `FROM`은 빈
파일 시스템을 만드는 명령이 아니다. Nginx 실행 파일과 기본 설정이 들어 있는 기존
이미지를 가져온다.

설정과 직접 관련된 기반 이미지의 원래 구조는 다음과 같다.

```text
/etc/nginx/
|-- nginx.conf [BASE]
|-- mime.types [BASE]
`-- conf.d/
    `-- default.conf [BASE]
```

`nginx.conf`는 Nginx가 처음 읽는 최상위 설정이고 `mime.types`는 파일 확장자를 HTTP
Content-Type으로 연결한다. 기반 이미지의 `default.conf`는 8080 port와 기본 시작 화면을
제공하는 예제 server 설정이다.

이 Repository는 `nginx.conf`와 `mime.types`를 그대로 둔다. 대신 기반 이미지의
`default.conf`를 Repository의 `nginx/default.conf`로 교체한다. 정적 화면, Single Page
Application (SPA) fallback, 캐시, gzip과 `/healthz`가 이 파일에 정의되어 있기 때문이다.

Repository는 proxy와 log에 필요한 설정도 `/etc/nginx/` 아래에 추가한다. Vite가 만든
`dist/index.html`은 기반 이미지의 기본 `index.html`을 교체하고, `dist/assets/`는 같은
정적 파일 디렉터리에 추가된다.

여기서 `[BASE]`는 기반 Nginx 이미지에 원래 있던 파일이고 `[PROJECT]`는 이 Repository가
추가하거나 교체한 파일이다. `[DEPLOYMENT]`는 이미지에 넣지 않고 배포 Repository가
컨테이너 실행 시 mount하는 파일이다.

## Nginx 설정 해석 구조

Nginx HTTP 설정에는 `http`, `server`, `location`이라는 3개 주요 context가 있다. 여기서
context는 directive를 작성할 수 있는 설정 범위를 뜻한다.

`http` context는 Nginx의 HTTP module 설정 전체를 포함하며 그 안에 여러 `server` 블록을
둘 수 있다. `upstream`, `map`과 `log_format`처럼 HTTP 처리 전체에서 정의해야 하는
directive도 이 범위에 둔다. `http`에 쓴 모든 directive가 하위 블록에 무조건 상속된다는
뜻은 아니며 상속 규칙은 directive마다 다르다.

`server` context는 가상 서버 하나에 적용되는 설정 범위다. 이것은 별도 Nginx process나
별도 웹 서버 프로그램을 뜻하지 않는다. 하나의 Nginx process가 여러 `server` 블록을
처리할 수 있고, 여러 블록이 같은 listen socket을 공유할 수도 있으며, 한 블록이 여러
`listen`을 선언할 수도 있다.

`location` context는 선택된 `server` 안에서 요청 URI와 일치하는 처리 설정이다. 정확히
일치하는 경로, prefix 또는 정규 표현식으로 URI를 비교할 수 있다. `location`도 별도
process가 아니라 요청에 적용할 directive의 범위다.

```nginx
http {
    server {
        location /example {
        }
    }
}
```

기반 이미지의 `nginx.conf`는 `http` 범위에서 다음 줄을 읽는다.

```nginx
include /etc/nginx/conf.d/*.conf;
```

`include`는 다른 파일을 별도 프로그램처럼 실행하는 명령이 아니다. Nginx는 해당 파일의
내용을 `include` 위치에 붙여 넣은 것처럼 하나의 설정으로 해석한다. `*.conf`는 이름이
`.conf`로 끝나는 모든 파일을 뜻한다.

이 Repository의 설정과 배포 주입 지점까지 연결하면 다음 구조가 된다.

```text
HTTP Scope [BASE nginx.conf]
|-- MIME Types [BASE mime.types]
|-- Shared Proxy Settings [PROJECT 00-proxy-map.conf]
|   `-- Upstream Settings [DEPLOYMENT upstreams/*.conf]
|-- Logging [PROJECT 01-observability.conf]
`-- Server 8080 [PROJECT default.conf]
    |-- Security Headers [PROJECT security-headers.conf]
    |-- Static and Health Locations [PROJECT default.conf]
    `-- Proxy Locations [DEPLOYMENT runtime/*.conf]
        `-- Proxy Helpers [PROJECT includes/*.conf]
```

`00-proxy-map.conf`는 WebSocket 연결에 사용할 값을 만들고
`/etc/nginx/upstreams/*.conf`를 포함한다. `01-observability.conf`는 구조화 access log와
error log를 정의한다. `default.conf`는 `listen 8080`을 선언한 `server` 블록 안에 정적
경로와 `/healthz`를 정의하고 `/etc/nginx/runtime/*.conf`를 포함한다.

`nginx/includes/`의 파일들은 자동으로 읽히지 않는다. 배포 Repository가 만든 proxy
`location`이 필요한 공통 파일을 선택해 include한다. 일반 HTTP는
`proxy-common.conf`, Server-Sent Events (SSE)는 `proxy-streaming.conf`, WebSocket은
`proxy-websocket.conf`를 사용한다.

현재 `nginx/upstreams/`와 `nginx/runtime/`에는 `.keep`만 있다. `.keep`는 Git에서 빈
디렉터리를 유지하기 위한 파일이며 이름이 `.conf`로 끝나지 않아서 Nginx가 읽지 않는다.
따라서 현재 이미지는 정적 화면을 제공하지만 실제 FastAPI로 전달할 경로는 아직 없다.

## 화면 요청 처리

브라우저가 `/`를 요청하면 `default.conf`의 `root`에 따라
`/usr/share/nginx/html/index.html`이 반환된다. `index.html`을 받은 브라우저는 다시
`/assets/` 아래의 JavaScript, CSS, 글꼴과 이미지를 요청한다.

```nginx
root /usr/share/nginx/html;
index index.html;
```

React 화면에는 `/history`, `/recordings`, `/login`과 `/admin` 같은 URL이 있지만 해당
이름의 HTML 파일은 없다. Nginx는 실제 파일을 찾지 못하면 `index.html`을 반환하고,
브라우저에서 실행된 React가 URL에 맞는 화면을 선택한다. 이것이 SPA fallback이다.

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

`index.html`은 새 배포의 asset 이름을 알려주는 진입점이므로 저장하지 않는다. 내용 hash가
파일 이름에 들어간 `/assets/` 파일은 내용이 바뀌면 이름도 바뀌므로 장기 캐시한다. Nginx는
CSS, JavaScript, JavaScript Object Notation (JSON)과 SVG 같은 text 응답에 gzip도 적용한다.

`/healthz`는 Nginx가 HTTP 요청에 응답할 수 있는지만 확인한다. 이 경로가 정상이어도
FastAPI, 데이터베이스와 미디어 서비스가 정상이라는 뜻은 아니다.

## API와 실시간 연결 처리

운영 브라우저는 FastAPI 컨테이너의 내부 주소를 직접 사용하지 않는다. 브라우저가 Nginx와
같은 origin으로 Application Programming Interface (API) 요청을 보내면 Nginx가 내부
Docker network의 FastAPI로 전달한다. 이 구조에서는 브라우저가 내부 service 이름과 port를
알 필요가 없다.

실제 FastAPI service 이름과 port는 환경마다 다르므로 이미지에 넣지 않는다. 배포
Repository가 `/etc/nginx/upstreams/*.conf`에 Docker Domain Name System (DNS) resolver와
FastAPI upstream을 제공한다. `/etc/nginx/runtime/*.conf`에는 확정된 API 경로,
`proxy_pass`, timeout, 요청 body 제한과 rate limit을 제공한다.

일반 proxy 요청에는 브라우저가 요청한 host, 원래 protocol, client 주소와 request ID가
FastAPI에 전달된다. SSE는 응답을 모아 두지 않고 바로 브라우저로 전달하도록 buffering을
비활성화한다. WebSocket은 HTTP/1.1의 `Upgrade`와 `Connection` header를 명시적으로
전달한다.

현재 프론트엔드 제안은 상태 갱신에 SSE를 사용하고 WebRTC signaling에 WebRTC-HTTP Egress
Protocol (WHEP)을 사용한다. WHEP는 HTTP 요청으로 session을 관리하므로 WebSocket이
아니다. WebSocket 설정은 외부 계약에서 필요한 경우 사용할 수 있도록 제공하는 공통
부품이다.

## WebRTC signaling과 미디어 경계

Web Real-Time Communication (WebRTC) 연결에는 signaling과 media라는 서로 다른 흐름이
있다. signaling은 브라우저와 미디어 서비스가 연결 정보를 교환하는 과정이다. 현재 구조에서
이 요청은 Nginx와 FastAPI를 거친다.

연결이 만들어진 뒤 영상 packet은 브라우저와 미디어 서비스 사이의 Interactive
Connectivity Establishment (ICE) 경로로 전송된다. Nginx와 FastAPI는 이 미디어 경로에
들어가지 않는다.

```text
Signaling: Browser -> Nginx -> FastAPI -> Media Service Control
Media: Browser <-> Media Service
```

따라서 Nginx는 signaling용 HTTP 요청만 proxy한다. 배포 환경은 브라우저가 미디어 서비스의
ICE candidate와 media port에 직접 접근할 수 있도록 별도 네트워크를 구성해야 한다.

## 운영 환경의 Nginx 기능

현재 이미지는 권한이 제한된 User Identifier (UID) `101`로 Nginx를 실행하고 컨테이너
내부의 TCP 8080에서 요청을 받는다. `EXPOSE 8080`은 사용할 port를 기록할 뿐 host port를
자동으로 열지 않는다. Docker의 `--publish`나 Docker Compose의 `ports`가 host와
컨테이너 port를 연결한다.

Nginx는 요청마다 request ID를 만들고 access log를 standard output에 JSON 한 줄로
기록한다. FastAPI에도 같은 request ID를 전달하므로 브라우저 응답, Nginx log와 FastAPI
log를 연결해 볼 수 있다.

기본 응답에는 Content Security Policy (CSP), framing 제한, content type 추측 방지와
Permissions-Policy가 적용된다. 실제 API, signaling 또는 media origin이 확정되어 허용
출처를 추가해야 하면 배포 Repository가 환경별 보안 header 설정을 mount한다.

기본 이미지는 HTTP 8080만 제공한다. 운영 TLS listener, 서버 인증서와 개인 키는 배포
환경의 값이므로 이미지에 포함하지 않는다. 배포 Repository가 TLS server 설정과 인증서
chain을 읽기 전용으로 mount하고 서버 개인 키를 Docker Secret으로 제공한다.

## 확정 구현과 미확정 배포 계약

현재 이미지에는 정적 파일 제공, SPA fallback, 캐시, gzip, `/healthz`, 보안 header,
구조화 log와 reverse proxy 공통 부품이 들어 있다. 이 기능은 Repository의 컨테이너
통합 테스트로 검증한다.

실제 API 경로, signaling 경로, FastAPI service 이름과 port, timeout, rate limit, 요청
body 크기, TLS와 추가 CSP origin은 확정되지 않았다. 이 값들은 외부 계약을 확정한 뒤 배포
Repository의 Nginx 설정으로 제공한다.

## 설정 및 컨테이너 검증

`nginx -t`는 Nginx가 조립한 설정의 문법과 directive 위치를 검사한다. `nginx -T`는 같은
검사를 수행한 뒤 최종 설정 전체를 출력한다.

```sh
nginx -t
nginx -T
```

이 Repository와 같은 컨테이너 동작을 검증할 때는 이미지를 빌드한 뒤 정적 서버, proxy와
TLS 통합 테스트를 실행한다.

```sh
set -a
. ./.env.example
set +a
docker build \
  --platform "$DASHBOARD_PLATFORM" \
  --build-arg APP_VERSION="$VITE_APP_VERSION" \
  --tag scrap-monitoring-dashboard:learning \
  .
./scripts/verify-container-image.sh \
  scrap-monitoring-dashboard:learning \
  scrap-monitoring-dashboard-learning \
  "$VITE_APP_VERSION"
node test/proxy/integration.mjs scrap-monitoring-dashboard:learning
./test/tls/integration.sh scrap-monitoring-dashboard:learning
docker image rm scrap-monitoring-dashboard:learning
```

통합 테스트의 path, port, upstream 이름과 timeout은 테스트 전용 값이며 운영 계약이 아니다.

## 실제 파일 확인 순서

설정을 직접 확인할 때는 `Dockerfile`에서 최종 이미지에 복사되는 경로를 먼저 본다. 그다음
`nginx/default.conf`, `nginx/00-proxy-map.conf`와 `nginx/01-observability.conf`를 읽으면
Nginx가 기본 server와 공통 설정을 어떻게 만드는지 알 수 있다.

proxy 전달 내용은 `nginx/includes/`에서 확인한다. 배포 설정의 예시는 운영 계약이 아니라
통합 테스트 fixture인 `test/proxy/upstreams/`와 `test/proxy/runtime/`에서 확인할 수 있다.

## 공식 자료

- [Nginx 초보자 안내](https://nginx.org/en/docs/beginners_guide.html)
- [Nginx HTTP proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Nginx WebSocket proxy](https://nginx.org/en/docs/http/websocket.html)
- [Nginx gzip module](https://nginx.org/en/docs/http/ngx_http_gzip_module.html)
