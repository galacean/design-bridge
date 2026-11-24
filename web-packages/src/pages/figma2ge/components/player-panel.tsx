import '../../../features/ge-runtime/register-plugins';
import { useEffect, useRef } from 'react';
import type { spec} from '@galacean/effects';
import { Player } from '@galacean/effects';
import { useDebouncedFitSize } from '../../../components/use-debounced-fit-size';

interface PlayerPanelProps {
  scene: spec.JSONScene;
}

export default function PlayerPanel({ scene }: PlayerPanelProps) {
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);

  const composition = scene?.compositions.find(d => d.id === scene.compositionId);
  const [width, height] = composition?.previewSize ?? [414, 736];
  const maxHeight = 750;
  const maxWidth = 980;
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  const displayWidth = Math.round(width * scale);
  const displayHeight = Math.round(height * scale);
  const displaySize = useDebouncedFitSize(previewWrapRef, displayWidth, displayHeight, true);

  useEffect(() => {
    if (!containerRef.current || !scene) {return;}

    if (playerRef.current) {
      playerRef.current.dispose();
      playerRef.current = null;
    }

    const player = new Player({
      container: containerRef.current,
      pixelRatio: 2,
    });

    playerRef.current = player;

    console.log('Loading scene into player...', scene);
    void player.loadScene(scene);

    return () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [scene]);

  return (
    <div ref={previewWrapRef} className="ui-card-compact flex min-w-0 justify-center py-2">
      <div className="relative overflow-hidden rounded-[var(--radius-lg)] bg-[var(--s1)]" style={displaySize}>
        <div
          ref={containerRef}
          className="absolute inset-0 h-full w-full [&_canvas]:!h-full [&_canvas]:!w-full"
          style={{ display: scene ? 'block' : 'none' }}
        />
        {!scene && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--color-text-secondary)]">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span className="text-sm">上传 Figma JSON 后自动播放</span>
          </div>
        )}
      </div>
    </div>
  );
}
