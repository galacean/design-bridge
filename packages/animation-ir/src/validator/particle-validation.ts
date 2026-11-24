import { IRParticleExpressionType } from '../schema/particle.js';
import type { ValidationContext } from './context.js';
import { isFiniteNumber, isRecord } from './value-validation.js';

interface ExpressionRange {
  min: number;
  exclusive: boolean;
}

function validateExpressionValue(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  range: ExpressionRange,
  layerId?: string,
): void {
  if (
    !isFiniteNumber(value) ||
    (range.exclusive ? value <= range.min : value < range.min)
  ) {
    const comparison = range.exclusive ? 'greater than' : 'greater than or equal to';

    ctx.error(
      'IR_PARTICLE_EXPRESSION_INVALID',
      path,
      `must be a finite number ${comparison} ${range.min}`,
      layerId,
    );
  }
}

function validateProgress(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  normalized: boolean,
  layerId?: string,
): value is number {
  if (!isFiniteNumber(value) || (normalized && (value < 0 || value > 1))) {
    ctx.error(
      'IR_PARTICLE_EXPRESSION_INVALID',
      path,
      normalized ? 'must be a finite number in the 0..1 range' : 'must be finite',
      layerId,
    );

    return false;
  }

  return true;
}

function validateCurvePoint(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  range: ExpressionRange,
  normalizedProgress: boolean,
  layerId?: string,
): number | undefined {
  if (!isRecord(value)) {
    ctx.error('IR_PARTICLE_EXPRESSION_INVALID', path, 'must be an object', layerId);

    return undefined;
  }

  const progress = value['progress'];

  validateProgress(ctx, progress, `${path}.progress`, normalizedProgress, layerId);
  if (normalizedProgress) {
    validateExpressionValue(ctx, value['value'], `${path}.value`, range, layerId);
  } else if (!isFiniteNumber(value['value'])) {
    ctx.error('IR_PARTICLE_EXPRESSION_INVALID', `${path}.value`, 'must be finite', layerId);
  }

  return isFiniteNumber(progress) ? progress : undefined;
}

function validateCurveKeyframes(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  range: ExpressionRange,
  layerId?: string,
): void {
  if (!Array.isArray(value) || value.length === 0) {
    ctx.error('IR_PARTICLE_EXPRESSION_INVALID', path, 'must be a non-empty array', layerId);

    return;
  }

  let previousProgress = -Infinity;

  for (const [index, keyframe] of value.entries()) {
    const keyframePath = `${path}[${index}]`;

    if (!isRecord(keyframe)) {
      ctx.error('IR_PARTICLE_EXPRESSION_INVALID', keyframePath, 'must be an object', layerId);
      continue;
    }

    const progress = validateCurvePoint(ctx, keyframe, keyframePath, range, true, layerId);

    if (progress != null) {
      if (progress <= previousProgress) {
        ctx.error(
          'IR_PARTICLE_EXPRESSION_INVALID',
          `${keyframePath}.progress`,
          'must be greater than the preceding keyframe progress',
          layerId,
        );
      }
      previousProgress = progress;
    }
    if (keyframe['hold'] !== undefined && typeof keyframe['hold'] !== 'boolean') {
      ctx.error('IR_PARTICLE_EXPRESSION_INVALID', `${keyframePath}.hold`, 'must be boolean when present', layerId);
    }
    if (keyframe['inControl'] !== undefined) {
      validateCurvePoint(ctx, keyframe['inControl'], `${keyframePath}.inControl`, range, false, layerId);
    }
    if (keyframe['outControl'] !== undefined) {
      validateCurvePoint(ctx, keyframe['outControl'], `${keyframePath}.outControl`, range, false, layerId);
    }
  }
}

export function validateParticleScalarExpression(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  range: ExpressionRange,
  layerId?: string,
): void {
  if (!isRecord(value)) {
    ctx.error('IR_PARTICLE_EXPRESSION_INVALID', path, 'must be an object', layerId);

    return;
  }

  switch (value['type']) {
    case IRParticleExpressionType.Constant:
      validateExpressionValue(ctx, value['value'], `${path}.value`, range, layerId);

      break;
    case IRParticleExpressionType.RandomBetweenConstants:
      validateExpressionValue(ctx, value['min'], `${path}.min`, range, layerId);
      validateExpressionValue(ctx, value['max'], `${path}.max`, range, layerId);
      if (isFiniteNumber(value['min']) && isFiniteNumber(value['max']) && value['max'] < value['min']) {
        ctx.error('IR_PARTICLE_EXPRESSION_INVALID', path, 'max must be greater than or equal to min', layerId);
      }

      break;
    case IRParticleExpressionType.Curve:
      validateCurveKeyframes(ctx, value['keyframes'], `${path}.keyframes`, range, layerId);

      break;
    default:
      ctx.error(
        'IR_PARTICLE_EXPRESSION_INVALID',
        `${path}.type`,
        'must be constant, randomBetweenConstants, or curve',
        layerId,
      );
  }
}

