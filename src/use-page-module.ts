import { useCallback, useEffect, useState } from "react";

import { getLoadedPageModule, isLazyPageRoute, loadPageModule } from "./page-loaders";

export type PageModuleState = {
  error: Error | null;
  isLoading: boolean;
  reload: () => void;
};

type LoadResult = { error: Error | null; route: string; version: number };

// 화면 모듈 load 상태를 suspend 없이 반환한다. load가 끝난 모듈은 getLoadedPageModule로 읽는다.
export function usePageModule(route: string): PageModuleState {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<LoadResult | null>(null);
  const lazyRoute = isLazyPageRoute(route) ? route : null;
  const cached = lazyRoute ? getLoadedPageModule(lazyRoute) ?? null : null;

  useEffect(() => {
    if (!lazyRoute || getLoadedPageModule(lazyRoute)) return;
    let active = true;
    void loadPageModule(lazyRoute).then(
      () => { if (active) setResult({ error: null, route: lazyRoute, version }); },
      (error: unknown) => {
        if (active) setResult({ error: error instanceof Error ? error : new Error("화면 모듈을 불러오지 못했습니다."), route: lazyRoute, version });
      },
    );
    return () => { active = false; };
  }, [lazyRoute, version]);

  const reload = useCallback(() => {
    setResult(null);
    setVersion((current) => current + 1);
  }, []);

  const failure = !cached && result !== null && result.route === lazyRoute && result.version === version ? result.error : null;
  return {
    error: failure,
    isLoading: lazyRoute !== null && cached === null && failure === null,
    reload,
  };
}
