import { describe, expect, it } from 'vitest';
import { IREndBehavior, type IRComposition, type IRPrecompLayer } from '@galacean/animation-ir';
import {
  mapOpacityToReferencedComposition, multiplyOpacityProperties,
} from '../../src/ir2ge/converter/opacity';

function createComposition(id: string, frameRate: number): IRComposition {
  return {
    id,
    width: 100,
    height: 100,
    frameRate,
    inPoint: 0,
    outPoint: frameRate * 4,
    endBehavior: IREndBehavior.Loop,
    layers: [],
  };
}

describe('Precomp opacity lowering', () => {
  it('scales one animated channel without changing its timing handles', () => {
    const opacity = multiplyOpacityProperties(
      { type: 'static', value: 0.5 },
      {
        type: 'keyframed',
        keyframes: [
          { frame: 0, value: 0, endValue: 1, outTangent: { x: 0.2, y: 0.3 } },
          { frame: 30, value: 1, inTangent: { x: 0.8, y: 0.7 } },
        ],
      },
      0,
      30,
    );

    expect(opacity).toEqual({
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: 0, endValue: 0.5, outTangent: { x: 0.2, y: 0.3 } },
        { frame: 30, value: 0.5, inTangent: { x: 0.8, y: 0.7 } },
      ],
    });
  });

  it('maps parent frames into referenced frames using rational rate and stretch', () => {
    const parent = createComposition('parent', 24);
    const referenced = createComposition('child', 30);
    const layer: IRPrecompLayer = {
      id: 'precomp',
      type: 'precomp',
      content: { compositionId: referenced.id, clipToBounds: false },
      time: { inFrame: 48, outFrame: 96, sourceStartFrame: 10, stretch: 2 },
      visible: true,
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
    };
    const mapped = mapOpacityToReferencedComposition({
      type: 'keyframed',
      keyframes: [{ frame: 48, value: 0 }, { frame: 72, value: 1 }],
    }, layer, parent, referenced);

    expect(mapped).toEqual({
      type: 'keyframed',
      keyframes: [{ frame: 10, value: 0 }, { frame: 25, value: 1 }],
    });
  });

  it('samples the product of two animated channels at both keyframe boundaries', () => {
    const opacity = multiplyOpacityProperties(
      { type: 'keyframed', keyframes: [{ frame: 0, value: 0 }, { frame: 20, value: 1 }] },
      { type: 'keyframed', keyframes: [{ frame: 0, value: 1 }, { frame: 10, value: 0.5 }, { frame: 20, value: 1 }] },
      0,
      20,
    );

    expect(opacity).toEqual({
      type: 'keyframed',
      keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 0.25 }, { frame: 20, value: 1 }],
    });
  });
});
