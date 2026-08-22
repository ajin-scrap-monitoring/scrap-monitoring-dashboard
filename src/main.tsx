import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { getExecutionStatus } from "./status";
import "./styles.css";

function App() {
  return (
    <main className="page">
      <section className="status-card" aria-labelledby="page-title">
        <p className="eyebrow">Scrap Monitoring Dashboard</p>
        <h1 id="page-title">프론트엔드 실행 확인</h1>
        <p className="description">
          브라우저 실행과 CI 검증을 위한 최소 화면입니다.
        </p>
        <p className="status" role="status">
          {getExecutionStatus(true)}
        </p>
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("React root element를 찾을 수 없습니다.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
