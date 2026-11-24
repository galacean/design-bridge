import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSONScene } from '@galacean/effects-specification';
import { saveToVideo } from '../src/features/ge-video/save-video';

const mocks = vi.hoisted(() => ({
  createPlayer: vi.fn(),
  drawImage: vi.fn(),
  fillRect: vi.fn(),
  exec: vi.fn().mockResolvedValue(0),
  load: vi.fn(),
  terminate: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
}));

vi.mock('../src/features/ge-runtime/register-plugins', () => ({}));

vi.mock('@galacean/effects', () => ({
  Player: class {
    constructor(config: unknown) {
      return mocks.createPlayer(config);
    }
  },
}));
vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    load = mocks.load;
    exec = mocks.exec;
    writeFile = vi.fn().mockResolvedValue(undefined);
    readFile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    deleteFile = vi.fn().mockResolvedValue(undefined);
    terminate = mocks.terminate;
  },
}));

describe('GE video export', () => {
  const source = {
    compositionId: 'main',
    compositions: [{ id: 'main', previewSize: [1080, 570] }],
  } as JSONScene;
  const context = {
    fillStyle: '',
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: (x: number, y: number, width: number, height: number) => {
      mocks.fillRect(context.fillStyle, x, y, width, height);
    },
    drawImage: mocks.drawImage,
  };
  const outputCanvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['frame'])),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockReset().mockResolvedValue(undefined);
    mocks.exec.mockReset().mockResolvedValue(0);
    mocks.createObjectURL.mockImplementation(() => `blob:encoder-${mocks.createObjectURL.mock.calls.length}`);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(mocks.createObjectURL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(mocks.revokeObjectURL);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('encoder')));
    outputCanvas.width = 0;
    outputCanvas.height = 0;
    context.fillStyle = '';
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn() },
      createElement: (tag: string) => tag === 'canvas' ? outputCanvas : {
        style: { cssText: '', width: '', height: '' },
        remove: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['load', 'encode'] as const)('releases the encoder and its resource URLs after a %s failure', async phase => {
    const dispose = vi.fn();

    mocks.createPlayer.mockReturnValue({
      canvas: { width: 2160, height: 1140 },
      gpuCapability: { detail: { maxTextureSize: 8192 } },
      engine: { displayServer: { setSize: vi.fn() } },
      loadScene: vi.fn().mockResolvedValue({ getDuration: () => 1 / 30, gotoAndStop: vi.fn() }),
      pause: vi.fn(), dispose,
    });
    if (phase === 'load') {
      mocks.load.mockRejectedValue(new Error('Encoder load failed'));
    } else {
      mocks.exec.mockResolvedValue(1);
    }

    await expect(saveToVideo(source, { onLog: vi.fn() })).rejects.toThrow();
    expect(mocks.terminate).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(mocks.revokeObjectURL.mock.calls.map(([url]) => url).sort())
      .toEqual(mocks.createObjectURL.mock.results.map(result => result.value as string).sort());
    expect(mocks.revokeObjectURL).toHaveBeenCalledTimes(3);
  });

  it('terminates an active encode on cancellation', async () => {
    const controller = new AbortController();
    const dispose = vi.fn();

    mocks.createPlayer.mockReturnValue({
      canvas: { width: 2160, height: 1140 },
      gpuCapability: { detail: { maxTextureSize: 8192 } },
      engine: { displayServer: { setSize: vi.fn() } },
      loadScene: vi.fn().mockResolvedValue({ getDuration: () => 1 / 30, gotoAndStop: vi.fn() }),
      pause: vi.fn(), dispose,
    });
    mocks.exec.mockImplementation((_args, _timeout, { signal }: { signal: AbortSignal }) => new Promise<number>(
      (_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError'))),
    ));
    const exporting = saveToVideo(source, { signal: controller.signal, onLog: vi.fn() });

    await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalled());
    controller.abort();
    await expect(exporting).rejects.toThrow('Cancelled');
    expect(mocks.terminate).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it.each([0, NaN, Infinity, -1])('rejects an invalid frame rate %j before allocating a player', async fps => {
    await expect(saveToVideo(source, { fps })).rejects.toThrow('fps');
    expect(mocks.createPlayer).not.toHaveBeenCalled();
  });

  it.each([
    { options: {}, width: 1080, height: 570, limit: 8192, renderWidth: 2160, renderHeight: 1140 },
    { options: { width: 1280, height: 720 }, width: 1280, height: 720,
      limit: 8192, renderWidth: 2560, renderHeight: 1440 },
    { options: {}, width: 1080, height: 570, limit: 2048, renderWidth: 2048, renderHeight: 1081 },
  ])('captures $renderWidth × $renderHeight into $width × $height', async testCase => {
    const canvas = { width: 2, height: 2 };

    mocks.createPlayer.mockImplementation((config: {
      container: { style: { width: string; height: string } };
      pixelRatio: number;
    }) => {
      // The runtime must see the output dimensions during construction.
      expect(config.container.style.width).toBe(`${testCase.width}px`);
      expect(config.container.style.height).toBe(`${testCase.height}px`);
      expect(config.pixelRatio).toBe(2);

      return {
        canvas,
        gpuCapability: { detail: { maxTextureSize: testCase.limit } },
        engine: {
          displayServer: {
            setSize: (width: number, height: number) => Object.assign(canvas, { width, height }),
          },
        },
        loadScene: vi.fn().mockResolvedValue({ getDuration: () => 1 / 30, gotoAndStop: vi.fn() }),
        pause: vi.fn(),
        dispose: vi.fn(),
      };
    });

    const blob = await saveToVideo(source, { ...testCase.options, onLog: vi.fn() });

    expect(blob.type).toBe('video/mp4');
    expect(outputCanvas).toMatchObject({ width: testCase.width, height: testCase.height });
    expect(mocks.drawImage).toHaveBeenCalledWith(
      canvas, 0, 0, testCase.renderWidth, testCase.renderHeight, 0, 0, testCase.width, testCase.height,
    );
    expect(mocks.exec.mock.calls[0][0]).toEqual(expect.arrayContaining(['-crf', '18']));
  });

  it.each([
    { background: undefined, fills: ['black'] },
    { background: '', fills: ['black'] },
    { background: '   ', fills: ['black'] },
    { background: '#ffffff', fills: ['black', '#ffffff'] },
    { background: 'rgba(255, 0, 0, 0.5)', fills: ['black', 'rgba(255, 0, 0, 0.5)'] },
  ])('composites $background over an opaque matte before capturing the frame', async ({ background, fills }) => {
    mocks.createPlayer.mockReturnValue({
      canvas: { width: 2160, height: 1140 },
      gpuCapability: { detail: { maxTextureSize: 8192 } },
      engine: { displayServer: { setSize: vi.fn() } },
      loadScene: vi.fn().mockResolvedValue({ getDuration: () => 1 / 30, gotoAndStop: vi.fn() }),
      pause: vi.fn(),
      dispose: vi.fn(),
    });

    await saveToVideo(source, { background, onLog: vi.fn() });

    expect(mocks.fillRect.mock.calls).toEqual(fills.map(color => [color, 0, 0, 1080, 570]));
    expect(mocks.fillRect.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.drawImage.mock.invocationCallOrder[0]);
  });
});
