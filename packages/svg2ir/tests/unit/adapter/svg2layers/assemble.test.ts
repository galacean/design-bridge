import { describe, expect, it } from 'vitest';
import { splitSVG, type SVGImageLayer } from '@galacean/svg2ir';
import type { BakedLayersResult } from '../../../../src/adapter/svg2layers/baking/build-baked-layers';
import { assembleSVGLayers } from '../../../../src/adapter/svg2layers/assemble';

const measureText = (_font: string, text: string) => ({
  width: text.length * 10, fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 4,
});
const wrap = (content: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">${content}</svg>`;
const buildImage = (url: string): SVGImageLayer => ({
  id: '', type: 'image', role: 'content', bbox: [0, 0, 20, 20], size: [20, 20], rotation: [0, 0, 0],
  url, width: 20, height: 20,
});

describe('native and baked SVG layer assembly', () => {
  it('orders numeric source paths and replaces whole baked subtrees without changing the original IR', () => {
    const split = splitSVG(wrap('<g><rect width="40" height="40"/></g>'
      + '<text x="10" y="60" font-family="Arial" font-size="20">Native</text>'), { measureText });
    const composition = split.ir.compositions[0];
    const before = JSON.stringify(split.ir);
    const shape = composition.layers.find(layer => layer.type === 'shape');
    const text = composition.layers.find(layer => layer.type === 'text');

    if (shape == null || text == null) { throw new Error('Expected source graphic and native text.'); }
    const layerSources = new Map([[shape.id, '1/0'], [text.id, '2']]);
    const baking: BakedLayersResult = {
      layers: [{ path: '10', layer: buildImage('last') }, { path: '1', layer: buildImage('first') }],
      warnings: [], replacesSource: path => path === '1/0', resolvesWarning: () => false,
    };
    const result = assembleSVGLayers({
      context: {
        source: '', ir: split.ir, warnings: [], preservedData: split.preservedData,
        layerSources, warningSources: new Map(),
      },
      options: { measureText }, baking,
    });

    expect(result.data.map(layer => layer.id)).toEqual(['image_0001', 'text_0001', 'image_0002']);
    expect(result.data[0]).toMatchObject({ url: 'first' });
    expect(result.data[1]).toMatchObject({ content: 'Native' });
    expect(result.data[2]).toMatchObject({ url: 'last' });
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(split.ir)).toBe(before);
  });

  it('retains unsupported sources when baking fails and reports each remaining diagnostic once', () => {
    const split = splitSVG(wrap('<rect width="40" height="40"/>'));
    const reported: string[] = [];
    const baking: BakedLayersResult = {
      layers: [], warnings: [], replacesSource: () => false, resolvesWarning: () => false,
    };
    const result = assembleSVGLayers({
      context: {
        source: '', ir: split.ir, warnings: split.warnings, preservedData: split.preservedData,
        layerSources: new Map(), warningSources: new Map(),
      },
      options: { onWarning: warning => reported.push(warning.code) }, baking,
    });

    expect(result.data).toEqual([]);
    expect(result.warnings.some(warning => warning.code === 'svg2ge_layers_unsupported_type')).toBe(true);
    expect(reported).toEqual(result.warnings.map(warning => warning.code));
    expect(split.ir.compositions[0].layers).toHaveLength(1);
  });
});
