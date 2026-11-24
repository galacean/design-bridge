import { describe, expect, it } from 'vitest';
import type { LottieJSON } from '@galacean/lottie2ir';
import { convertLottieToIR } from '@galacean/lottie2ir';

const transform = {
  p: { a: 0, k: [20, 30, 0] }, a: { a: 0, k: [5, 6, 0] },
  s: { a: 0, k: [100, 100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 },
};

function input(parentType: number, childIn = 0, childOut = 40, compositionIn = 0, compositionOut = 40): LottieJSON {
  return {
    v: '5.7.0', w: 100, h: 100, fr: 20, ip: compositionIn, op: compositionOut,
    layers: [
      { ty: 1, ind: 2, nm: 'child', parent: 1, ip: childIn, op: childOut, st: 0,
        sw: 10, sh: 10, sc: '#00ff00', ks: transform },
      { ty: parentType, ind: 1, nm: 'parent', ip: 8, op: 16, st: 0, refId: 'content',
        sw: 10, sh: 10, sc: '#ff0000', ks: {
          ...transform,
          r: { a: 1, k: [{ t: 0, s: [0], e: [90] }, { t: 40, s: [90] }] },
          o: { a: 0, k: 25 },
        } },
    ],
    assets: [{ id: 'content', w: 100, h: 100, layers: [
      { ty: 1, ind: 1, ip: 0, op: 40, st: 0, sw: 10, sh: 10, sc: '#ff0000', ks: transform },
    ] }],
  } as unknown as LottieJSON;
}

describe('transform parenting outside the parent visibility interval', () => {
  it.each([0, 1, 3])('keeps type %i parent transforms alive without extending visible content', parentType => {
    const source = input(parentType);
    const snapshot = JSON.stringify(source);
    const { scene } = convertLottieToIR(source);
    const layers = scene.compositions[0].layers;
    const parent = layers.find(layer => layer.name === 'parent')!;
    const child = layers.find(layer => layer.name === 'child')!;
    const inherited = layers.find(layer => layer.id === child.parentId)!;

    expect(parent.time.inFrame).toBe(8);
    expect(parent.time.outFrame).toBe(16);
    expect(child.time).toEqual({ inFrame: 0, outFrame: 40 });
    expect(inherited.id).not.toBe(parent.id);
    expect(inherited.type).toBe('null');
    expect(inherited.time).toEqual({ inFrame: 0, outFrame: 40 });
    expect(inherited.transform?.rotation).toEqual(parent.transform?.rotation);
    expect(inherited.transform?.anchor).toEqual(parent.transform?.anchor);
    expect(inherited.transform?.opacity).toBeUndefined();
    expect(parent.transform?.opacity).toEqual({ type: 'static', value: 0.25 });
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('keeps direct parenting when the composition clips the child to the parent interval', () => {
    const { scene } = convertLottieToIR(input(0, 0, 40, 8, 16));
    const layers = scene.compositions[0].layers;

    expect(layers).toHaveLength(2);
    expect(layers.find(layer => layer.name === 'child')?.parentId).toBe(
      layers.find(layer => layer.name === 'parent')?.id,
    );
  });
});
