import { describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const preservedData = {
    textDataByLayerId: new Map(), paintAnimationsByLayerId: new Map(), shapeAnimationsByLayerId: new Map(),
  };
  const ir = { format: 'animation-ir' };
  const data = { type: 'ge' };
  const warnings = [{ code: 'test_warning' }];
  const context = { ir, preservedData, warnings: [] };

  return {
    context, ir, data, warnings,
    splitSVG: vi.fn(() => context),
    convertSVGToGE: vi.fn(() => ({ data, warnings })),
  };
});

vi.mock('@galacean/svg2ir', () => ({
  splitSVG: mock.splitSVG, convertSVGToGE: mock.convertSVGToGE, inferNumericWeightFromFamily: vi.fn(),
}));

import { convertSVGToEffects } from '../src/features/frame-comparison/core/svg2ge-shared';

describe('SVG frame comparison conversion', () => {
  it('reuses the parsed context for GE conversion with the same options', () => {
    const measureText = vi.fn(() => ({ width: 10 }));
    const options = { measureText, frameRate: 24, resourceBaseUrl: 'https://example.com/design.svg' };
    const source = '<svg width="10" height="10"/>';
    const result = convertSVGToEffects(source, options);

    expect(mock.splitSVG).toHaveBeenCalledExactlyOnceWith(source, options);
    expect(mock.convertSVGToGE).toHaveBeenCalledExactlyOnceWith(mock.context, options);
    expect(result).toEqual({ data: mock.data, ir: mock.ir, warnings: mock.warnings });
  });
});
