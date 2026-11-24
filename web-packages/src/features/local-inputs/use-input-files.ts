import { useCallback, useEffect, useRef, useState } from 'react';
import { listInputFiles, type InputFormat } from './input-api';

export function useInputFiles(format: InputFormat) {
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();

    pending.current = controller;
    setError(null);
    try {
      const next = await listInputFiles(format, controller.signal);

      if (!controller.signal.aborted) {
        setFiles(next);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(`文件列表加载失败：${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
  }, [format]);

  useEffect(() => {
    void refresh();

    return () => pending.current?.abort();
  }, [refresh]);

  return { files, error, refresh };
}
