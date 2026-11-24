import type { IRParticleBurst, IRParticleContent, IRParticleScalarExpression } from '@galacean/animation-ir';
import { mapIRParticleScalarValues } from '@galacean/animation-ir/adapter';
import type { NumberExpression } from '../dsl/number-expression';
import type { ParticleBurst, ParticleProperties } from '../dsl/schema';
import { mapDSLParticleExpressionToIR } from '../common/particle-expression';
import { secondsToFrames } from '../common/utils';

export function convertDSLParticleToIRContent(
  particle: ParticleProperties,
  frameRate: number,
): IRParticleContent {
  return {
    maxParticles: particle.options.maxCount,
    startLifetime: mapDSLParticleLifetimeToIR(particle.options.startLifetime, frameRate),
    emission: {
      rateOverTime: mapDSLParticleExpressionToIR(particle.emission.rateOverTime),
      ...(particle.emission.bursts != null && {
        bursts: mapDSLParticleBurstsToIR(particle.emission.bursts, frameRate),
      }),
    },
  };
}

export function mapDSLParticleLifetimeToIR(lifetime: NumberExpression, frameRate: number): IRParticleScalarExpression {
  return mapIRParticleScalarValues(mapDSLParticleExpressionToIR(lifetime), seconds => seconds * frameRate);
}

export function mapDSLParticleBurstsToIR(bursts: ParticleBurst[], frameRate: number): IRParticleBurst[] {
  return bursts.map(burst => ({
    frameOffset: secondsToFrames(burst.time, frameRate),
    count: burst.count,
    cycleCount: burst.cycles == null || burst.cycles === 0 ? 'infinite' : burst.cycles,
    repeatIntervalFrames: secondsToFrames(burst.interval ?? 0, frameRate),
  }));
}
