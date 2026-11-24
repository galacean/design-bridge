import type { IRParticleBurst, IRParticleContent } from '@galacean/animation-ir';
import { mapIRParticleScalarValues } from '@galacean/animation-ir/adapter';
import { parseGEParticleScalarExpression } from '../../common/particle-expression';
import { isRecord, normalizeJSONValue } from '../../common/json-normalization';

export interface ParsedGEParticleComponent {
  particle: IRParticleContent;
  rawParticleContent: Record<string, unknown>;
  normalizedBurstRuntimeDefaults: boolean;
}

interface ParsedParticleBursts {
  bursts: IRParticleBurst[];
  normalizedRuntimeDefaults: boolean;
}

export function parseParticleComponent(
  component: Record<string, unknown>,
  frameRate: number,
): ParsedGEParticleComponent | undefined {
  const options = component['options'];
  const emission = component['emission'];

  if (!isRecord(options) || !isRecord(emission)) {
    return undefined;
  }

  const maxCount = options['maxCount'];
  const startLifetime = parseGEParticleScalarExpression(options['startLifetime']);
  const rateOverTime = parseGEParticleScalarExpression(emission['rateOverTime']);
  const parsedBursts = parseParticleBursts(emission['bursts'], frameRate);

  if (!Number.isInteger(maxCount) || (maxCount as number) <= 0 || startLifetime == null || rateOverTime == null) {
    return undefined;
  }
  if (emission['bursts'] !== undefined && parsedBursts == null) {
    return undefined;
  }

  const rawParticleContent = normalizeJSONValue(component);

  delete rawParticleContent['id'];
  delete rawParticleContent['item'];
  delete rawParticleContent['dataType'];
  delete rawParticleContent['mask'];

  return {
    particle: {
      maxParticles: maxCount as number,
      startLifetime: mapIRParticleScalarValues(startLifetime, seconds => seconds * frameRate),
      emission: {
        rateOverTime,
        ...(parsedBursts != null && { bursts: parsedBursts.bursts }),
      },
    },
    rawParticleContent,
    normalizedBurstRuntimeDefaults: parsedBursts?.normalizedRuntimeDefaults ?? false,
  };
}

function parseParticleBursts(
  value: unknown,
  frameRate: number,
): ParsedParticleBursts | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const bursts: IRParticleBurst[] = [];
  let normalizedRuntimeDefaults = false;

  for (const burst of value) {
    if (!isRecord(burst)) {
      return undefined;
    }
    const time = parseLegacyParticleNumber(burst['time']);
    const count = parseLegacyParticleNumber(burst['count']);
    const rawCycleCount = parseLegacyParticleNumber(burst['cycles']);
    const rawRepeatInterval = parseLegacyParticleNumber(burst['interval']);

    if (
      time == null || time < 0 ||
      count == null || !Number.isInteger(count) || count < 0 ||
      (burst['cycles'] !== undefined && rawCycleCount === undefined) ||
      (rawCycleCount !== undefined && (!Number.isInteger(rawCycleCount) || rawCycleCount < 0)) ||
      (burst['interval'] !== undefined && rawRepeatInterval === undefined) ||
      (rawRepeatInterval !== undefined && rawRepeatInterval < 0)
    ) {
      return undefined;
    }

    const cycleCount = rawCycleCount == null || rawCycleCount === 0 ? 'infinite' : rawCycleCount;
    const repeatIntervalSeconds = rawRepeatInterval == null || rawRepeatInterval === 0
      ? (cycleCount === 1 ? 0 : 1)
      : rawRepeatInterval;

    normalizedRuntimeDefaults ||= rawCycleCount == null || rawCycleCount === 0 ||
      ((rawRepeatInterval == null || rawRepeatInterval === 0) && cycleCount !== 1);

    bursts.push({
      frameOffset: time * frameRate,
      count,
      cycleCount,
      repeatIntervalFrames: repeatIntervalSeconds * frameRate,
    });
  }

  return { bursts, normalizedRuntimeDefaults };
}

function parseLegacyParticleNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}
