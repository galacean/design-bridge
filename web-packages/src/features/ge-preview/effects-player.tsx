import '../ge-runtime/register-plugins';
import { useEffect, useRef, useState } from 'react';
import { Player, AssetManager } from '@galacean/effects';
import type { Scene } from '@galacean/effects';
import { useDebouncedFitSize } from '../../components/use-debounced-fit-size';
import { readGESceneMetadata } from './read-scene-metadata';

interface EffectsPlayerProps {
  effectsData: Record<string, unknown> | null;
  width: number;
  height: number;
  showInfo?: boolean;
  onReady?: () => void;
  fitContainer?: boolean;
  background?: string;
}

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

export default function EffectsPlayer({
  effectsData,
  width,
  height,
  showInfo = false,
  onReady,
  fitContainer = false,
  background,
}: EffectsPlayerProps) {
  const frameWrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [statusMsg, setStatusMsg] = useState('等待转换...');
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeedState] = useState(1);

  useEffect(() => {
    let cancelled = false;

    if (playerRef.current) {
      playerRef.current.dispose();
      playerRef.current = null;
    }

    if (!containerRef.current || !effectsData) {
      setLoadStatus('idle');
      setStatusMsg('等待转换...');

      return;
    }

    const player = new Player({
      container: containerRef.current,
      pixelRatio: window.devicePixelRatio,
    });

    playerRef.current = player;

    setLoadStatus('loading');
    setStatusMsg('正在加载资源...');

    const assetManager = new AssetManager({ timeout: 10000 });

    assetManager
      .loadScene(structuredClone(effectsData) as Scene.LoadType, player.renderer)
      .then(scene => {
        if (cancelled) {return;}
        setStatusMsg('正在渲染场景...');

        return player.loadScene(scene, { autoplay: false, timeout: 10000 });
      })
      .then(composition => {
        if (cancelled || !composition) {return;}
        player.play();
        setLoadStatus('success');
        setStatusMsg('渲染成功');
        setIsPlaying(true);
        onReady?.();
      })
      .catch(err => {
        if (cancelled) {return;}
        setLoadStatus('error');
        setStatusMsg((err as Error).message);
        console.error('Effects render error:', err);
      });

    return () => {
      cancelled = true;
      player.dispose();
      playerRef.current = null;
    };
  }, [effectsData]);

  const togglePlay = () => {
    const p = playerRef.current;

    if (!p) {return;}
    if (isPlaying) {
      p.pause();
      setIsPlaying(false);
    } else {
      void p.resume();
      setIsPlaying(true);
    }
  };

  const restart = () => {
    const p = playerRef.current;

    if (!p) {return;}
    p.gotoAndPlay(0);
    if (!isPlaying) {
      void playerRef.current!.resume();
      setIsPlaying(true);
    }
  };

  const handleSpeedChange = (newSpeed: number) => {
    setSpeedState(newSpeed);
    const p = playerRef.current;

    if (!p) {return;}
    p.setSpeed(newSpeed);
  };

  const statusColor =
    loadStatus === 'error'
      ? 'text-[var(--coral)]'
      : loadStatus === 'success'
        ? 'text-[var(--cyan)]'
        : 'text-[var(--color-text-secondary)]';

  const metadata = readGESceneMetadata(effectsData);

  const frameSize = useDebouncedFitSize(frameWrapRef, width, height, fitContainer);

  return (
    <div ref={frameWrapRef} className={`flex flex-col items-center gap-2 ${fitContainer ? 'w-full min-w-0' : ''}`}>
      <div
        className="ui-player-frame relative overflow-hidden border border-[var(--border)] bg-[var(--s1)]"
        data-empty={effectsData == null}
        style={frameSize}
      >
        <div ref={containerRef}
          className={`absolute inset-0 [&_canvas]:!h-full [&_canvas]:!w-full ${background == null ? 'bg-black' : ''}`}
          style={background == null ? undefined : { background }} />
        {!effectsData && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] leading-[1.45] text-[var(--color-text-secondary)]">
            等待转换...
          </div>
        )}
      </div>

      <div className={`text-[12px] leading-[1.4] ${statusColor}`}>{statusMsg}</div>

      {loadStatus === 'success' && (
        <div className="flex items-center gap-2">
          <button onClick={togglePlay} className="ui-btn ui-btn-icon" title={isPlaying ? '暂停' : '播放'}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button onClick={restart} className="ui-btn ui-btn-icon" title="重新播放">
            ↺
          </button>
          <select
            value={speed}
            onChange={e => handleSpeedChange(parseFloat(e.target.value))}
            className="ui-select cursor-pointer px-2 py-1 text-[12px] leading-[1.4]"
          >
            <option value="0.25">0.25x</option>
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
        </div>
      )}

      {showInfo && effectsData && loadStatus === 'success' && (
        <div className="ui-card-compact mt-1 grid w-full max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-[12px] leading-[1.4] text-[var(--color-text-primary)]">
          <span className="text-[var(--color-text-secondary)]">版本</span>
          <span>{metadata.version ?? '未知'}</span>
          <span className="text-[var(--color-text-secondary)]">时长</span>
          <span>
            {metadata.duration == null ? '未知' : `${metadata.duration.toFixed(2)}s`}
          </span>
          <span className="text-[var(--color-text-secondary)]">合成数</span>
          <span>{metadata.compositions}</span>
          <span className="text-[var(--color-text-secondary)]">图层数</span>
          <span>{metadata.items + metadata.nestedLayers}</span>
        </div>
      )}
    </div>
  );
}
