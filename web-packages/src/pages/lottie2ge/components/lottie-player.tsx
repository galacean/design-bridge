import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import lottie from 'lottie-web';
import { useDebouncedFitSize } from '../../../components/use-debounced-fit-size';

interface LottiePlayerProps {
  animationData: Record<string, unknown> | null;
  width: number;
  height: number;
  autoplay?: boolean;
  fitContainer?: boolean;
}

export interface LottiePlayerHandle {
  play: () => void;
  goToAndPlay: (frame: number) => void;
}

const LottiePlayer = forwardRef<LottiePlayerHandle, LottiePlayerProps>(function LottiePlayer(
  { animationData, width, height, autoplay = true, fitContainer = false },
  ref,
) {
  const frameWrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<ReturnType<typeof lottie.loadAnimation> | null>(null);

  useImperativeHandle(ref, () => ({
    play: () => {
      animRef.current?.play();
    },
    goToAndPlay: (frame: number) => {
      animRef.current?.goToAndPlay(frame, true);
    },
  }));

  useEffect(() => {
    animRef.current?.destroy();
    animRef.current = null;

    if (!containerRef.current || !animationData) {return;}

    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop: true,
      autoplay,
      animationData,
    });

    animRef.current = anim;

    // SVG 渲染完成后注入黑色背景矩形
    anim.addEventListener('DOMLoaded', () => {
      const svg = containerRef.current?.querySelector('svg');

      if (svg) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');

        rect.setAttribute('width', '100%');
        rect.setAttribute('height', '100%');
        rect.setAttribute('fill', 'black');
        svg.insertBefore(rect, svg.firstChild);
      }
    });

    return () => {
      animRef.current?.destroy();
      animRef.current = null;
    };
  }, [animationData, autoplay]);

  const frameSize = useDebouncedFitSize(frameWrapRef, width, height, fitContainer);

  return (
    <div ref={frameWrapRef} className={fitContainer ? 'flex w-full min-w-0 justify-center' : undefined}>
      <div className="relative overflow-hidden border border-[var(--border)] bg-[var(--s1)]" style={frameSize}>
        <div ref={containerRef} className="absolute inset-0 [&_svg]:!h-full [&_svg]:!w-full" />
        {!animationData && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] leading-[1.45] text-[var(--color-text-secondary)]">
            等待输入...
          </div>
        )}
      </div>
    </div>
  );
});

export default LottiePlayer;
