import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./integration",
  outputDir: `${process.env.SYNC_RUN_DIRECTORY ?? "test-results/integration"}/private/browser`,
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  timeout: 45_000,
  workers: 1,
  retries: 0,
  reporter: [["json", { outputFile: `${process.env.SYNC_RUN_DIRECTORY ?? "test-results/integration"}/private/report.json` }]],
  use: {
    baseURL: process.env.SYNC_BASE_URL ?? "http://dashboard:8080",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "off",
  },
});
