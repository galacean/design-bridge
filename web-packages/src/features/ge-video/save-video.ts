import '../ge-runtime/register-plugins';
import { Player } from '@galacean/effects';
import type { Composition } from '@galacean/effects';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { JSONScene } from '@galacean/effects-specification';
import { readGESceneMetadata } from '../ge-preview/read-scene-metadata';

export interface SaveVideoOptions {
  width?: number;
  height?: number;
  fps?: number;
  background?: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  onLog?: (message: string) => void;
}

/** FFmpeg WASM CDN 配置 */
const FFMPEG_CDN = {
  CLASSWORKER: 'https://mdn.alipayobjects.com/rms/uri/file/as/ffmpeg/core/0.12.10/dist/worker.js',
  CORE: 'https://gw.alipayobjects.com/os/lib/ffmpeg/core/0.12.10/dist/esm/ffmpeg-core.js',
  WASM: 'https://gw.alipayobjects.com/os/lib/ffmpeg/core/0.12.10/dist/esm/ffmpeg-core.wasm',
};

/**
 * 将 GE 场景渲染为 MP4 视频（浏览器端）
 *
 * 流程：
 * 1. 创建隐藏容器 + GE Player 加载场景
 * 2. 逐帧 gotoAndStop → 等待视频帧 seek 完成 → canvas 截图 → 写入 FFmpeg WASM 虚拟文件系统
 * 3. FFmpeg WASM 编码输出 MP4
 * 4. 返回视频的 Blob 对象
 *
 * @param source - GE JSON 对象（JSONScene）
 * @param options - 视频输出配置。`width/height` 不传时会优先读取 `source.compositions[compositionId].previewSize`。
 * @returns 视频文件的 Blob（MP4 格式）
 * @throws 当 GE 场景加载失败、FFmpeg 初始化失败或编码失败时抛出 Error。
 *
 * @example
 * ```ts
 * import { saveToVideo } from './save-video';
 *
 * const videoBlob = await saveToVideo(scene, {
 *   fps: 30,
 *   background: 'black',
 * });
 *
 * // 下载视频
 * const url = URL.createObjectURL(videoBlob);
 * const a = document.createElement('a');
 * a.href = url;
 * a.download = 'output.mp4';
 * a.click();
 * URL.revokeObjectURL(url);
 * ```
 */
