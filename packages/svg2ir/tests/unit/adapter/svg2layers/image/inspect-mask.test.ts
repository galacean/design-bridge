import { describe, expect, it } from 'vitest';
import type { IRBezierPath, IRMask } from '@galacean/animation-ir';
import { maskCoversImage } from '../../../../../src/adapter/svg2layers/converter/image/inspect-mask';

const bounds = { x: 10, y: 20, width: 40, height: 30 };
const rectangle: IRBezierPath = {
  points: [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 50 }, { x: 10, y: 50 }],
  inTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
  outTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
  closed: true,
};

function buildMask(path: IRBezierPath = rectangle): IRMask {
  return { path, mode: 'add' };
}

describe('Image mask coverage', () => {
  it('accepts opaque additive and intersecting rectangles that enclose the image', () => {
    const larger = { ...rectangle, points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }] };

    expect(maskCoversImage(buildMask(), bounds)).toBe(true);
    expect(maskCoversImage({ ...buildMask(larger), mode: 'intersect' }, bounds)).toBe(true);
    expect(maskCoversImage(buildMask({ ...rectangle, points: [...rectangle.points].reverse() }), bounds)).toBe(true);
  });

  it.each([
    { ...buildMask(), mode: 'subtract' as const },
    { ...buildMask(), inverted: true },
    buildMask({ ...rectangle, closed: false }),
    buildMask({ ...rectangle, inTangents: [{ x: 1, y: 0 }, ...rectangle.inTangents.slice(1)] }),
    buildMask({ ...rectangle, points: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 50 }, { x: 10, y: 50 }] }),
    buildMask({ ...rectangle, points: [{ x: 10, y: 20 }, { x: 50, y: 50 }, { x: 50, y: 20 }, { x: 10, y: 50 }] }),
    buildMask({ ...rectangle, points: [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 50 }] }),
  ])('preserves masks with clipping, inversion, curves or degenerate geometry (%#)', mask => {
    expect(maskCoversImage(mask, bounds)).toBe(false);
  });
});
