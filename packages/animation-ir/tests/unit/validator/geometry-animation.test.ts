import { describe, expect, it } from 'vitest';
import type { IRAnimatedProperty, IRBezierPath, IRShape } from '@galacean/animation-ir';
import { makeComposition, validateComposition } from './test-scene';

function makePath(count = 3, closed = true): IRBezierPath {
  return {
    points: Array.from({ length: count }, (_, index) => ({ x: index * 10, y: index % 2 * 10 })),
    inTangents: Array.from({ length: count }, () => ({ x: -1, y: 0 })),
    outTangents: Array.from({ length: count }, () => ({ x: 1, y: 0 })),
    closed,
  };
}

function validateShape(geometry: Record<string, unknown>) {
  return validateComposition({
    ...makeComposition(),
    layers: [{
      id: 'shape', type: 'shape', visible: true, time: { inFrame: 0, outFrame: 60 },
      content: { shapes: [{ position: { type: 'static', value: [0, 0] }, fills: [], strokes: [], ...geometry }] },
    }],
  });
}

function validatePaths(customPaths: unknown) {
  return validateShape({ primitiveType: 'custom', customPaths });
}

const animatedSize: IRAnimatedProperty<number> = {
  type: 'keyframed', keyframes: [{ frame: 0, value: 10 }, { frame: 30, value: 20 }],
};
const animatedRoundness: IRAnimatedProperty<number> = {
  type: 'keyframed', keyframes: [{ frame: 0, value: 0 }, { frame: 30, value: 50 }],
};

describe('shape geometry animation contract', () => {
  it('accepts path morphing with component correspondence, easing and discontinuous endpoints', () => {
    const customPaths: IRAnimatedProperty<IRBezierPath[]> = {
      type: 'keyframed',
      keyframes: [
        {
          frame: 0, value: [makePath()], endValue: [makePath()],
          outTangent: { x: 0.2, y: 0 },
        },
        { frame: 30, value: [makePath(4, false)], inTangent: { x: 0.8, y: 1 } },
        { frame: 60, value: [makePath(4, false)] },
      ],
    };

    expect(validatePaths(customPaths).errors).toEqual([]);
  });

  it.each([
    [makePath(), makePath()],
    [makePath(4)],
    [makePath(3, false)],
  ].map(nextValue => ({ nextValue })))('checks topology only on continuous segments: %j', ({ nextValue }) => {
    const first = { frame: 0, value: [makePath()] };
    const next = { frame: 30, value: nextValue };

    expect(validatePaths({ type: 'keyframed', keyframes: [first, next] }).errors).toContainEqual(
      expect.objectContaining({
        code: 'IR_SHAPE_DATA_INVALID', path: 'layers[0].content.shapes[0].customPaths.keyframes[0]',
      }),
    );
    expect(validatePaths({ type: 'keyframed', keyframes: [{ ...first, hold: true }, next] }).valid).toBe(true);
    expect(validatePaths({
      type: 'keyframed', keyframes: [{ ...first, endValue: first.value }, next],
    }).valid).toBe(true);
    expect(validatePaths({
      type: 'keyframed', keyframes: [{ ...first, endValue: nextValue }, { ...next, value: first.value }],
    }).valid).toBe(false);
  });

  it('ignores topology differences in an unused final segment', () => {
    expect(validatePaths({
      type: 'keyframed', keyframes: [{ frame: 0, value: [makePath()], endValue: [makePath(4)] }],
    }).valid).toBe(true);
  });

  it.each([
    { value: [], suffix: 'value' },
    { value: [{ ...makePath(), points: [] }], suffix: 'value[0].points' },
    { value: [{ ...makePath(), inTangents: [] }], suffix: 'value[0].inTangents' },
    { value: [{ ...makePath(), outTangents: [{ x: NaN, y: 0 }] }], suffix: 'value[0].outTangents[0]' },
  ])('validates path arrays in both values and endValue: $suffix', ({ value, suffix }) => {
    for (const field of ['value', 'endValue']) {
      const result = validatePaths({
        type: 'keyframed', keyframes: [{ frame: 0, value: [makePath()], [field]: value }],
      });

      expect(result.errors).toContainEqual(expect.objectContaining({
        code: 'IR_SHAPE_DATA_INVALID',
        path: `layers[0].content.shapes[0].customPaths.keyframes[0].${suffix.replace('value', field)}`,
      }));
    }
  });

  it('accepts animated parameters for each parametric primitive and shape position', () => {
    const style = {
      position: { type: 'keyframed', keyframes: [{ frame: 0, value: [0, 0] }, { frame: 30, value: [20, 30] }] },
      fills: [], strokes: [],
    } satisfies Pick<IRShape, 'position' | 'fills' | 'strokes'>;
    const shapes: IRShape[] = [
      {
        ...style, primitiveType: 'rectangle', width: animatedSize, height: animatedSize,
        cornerRadius: { type: 'keyframed', keyframes: [{ frame: 0, value: 2 }, { frame: 30, value: 4 }] },
      },
      { ...style, primitiveType: 'ellipse', xRadius: animatedSize, yRadius: animatedSize },
      { ...style, primitiveType: 'polygon', pointCount: 5, radius: animatedSize, roundness: animatedRoundness },
      {
        ...style, primitiveType: 'star', pointCount: 5, innerRadius: animatedSize, outerRadius: animatedSize,
        innerRoundness: animatedRoundness, outerRoundness: animatedRoundness,
      },
    ];

    for (const shape of shapes) {
      expect(validateShape({ ...shape }).errors).toEqual([]);
    }
  });

  it.each([
    { field: 'radius', sample: -1 },
    { field: 'roundness', sample: 101 },
    { field: 'position', sample: [1, Infinity] },
  ])('validates geometry endValue: $field', ({ field, sample }) => {
    const result = validateShape({
      primitiveType: 'polygon', pointCount: 5, radius: { type: 'static', value: 10 },
      [field]: {
        type: 'keyframed', keyframes: [{ frame: 0, value: field === 'position' ? [0, 0] : 0, endValue: sample }],
      },
    });

    expect(result.errors).toContainEqual(expect.objectContaining({
      path: `layers[0].content.shapes[0].${field}.keyframes[0].endValue`,
    }));
  });

  it('keeps pointCount static and disallows spatial motion handles on geometry channels', () => {
    expect(validateShape({
      primitiveType: 'polygon', pointCount: animatedSize, radius: animatedSize,
    }).errors).toContainEqual(expect.objectContaining({ path: 'layers[0].content.shapes[0].pointCount' }));
    expect(validatePaths({
      type: 'keyframed', keyframes: [{ frame: 0, value: [makePath()], spatialOut: [1, 0] }],
    }).errors).toContainEqual(expect.objectContaining({ code: 'IR_KEYFRAME_INVALID' }));
  });
});
