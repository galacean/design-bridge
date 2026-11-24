import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRasterizeSVG } from '../../../src/svg-rasterizer/rasterize-svg';

afterEach(() => vi.unstubAllGlobals());

describe('SVG rasterization environment', () => {
  it('does not treat a document or svgdom-style window as a browser renderer', () => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('window', { document: {} });

    expect(canRasterizeSVG()).toBe(false);
  });
});