export async function saveToVideo(source: JSONScene | Record<string, unknown>, options: SaveVideoOptions = {}): Promise<Blob> {
  const sceneSize = getVideoSizeFromSource(source);
  const { width = sceneSize.width, height = sceneSize.height, fps = 30, background, onProgress, signal } = options;

  signal?.throwIfAborted();
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 ||
    !Number.isFinite(fps) || fps <= 0) {
    throw new Error('Video dimensions must be positive integers and fps must be finite and greater than 0');
  }

  const onLog = options.onLog ?? console.info;
  const startTime = Date.now();
  const backgroundColor = background?.trim() ?? '';

  // 1. 创建隐藏容器 + GE Player
  const container = document.createElement('div');

  container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;overflow:hidden;';
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  document.body.appendChild(container);

  // 用于合成最终帧的输出 Canvas（叠加背景 + 动画）
  const outputCanvas = document.createElement('canvas');

  outputCanvas.width = width;
  outputCanvas.height = height;

  let player: Player | undefined;
  let composition: Composition | undefined;
  let ffmpeg: FFmpeg | undefined;
  const stopEncoder = () => {
    ffmpeg?.terminate();
    ffmpeg = undefined;
  };

  signal?.addEventListener('abort', stopEncoder, { once: true });

  try {
    player = new Player({
      container,
      pixelRatio: 2,
      transparentBackground: true,
      renderOptions: {
        willCaptureImage: true,
      },
    });

    const playerCanvas = player.canvas;

    // 2. 加载 GE 场景
    onLog('🎬 加载场景...');
    composition = await waitWithSignal(player.loadScene({ ...source }, {
      autoplay: false,
      timeout: 30000,
    }), signal);

    // Keep the viewport and render targets in sync beyond the runtime's default 2048px resize cap.
    const maxSize = player.gpuCapability.detail.maxTextureSize;
    const renderScale = Math.min(2, maxSize / width, maxSize / height);

    player.engine.displayServer.setSize(
      Math.max(1, Math.round(width * renderScale)),
      Math.max(1, Math.round(height * renderScale)),
    );
    onLog(`📐 渲染 ${playerCanvas.width}×${playerCanvas.height} → 视频 ${width}×${height}`);

    const duration = composition.getDuration();

    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Scene duration must be finite and greater than 0');
    }
    const totalFrames = Math.ceil(duration * fps);

    // 收集场景中的视频元素，用于 seek 等待
    const compositionRef = composition as unknown as { videos?: HTMLVideoElement[] };
    const videoElements: HTMLVideoElement[] = compositionRef.videos ?? [];

    // 3. 加载 FFmpeg WASM
    onLog('📦 加载编码器...');
    const encoder = new FFmpeg();

    ffmpeg = encoder;
    await loadFFmpegWasm(encoder, signal);
    signal?.throwIfAborted();

    onLog(`📸 开始渲染 ${totalFrames} 帧（${duration.toFixed(2)}s）...`);

    // 4. 逐帧渲染并写入 FFmpeg 虚拟文件系统
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      signal?.throwIfAborted();
      const currentTime = frameIndex / fps;

      composition.gotoAndStop(currentTime);

      // 等待所有视频元素 seek 完成（视频帧解码可能滞后于 gotoAndStop）
      if (videoElements.length > 0) {
        await waitForVideosSeeked(videoElements, signal);
      }

      // 将 playerCanvas 合成到 outputCanvas（叠加背景）
      drawToOutputCanvas(playerCanvas, outputCanvas, backgroundColor);

      // Canvas → PNG ArrayBuffer
      const frameBuffer = await waitWithSignal(canvasToArrayBuffer(outputCanvas, 'image/png'), signal);
      const fileName = `frame-${padZero(frameIndex + 1, 4)}.png`;

      await encoder.writeFile(fileName, new Uint8Array(frameBuffer), { signal });
      signal?.throwIfAborted();

      // 上报进度
      const progress = (frameIndex + 1) / totalFrames;

      onProgress?.(progress);

      if (frameIndex % 30 === 0 || frameIndex === totalFrames - 1) {
        onLog(`📸 渲染中 ${frameIndex + 1}/${totalFrames}（${(progress * 100).toFixed(0)}%）`);
      }
    }

    // 5. FFmpeg WASM 编码 MP4
    onLog('🎞️ 编码中...');
    const evenWidth = width % 2 === 0 ? width : width + 1;
    const evenHeight = height % 2 === 0 ? height : height + 1;

    const exitCode = await encoder.exec([
      '-framerate',
      String(fps),
      '-i',
      'frame-%4d.png',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-s',
      `${evenWidth}x${evenHeight}`,
      '-vf',
      'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      '-crf',
      '18',
      '-y',
      'output.mp4',
    ], -1, { signal });

    signal?.throwIfAborted();

    if (exitCode !== 0) {
      throw new Error(`FFmpeg encoding failed with exit code ${exitCode}`);
    }

    // 6. 读取输出文件
    const outputData = await encoder.readFile('output.mp4', undefined, { signal });
    const videoBuffer =
      typeof outputData === 'string' ? new TextEncoder().encode(outputData) : new Uint8Array(outputData);

    signal?.throwIfAborted();

    const totalTime = Date.now() - startTime;

    onLog(`🎉 完成！耗时 ${(totalTime / 1000).toFixed(1)}s`);

    return new Blob([videoBuffer], { type: 'video/mp4' });
  } finally {
    signal?.removeEventListener('abort', stopEncoder);
    // Terminating the worker also releases its virtual filesystem.
    stopEncoder();
    if (player) {
      player.pause();
      player.dispose();
    }
    container.remove();
  }
}

