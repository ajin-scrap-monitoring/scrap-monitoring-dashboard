import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { RuntimeConfiguredApp } from "./RuntimeConfiguredApp";
import { createHttpDashboardDataSource } from "./data/http-dashboard-data-source";
import { createMockDashboardDataSource, resolveMockScenario } from "./data/mock-dashboard-data-source";
import type { DashboardRuntimeConfig } from "./runtime-config";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Root element not found.");
}

const searchParameters = new URLSearchParams(window.location.search);
const mockDataEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCK_DATA === "true";
const requestedSource = searchParameters.get("source");
if (mockDataEnabled && (requestedSource === "api" || requestedSource === "mock")) {
  window.sessionStorage.setItem("scrap-monitoring-data-source", requestedSource);
}
const selectedSource = mockDataEnabled ? requestedSource ?? window.sessionStorage.getItem("scrap-monitoring-data-source") : null;
const proposalMode = mockDataEnabled && window.sessionStorage.getItem("scrap-monitoring-api-contract") === "proposal";
const monitoringVersion = proposalMode ? "v1" : import.meta.env.VITE_MONITORING_API_VERSION ?? "v2";
const liveVideoMode = proposalMode ? "webrtc" : import.meta.env.VITE_LIVE_VIDEO_MODE ?? "mjpeg";
if (monitoringVersion !== "v1" && monitoringVersion !== "v2") throw new Error("VITE_MONITORING_API_VERSION must be v1 or v2.");
if (liveVideoMode !== "mjpeg" && liveVideoMode !== "webrtc") throw new Error("VITE_LIVE_VIDEO_MODE must be mjpeg or webrtc.");
if (monitoringVersion === "v2" && liveVideoMode !== "mjpeg") throw new Error("Monitoring v2 supports only MJPEG live video.");
const createApiDataSource = ({ pitId, cameraId }: Pick<DashboardRuntimeConfig, "pitId" | "cameraId">) => createHttpDashboardDataSource({
    apiContract: proposalMode ? "proposal" : "backend",
    monitoringVersion,
    liveVideoMode,
    pitId,
    cameraId,
  });
const application = mockDataEnabled && selectedSource !== "api"
  ? <App dataSource={createMockDashboardDataSource(resolveMockScenario(searchParameters.get("scenario")))} />
  : import.meta.env.DEV
    ? <App dataSource={createApiDataSource({ pitId: import.meta.env.VITE_PIT_ID ?? "pit-01", cameraId: import.meta.env.VITE_CAMERA_ID ?? "camera-main" })} />
    : <RuntimeConfiguredApp createDataSource={createApiDataSource} />;

createRoot(rootElement).render(
  <StrictMode>
    {application}
  </StrictMode>,
);
