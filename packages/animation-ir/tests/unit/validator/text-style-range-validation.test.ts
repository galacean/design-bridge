import { describe, expect, it } from 'vitest';
import type { IRTextStyleRange } from '@galacean/animation-ir';
import { validateIRScene } from '@galacean/animation-ir/validator';
import { makeComposition, makeScene } from './test-scene';

function makeTextScene(styleRanges: unknown, text = 'A😀B\nC') {
  return {
    ...makeScene([
      {
        id: 'font:body', type: 'font', family: 'sans-serif', style: 'normal', weight: 400,
        source: { kind: 'system' },
      },
      {
        id: 'font:emphasis', type: 'font', family: 'sans-serif', style: 'italic', weight: 700,
        source: { kind: 'system' },
      },
      { id: 'image', type: 'image', source: { kind: 'url', url: 'https://example.com/image.png' } },
    ]),
    compositions: [{
      ...makeComposition(),
      layers: [{
        id: 'text', type: 'text', visible: true, time: { inFrame: 0, outFrame: 60 },
        content: {
          text, fontAssetId: 'font:body', fontSize: 12, color: [0, 0, 0, 1],
          letterSpacing: 0, lineHeight: 16, textAlign: 'left', styleRanges,
        },
      }],
    }],
  };
}

describe('text style range contract', () => {
  it('accepts partial styles, uncovered text, adjacent ranges and Unicode without mutating input', () => {
    const styleRanges: IRTextStyleRange[] = [
      { start: 1, end: 3, fontAssetId: 'font:emphasis', fontSize: 20 },
      { start: 3, end: 4, color: [1, 0, 0, 0.5], letterSpacing: -1 },
      { start: 5, end: 6 },
    ];
    const scene = makeTextScene(styleRanges);
    const original = structuredClone(scene);

    expect(validateIRScene(scene).errors).toEqual([]);
    expect(scene).toEqual(original);
  });

  it.each([undefined, []])('accepts plain text with no style ranges: %j', styleRanges => {
    expect(validateIRScene(makeTextScene(styleRanges, '')).valid).toBe(true);
  });

  it.each([
    { styleRanges: {}, suffix: 'styleRanges' },
    { styleRanges: [null], suffix: 'styleRanges[0]' },
    { styleRanges: [{ start: -1, end: 1 }], suffix: 'styleRanges[0]' },
    { styleRanges: [{ start: 0.5, end: 1 }], suffix: 'styleRanges[0]' },
    { styleRanges: [{ start: 3, end: 3 }], suffix: 'styleRanges[0]' },
    { styleRanges: [{ start: 3, end: 1 }], suffix: 'styleRanges[0]' },
    { styleRanges: [{ start: 0, end: 7 }], suffix: 'styleRanges[0].end' },
    { styleRanges: [{ start: 0, end: 4 }, { start: 3, end: 5 }], suffix: 'styleRanges[1].start' },
    { styleRanges: [{ start: 3, end: 4 }, { start: 0, end: 1 }], suffix: 'styleRanges[1].start' },
    { styleRanges: [{ start: 2, end: 3 }], suffix: 'styleRanges[0].start' },
    { styleRanges: [{ start: 1, end: 2 }], suffix: 'styleRanges[0].end' },
  ])('rejects invalid ranges: $suffix $styleRanges', ({ styleRanges, suffix }) => {
    expect(validateIRScene(makeTextScene(styleRanges)).errors).toContainEqual(expect.objectContaining({
      code: 'IR_TEXT_DATA_INVALID', path: `compositions[0].layers[0].content.${suffix}`,
    }));
  });

  it.each([
    { style: { fontAssetId: '' }, code: 'IR_TEXT_DATA_INVALID', field: 'fontAssetId' },
    { style: { fontAssetId: 'missing' }, code: 'IR_TEXT_FONT_ASSET_MISSING', field: 'fontAssetId' },
    { style: { fontAssetId: 'image' }, code: 'IR_TEXT_FONT_ASSET_TYPE_INVALID', field: 'fontAssetId' },
    { style: { fontSize: 0 }, code: 'IR_TEXT_DATA_INVALID', field: 'fontSize' },
    { style: { letterSpacing: Infinity }, code: 'IR_TEXT_DATA_INVALID', field: 'letterSpacing' },
    { style: { color: [1, 0, 0, 2] }, code: 'IR_TEXT_COLOR_INVALID', field: 'color' },
  ])('validates range style and references: $style', ({ style, code, field }) => {
    const result = validateIRScene(makeTextScene([{ start: 0, end: 1, ...style }]));

    expect(result.errors).toContainEqual(expect.objectContaining({
      code, path: `compositions[0].layers[0].content.styleRanges[0].${field}`,
    }));
  });
});
