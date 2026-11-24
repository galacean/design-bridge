import { describe, expect, it } from 'vitest';
import { measureLocalDiffDensity } from './local-diff-density';
import { isFramePass } from './frame-comparison-config';

function image(width: number, height: number) {
  return new Uint8Array(width * height * 4).fill(255);
}

describe('local difference density', () => {
  it('detects a small missing block that full-image metrics can dilute', () => {
    const source = image(512, 512);
    const target = source.slice();

    for (let y = 100; y < 150; y++) {
      for (let x = 100; x < 150; x++) {
        target.fill(0, (y * 512 + x) * 4, (y * 512 + x) * 4 + 3);
      }
    }
    const density = measureLocalDiffDensity(source, target, 512, 512);

    expect(density).toBe(2500 / 64 ** 2);
    expect(isFramePass({ fullSsim: 1, coreRoiSsim: 1, blurredSsim: 1, pixelDiffRatio: 2500 / 512 ** 2,
      localDiffDensity: density })).toBe(false);
  });

  it.each([[8, 20], [20, 8], [64, 64]])('normalizes small %sx%s images to the clamped window', (width, height) => {
    const source = image(width, height);
    const target = source.slice();

    for (let i = 0; i < target.length; i += 4) { target.fill(0, i, i + 3); }
    expect(measureLocalDiffDensity(source, target, width, height)).toBe(1);
    expect(measureLocalDiffDensity(source, source, width, height)).toBe(0);
  });

  it('ignores color changes in fully transparent pixels', () => {
    const source = new Uint8Array(96 * 96 * 4);
    const target = source.slice();

    for (let index = 0; index < target.length; index += 4) {
      target.set([37, 170, 241], index);
    }
    expect(measureLocalDiffDensity(source, target, 96, 96)).toBe(0);
  });

  it('compares distinct opaque colors that share a cache slot', () => {
    const source = image(8, 8);
    const target = image(8, 8);

    for (let index = 0; index < source.length; index += 4) {
      source.set([0, 0, 0], index);
      target.set([1, 0, 140], index);
    }
    expect(measureLocalDiffDensity(source, target, 8, 8)).toBe(1);
  });

  it('preserves antialias handling for shifted translucent edges', () => {
    const size = 96;
    const circle = (centerX: number) => {
      const pixels = new Uint8Array(size * size * 4);

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const index = (y * size + x) * 4;
          const alpha = Math.round(255 * Math.max(0, Math.min(1, 26 - Math.hypot(x - centerX, y - 48))));

          pixels.set([35, 80, 150, alpha], index);
        }
      }

      return pixels;
    };

    expect(measureLocalDiffDensity(circle(48), circle(49), size, size)).toBe(2 / 64 ** 2);
  });

  it('rejects invalid dimensions', () => {
    expect(() => measureLocalDiffDensity(new Uint8Array(), new Uint8Array(), 0, 1)).toThrow(RangeError);
  });
});
