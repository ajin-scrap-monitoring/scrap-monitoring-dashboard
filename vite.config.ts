import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export function developmentProxy(target: string | undefined) {
  if (!target) return undefined;
  let upstream: URL;
  try {
    upstream = new URL(target);
  } catch {
    throw new Error("DASHBOARD_DEV_PROXY_TARGET must be an HTTP or HTTPS origin.");
  }
  if (!["http:", "https:"].includes(upstream.protocol) || upstream.username || upstream.password
    || upstream.pathname !== "/" || upstream.search || upstream.hash) {
    throw new Error("DASHBOARD_DEV_PROXY_TARGET must be an HTTP or HTTPS origin without credentials.");
  }
  return {
    "^/api/": { target: upstream.origin, changeOrigin: false },
    "^/media/": { target: upstream.origin, changeOrigin: false },
  };
}

export default defineConfig({
  plugins: [react()],
  server: {
    strictPort: true,
    proxy: developmentProxy(process.env.DASHBOARD_DEV_PROXY_TARGET),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
