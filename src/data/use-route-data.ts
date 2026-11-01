import { useCallback, useEffect, useState } from "react";

import type { DashboardData } from "../domain/dashboard";
import type { DashboardDataSource, DashboardRoute, DashboardRouteData } from "./dashboard-data-source";

export type UseRouteDataOptions = {
  dataSource: DashboardDataSource;
  fallbackData?: DashboardData | null;
  isAppReady: boolean;
  revalidateSession?: boolean;
  route: DashboardRoute;
  search: string;
  sessionUserId?: string | null;
};

export type RouteDataLoadState = {
  data: DashboardRouteData | null;
  error: Error | null;
  isLoading: boolean;
  reload: () => void;
};

function toError(error: unknown) {
  return error instanceof Error ? error : new Error("화면 데이터를 불러오지 못했습니다.");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function extractFallback(fallback: DashboardData | null | undefined, route: DashboardRoute): DashboardRouteData {
  if (!fallback) return {};
  if (route === "history") return { history: fallback.history };
  if (route === "recordings") {
    return {
      history: fallback.history,
      recordings: fallback.recordings,
      recordingsList: fallback.recordingsList,
      recordingsSource: fallback.recordingsSource,
      recordingsState: fallback.recordingsState,
      recordingsTotal: fallback.recordingsTotal,
    };
  }
  if (route === "admin") return { admin: fallback.admin };
  return {};
}

export function useRouteData({
  dataSource,
  fallbackData,
  isAppReady,
  revalidateSession = false,
  route,
  search,
  sessionUserId,
}: UseRouteDataOptions): RouteDataLoadState {
  const supportsLoadRouteData = typeof dataSource.loadRouteData === "function";

  const [requestVersion, setRequestVersion] = useState(0);
  const [result, setResult] = useState<{
    data: DashboardRouteData | null;
    error: Error | null;
    revalidateSession: boolean;
    route: DashboardRoute;
    search: string;
    sessionUserId?: string | null;
    source: DashboardDataSource;
    version: number;
  }>({
    data: null,
    error: null,
    revalidateSession,
    route,
    search,
    sessionUserId,
    source: dataSource,
    version: -1,
  });

  const reload = useCallback(() => {
    setRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!supportsLoadRouteData || !isAppReady) return;

    const controller = new AbortController();
    let active = true;

    void dataSource.loadRouteData!(route, { search, signal: controller.signal, revalidateSession })
      .then((routeData) => {
        if (!active) return;
        setResult({
          data: routeData,
          error: null,
          revalidateSession,
          route,
          search,
          sessionUserId,
          source: dataSource,
          version: requestVersion,
        });
      })
      .catch((error: unknown) => {
        if (!active || isAbortError(error)) return;
        setResult({
          data: null,
          error: toError(error),
          revalidateSession,
          route,
          search,
          sessionUserId,
          source: dataSource,
          version: requestVersion,
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [dataSource, isAppReady, revalidateSession, route, search, sessionUserId, supportsLoadRouteData, requestVersion]);

  if (!supportsLoadRouteData) {
    return {
      data: isAppReady ? extractFallback(fallbackData, route) : null,
      error: null,
      isLoading: !isAppReady,
      reload,
    };
  }

  const isCurrent = result.source === dataSource
    && result.route === route
    && result.search === search
    && result.sessionUserId === sessionUserId
    && result.revalidateSession === revalidateSession
    && result.version === requestVersion;

  return {
    data: isCurrent ? result.data : null,
    error: isCurrent ? result.error : null,
    isLoading: !isAppReady || !isCurrent,
    reload,
  };
}
