import { describe, expect, it, vi } from 'vitest';
import { convertSVGToGE, convertSVGToIR, convertSVGToLayers, splitSVG } from '@galacean/svg2ir';
import * as treePath from '../../../src/parse-svg/build-element-tree-path';

const wrap = (content: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">${content}</svg>`;

describe('optional SVG source collectors', () => {
  it.each(['ir', 'ge'] as const)('does not calculate element paths during %s export', mode => {
    const spy = vi.spyOn(treePath, 'buildElementTreePath');

    try {
      if (mode === 'ir') {
        convertSVGToIR(wrap('<rect width="40" height="30"/>'));
      } else {
        convertSVGToGE(wrap('<rect width="40" height="30"/>'));
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it.each(['mask', 'clipPath'])('retains the GE parser diagnostic for a standalone %s declaration', tag => {
    const source = wrap(`<${tag} id="definition"><rect width="40" height="30"/></${tag}>`);
    const result = convertSVGToGE(source);

    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'svg2ir_element_dropped', elementSelector: `${tag.toLowerCase()}#definition`,
    }));
    expect(() => convertSVGToGE(source, { strict: true })).toThrow();
  });

  it.each(['mask', 'clipPath'])('retains the shared parser diagnostic for a standalone %s declaration', tag => {
    const source = wrap(`<${tag} id="definition"><rect width="40" height="30"/></${tag}>`);
    const split = splitSVG(source);

    expect(split.warnings).toContainEqual(expect.objectContaining({
      code: 'svg2ir_element_dropped', elementSelector: `${tag.toLowerCase()}#definition`,
    }));
    expect(() => convertSVGToIR(source, { strict: true })).toThrow();
  });

  it.each(['mask', 'clipPath'])('handles declaration-only %s diagnostics in layers output', async tag => {
    const source = wrap(`<${tag} id="definition"><rect width="40" height="30"/></${tag}>`);
    const result = await convertSVGToLayers(source, { strict: true });

    expect(result.data).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
