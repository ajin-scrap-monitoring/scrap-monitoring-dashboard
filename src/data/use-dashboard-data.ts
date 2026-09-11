import { useCallback, useEffect, useState } from "react";

import type { DashboardData } from "../domain/dashboard";

import type { DashboardDataSource } from "./dashboard-data-source";

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
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);

  const reload = useCallback(() => {
    setError(null);
    setIsLoading(true);
    setRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void dataSource.getDashboardData({ signal: controller.signal })
      .then((nextData) => {
        if (!active) return;
        setData(nextData);
      })
      .catch((nextError: unknown) => {
        if (!active || isAbortError(nextError)) return;
        setError(toError(nextError));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    const unsubscribe = dataSource.subscribe?.((nextData) => {
      if (!active) return;
      setData(nextData);
      setError(null);
      setIsLoading(false);
    });

    return () => {
      active = false;
      controller.abort();
      unsubscribe?.();
    };
  }, [dataSource, requestVersion]);

  return { data, error, isLoading, reload };
}
