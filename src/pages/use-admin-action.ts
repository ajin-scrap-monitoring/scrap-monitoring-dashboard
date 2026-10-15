import { useCallback, useEffect, useRef, useState } from "react";

export function useAdminAction(scope: unknown) {
  const pending = useRef<AbortController | null>(null);
  const [state, setState] = useState({ scope, busy: false });
  useEffect(() => () => { pending.current?.abort(); }, [scope]);
  const cancel = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    setState(previous => ({ ...previous, busy: false }));
  }, []);

  function run<T>(request: () => Promise<T>, success: (value: T) => void, failure: (error: unknown) => void) {
    if (pending.current && !pending.current.signal.aborted) return;
    const controller = new AbortController();
    pending.current = controller;
    setState({ scope, busy: true });
    void Promise.resolve().then(request)
      .then(value => { if (!controller.signal.aborted) success(value); })
      .catch((error: unknown) => { if (!controller.signal.aborted) failure(error); })
      .finally(() => {
        if (!controller.signal.aborted) {
          pending.current = null;
          setState({ scope, busy: false });
        }
      });
  }

  return { busy: state.scope === scope && state.busy, run, cancel };
}