// ─── FFmpeg WASM ────────────────────────────────────────────

async function loadFFmpegWasm(ffmpeg: FFmpeg, signal?: AbortSignal): Promise<void> {
  const resourceURLs: string[] = [];

  try {
    const results = await Promise.allSettled([
      [FFMPEG_CDN.CORE, 'text/javascript'],
      [FFMPEG_CDN.WASM, 'application/wasm'],
      [FFMPEG_CDN.CLASSWORKER, 'text/javascript'],
    ].map(async ([url, mime]) => {
      const response = await fetch(url, { signal });

      if (!response.ok) {
        throw new Error(`Failed to load encoder resource: HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();

      signal?.throwIfAborted();
      const objectURL = URL.createObjectURL(new Blob([buffer], { type: mime }));

      resourceURLs.push(objectURL);

      return objectURL;
    }));
    const urls = results.map(result => {
      if (result.status === 'rejected') {
        throw result.reason;
      }

      return result.value;
    });

    signal?.throwIfAborted();
    await ffmpeg.load({ coreURL: urls[0], wasmURL: urls[1], classWorkerURL: urls[2] }, { signal });
  } finally {
    resourceURLs.forEach(url => URL.revokeObjectURL(url));
  }
}

function waitWithSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal == null) {
    return operation;
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Video export aborted', 'AbortError'));

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
    void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

// ─── Canvas 工具 ────────────────────────────────────────────

/**
 * 将 playerCanvas 的内容绘制到 outputCanvas，并叠加背景色
 */
function drawToOutputCanvas(
  playerCanvas: HTMLCanvasElement,
  outputCanvas: HTMLCanvasElement,
  backgroundColor: string,
): void {
  const ctx = outputCanvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get 2d context from output canvas');
  }

  // Flatten alpha before encoding: yuv420p discards it, including antialiased edge coverage.
  ctx.save();
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

  if (backgroundColor !== '') {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  }
  ctx.restore();

  ctx.drawImage(
    playerCanvas,
    0,
    0,
    playerCanvas.width,
    playerCanvas.height,
    0,
    0,
    outputCanvas.width,
    outputCanvas.height,
  );
}

/**
 * 将 Canvas 转换为 ArrayBuffer（PNG 格式）
 */
function canvasToArrayBuffer(canvas: HTMLCanvasElement, mime: string): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) {
          reject(new Error('canvas.toBlob returned null'));
        } else {
          resolve(blob.arrayBuffer());
        }
      },
      mime,
      1,
    );
  });
}

/**
 * 等待所有视频元素 seek 完成
 *
 * gotoAndStop 会触发视频元素的 currentTime 变化，
 * 但视频帧解码是异步的，需要等 seeked 事件或 readyState 就绪后再截图。
 */
function waitForVideosSeeked(videos: HTMLVideoElement[], signal?: AbortSignal): Promise<void> {
  const SEEK_TIMEOUT_MS = 500;

  const promises = videos.map(video => {
    // readyState >= HAVE_CURRENT_DATA 说明当前帧已解码完成
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !video.seeking) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('seeked', onReady);
        video.removeEventListener('canplay', onReady);
        signal?.removeEventListener('abort', onAbort);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException('Video export aborted', 'AbortError'));
      };
      const timer = setTimeout(onReady, SEEK_TIMEOUT_MS);

      video.addEventListener('seeked', onReady, { once: true });
      video.addEventListener('canplay', onReady, { once: true });
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
      }
    });
  });

  return Promise.all(promises).then(() => {});
}

function padZero(num: number, length: number): string {
  return String(num).padStart(length, '0');
}

function getVideoSizeFromSource(scene: JSONScene | Record<string, unknown>): { width: number; height: number } {
  const size = readGESceneMetadata(scene).previewSize;

  return {
    width: size == null ? 720 : Math.max(1, Math.round(size.width)),
    height: size == null ? 1280 : Math.max(1, Math.round(size.height)),
  };
}
