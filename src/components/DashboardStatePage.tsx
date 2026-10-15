import type { ReactNode } from "react";
import type { DataReception } from "../domain/dashboard";
import { DataReceptionMeta } from "./DataReceptionMeta";

type DashboardStatePageProps = {
  description: string;
  footer: ReactNode;
  header: ReactNode;
  onRetry?: () => void;
  title: string;
  reception?: DataReception;
};

export function DashboardStatePage({ description, footer, header, onRetry, title, reception }: DashboardStatePageProps) {
  return (
    <div className="app-shell">
      {header}
      <main className="dashboard-state" aria-label={title}>
        {reception && <div className="dashboard-state-reception"><DataReceptionMeta reception={reception} /></div>}
        <section>
          <h1>{title}</h1>
          <p>{description}</p>
          {onRetry && <button className="primary-button" type="button" onClick={onRetry}>다시 시도</button>}
        </section>
      </main>
      {footer}
    </div>
  );
}
