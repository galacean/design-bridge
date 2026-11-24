import { describe, expect, it, vi, beforeEach } from 'vitest';
import { convertSVGToLayers, splitSVG } from '@galacean/svg2ir';
import * as rasterizer from '../../../../src/svg-rasterizer/rasterize-svg';
import { planGraphicBaking } from '../../../../src/adapter/svg2layers/baking/plan-graphic-baking';

const rasterizeSVG = vi.spyOn(rasterizer, 'rasterizeSVG');

vi.spyOn(rasterizer, 'canRasterizeSVG').mockReturnValue(true);

const png = 'data:image/png;base64,iVBORw0KGgo=';
const wrap = (content: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">${content}</svg>`;
const measureText = (_font: string, text: string) => ({
  width: text.length * 10, fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 4,
});
const text = '<text x="10" y="30" font-family="Arial" font-size="20">Native</text>';
const image = `<image href="${png}" x="120" y="10" width="20" height="30"/>`;

describe('graphic baking in layers conversion', () => {
  beforeEach(() => {
    rasterizeSVG.mockReset();
    vi.mocked(rasterizeSVG).mockResolvedValue({ url: png, bbox: [2, 4, 82, 44] });
  });

  it('interleaves baked graphics with unchanged native text and images, using source identity despite duplicate IDs', async () => {
    const source = wrap(`<rect id="same" width="100" height="50"/>${text}${image}<circle id="same" r="10"/>`);
    const result = await convertSVGToLayers(source, { measureText });
    const nativeResult = await convertSVGToLayers(wrap(`${text}${image}`), { measureText });

    expect(result.data.map(layer => layer.type)).toEqual(['image', 'text', 'image', 'image']);
    expect(result.data[1]).toEqual(nativeResult.data[0]);
    expect(result.data[2]).toEqual({ ...nativeResult.data[1], id: 'image_0002' });
    expect(result.data[0]).toMatchObject({ size: [80, 40], rotation: [0, 0, 0], bbox: [2, 4, 82, 44] });
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'svg2ge_layers_graphic_baked', elementSelector: 'rect#same' }),
      expect.objectContaining({ code: 'svg2ge_layers_graphic_baked', elementSelector: 'circle#same' }),
    ]);
    expect(nativeResult.warnings).toEqual([]);
    expect(rasterizeSVG).toHaveBeenCalledTimes(2);
  });

  it('reports successful baking once through warnings and onWarning, including in strict mode', async () => {
    const reported: Array<{ code: string; message: string }> = [];
    const result = await convertSVGToLayers(wrap('<rect id="graphic" width="50" height="30"/>'), {
      strict: true, onWarning: warning => reported.push(warning),
    });

    expect(result.data).toHaveLength(1);
    expect(result.warnings).toEqual([expect.objectContaining({
      code: 'svg2ge_layers_graphic_baked', elementSelector: 'rect#graphic',
      message: expect.stringContaining('no longer editable'),
    })]);
    expect(reported).toEqual(result.warnings);
    expect(reported[0]).toBe(result.warnings[0]);
  });

  it('keeps separate graphics in a plain group as separate baked layers', async () => {
    const result = await convertSVGToLayers(wrap('<g><rect width="50" height="40"/><circle cx="60" cy="30" r="20"/></g>' + text), {
      measureText,
    });

    expect(result.data.map(layer => layer.type)).toEqual(['image', 'image', 'text']);
    expect(rasterizeSVG).toHaveBeenCalledTimes(2);
    expect(result.warnings.map(warning => warning.code)).toEqual([
      'svg2ge_layers_graphic_baked', 'svg2ge_layers_graphic_baked',
    ]);
  });

  it('bakes the whole pure graphic mask/filter group and removes only diagnostics it resolves', async () => {
    const source = wrap('<defs><filter id="blur"><feGaussianBlur stdDeviation="2"/></filter></defs>'
      + '<g id="graphics" opacity=".5" filter="url(#blur)"><rect width="40" height="40"/><circle r="20"/></g>' + text);
    const result = await convertSVGToLayers(source, { measureText, strict: true });

    expect(result.data.map(layer => layer.type)).toEqual(['image', 'text']);
    expect(rasterizeSVG).toHaveBeenCalledTimes(1);
    expect(result.warnings).toEqual([expect.objectContaining({
      code: 'svg2ge_layers_graphic_baked', elementSelector: 'g#graphics',
      message: expect.stringContaining('group baked into a single PNG'),
    })]);
  });

  it('keeps preserved data paired with original IDs when preceding graphics are baked', async () => {
    const source = wrap('<rect width="40" height="40"/>' + text);
    const split = splitSVG(source, { measureText });
    const result = await convertSVGToLayers(source, { measureText }, split.preservedData);

    expect(result.data[1]).toMatchObject({ type: 'text', content: 'Native' });
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'svg2ge_layers_graphic_baked' })]);
  });

  it.each(['mask="url(#mask)"', 'filter="url(#filter)"', 'opacity=".5"'])(
    'refuses a mixed native group with %s', async effect => {
      const source = wrap(`<g ${effect}><rect width="50" height="40"/>${text}${image}</g>`);
      const result = await convertSVGToLayers(source, { measureText });

      expect(rasterizeSVG).not.toHaveBeenCalled();
      expect(result.warnings.some(warning => warning.message.includes('contains native text or images'))).toBe(true);
    },
  );

  it('does not report compositing losses for an explicitly hidden mixed group', async () => {
    const result = await convertSVGToLayers(wrap(`<g display="none" opacity=".5"><rect width="40" height="40"/>${text}</g>`), {
      strict: true,
    });

    expect(rasterizeSVG).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('does not bake a use whose referenced group contains native text or images', () => {
    const source = wrap(`<defs><g id="native">${text}${image}</g></defs><use href="#native"/>`);

    expect(planGraphicBaking(source).scopes).toEqual([]);
  });

  it('keeps failure diagnostics and enforces strict mode without reporting warnings twice', async () => {
    vi.mocked(rasterizeSVG).mockRejectedValue(new Error('decode failed'));
    const reported: string[] = [];
    const result = await convertSVGToLayers(wrap('<rect width="50" height="30"/>'), {
      onWarning: warning => reported.push(warning.message),
    });

    expect(result.data).toEqual([]);
    expect(reported).toEqual(result.warnings.map(warning => warning.message));
    expect(result.warnings.some(warning => warning.message.includes('decode failed'))).toBe(true);
    expect(result.warnings.some(warning => warning.code === 'svg2ge_layers_graphic_baked')).toBe(false);
    await expect(convertSVGToLayers(wrap('<rect width="50" height="30"/>'), { strict: true }))
      .rejects.toThrow(/decode failed/);
  });

  it('omits a successfully baked transparent graphic instead of restoring its unsupported IR fallback', async () => {
    vi.mocked(rasterizeSVG).mockResolvedValue(null);
    const result = await convertSVGToLayers(wrap('<rect width="50" height="30" fill="none"/>'), {
      strict: true,
    });

    expect(result.data).toEqual([]);
    expect(result.warnings).toEqual([expect.objectContaining({
      code: 'svg2ge_layers_graphic_baked', message: expect.stringContaining('no visible pixels'),
    })]);
  });

  it('parses a nested SVG without truncating the outer document', async () => {
    const source = wrap('<svg x="10" width="50" height="50"><rect width="40" height="40"/></svg>' + text);
    const result = await convertSVGToLayers(source, { measureText });

    expect(result.size).toEqual([200, 100]);
    expect(result.data.map(layer => layer.type)).toEqual(['image', 'text']);
  });
});