function validateBursts(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  layerDurationFrames: number,
  layerId?: string,
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    ctx.error('IR_PARTICLE_BURST_INVALID', path, 'must be an array when present', layerId);

    return;
  }

  for (const [index, burst] of value.entries()) {
    const burstPath = `${path}[${index}]`;

    if (!isRecord(burst)) {
      ctx.error('IR_PARTICLE_BURST_INVALID', burstPath, 'must be an object', layerId);
      continue;
    }

    const frameOffset = burst['frameOffset'];
    const cycleCount = burst['cycleCount'];
    const repeatIntervalFrames = burst['repeatIntervalFrames'];

    if (!isFiniteNumber(frameOffset) || frameOffset < 0 || frameOffset >= layerDurationFrames) {
      ctx.error(
        'IR_PARTICLE_BURST_INVALID',
        `${burstPath}.frameOffset`,
        'must be a finite frame offset within the Layer visible range',
        layerId,
      );
    }
    if (!Number.isInteger(burst['count']) || (burst['count'] as number) < 0) {
      ctx.error('IR_PARTICLE_BURST_INVALID', `${burstPath}.count`, 'must be a non-negative integer', layerId);
    }
    if (cycleCount !== 'infinite' && (!Number.isInteger(cycleCount) || (cycleCount as number) <= 0)) {
      ctx.error(
        'IR_PARTICLE_BURST_INVALID',
        `${burstPath}.cycleCount`,
        "must be a positive integer or 'infinite'",
        layerId,
      );
    }
    if (!isFiniteNumber(repeatIntervalFrames) || repeatIntervalFrames < 0) {
      ctx.error(
        'IR_PARTICLE_BURST_INVALID',
        `${burstPath}.repeatIntervalFrames`,
        'must be a non-negative finite frame count',
        layerId,
      );
    }
    if (
      (cycleCount === 'infinite' || (typeof cycleCount === 'number' && cycleCount > 1)) &&
      repeatIntervalFrames === 0
    ) {
      ctx.error(
        'IR_PARTICLE_BURST_INVALID',
        `${burstPath}.repeatIntervalFrames`,
        'must be greater than 0 when the burst has repeated cycles',
        layerId,
      );
    }
    if (
      isFiniteNumber(frameOffset) && frameOffset < layerDurationFrames &&
      typeof cycleCount === 'number' && Number.isInteger(cycleCount) &&
      cycleCount > 0 && isFiniteNumber(repeatIntervalFrames) && repeatIntervalFrames >= 0 &&
      frameOffset + (cycleCount - 1) * repeatIntervalFrames >= layerDurationFrames
    ) {
      ctx.error(
        'IR_PARTICLE_BURST_INVALID',
        burstPath,
        'finite burst cycles must finish within the Layer visible range',
        layerId,
      );
    }
  }
}

export function validateParticleContent(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  layerDurationFrames: number,
  layerId?: string,
): void {
  if (!isRecord(value)) {
    ctx.error('IR_PARTICLE_CONTENT_INVALID', path, 'must be an object', layerId);

    return;
  }

  if (!Number.isInteger(value['maxParticles']) || (value['maxParticles'] as number) <= 0) {
    ctx.error('IR_PARTICLE_CONTENT_INVALID', `${path}.maxParticles`, 'must be a positive integer', layerId);
  }
  validateParticleScalarExpression(
    ctx,
    value['startLifetime'],
    `${path}.startLifetime`,
    { min: 0, exclusive: true },
    layerId,
  );

  const emission = value['emission'];

  if (!isRecord(emission)) {
    ctx.error('IR_PARTICLE_EMISSION_INVALID', `${path}.emission`, 'must be an object', layerId);
  } else {
    validateParticleScalarExpression(
      ctx,
      emission['rateOverTime'],
      `${path}.emission.rateOverTime`,
      { min: 0, exclusive: false },
      layerId,
    );
    validateBursts(ctx, emission['bursts'], `${path}.emission.bursts`, layerDurationFrames, layerId);
  }
}
