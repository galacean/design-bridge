import { useEffect, useState, type RefObject } from 'react';

interface FitSize {
  width: number;
  height: number;
}

function resolveFitSize(
  container: HTMLElement | null,
  sourceWidth: number,
  sourceHeight: number,
  enabled: boolean,
): FitSize {
  const safeWidth = Math.max(1, Math.round(sourceWidth || 1));
  const safeHeight = Math.max(1, Math.round(sourceHeight || 1));

  if (!enabled) {
    return { width: safeWidth, height: safeHeight };
  }

  const horizontalPadding =
    container != null
      ? parseFloat(window.getComputedStyle(container).paddingLeft || '0') +
        parseFloat(window.getComputedStyle(container).paddingRight || '0')
      : 0;
  const availableWidth = Math.max(1, Math.floor((container?.clientWidth ?? safeWidth) - horizontalPadding));
  const fittedWidth = Math.max(1, Math.min(safeWidth, availableWidth));

  return {
    width: fittedWidth,
    height: Math.max(1, Math.round((fittedWidth * safeHeight) / safeWidth)),
  };
}

export function useDebouncedFitSize(
  containerRef: RefObject<HTMLElement | null>,
  sourceWidth: number,
  sourceHeight: number,
  enabled: boolean,
  delay = 180,
): FitSize {
  const [size, setSize] = useState<FitSize>(() => resolveFitSize(null, sourceWidth, sourceHeight, enabled));

  useEffect(() => {
    const container = containerRef.current;
    let timeoutId: number | undefined;

    const commitSize = () => {
      setSize(resolveFitSize(container, sourceWidth, sourceHeight, enabled));
    };
    const scheduleSize = () => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(commitSize, delay);
    };

    commitSize();

    if (!enabled || container == null || typeof ResizeObserver === 'undefined') {
      return () => {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId);
        }
      };
    }

    const observer = new ResizeObserver(scheduleSize);

    observer.observe(container);

    return () => {
      observer.disconnect();
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [containerRef, sourceWidth, sourceHeight, enabled, delay]);

  return size;
}
