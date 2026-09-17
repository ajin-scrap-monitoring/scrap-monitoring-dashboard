# syntax=docker/dockerfile:1.7

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build

# 상대 경로를 사용하는 RUN과 COPY의 대상 경로는 /app을 기준으로 해석된다.
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    corepack enable && \
    corepack install --global pnpm@11.23.0 && \
    pnpm install --frozen-lockfile

COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY src ./src
COPY docs/mockups/assets/OFL.txt /app/licenses/NotoSansKR-OFL.txt

# ARG 값은 ENV와 달리 이 선언만으로 최종 컨테이너의 환경 변수에 남지 않는다.
ARG APP_VERSION=0.1.0
ARG VITE_ENABLE_MOCK_DATA=false
# 정적 산출물을 /app/dist에 생성한다.
RUN VITE_APP_VERSION="$APP_VERSION" VITE_ENABLE_MOCK_DATA="$VITE_ENABLE_MOCK_DATA" pnpm run build && \
    cp node_modules/react/LICENSE /app/licenses/React-MIT.txt && \
    cp node_modules/vite/LICENSE.md /app/licenses/Vite-MIT.txt

FROM build AS development

EXPOSE 5173

CMD ["sh", "-c", "pnpm install --frozen-lockfile && pnpm exec vite --host 0.0.0.0"]

FROM build AS verification

RUN apt-get update && \
    apt-get install --yes --no-install-recommends git openssl && \
    pnpm exec playwright install --with-deps chromium && \
    rm -rf /var/lib/apt/lists/*

CMD ["sh", "-c", "git config --global --add safe.directory /app && pnpm install --frozen-lockfile && pnpm run check"]

FROM nginxinc/nginx-unprivileged:1.30.4-alpine3.24-slim@sha256:3a4485bf084957d56674ee22db07d77d5a281418815c5852827419d6d629d440 AS runtime

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
# 여러 location에서 함께 사용하는 보안 응답 헤더 설정을 이미지에 복사한다.
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY nginx/00-proxy-map.conf nginx/01-observability.conf /etc/nginx/conf.d/
COPY nginx/includes /etc/nginx/includes
COPY nginx/runtime /etc/nginx/runtime
COPY nginx/upstreams /etc/nginx/upstreams
# build 단계의 /app/dist만 Nginx가 제공하는 정적 파일 경로로 복사한다.
# --from=build는 현재 runtime 단계가 아니라 앞서 이름을 붙인 build 단계에서 가져온다는 뜻이다.
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/licenses /usr/share/licenses/scrap-monitoring-dashboard

EXPOSE 8080

# 시작 후 5초는 준비 시간으로 두며 연속 3회 실패하면 컨테이너를 unhealthy로 표시한다.
HEALTHCHECK \
    --interval=30s \
    --timeout=3s \
    --start-period=5s \
    --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
