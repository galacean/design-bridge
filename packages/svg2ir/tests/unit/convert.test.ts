import { DataType } from '@galacean/effects-specification';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  convertSVGToGE, convertSVGToLayers, splitSVG,
  type SVGToGEOptions, type SVGToLayersOptions, type SVGToLayersResult,
} from '@galacean/svg2ir';
import * as svgAssembly from '../../src/svg2ir/assemble';
import * as geAssembly from '../../src/adapter/svg2ge/assemble';

const source = '<svg width="120" height="60"><text x="10" y="30" font-family="Arial" font-size="20">Hello</text></svg>';

afterEach(() => vi.restoreAllMocks());

describe('SVG conversion entries', () => {
  it('keeps options specific to each output', () => {
    expectTypeOf<SVGToGEOptions>().toHaveProperty('fonts');
    expectTypeOf<SVGToGEOptions>().not.toHaveProperty('loadImage');
    expectTypeOf<SVGToLayersOptions>().toHaveProperty('loadImage');
    expectTypeOf<SVGToLayersOptions>().not.toHaveProperty('fonts');
    expectTypeOf<SVGToLayersOptions>().not.toHaveProperty('outputFormat');
    expectTypeOf<SVGToLayersOptions>().toHaveProperty('measureText');
    expectTypeOf<ReturnType<typeof convertSVGToLayers>>().toEqualTypeOf<Promise<SVGToLayersResult>>();
  });

  it.each([
    { format: 'ge', supplied: false },
    { format: 'ge', supplied: true },
    { format: 'layers', supplied: false },
    { format: 'layers', supplied: true },
  ] as const)('parses SVG once for $format with supplied preservation=$supplied', async ({ format, supplied }) => {
    const preservedData = supplied ? splitSVG(source).preservedData : undefined;
    const parse = vi.spyOn(svgAssembly, 'parseSVGToIRScene');
    const result = format === 'ge'
      ? convertSVGToGE(source, {}, preservedData)
      : await convertSVGToLayers(source, {}, preservedData);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(Array.isArray(result.data)).toBe(format === 'layers');
  });

  it('converts a split context without parsing the SVG again', () => {
    const context = splitSVG(source);
    const parse = vi.spyOn(svgAssembly, 'parseSVGToIRScene');

    const result = convertSVGToGE(context);

    expect(parse).not.toHaveBeenCalled();
    expect(result.data.type).toBe('ge');
  });

  it('keeps parsed and previous GE warnings unchanged when reusing a context', () => {
    const context = splitSVG(source.replace('Arial', 'Custom Font'));
    const parsedWarnings = [...context.warnings];
    const first = convertSVGToGE(context);
    const firstWarnings = [...first.warnings];

    expect(first.warnings.some(warning => warning.code === 'svg2ir_text_font_not_supplied')).toBe(true);

    const second = convertSVGToGE(context, {
      fonts: [{ fontFamily: 'Custom Font', fontURL: 'https://example.com/custom-font.woff2' }],
    });

    expect(second.warnings.some(warning => warning.code === 'svg2ir_text_font_not_supplied')).toBe(false);
    expect(context.warnings).toEqual(parsedWarnings);
    expect(first.warnings).toEqual(firstWarnings);
  });

  it('converts layers without constructing a GE scene', async () => {
    const assembleGE = vi.spyOn(geAssembly, 'assembleSVGGE').mockImplementation(() => {
      throw new Error('Layers must not construct a GE scene');
    });
    const result = await convertSVGToLayers(source);

    expect(result.data).toHaveLength(1);
    expect(assembleGE).not.toHaveBeenCalled();
  });

  it('does not emit GE Runtime font diagnostics for layers', async () => {
    const result = await convertSVGToLayers(source.replace('Arial', 'Custom Font'));

    expect(result.warnings.some(warning => warning.code === 'svg2ir_text_font_not_supplied')).toBe(false);
  });

  it('does not implicitly enable rich text in GE output', () => {
    const result = convertSVGToGE(source);

    expect(result.data.type).toBe('ge');
    expect(result.data.components.some(component => component.dataType === DataType.TextComponent)).toBe(true);
  });

  it('does not mutate caller-owned preservation data', async () => {
    const preservedData = splitSVG(source).preservedData;
    const before = structuredClone(preservedData);

    await convertSVGToLayers(source, {}, preservedData);

    expect(preservedData).toEqual(before);
  });
});
