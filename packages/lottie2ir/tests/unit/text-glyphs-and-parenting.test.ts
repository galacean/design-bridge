import { describe, expect, it } from 'vitest';
import { convertLottieToIR } from '@galacean/lottie2ir';
import type { LottieJSON } from '@galacean/lottie2ir';
import { convertIRToGE } from '@galacean/ge-ir';
import { DataType, FillType } from '@galacean/effects-specification';
import { expectStaticValue } from '../helpers/shape-test-helpers';

const transform = {
  p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] },
  s: { a: 0, k: [100, 100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 },
};

function scene(layers: unknown[], extra: object = {}): LottieJSON {
  return { v: '5.7.0', w: 200, h: 100, fr: 24, ip: 0, op: 48, layers, ...extra } as LottieJSON;
}
function layer(ind: number, extra: object = {}) {
  return { ty: 3, ind, nm: String(ind), ip: 0, op: 48, st: 0, ks: transform, ...extra };
}
const path = { c: true, v: [[0, -10], [10, -10], [10, 0]], i: [[0, 0], [0, 0], [0, 0]],
  o: [[0, 0], [0, 0], [0, 0]] };

function textScene(text = 'AA ', extra: object = {}) {
  return scene([layer(1, { ty: 5, t: { d: { k: [{ t: 0, s: {
    t: text, f: 'Test', s: 50, j: 2, tr: 100, lh: 60, fc: [1, 0, 0], ...extra,
  } }] } } })], {
    fonts: { list: [{ fName: 'Test', fFamily: 'Outline', fStyle: 'Regular', ascent: 75 }] },
    chars: [{ ch: 'A', fFamily: 'Outline', style: 'Regular', w: 20, size: 100,
      data: { shapes: [{ ty: 'gr', it: [{ ty: 'sh', ks: { a: 0, k: path } }] },
      { ty: 'gr', it: [{ ty: 'sh', ks: { a: 0, k: { ...path, v: [[2, -8], [4, -6], [4, -8]] } } }] }] } },
    { ch: ' ', fFamily: 'Outline', style: 'Regular', w: 10, size: 100, data: {} }],
  });
}

describe('Lottie glyph outlines and duplicate parent indices', () => {
  it('preserves every matching parent transform in source order without changing the visual parents', () => {
    const input = scene([
      layer(7, { nm: 'first', ks: { ...transform, s: { a: 0, k: [50, 50, 100] }, o: { a: 0, k: 20 } } }),
      layer(2, { nm: 'child', parent: 7 }),
      layer(7, { nm: 'second', ks: { ...transform, s: { a: 0, k: [80, 80, 100] } } }),
    ]);
    const before = JSON.stringify(input);
    const result = convertLottieToIR(input);
    const layers = result.scene.compositions[0].layers;
    const child = layers.find(item => item.name === 'child')!;
    const firstParent = layers.find(item => item.id === child.parentId)!;
    const secondParent = layers.find(item => item.id === firstParent.parentId)!;

    expect(firstParent.transform?.scale).toEqual({ type: 'static', value: [0.5, 0.5, 1] });
    expect(secondParent.transform?.scale).toEqual({ type: 'static', value: [0.8, 0.8, 1] });
    expect(firstParent.transform?.opacity).toBeUndefined();
    expect(secondParent.transform?.opacity).toBeUndefined();
    expect(layers.find(item => item.name === 'first')?.parentId).toBeUndefined();
    expect(layers.find(item => item.name === 'second')?.parentId).toBeUndefined();
    expect(result.diagnostics.some(item => item.code === 'LOTTIE_DUPLICATE_LAYER_INDEX')).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('uses glyph advances, tracking and point-text alignment while preserving compound contours', () => {
    const input = textScene();
    const before = JSON.stringify(input);
    const result = convertLottieToIR(input);
    const output = result.scene.compositions[0].layers[0];

    expect(output.type).toBe('shape');
    if (output.type !== 'shape') {
      throw new Error('Expected outline shape');
    }
    const shape = output.content.shapes[0];

    expect(shape.primitiveType).toBe('custom');
    if (shape.primitiveType !== 'custom') {
      throw new Error('Expected compound path');
    }
    const paths = expectStaticValue(shape.customPaths);

    expect(paths).toHaveLength(4);
    expect(paths[0].points[0]).toEqual({ x: -12.5, y: -5 });
    expect(paths[2].points[0]).toEqual({ x: 2.5, y: -5 });
    expect(shape.position).toEqual({ type: 'static', value: [0, 0] });
    expect(shape.fills).toEqual([{ type: 'solid', color: { type: 'static', value: [1, 0, 0, 1] } }]);
    const exported = convertIRToGE(result.scene).scene;
    const component = exported.components?.find(item => item.dataType === DataType.ShapeComponent);

    expect(component).toMatchObject({
      fills: [{ type: FillType.Solid, color: { r: 1, g: 0, b: 0, a: 1 } }],
      shapes: Array.from({ length: 4 }, () => expect.objectContaining({ close: true })),
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('aligns each line independently and retains line height and baseline shift', () => {
    const result = convertLottieToIR(textScene('AA\rA', { j: 1, ls: 3 }));
    const output = result.scene.compositions[0].layers[0];

    if (output.type !== 'shape' || output.content.shapes[0].primitiveType !== 'custom') {
      throw new Error('Expected outline shape');
    }
    const paths = expectStaticValue(output.content.shapes[0].customPaths);

    expect(paths[0].points[0]).toEqual({ x: -25, y: -8 });
    expect(paths[4].points[0]).toEqual({ x: -10, y: 53 });
  });

  it('reports a missing embedded glyph instead of silently claiming outline fidelity', () => {
    const result = convertLottieToIR(textScene('AB'));

    expect(result.scene.compositions[0].layers[0].type).toBe('text');
    expect(result.diagnostics.some(item => item.code === 'LOTTIE_UNSUPPORTED_TEXT_GLYPHS')).toBe(true);
  });
});
