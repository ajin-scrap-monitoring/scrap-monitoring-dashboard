FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

WORKDIR /app
COPY upstream.mjs ./upstream.mjs

EXPOSE 18081

HEALTHCHECK --interval=1s --timeout=1s --retries=10 CMD node -e "fetch('http://127.0.0.1:18081/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "upstream.mjs"]
