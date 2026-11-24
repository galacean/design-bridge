import type { IRParticleScalarExpression } from '@galacean/animation-ir';
import { ValueType, type NumberExpression } from '../dsl/number-expression';

export function mapDSLParticleExpressionToIR(expression: NumberExpression): IRParticleScalarExpression {
  if (expression[0] === ValueType.RANDOM) {
    return {
      type: 'randomBetweenConstants',
      min: expression[1][0],
      max: expression[1][1],
    };
  }

  return { type: 'constant', value: expression[1] };
}

export function mapIRParticleExpressionToDSL(expression: IRParticleScalarExpression): NumberExpression {
  switch (expression.type) {
    case 'constant':
      return [ValueType.CONSTANT, expression.value];
    case 'randomBetweenConstants':
      return [ValueType.RANDOM, [expression.min, expression.max]];
    case 'curve':
      return [ValueType.CONSTANT, expression.keyframes[0]?.value ?? 0];
  }
}

export function isDSLCompatibleParticleExpression(expression: IRParticleScalarExpression): boolean {
  return expression.type === 'constant' || expression.type === 'randomBetweenConstants';
}

export function isDSLNumberExpressionEqual(left: NumberExpression, right: NumberExpression): boolean {
  if (left[0] !== right[0]) {
    return false;
  }
  if (left[0] === ValueType.CONSTANT && right[0] === ValueType.CONSTANT) {
    return Object.is(left[1], right[1]);
  }
  if (left[0] === ValueType.RANDOM && right[0] === ValueType.RANDOM) {
    return Object.is(left[1][0], right[1][0]) && Object.is(left[1][1], right[1][1]);
  }

  return false;
}
