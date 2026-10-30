import { useCallback, useEffect, useRef } from "react";

export function useLatestRequest(scope: unknown) {
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => {
    current.current?.abort();
    current.current = null;
  }, [scope]);

  return useCallback(() => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    return controller.signal;
  }, []);
}
