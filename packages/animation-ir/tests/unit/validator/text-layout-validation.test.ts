import { describe, expect, it } from 'vitest';
import type { IRLocalBounds, IRTextContent, IRTextLayer } from '@galacean/animation-ir';
import { makeComposition, validateComposition } from './test-scene';

function textLayer(content: Partial<IRTextContent> = {}, localBounds?: IRLocalBounds): IRTextLayer {
  return {
    id: 'text', type: 'text', visible: true, time: { inFrame: 0, outFrame: 60 }, localBounds,
    content: {
      text: 'First\nSecond', fontAssetId: 'font:body', fontSize: 16,
      color: [0, 0, 0, 1], letterSpacing: 0, lineHeight: 20, textAlign: 'left', ...content,
    },
  };
}

const frame: IRLocalBounds = { x: -20, y: 10, width: 80, height: 40 };

describe('text layout contract', () => {
  it('accepts omitted layout fields without inferring constraints from measured bounds or mutating input', () => {
    const composition = makeComposition({ layers: [textLayer({}, { ...frame, width: 0, height: 0 })] });
    const original = structuredClone(composition);

    expect(validateComposition(composition).errors).toEqual([]);
    expect(composition).toEqual(original);
    expect(validateComposition(makeComposition({ layers: [textLayer()] })).errors).toEqual([]);
  });

  it.each([
    { sizeMode: 'auto-width', wrap: false, overflow: 'visible', verticalAlign: 'top' },
    { sizeMode: 'fixed', wrap: false, overflow: 'clip', verticalAlign: 'bottom' },
    { sizeMode: 'fixed', wrap: true, overflow: 'shrink', verticalAlign: 'center' },
    { sizeMode: 'auto-height', wrap: true, overflow: 'visible', verticalAlign: 'top' },
    { sizeMode: 'auto-height', wrap: false, overflow: 'shrink', verticalAlign: 'bottom' },
  ] satisfies Partial<IRTextContent>[])('accepts layout independent of style ranges: %j', layout => {
    const plain = textLayer(layout, frame);
    const styled = textLayer({ ...layout, styleRanges: [{ start: 0, end: 5, fontSize: 24 }] }, frame);

    expect(validateComposition(makeComposition({ layers: [plain] })).errors).toEqual([]);
    expect(validateComposition(makeComposition({ layers: [styled] })).errors).toEqual([]);
  });

  it.each([
    { sizeMode: 'auto-height', bounds: { ...frame, height: 0 } },
    { sizeMode: 'auto-width', bounds: { ...frame, width: 0, height: 0 } },
  ] as const)('allows zero measurement hints on automatic dimensions: $sizeMode', ({ sizeMode, bounds }) => {
    expect(validateComposition(makeComposition({ layers: [textLayer({ sizeMode }, bounds)] })).errors).toEqual([]);
  });

  it.each([-1, Infinity, NaN])('rejects invalid automatic dimension hints: %s', height => {
    const layer = textLayer({ sizeMode: 'auto-height' }, { ...frame, height });

    expect(validateComposition(makeComposition({ layers: [layer] })).errors).toContainEqual(expect.objectContaining({
      code: 'IR_LAYER_LOCAL_BOUNDS_INVALID', path: 'layers[0].localBounds.height',
    }));
  });

  it.each([
    ['sizeMode', 'auto'], ['sizeMode', null],
    ['wrap', 'true'], ['wrap', null],
    ['overflow', 'display'], ['overflow', null],
    ['verticalAlign', 'middle'], ['verticalAlign', null],
  ] as const)('rejects invalid layout field %s=%j', (field, value) => {
    const layer = textLayer({}, frame);

    Object.assign(layer.content, { [field]: value });
    expect(validateComposition(makeComposition({ layers: [layer] })).errors).toContainEqual(expect.objectContaining({
      code: 'IR_TEXT_DATA_INVALID', path: `layers[0].content.${field}`,
    }));
  });

  it.each([undefined, 'auto-width'] as const)('rejects wrapping without constrained width: %s', sizeMode => {
    const layer = textLayer({ sizeMode, wrap: true }, frame);

    expect(validateComposition(makeComposition({ layers: [layer] })).errors).toContainEqual(expect.objectContaining({
      code: 'IR_TEXT_DATA_INVALID', path: 'layers[0].content.wrap',
    }));
  });

  it.each(['fixed', 'auto-height'] as const)('requires bounds for %s layout', sizeMode => {
    expect(validateComposition(makeComposition({ layers: [textLayer({ sizeMode })] })).errors)
      .toContainEqual(expect.objectContaining({ code: 'IR_LAYER_LOCAL_BOUNDS_INVALID', path: 'layers[0].localBounds' }));
  });

  it.each([
    { sizeMode: 'fixed', dimension: 'width' },
    { sizeMode: 'fixed', dimension: 'height' },
    { sizeMode: 'auto-height', dimension: 'width' },
  ] as const)('rejects zero constrained $dimension in $sizeMode', ({ sizeMode, dimension }) => {
    const layer = textLayer({ sizeMode }, { ...frame, [dimension]: 0 });

    expect(validateComposition(makeComposition({ layers: [layer] })).errors).toContainEqual(expect.objectContaining({
      code: 'IR_LAYER_LOCAL_BOUNDS_INVALID', path: `layers[0].localBounds.${dimension}`,
    }));
  });
});
