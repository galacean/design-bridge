import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useDebouncedFitSize } from '../../../components/use-debounced-fit-size';
import {
  getSmilReplayTimes,
  namespaceSvgIdsForPlayback,
  readSvgIntrinsicSize,
} from '../../../features/frame-comparison/runtime/svg-renderer';

const TRANSPARENCY_GRID_BACKGROUND = 'conic-gradient(#d8dce3 25%, #f4f5f7 0 50%, #d8dce3 0 75%, #f4f5f7 0) 0 0 / 16px 16px';

interface SVGPlayerProps {
  svg: string | null;
  width: number;
  height: number;
  autoplay?: boolean;
  fitContainer?: boolean;
  seekTime?: number;
  background?: string;
}

export interface SVGPlayerHandle {
  play: () => void;
  goToAndPlay: (seconds: number) => void;
}

let previewNamespaceSequence = 0;

const SVGPlayer = forwardRef<SVGPlayerHandle, SVGPlayerProps>(function SVGPlayer (
  { svg, width, height, autoplay = true, fitContainer = false, seekTime, background = TRANSPARENCY_GRID_BACKGROUND },
  ref,
) {
  const frameWrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const frameSize = useDebouncedFitSize(frameWrapRef, width, height, fitContainer);

  const playFrom = (seconds: number) => {
    const element = svgRef.current;

    if (element == null) { return; }
    try { element.setCurrentTime(Math.max(0, seconds)); } catch { /* static/legacy SVG */ }
    try { element.unpauseAnimations(); } catch { /* static/legacy SVG */ }
  };
  const seekAndPause = (seconds: number) => {
    const element = svgRef.current;

    if (element == null) { return; }
    try { element.pauseAnimations(); } catch { /* static/legacy SVG */ }
    for (const time of getSmilReplayTimes(0, Math.max(0, seconds))) {
      try { element.setCurrentTime(time); } catch { break; /* static/legacy SVG */ }
    }
  };

  useImperativeHandle(ref, () => ({
    play: () => {
      let currentTime = 0;

      try { currentTime = svgRef.current?.getCurrentTime() ?? 0; } catch { /* static/legacy SVG */ }
      playFrom(currentTime);
    },
    goToAndPlay: playFrom,
  }));

  useEffect(() => {
    const container = containerRef.current;

    if (container == null) { return; }
    container.replaceChildren();
    svgRef.current = null;
    if (svg == null || svg.trim() === '') { return; }

    const wrapper = document.createElement('div');
    const intrinsicSize = readSvgIntrinsicSize(svg);

    wrapper.className = 'origin-top-left';
    wrapper.innerHTML = namespaceSvgIdsForPlayback(svg, `__svg_preview_${++previewNamespaceSequence}_`);
    if (intrinsicSize == null) {
      wrapper.style.width = '100%';
      wrapper.style.height = '100%';
    } else {
      wrapper.style.width = `${intrinsicSize.width}px`;
      wrapper.style.height = `${intrinsicSize.height}px`;
      wrapper.style.transform = `scale(${frameSize.width / intrinsicSize.width}, ${frameSize.height / intrinsicSize.height})`;
    }
    container.replaceChildren(wrapper);
    const element = wrapper.querySelector('svg');

    if (element == null) { return; }
    svgRef.current = element;
    const animationFrame = requestAnimationFrame(() => {
      if (seekTime != null) { seekAndPause(seekTime); } else if (autoplay) { playFrom(0); } else {
        try { element.pauseAnimations(); } catch { /* static/legacy SVG */ }
      }
    });

    return () => {
      cancelAnimationFrame(animationFrame);
      svgRef.current = null;
      container.replaceChildren();
    };
  }, [autoplay, frameSize.height, frameSize.width, seekTime, svg]);

  return (
    <div ref={frameWrapRef} className={fitContainer ? 'flex w-full min-w-0 justify-center' : undefined}>
      <div
        data-testid="svg-native-player"
        className="relative overflow-hidden ring-1 ring-[var(--border)]"
        style={{ ...frameSize, background }}
      >
        <div
          ref={containerRef}
          className="absolute inset-0 [&_svg]:!block [&_svg]:!h-full [&_svg]:!w-full"
        />
        {svg == null && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] leading-[1.45] text-[var(--color-text-secondary)]">
            等待输入...
          </div>
        )}
      </div>
    </div>
  );
});

export default SVGPlayer;
