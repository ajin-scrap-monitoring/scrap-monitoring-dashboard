import type { ReactNode } from "react";

export function DetailFields({ fields }: { fields: ReadonlyArray<readonly [label: string, value: ReactNode]> }) {
  return <dl className="monitoring-detail-list">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
