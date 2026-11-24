import '../../ge-runtime/register-plugins';
import { Player, AssetManager } from '@galacean/effects';
import { withSeededRandom } from './with-seeded-random';

/**
 * 封装 GE Player 渲染器，用于帧对比测试。
 * 使用 manualRender + willCaptureImage + pixelRatio=1。
 */
export class EffectsRenderer {
  private canvas: HTMLCanvasElement;
  private container: HTMLDivElement;
  private player: Player | null = null;

  constructor(width: number, height: number) {
    const container = document.createElement('div');

    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    container.style.overflow = 'hidden';
    container.style.backgroundColor = 'black';
    document.body.appendChild(container);

    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;
    container.appendChild(canvas);

    this.container = container;
    this.canvas = canvas;
  }

  async load(sceneData: Record<string, unknown>): Promise<void> {
    this.destroyPlayer();

    const player = new Player({
      canvas: this.canvas,
      manualRender: true,
      renderOptions: {
        willCaptureImage: true,
      },
      pixelRatio: 1,
    });

    this.player = player;

    const assetManager = new AssetManager({ timeout: 10000 });
    const scene = await assetManager.loadScene(sceneData, player.renderer);

    await player.loadScene(scene, {
      autoplay: false,
      timeout: 10000,
    });

    // `loadScene` may leave load-time mask/texture state on the canvas. An
    // explicit manual seek makes the first captured t=0 image deterministic.
    withSeededRandom(() => player.gotoAndStop(0));
  }

  /** 跳转到指定时间（秒） */
  gotoTime(seconds: number): void {
    if (!this.player) {
      return;
    }
    const player = this.player;

    withSeededRandom(() => player.gotoAndStop(seconds));
  }

  /** 获取动画总时长（秒） */
  getDuration(): number {
    if (!this.player) {
      return 0;
    }
    const compositions = this.player.getCompositions();

    if (compositions.length === 0) {
      return 0;
    }

    return compositions[0].getDuration();
  }

  /**
   * 获取当前帧的 data URL (PNG)。
   * 对比时两侧都用 toDataUrl → 统一 Canvas 2D 管线读取像素，
   * 避免 WebGL readPixels 与 Canvas 2D getImageData 的 premultiplied alpha 差异。
   */
  toDataUrl(): string {
    return this.canvas.toDataURL('image/png');
  }

  private destroyPlayer(): void {
    if (this.player) {
      this.player.dispose();
      this.player = null;
    }
  }

  dispose(): void {
    this.destroyPlayer();
    this.canvas.remove();
    this.container.remove();
  }
}
