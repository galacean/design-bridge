import type { IRLayer } from '@galacean/animation-ir';
import type { Layer, ParticleBurst } from '../../dsl/schema';
import { isDSLNumberExpressionEqual, mapDSLParticleExpressionToIR } from '../../common/particle-expression';
import { mapDSLParticleBurstsToIR, mapDSLParticleLifetimeToIR } from '../convert-particle';
import type { DSLToIRChangeReporter } from '../types';

export function updateIRParticle(
  irLayer: IRLayer,
  editedLayer: Layer,
  baselineLayer: Layer,
  frameRate: number,
  reportChange: DSLToIRChangeReporter,
): void {
  const editedParticle = editedLayer.particle;
  const baselineParticle = baselineLayer.particle;

  if (irLayer.type !== 'particle' || editedParticle == null || baselineParticle == null) {
    return;
  }

  if (editedParticle.options.maxCount !== baselineParticle.options.maxCount) {
    const previousValue = irLayer.content.maxParticles;

    irLayer.content.maxParticles = editedParticle.options.maxCount;
    reportChange({
      kind: 'layer',
      op: 'set',
      field: 'particle.options.maxCount',
      layerId: editedLayer.id,
      oldValue: previousValue,
      newValue: editedParticle.options.maxCount,
    });
  }
  if (!isDSLNumberExpressionEqual(
    editedParticle.options.startLifetime,
    baselineParticle.options.startLifetime,
  )) {
    const previousValue = irLayer.content.startLifetime;

    irLayer.content.startLifetime = mapDSLParticleLifetimeToIR(editedParticle.options.startLifetime, frameRate);
    reportChange({
      kind: 'layer',
      op: 'set',
      field: 'particle.options.startLifetime',
      layerId: editedLayer.id,
      oldValue: previousValue,
      newValue: irLayer.content.startLifetime,
    });
  }
  if (!isDSLNumberExpressionEqual(
    editedParticle.emission.rateOverTime,
    baselineParticle.emission.rateOverTime,
  )) {
    const previousValue = irLayer.content.emission.rateOverTime;

    irLayer.content.emission.rateOverTime = mapDSLParticleExpressionToIR(
      editedParticle.emission.rateOverTime,
    );
    reportChange({
      kind: 'layer',
      op: 'set',
      field: 'particle.emission.rateOverTime',
      layerId: editedLayer.id,
      oldValue: previousValue,
      newValue: irLayer.content.emission.rateOverTime,
    });
  }
  if (!areParticleBurstsEqual(editedParticle.emission.bursts, baselineParticle.emission.bursts)) {
    const previousValue = irLayer.content.emission.bursts;
    const updatedBursts = editedParticle.emission.bursts == null
      ? undefined
      : mapDSLParticleBurstsToIR(editedParticle.emission.bursts, frameRate);

    if (updatedBursts == null) {
      delete irLayer.content.emission.bursts;
    } else {
      irLayer.content.emission.bursts = updatedBursts;
    }
    reportChange({
      kind: 'layer',
      op: updatedBursts == null ? 'delete' : 'set',
      field: 'particle.emission.bursts',
      layerId: editedLayer.id,
      oldValue: previousValue,
      newValue: updatedBursts,
    });
  }
}

function areParticleBurstsEqual(
  left: ParticleBurst[] | undefined,
  right: ParticleBurst[] | undefined,
): boolean {
  if (left == null || right == null) {
    return left === right;
  }
  if (left.length !== right.length) {
    return false;
  }

  return left.every((burst, index) => {
    const other = right[index];

    return other != null && Object.is(burst.time, other.time) && Object.is(burst.count, other.count) &&
      Object.is(burst.cycles, other.cycles) && Object.is(burst.interval, other.interval);
  });
}
