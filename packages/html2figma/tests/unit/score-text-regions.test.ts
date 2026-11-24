import { describe, expect, it } from 'vitest';
import { scoreTextRegions } from '../helpers/score-text-regions';

describe('visible DOM text region scoring', () => {
  const width = 32, height = 8;
  const pixels = Array.from({ length: width * height }, (_, index) => index % 2);
  const reference = { width, height, pixels };
  const clipped = { width, height, pixels: pixels.map((value, index) => index % width < 8 ? value : 1) };

  it('detects clipping outside an unchanged host box', () => {
    const host = [{ x: 0, y: 0, width: 8, height }];
    const visibleText = [{ x: 0, y: 0, width, height }];

    expect(scoreTextRegions(reference, clipped, host)).toBe(100);
    expect(scoreTextRegions(reference, clipped, visibleText)).toBeLessThan(50);
    expect(scoreTextRegions(reference, reference, visibleText)).toBe(100);
  });

  it('does not penalize content outside independently clipped reference regions', () => {
    expect(scoreTextRegions(reference, clipped, [{ x: 0, y: 0, width: 8, height }])).toBe(100);
  });

  it('reports absent regions as N/A and rejects mismatched images', () => {
    expect(scoreTextRegions(reference, clipped, [])).toBeNull();
    expect(() => scoreTextRegions(reference, { ...clipped, width: 1 }, [])).toThrow('matching');
  });
});
