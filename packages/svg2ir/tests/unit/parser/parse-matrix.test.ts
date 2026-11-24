import { describe, expect, it } from 'vitest';
import { accumulateAncestors, transformPoint } from '../../../src/svg2ir/matrix';

describe('accumulateAncestors root viewport', () => {
  it('parses px viewport lengths before applying viewBox scaling', () => {
    const root = {
      tagName: 'svg',
      getAttribute: (name: string) => ({
        viewBox: '0 0 100 100',
        width: '50px',
        height: '50px',
      } as Record<string, string>)[name] ?? null,
      parentNode: null,
    };
    const element = { node: { parentNode: root } };
    const matrix = accumulateAncestors(element);

    expect(transformPoint(matrix, 80, 50)).toEqual({ x: 40, y: 25 });
    expect(matrix.a).toBe(0.5);
    expect(matrix.d).toBe(0.5);
  });
});
