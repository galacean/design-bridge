import { describe, expect, it } from 'vitest';
import {
  BezierKeyframeType, type NumberExpression, ValueType,
} from '@galacean/effects-specification';
import {
  convertIRParticleScalarExpressionToGE, parseGEParticleScalarExpression, restoreGEParticleScalarExpression,
} from '../src/common/particle-expression';

describe('particle scalar expression mapping', () => {
  it('preserves constant and random expressions without introducing curve data', () => {
    const expressions: NumberExpression[] = [
      [ValueType.CONSTANT, 3],
      [ValueType.RANDOM, [1, 2]],
    ];

    for (const expression of expressions) {
      const parsed = parseGEParticleScalarExpression(expression);

      expect(parsed).toBeDefined();
      if (parsed != null) {
        expect(convertIRParticleScalarExpressionToGE(parsed)).toEqual(expression);
      }
    }
  });

  it('normalizes GE line, Hermite, and Bezier forms into one source-neutral curve', () => {
    const expressions: NumberExpression[] = [
      [ValueType.LINE, [[0, 1], [1, 2]]],
      [ValueType.CURVE, [[0, 1, 0, 0.5], [1, 2, 0.5, 0]]],
      [
        ValueType.BEZIER_CURVE,
        [
          [BezierKeyframeType.EASE, [0, 1, 0, 1, 0.1, 1.1], BezierKeyframeType.AUTO],
          [BezierKeyframeType.EASE_IN, [0.2, 1.2, 0.3, 1.3], BezierKeyframeType.EASE_IN],
          [BezierKeyframeType.EASE_OUT, [0.4, 1.4, 0.5, 1.5], BezierKeyframeType.EASE_OUT],
          [BezierKeyframeType.LINE, [0.6, 1.6], BezierKeyframeType.LINE],
          [BezierKeyframeType.HOLD, [0.65, 1.65, 0.7, 1.7], BezierKeyframeType.EASE_IN],
          [BezierKeyframeType.HOLD, [0.75, 1.75, 0.8, 1.8], BezierKeyframeType.EASE_OUT],
          [BezierKeyframeType.HOLD, [0.85, 1.85], BezierKeyframeType.LINE],
          [BezierKeyframeType.HOLD, [0.9, 1.9], BezierKeyframeType.LINE_OUT],
          [BezierKeyframeType.HOLD, [0.95, 1.95], BezierKeyframeType.HOLD],
        ],
      ],
    ];

    for (const expression of expressions) {
      const parsed = parseGEParticleScalarExpression(expression);

      expect(parsed).toMatchObject({ type: 'curve' });
      if (parsed != null) {
        const canonicalGE = convertIRParticleScalarExpressionToGE(parsed);

        expect(canonicalGE[0]).toBe(ValueType.BEZIER_CURVE);
        expect(parseGEParticleScalarExpression(canonicalGE)).toEqual(parsed);
      }
    }
  });

  it('converts legacy Hermite slopes to absolute Bezier controls', () => {
    expect(parseGEParticleScalarExpression([
      ValueType.CURVE,
      [[0, 1, 0, 3], [1, 2, 6, 0]],
    ])).toEqual({
      type: 'curve',
      keyframes: [
        {
          progress: 0,
          value: 1,
          outControl: { progress: 1 / 3, value: 2 },
        },
        {
          progress: 1,
          value: 2,
          inControl: { progress: 1 - 1 / 3, value: 0 },
        },
      ],
    });
  });

  it('exports an edit to a lifetime handle in seconds at the same emitter progress', () => {
    const source = [ValueType.BEZIER_CURVE, [
      [BezierKeyframeType.EASE_OUT, [0, 0.5, 0.25, 0.75]],
      [BezierKeyframeType.EASE_IN, [0.8, 1, 1, 2]],
    ]];

    expect(restoreGEParticleScalarExpression({ type: 'curve', keyframes: [
      { progress: 0, value: 12, outControl: { progress: 0.25, value: 7.5 } },
      { progress: 1, value: 48, inControl: { progress: 0.8, value: 24 } },
    ] }, source, 24)).toEqual([ValueType.BEZIER_CURVE, [
      [BezierKeyframeType.EASE_OUT, [0, 0.5, 0.25, 0.3125], BezierKeyframeType.EASE_OUT],
      [BezierKeyframeType.EASE_IN, [0.8, 1, 1, 2], BezierKeyframeType.EASE_IN],
    ]]);
  });

  it('orders random endpoints and crops curves to normalized emitter progress', () => {
    expect(parseGEParticleScalarExpression([ValueType.RANDOM, [2, 1]])).toEqual({
      type: 'randomBetweenConstants', min: 1, max: 2,
    });
    expect(parseGEParticleScalarExpression([ValueType.LINE, [[-1, 1], [2, 4]]])).toEqual({
      type: 'curve', keyframes: [{ progress: 0, value: 2 }, { progress: 1, value: 3 }],
    });
    const curve = parseGEParticleScalarExpression([ValueType.BEZIER_CURVE, [
      [BezierKeyframeType.EASE_OUT, [0, 1, 2 / 3, 1]],
      [BezierKeyframeType.EASE_IN, [4 / 3, 5 / 3, 2, 3]],
    ]]);

    expect(curve?.type).toBe('curve');
    if (curve?.type !== 'curve') {
      throw new Error('Expected curve');
    }
    expect(curve.keyframes.at(-1)?.progress).toBe(1);
    expect(curve.keyframes.at(-1)?.value).toBeCloseTo(1.5, 10);
    expect(curve.keyframes[0].outControl?.value).toBe(1);
    expect(curve.keyframes.at(-1)?.inControl?.value).toBeCloseTo(7 / 6, 10);
  });

  it('leaves malformed curve ordering visible to IR validation', () => {
    expect(parseGEParticleScalarExpression([ValueType.LINE, [[2, 1], [-1, 2]]])).toEqual({
      type: 'curve', keyframes: [{ progress: 2, value: 1 }, { progress: -1, value: 2 }],
    });
  });

  it('maps GE HOLD sides to the corresponding IR outgoing segment', () => {
    expect(parseGEParticleScalarExpression([
      ValueType.BEZIER_CURVE,
      [
        [BezierKeyframeType.LINE, [0, 0], BezierKeyframeType.LINE],
        [BezierKeyframeType.HOLD, [0.25, 1, 0.3, 1.2], BezierKeyframeType.EASE_OUT],
        [BezierKeyframeType.LINE, [0.5, 2], BezierKeyframeType.LINE],
        [BezierKeyframeType.HOLD, [0.65, 2.8, 0.75, 3], BezierKeyframeType.EASE_IN],
        [BezierKeyframeType.LINE, [1, 4], BezierKeyframeType.LINE],
      ],
    ])).toEqual({
      type: 'curve',
      keyframes: [
        { progress: 0, value: 0, hold: true },
        { progress: 0.25, value: 1, outControl: { progress: 0.3, value: 1.2 } },
        { progress: 0.5, value: 2 },
        { progress: 0.75, value: 3, inControl: { progress: 0.65, value: 2.8 }, hold: true },
        { progress: 1, value: 4 },
      ],
    });
  });

  it('preserves the meaningful control when an IR hold keyframe has controls on both sides', () => {
    expect(convertIRParticleScalarExpressionToGE({
      type: 'curve',
      keyframes: [
        { progress: 0, value: 0 },
        {
          progress: 0.5,
          value: 1,
          inControl: { progress: 0.4, value: 0.8 },
          outControl: { progress: 0.6, value: 1.2 },
          hold: true,
        },
        { progress: 1, value: 2 },
      ],
    })).toEqual([
      ValueType.BEZIER_CURVE,
      [
        [BezierKeyframeType.LINE, [0, 0], BezierKeyframeType.LINE],
        [BezierKeyframeType.HOLD, [0.4, 0.8, 0.5, 1], BezierKeyframeType.EASE_IN],
        [BezierKeyframeType.LINE, [1, 2], BezierKeyframeType.LINE],
      ],
    ]);
  });
});
