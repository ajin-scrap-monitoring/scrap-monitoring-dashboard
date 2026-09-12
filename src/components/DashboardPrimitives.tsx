import type { DashboardData } from "../domain/dashboard";

export function SectionTitle({ children }: { children: string }) {
  return <h2 className="section-title">{children}</h2>;
}

export function DashboardStatusLabel({ status }: { status: DashboardData["monitoring"]["status"] }) {
  const labels = {
    normal: "정상",
    "collection-required": "수거 필요",
    "measurement-error": "측정 오류",
    disconnected: "연결 끊김",
    "no-data": "데이터 없음",
  };
  const tone = status === "normal" ? "ok" : status === "collection-required" ? "warning" : "error";
  return <span className={`status-text ${tone}`}>{labels[status]}</span>;
}

export function UserIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" />
    </svg>
  );
}

export function ExpandIcon() {
  return (
    <svg className="expand-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg className="login-field-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
    </svg>
  );
}
