import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

export function useDelayedState<T>(initialState: T): [T, Dispatch<SetStateAction<T>>, (nextState: T, delay: number) => void] {
  const [state, setState] = useState(initialState);
  const timerRef = useRef<number | null>(null);

  const setStateAfter = useCallback((nextState: T, delay: number) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setState(nextState);
    }, delay);
  }, []);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const setImmediateState: Dispatch<SetStateAction<T>> = useCallback((value) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState(value);
  }, []);

  return [state, setImmediateState, setStateAfter];
}
