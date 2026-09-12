import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createHttpDashboardDataSource } from "./data/http-dashboard-data-source";
import { createMockDashboardDataSource, resolveMockScenario } from "./data/mock-dashboard-data-source";

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
const selectedSource = requestedSource ?? window.sessionStorage.getItem("scrap-monitoring-data-source");
const dataSource = mockDataEnabled && selectedSource !== "api"
  ? createMockDashboardDataSource(resolveMockScenario(searchParameters.get("scenario")))
  : createHttpDashboardDataSource();

createRoot(rootElement).render(
  <StrictMode>
    <App dataSource={dataSource} />
  </StrictMode>,
);
