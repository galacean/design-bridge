import '../../features/ge-runtime/register-plugins';
import { useEffect, useRef, useState } from 'react';
import { Player } from '@galacean/effects';
import { useDebouncedFitSize } from '../../components/use-debounced-fit-size';

interface EffectsPreviewProps {
  scene: Record<string, unknown> | null;
}

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

export default function EffectsPreview({ scene }: EffectsPreviewProps) {
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('等待转换...');
  const [isPlaying, setIsPlaying] = useState(false);

  const compositions = (scene?.compositions ?? []) as Array<{
    id: string;
    previewSize?: [number, number];
  }>;
  const compositionId = scene?.compositionId as string | undefined;
  const composition = compositions.find(item => item.id === compositionId);
  const [sceneWidth, sceneHeight] = composition?.previewSize ?? [512, 512];
  const maxDisplayWidth = 560;
  const maxDisplayHeight = 400;
  const scaleFactor = Math.min(maxDisplayWidth / sceneWidth, maxDisplayHeight / sceneHeight, 1);
  const displayWidth = Math.round(sceneWidth * scaleFactor);
  const displayHeight = Math.round(sceneHeight * scaleFactor);
  const displaySize = useDebouncedFitSize(previewWrapRef, displayWidth, displayHeight, true);

  useEffect(() => {
    let cancelled = false;

    if (playerRef.current) {
      playerRef.current.dispose();
      playerRef.current = null;
    }

    if (!containerRef.current || !scene) {
      setLoadStatus('idle');
      setStatusMessage('等待转换...');
      setIsPlaying(false);

      return;
    }

    setLoadStatus('loading');
    setStatusMessage('正在加载场景...');

    const player = new Player({
      container: containerRef.current,
      pixelRatio: window.devicePixelRatio,
    });

    playerRef.current = player;

    player.on('rendererror', (error?: Error) => {
      console.error('[shader2ge] Render error:', error);
      if (!cancelled) {
        setLoadStatus('error');
        setStatusMessage(`渲染错误: ${error?.message ?? 'Unknown render error'}`);
        setIsPlaying(false);
      }
    });

    player
      .loadScene(structuredClone(scene))
      .then(() => {
        if (cancelled) {
          return;
        }
        setLoadStatus('success');
        setStatusMessage('渲染成功');
        setIsPlaying(true);
      })
      .catch((error: Error) => {
        if (cancelled) {
          return;
        }
        setLoadStatus('error');
        setStatusMessage(error.message);
        console.error('[shader2ge] Player load error:', error);
      });

    return () => {
      cancelled = true;
      player.dispose();
      playerRef.current = null;
    };
  }, [scene]);

  useEffect(() => {
    playerRef.current?.resize();
  }, [displaySize.width, displaySize.height]);

  const togglePlay = () => {
    const player = playerRef.current;

    if (!player) {
      return;
    }
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
    } else {
      void player.resume();
      setIsPlaying(true);
    }
  };

  const restart = () => {
    const player = playerRef.current;

    if (!player) {
      return;
    }
    player.gotoAndPlay(0);
    if (!isPlaying) {
      void playerRef.current!.resume();
      setIsPlaying(true);
    }
  };

  const statusColorClass =
    loadStatus === 'error'
      ? 'text-[var(--coral)]'
      : loadStatus === 'success'
        ? 'text-[var(--cyan)]'
        : 'text-[var(--color-text-secondary)]';

  return (
    <section className="ui-card min-w-0 space-y-3">
      <span className="ui-kicker">GE 预览</span>

      <div ref={previewWrapRef} className="flex min-w-0 justify-center">
        <div
          className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-black"
          style={displaySize}
        >
          <div ref={containerRef} className="absolute inset-0 h-full w-full [&_canvas]:!h-full [&_canvas]:!w-full" />
          {!scene && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--color-text-secondary)]">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span className="text-[length:var(--text-caption)]">转换后自动播放</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className={`text-[length:var(--text-caption)] leading-[var(--lh-ui)] ${statusColorClass}`}>{statusMessage}</span>

        {loadStatus === 'success' && (
          <div className="flex items-center gap-1">
            <button
              onClick={togglePlay}
              className="ui-btn ui-btn-icon"
              title={isPlaying ? '暂停' : '播放'}
              aria-label={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button onClick={restart} className="ui-btn ui-btn-icon" title="重新播放" aria-label="重新播放">
              ↺
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
