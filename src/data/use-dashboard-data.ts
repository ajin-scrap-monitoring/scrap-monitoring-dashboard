import { useCallback, useEffect, useState } from "react";

import type { DashboardData } from "../domain/dashboard";

import type { DashboardDataSource } from "./dashboard-data-source";
import { ApiError } from "./http-dashboard-data-source";

export type DashboardDataLoadState = {
  data: DashboardData | null;
  error: Error | null;
  isLoading: boolean;
  reload: () => void;
};

function toError(error: unknown) {
  return error instanceof Error ? error : new Error("대시보드 데이터를 불러오지 못했습니다.");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useDashboardData(dataSource: DashboardDataSource): DashboardDataLoadState {
  const [result, setResult] = useState<{ source: DashboardDataSource; data: DashboardData | null; error: Error | null }>({
    source: dataSource, data: null, error: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);

  const reload = useCallback(() => {
    setResult(previous => previous.source === dataSource ? { ...previous, error: null } : previous);
    setIsLoading(true);
    setRequestVersion((version) => version + 1);
  }, [dataSource]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void dataSource.getDashboardData({ signal: controller.signal })
      .then((nextData) => {
        if (!active) return;
        setResult({ source: dataSource, data: nextData, error: null });
        unsubscribe = dataSource.subscribe?.((updatedData) => {
          if (!active) return;
          if (updatedData.authError) {
            active = false;
            setResult({ source: dataSource, data: null, error: new ApiError(updatedData.authError.status, updatedData.authError.message) });
            setIsLoading(false);
            unsubscribe?.();
            unsubscribe = undefined;
            return;
          }
          setResult({ source: dataSource, data: updatedData, error: null });
          setIsLoading(false);
        });
      })
      .catch((nextError: unknown) => {
        if (!active || isAbortError(nextError)) return;
        setResult(previous => ({ source: dataSource, data: previous.source === dataSource ? previous.data : null, error: toError(nextError) }));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
      unsubscribe?.();
    };
  }, [dataSource, requestVersion]);

  const isCurrentSource = result.source === dataSource;
  return { data: isCurrentSource ? result.data : null, error: isCurrentSource ? result.error : null,
    isLoading: !isCurrentSource || isLoading, reload };
}
