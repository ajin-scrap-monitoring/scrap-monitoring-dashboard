import type { DataReception } from "../domain/dashboard";
import { seoulClock, seoulDisplayText } from "../display-time";

export function DataReceptionMeta({ reception }: { reception: DataReception }) {
  const [label, tone] = { waiting: ["수신 대기", "warning"], connected: ["연결 정상", "ok"], error: ["연결 문제", "error"] }[reception.status];
  const receivedAt = reception.lastReceivedAt;
  const date = receivedAt === null ? null : new Date(receivedAt);

  return <div className="page-meta" aria-label="데이터 수신 상태">
    <span className={`status-text ${tone}`} role="status">{label}</span>
    <span className="meta-divider" aria-hidden="true" />
    <span>마지막 수신 {date === null ? "없음" : <time dateTime={date.toISOString()} title={seoulDisplayText(date.getTime())}>{seoulClock(date.getTime())}</time>}</span>
  </div>;
}
