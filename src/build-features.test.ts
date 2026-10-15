import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function features(development: boolean, synthetic: boolean, monitoring?: "v1" | "v2", video?: "mjpeg" | "webrtc") {
  vi.stubEnv("DEV", development);
  vi.stubEnv("VITE_ENABLE_MOCK_DATA", String(synthetic));
  vi.stubEnv("VITE_MONITORING_API_VERSION", monitoring);
  vi.stubEnv("VITE_LIVE_VIDEO_MODE", video);
  vi.resetModules();
  return import("./build-features");
}

describe("선택한 production 기능의 compile-time 경계", () => {
  test("기본 production은 v2와 MJPEG만 포함한다", async () => {
    expect(await features(false, false)).toMatchObject({ runtimeFeatureSelection: false, configuredMonitoringVersion: "v2", configuredLiveVideoMode: "mjpeg", v1MonitoringEnabled: false, v2MonitoringEnabled: true, mjpegPlaybackEnabled: true, whepPlaybackEnabled: false });
  });

  test.each(["mjpeg", "webrtc"] as const)("production v1/%s의 선택 기능은 유지한다", async (video) => {
    expect(await features(false, false, "v1", video)).toMatchObject({ runtimeFeatureSelection: false, v1MonitoringEnabled: true, v2MonitoringEnabled: false, mjpegPlaybackEnabled: video === "mjpeg", whepPlaybackEnabled: video === "webrtc" });
  });

  test.each([
    { monitoring: "v2", video: "mjpeg" },
    { monitoring: "v1", video: "mjpeg" },
    { monitoring: "v1", video: "webrtc" },
  ] as const)("production adapter는 선택한 build 입력만 허용한다: %j", async ({ monitoring, video }) => {
    await features(false, false, monitoring, video);
    const { createHttpDashboardDataSource } = await import("./data/http-dashboard-data-source");
    const fetchImplementation = vi.fn<typeof fetch>();
    expect(createHttpDashboardDataSource({ fetchImplementation }).monitoringVersion).toBe(monitoring);
    expect(() => createHttpDashboardDataSource({ fetchImplementation, monitoringVersion: monitoring === "v2" ? "v1" : "v2" })).toThrow("Monitoring version is not enabled in this build.");
    expect(() => createHttpDashboardDataSource({ fetchImplementation, apiContract: "proposal" })).toThrow("Production requires the Backend contract.");
    expect(() => createHttpDashboardDataSource({ fetchImplementation, liveVideoMode: video === "mjpeg" ? "webrtc" : "mjpeg" })).toThrow("Live video mode is not enabled in this build.");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  test.each([
    { development: true, synthetic: false },
    { development: false, synthetic: true },
    { development: true, synthetic: true },
  ])("개발 및 synthetic의 기존 런타임 선택을 유지한다: %j", async ({ development, synthetic }) => {
    for (const monitoring of ["v1", "v2"] as const) {
      for (const video of ["mjpeg", "webrtc"] as const) {
        expect(await features(development, synthetic, monitoring, video)).toMatchObject({ runtimeFeatureSelection: true, v1MonitoringEnabled: true, v2MonitoringEnabled: true, mjpegPlaybackEnabled: true, whepPlaybackEnabled: true });
      }
    }
  });
});
