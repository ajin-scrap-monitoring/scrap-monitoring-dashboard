import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createMockDashboardDataSource, resolveMockScenario } from "./data/mock-dashboard-data-source";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Root element not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App dataSource={createMockDashboardDataSource(resolveMockScenario(new URLSearchParams(window.location.search).get("scenario")))} />
  </StrictMode>,
);
