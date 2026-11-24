import type { IRParticleCurvePoint, IRParticleScalarExpression } from '../schema/particle.js';

/** Convert scalar units, including Bézier control values, while preserving emitter progress and interpolation. */
export function mapIRParticleScalarValues(
  expression: IRParticleScalarExpression,
  mapValue: (value: number) => number,
): IRParticleScalarExpression {
  switch (expression.type) {
    case 'constant':
      return { ...expression, value: mapValue(expression.value) };
    case 'randomBetweenConstants':
      return { ...expression, min: mapValue(expression.min), max: mapValue(expression.max) };
    case 'curve': {
      const mapPoint = (point: IRParticleCurvePoint) => ({ ...point, value: mapValue(point.value) });

      return {
        type: 'curve',
        keyframes: expression.keyframes.map(keyframe => ({
          ...keyframe,
          value: mapValue(keyframe.value),
          ...(keyframe.inControl && { inControl: mapPoint(keyframe.inControl) }),
          ...(keyframe.outControl && { outControl: mapPoint(keyframe.outControl) }),
        })),
      };
    }
  }
}
