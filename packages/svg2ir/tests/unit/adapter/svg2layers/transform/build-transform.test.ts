import { describe, expect, it } from 'vitest';
import type { IRLayer } from '@galacean/animation-ir';
import { buildIRStaticStateResolver } from '../../../../../src/adapter/svg2layers/converter/transform/build-transform';
import { buildImageLayer, buildLayerBase } from '../build-layer-fixtures';

function resolve(layers: IRLayer[]) {
  return buildIRStaticStateResolver(new Map(layers.map(layer => [layer.id, layer])), 0);
}

describe('IR static layer state', () => {
  it('inherits parent transforms while keeping layer visibility and opacity independent', () => {
    const parent: IRLayer = { ...buildLayerBase('parent'), type: 'null', visible: false, transform: {
      position: { type: 'static', value: [10, 5, 0] }, scale: { type: 'static', value: [2, 2, 1] },
      opacity: { type: 'static', value: 0.1 },
    } };
    const child = buildImageLayer('child');

    child.parentId = 'parent';
    child.transform = { position: { type: 'static', value: [3, 4, 0] },
      scale: { type: 'static', value: [3, 3, 1] }, opacity: { type: 'static', value: 0.5 } };

    expect(resolve([parent, child])(child)).toMatchObject({
      opacity: 0.5, visible: true, matrix: { a: 6, d: 6, e: 16, f: 13 },
    });
  });

  it('applies a local anchor before composing the parent transform', () => {
    const layer = buildImageLayer();

    layer.transform = { position: { type: 'static', value: [100, 50, 0] },
      anchor: { type: 'static', value: [10, 5, 0] }, scale: { type: 'static', value: [2, 2, 1] } };

    expect(resolve([layer])(layer).matrix).toMatchObject({ a: 2, d: 2, e: 80, f: 40 });
  });

  it('rejects cyclic and missing parents instead of dropping their transforms', () => {
    const first = { ...buildImageLayer('a'), parentId: 'b' };
    const second = { ...buildImageLayer('b'), parentId: 'a' };

    expect(() => resolve([first, second])(first)).toThrow(/Cyclic/);
    expect(() => resolve([first])(first)).toThrow(/Missing/);
  });

  it('does not mistake delayed or animated layers for static visible layers', () => {
    const delayed = { ...buildImageLayer(), time: { inFrame: 30, outFrame: 150 } };
    const animated = buildImageLayer();

    animated.transform = { position: { type: 'keyframed', keyframes: [
      { frame: 0, value: [0, 0, 0] }, { frame: 30, value: [100, 0, 0] },
    ] } };

    expect(() => resolve([delayed])(delayed)).toThrow(/Delayed/);
    expect(() => resolve([animated])(animated)).toThrow(/Animated/);
  });

  it('accepts a single keyframe as a held static value', () => {
    const layer = buildImageLayer();

    layer.transform = { position: { type: 'keyframed', keyframes: [{ frame: 0, value: [30, 40, 0] }] } };

    expect(resolve([layer])(layer).matrix).toMatchObject({ e: 30, f: 40 });
  });
});
