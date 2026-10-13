import { useEffect, useState } from "react";

import { App } from "./App";
import { ApplicationFooter, DashboardHeader } from "./components/DashboardShell";
import { DashboardStatePage } from "./components/DashboardStatePage";
import type { DashboardDataSource } from "./data/dashboard-data-source";
import { loadRuntimeConfig, type DashboardRuntimeConfig } from "./runtime-config";

type Props = {
  createDataSource: (config: DashboardRuntimeConfig) => DashboardDataSource;
  fetchImplementation?: typeof fetch;
};
type State = { factory: Props["createDataSource"]; fetchImplementation?: typeof fetch; value: DashboardDataSource | null; error: boolean };

export function RuntimeConfiguredApp({ createDataSource, fetchImplementation }: Props) {
  const [state, setState] = useState<State>({ factory: createDataSource, fetchImplementation, value: null, error: false });
  const current = state.factory === createDataSource && state.fetchImplementation === fetchImplementation ? state : { value: null, error: false };
  useEffect(() => {
    const controller = new AbortController();
    void loadRuntimeConfig(fetchImplementation, controller.signal)
      .then((config) => {
        if (!controller.signal.aborted) setState({ factory: createDataSource, fetchImplementation, value: createDataSource(config), error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ factory: createDataSource, fetchImplementation, value: null, error: true });
      });
    return () => controller.abort();
  }, [createDataSource, fetchImplementation]);
  if (current.value) return <App dataSource={current.value} />;
  return <DashboardStatePage
    title={current.error ? "대시보드 설정을 불러올 수 없습니다." : "대시보드 설정을 불러오는 중입니다."}
    description={current.error ? "runtime-config.json의 파일 경로, schemaVersion과 식별자를 확인한 뒤 페이지를 새로고침하세요." : "모니터링에 사용할 runtime 설정을 확인하고 있습니다."}
    header={<DashboardHeader activePage="monitoring" initialNotifications={[]} session={null} />}
    footer={<ApplicationFooter />}
    onRetry={current.error ? () => window.location.reload() : undefined}
  />;
}
