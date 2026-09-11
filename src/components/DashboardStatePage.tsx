import type { ReactNode } from "react";

type DashboardStatePageProps = {
  description: string;
  footer: ReactNode;
  header: ReactNode;
  onRetry?: () => void;
  title: string;
};

export function DashboardStatePage({ description, footer, header, onRetry, title }: DashboardStatePageProps) {
  return (
    <div className="app-shell">
      {header}
      <main className="dashboard-state" aria-label={title}>
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
