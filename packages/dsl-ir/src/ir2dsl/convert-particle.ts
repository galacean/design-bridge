import type { IRParticleLayer, IRParticleScalarExpression } from '@galacean/animation-ir';
import { type ConversionDiagnostic, mapIRParticleScalarValues } from '@galacean/animation-ir/adapter';
import type { ParticleProperties } from '../dsl/schema';
import type { NumberExpression } from '../dsl/number-expression';
import {
  isDSLCompatibleParticleExpression, mapIRParticleExpressionToDSL,
} from '../common/particle-expression';

export function convertIRParticleToDSL(
  layer: IRParticleLayer,
  frameRate: number,
  layerPath: string,
  diagnostics: ConversionDiagnostic[],
): ParticleProperties {
  const convertExpression = (
    expression: IRParticleScalarExpression,
    fieldPath: string,
  ): NumberExpression => {
    if (!isDSLCompatibleParticleExpression(expression)) {
      diagnostics.push({
        code: 'PARTICLE_EXPRESSION_PROJECTED',
        severity: 'warning',
        action: 'approximated',
        path: `${layerPath}.content.${fieldPath}`,
        sourceId: layer.id,
        feature: fieldPath,
        message: `Particle ${fieldPath} uses an IR ${expression.type} expression and was projected to a representative editable DSL value; the baseline IR preserves the original expression until this field is edited.`,
      });
    }

    return mapIRParticleExpressionToDSL(expression);
  };

  return {
    options: {
      maxCount: layer.content.maxParticles,
      startLifetime: convertExpression(
        mapIRParticleScalarValues(layer.content.startLifetime, frames => frames / frameRate),
        'startLifetime',
      ),
    },
    emission: {
      rateOverTime: convertExpression(layer.content.emission.rateOverTime, 'emission.rateOverTime'),
      ...(layer.content.emission.bursts != null && {
        bursts: layer.content.emission.bursts.map(burst => ({
          time: burst.frameOffset / frameRate,
          count: burst.count,
          cycles: burst.cycleCount === 'infinite' ? 0 : burst.cycleCount,
          interval: burst.repeatIntervalFrames / frameRate,
        })),
      }),
    },
  };
}
