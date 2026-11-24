import lottie from 'lottie-web';
import type { AnimationItem } from 'lottie-web';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const CAPTURE_TIMEOUT_MS = 10000;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read Lottie image asset'));
    reader.readAsDataURL(blob);
  });
}

async function fetchImageDataUrl(url: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to inline Lottie image asset: HTTP ${response.status} ${url}`);
  }

  return blobToDataUrl(await response.blob());
}

function loadSvgImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error('Timed out while rasterizing Lottie SVG'));
    }, CAPTURE_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
    };

    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('Failed to rasterize Lottie SVG'));
    };
    image.src = url;
  });
}

/**
 * 封装 lottie-web SVG 模式渲染器，用于帧对比测试。
 *
 * lottie-web Canvas renderer 会把 subtract/intersect mask 当作普通 clip path，
 * 无法作为这些 Lottie 特性的可靠基准。这里使用与 lottie2ge 预览一致的 SVG
 * renderer，再将当前 SVG 栅格化到固定尺寸 Canvas，保持后续像素管线一致。
 */
export class LottieRenderer {
  private container: HTMLDivElement;
  private anim: AnimationItem | null = null;
  private svg: SVGSVGElement | null = null;
  private captureCanvas: HTMLCanvasElement;
  private captureContext: CanvasRenderingContext2D;
  private imageDataUrlCache = new Map<string, Promise<string>>();
  private width: number;
  private height: number;

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

    const captureCanvas = document.createElement('canvas');

    captureCanvas.width = width;
    captureCanvas.height = height;

    const captureContext = captureCanvas.getContext('2d');

    if (!captureContext) {
      container.remove();
      throw new Error('Canvas 2D context is unavailable for Lottie SVG capture');
    }

    this.container = container;
    this.captureCanvas = captureCanvas;
    this.captureContext = captureContext;
    this.width = width;
    this.height = height;
  }

  async load(animationData: Record<string, unknown>): Promise<void> {
    this.destroy();

    return new Promise<void>((resolve, reject) => {
      const anim = lottie.loadAnimation({
        container: this.container,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData,
        rendererSettings: {
          preserveAspectRatio: 'xMidYMid meet',
        },
      });

      this.anim = anim;

      const cleanupCallbacks: Array<() => void> = [];
      let timer = 0;

      const cleanup = () => {
        window.clearTimeout(timer);
        for (const removeListener of cleanupCallbacks) {
          removeListener();
        }
      };
      const fail = (message: string) => {
        cleanup();
        reject(new Error(message));
      };

      timer = window.setTimeout(() => fail('Timed out while loading Lottie SVG'), CAPTURE_TIMEOUT_MS);

      cleanupCallbacks.push(
        anim.addEventListener('DOMLoaded', () => {
          const svg = this.container.querySelector('svg');

          if (!(svg instanceof SVGSVGElement)) {
            fail('Lottie SVG renderer did not create an SVG element');

            return;
          }

          cleanup();
          this.svg = svg;
          resolve();
        }),
        anim.addEventListener('data_failed', () => fail('Lottie SVG data failed to load')),
        anim.addEventListener('error', () => fail('Lottie SVG renderer failed')),
      );
    });
  }

  /** 跳转到指定时间（秒） */
  gotoTime(seconds: number): void {
    if (!this.anim) {
      return;
    }
    // goToAndStop 第二个参数 false 表示使用毫秒为单位
    this.anim.goToAndStop(seconds * 1000, false);
  }

  /** 获取动画总时长（秒） */
  getDuration(): number {
    if (!this.anim) {
      return 0;
    }

    return this.anim.getDuration(false);
  }

  /**
   * 获取当前 SVG 帧的 data URL (PNG)。
   * 外链图片先内联，避免序列化 SVG 在 Canvas 栅格化时丢失跨域资源。
   */
  async toDataUrl(): Promise<string> {
    if (!this.svg) {
      throw new Error('Lottie SVG is not ready for capture');
    }

    const svg = this.svg.cloneNode(true) as SVGSVGElement;

    svg.setAttribute('xmlns', SVG_NAMESPACE);
    svg.setAttribute('xmlns:xlink', XLINK_NAMESPACE);
    svg.setAttribute('width', String(this.width));
    svg.setAttribute('height', String(this.height));
    await this.inlineSvgImages(svg);

    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);

    try {
      const image = await loadSvgImage(objectUrl);

      this.captureContext.setTransform(1, 0, 0, 1, 0, 0);
      this.captureContext.clearRect(0, 0, this.width, this.height);
      this.captureContext.drawImage(image, 0, 0, this.width, this.height);

      return this.captureCanvas.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  private async inlineSvgImages(svg: SVGSVGElement): Promise<void> {
    const images = Array.from(svg.querySelectorAll('image'));

    await Promise.all(
      images.map(async image => {
        const href = image.getAttribute('href') ?? image.getAttributeNS(XLINK_NAMESPACE, 'href');

        if (!href || href.startsWith('data:') || href.startsWith('#')) {
          return;
        }

        const absoluteUrl = new URL(href, document.baseURI).href;
        let dataUrlPromise = this.imageDataUrlCache.get(absoluteUrl);

        if (!dataUrlPromise) {
          dataUrlPromise = fetchImageDataUrl(absoluteUrl);
          this.imageDataUrlCache.set(absoluteUrl, dataUrlPromise);
        }

        const dataUrl = await dataUrlPromise;

        image.setAttribute('href', dataUrl);
        image.setAttributeNS(XLINK_NAMESPACE, 'href', dataUrl);
      }),
    );
  }

  private destroy(): void {
    if (this.anim) {
      this.anim.destroy();
      this.anim = null;
    }
    this.svg = null;
    this.imageDataUrlCache.clear();
  }

  dispose(): void {
    this.destroy();
    this.captureCanvas.remove();
    this.container.remove();
  }
}
