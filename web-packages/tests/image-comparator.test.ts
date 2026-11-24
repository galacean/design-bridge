import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { measureLocalDiffDensity } from '../src/features/frame-comparison/core/local-diff-density';
import { compareDataUrls } from '../src/features/frame-comparison/core/image-comparator';
import { isFramePass } from '../src/features/frame-comparison/core/frame-comparison-config';

vi.mock('../src/features/frame-comparison/core/local-diff-density', () => ({
  measureLocalDiffDensity: vi.fn(() => 0.75),
}));

describe('frame comparison visibility', () => {
  const size = 64;
  const inputs = new Map<string, Uint8ClampedArray>();
  let heatmap: Uint8ClampedArray;

  function square(color: number[], alpha: number) {
    const pixels = new Uint8ClampedArray(size * size * 4);

    for (let y = 12; y < 52; y++) {
      for (let x = 12; x < 52; x++) {
        pixels.set([...color, alpha], (y * size + x) * 4);
      }
    }

    return pixels;
  }

  beforeEach(() => {
    inputs.clear();
    heatmap = new Uint8ClampedArray();
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      url = '';
      set src(value: string) {
        this.url = value;
        queueMicrotask(() => this.onload?.());
      }
    });
    vi.stubGlobal('document', {
      createElement: () => {
        let pixels: Uint8ClampedArray = new Uint8ClampedArray();

        return {
          getContext: () => ({
            drawImage: (image: { url?: string; pixels?: Uint8ClampedArray }) => {
              pixels = image.pixels ?? inputs.get(image.url ?? '') ?? pixels;
            },
            getImageData: () => ({ data: pixels }),
            createImageData: () => ({ data: new Uint8ClampedArray(size * size * 4) }),
            putImageData: (data: { data: Uint8ClampedArray }) => { heatmap = data.data; },
          }),
          toDataURL: () => 'data:image/png;heatmap',
        };
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('skips local difference work unless the caller requests it', async () => {
    inputs.set('A', square([240, 80, 40], 255));
    inputs.set('B', square([240, 80, 40], 255));
    const result = await compareDataUrls('A', 'B', size, size);

    expect(measureLocalDiffDensity).not.toHaveBeenCalled();
    expect(result.localDiffDensity).toBeUndefined();
    expect(result).not.toHaveProperty('localDiffDensity');
    expect(isFramePass(result)).toBe(true);
  });

  it('includes local differences when requested and applies their threshold', async () => {
    inputs.set('A', square([240, 80, 40], 255));
    inputs.set('B', square([240, 80, 40], 255));
    const result = await compareDataUrls('A', 'B', size, size, { localDiffDensity: true });

    expect(measureLocalDiffDensity).toHaveBeenCalledOnce();
    expect(result.localDiffDensity).toBe(0.75);
    expect(isFramePass(result)).toBe(false);
  });

  it.each([{ color: [240, 80, 40] }, { color: [0, 0, 0] }])('detects opacity changes for RGB $color', async ({ color }) => {
    inputs.set('A', square(color, 255));
    inputs.set('B', square(color, 64));
    const result = await compareDataUrls('A', 'B', size, size);

    expect(isFramePass(result)).toBe(false);
    expect(result.pixelDiffRatio).toBe(1600 / (size * size));
    expect(heatmap[(32 * size + 32) * 4 + 3]).toBeGreaterThan(0);
  });

  it('ignores RGB values that are invisible in fully transparent pixels', async () => {
    inputs.set('A', square([255, 0, 0], 0));
    inputs.set('B', square([0, 255, 255], 0));
    const result = await compareDataUrls('A', 'B', size, size);

    expect(isFramePass(result)).toBe(true);
    expect(result.pixelDiffRatio).toBe(0);
    expect(result.fullSsim).toBeCloseTo(1);
  });

  it('retains tolerance for small antialiasing differences', async () => {
    inputs.set('A', square([240, 80, 40], 255));
    inputs.set('B', square([240, 80, 40], 245));

    expect(isFramePass(await compareDataUrls('A', 'B', size, size))).toBe(true);
  });

});
