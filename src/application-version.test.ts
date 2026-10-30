import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test.each([undefined, ""])("빌드 버전 %s가 없으면 공개 기본 버전을 표시한다", async (version) => {
  vi.stubEnv("VITE_APP_VERSION", version);
  vi.resetModules();
  const { applicationVersion } = await import("./application-version");
  expect(applicationVersion).toBe("0.5.0");
});

test("Release 빌드가 제공한 버전을 우선한다", async () => {
  vi.stubEnv("VITE_APP_VERSION", "1.2.3");
  vi.resetModules();
  const { applicationVersion } = await import("./application-version");
  expect(applicationVersion).toBe("1.2.3");
});
