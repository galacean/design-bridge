import { useCallback, useEffect, useRef } from 'react';

export function useInputRequest() {
  const pending = useRef<AbortController | null>(null);
  const cancelRequest = useCallback(() => pending.current?.abort(), []);
  const beginRequest = useCallback(() => {
    pending.current?.abort();
    const controller = new AbortController();

    pending.current = controller;

    return controller.signal;
  }, []);

  useEffect(() => cancelRequest, [cancelRequest]);

  return { beginRequest, cancelRequest };
}
