import { IRPropertyType } from '../schema/value-types.js';
import type { ValidationContext } from './context.js';
import { isFiniteNumber, isNormalizedNumber, isNumberTuple, isRecord } from './value-validation.js';

type AnimatedDimension = 2 | 3 | 4 | 'number';

function validateBezierHandle(ctx: ValidationContext, value: unknown, path: string, layerId?: string): void {
  if (!isRecord(value)) {
    ctx.error('IR_KEYFRAME_INVALID', path, 'must be an object', layerId);

    return;
  }

  if (!isNormalizedNumber(value['x'])) {
    ctx.error('IR_KEYFRAME_INVALID', `${path}.x`, 'must be finite and in the 0..1 range', layerId);
  }
  if (!isFiniteNumber(value['y'])) {
    ctx.error('IR_KEYFRAME_INVALID', `${path}.y`, 'must be finite', layerId);
  }
}
function validateAnimatedValue(
  ctx: ValidationContext,
  value: unknown,
  dimension: AnimatedDimension,
  path: string,
  layerId?: string,
  normalized = false,
): void {
  const valid = dimension === 'number' ? isFiniteNumber(value) : isNumberTuple(value, dimension);

  if (!valid) {
    const expected = dimension === 'number' ? 'a finite number' : `a finite ${dimension}D tuple`;

    ctx.error('IR_ANIMATED_PROPERTY_INVALID', path, `must be ${expected}`, layerId);

    return;
  }

  if (normalized) {
    const values = Array.isArray(value) ? value : [value];

    if (!values.every(isNormalizedNumber)) {
      ctx.error('IR_ANIMATED_PROPERTY_INVALID', path, 'must be in the 0..1 range', layerId);
    }
  }
}

function validateSpatialTangent(ctx: ValidationContext, value: unknown, path: string, layerId?: string): void {
  if (!isNumberTuple(value, 2) && !isNumberTuple(value, 3)) {
    ctx.error('IR_KEYFRAME_INVALID', path, 'must be a finite 2D or 3D number tuple', layerId);
  }
}

export function validateAnimatedProperty(
  ctx: ValidationContext,
  property: unknown,
  dimension: AnimatedDimension,
  path: string,
  layerId?: string,
  options: { normalized?: boolean; allowSpatialTangents?: boolean } = {},
): void {
  const { normalized = false, allowSpatialTangents = false } = options;

  if (property === undefined) {
    return;
  }
  if (!isRecord(property)) {
    ctx.error('IR_ANIMATED_PROPERTY_INVALID', path, 'must be an object', layerId);

    return;
  }

  const type = property['type'];

  if (type !== IRPropertyType.Static && type !== IRPropertyType.Keyframed) {
    ctx.error('IR_ANIMATED_PROPERTY_INVALID', `${path}.type`, "must be 'static' or 'keyframed'", layerId);

    return;
  }

  if (type === IRPropertyType.Static) {
    if (property['value'] === undefined) {
      ctx.error('IR_ANIMATED_PROPERTY_INVALID', `${path}.value`, "is required when type is 'static'", layerId);
    } else {
      validateAnimatedValue(ctx, property['value'], dimension, `${path}.value`, layerId, normalized);
    }
    if (property['keyframes'] !== undefined) {
      ctx.error(
        'IR_ANIMATED_PROPERTY_INVALID',
        `${path}.keyframes`,
        "must be omitted when type is 'static'",
        layerId,
      );
    }

    return;
  }

  const keyframes = property['keyframes'];

  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    ctx.error(
      'IR_ANIMATED_PROPERTY_INVALID',
      `${path}.keyframes`,
      "must be a non-empty array when type is 'keyframed'",
      layerId,
    );

    return;
  }

  if (property['value'] !== undefined) {
    ctx.error('IR_ANIMATED_PROPERTY_INVALID', `${path}.value`, "must be omitted when type is 'keyframed'", layerId);
  }

  let previousFrame = Number.NEGATIVE_INFINITY;

  for (const [index, keyframe] of keyframes.entries()) {
    const keyframePath = `${path}.keyframes[${index}]`;

    if (!isRecord(keyframe)) {
      ctx.error('IR_KEYFRAME_INVALID', keyframePath, 'must be an object', layerId);
      continue;
    }

    const frame = keyframe['frame'];

    if (!isFiniteNumber(frame)) {
      ctx.error('IR_KEYFRAME_INVALID', `${keyframePath}.frame`, 'must be finite', layerId);
    } else {
      if (frame <= previousFrame) {
        ctx.error(
          'IR_KEYFRAME_INVALID',
          `${keyframePath}.frame`,
          'must be greater than the previous keyframe frame',
          layerId,
        );
      }
      previousFrame = frame;
    }

    if (keyframe['value'] === undefined) {
      ctx.error('IR_KEYFRAME_INVALID', `${keyframePath}.value`, 'is required', layerId);
    } else {
      validateAnimatedValue(ctx, keyframe['value'], dimension, `${keyframePath}.value`, layerId, normalized);
    }
    if (keyframe['endValue'] !== undefined) {
      validateAnimatedValue(ctx, keyframe['endValue'], dimension, `${keyframePath}.endValue`, layerId, normalized);
    }
    if (keyframe['hold'] !== undefined && typeof keyframe['hold'] !== 'boolean') {
      ctx.error('IR_KEYFRAME_INVALID', `${keyframePath}.hold`, 'must be boolean when present', layerId);
    }
    if (keyframe['inTangent'] !== undefined) {
      validateBezierHandle(ctx, keyframe['inTangent'], `${keyframePath}.inTangent`, layerId);
    }
    if (keyframe['outTangent'] !== undefined) {
      validateBezierHandle(ctx, keyframe['outTangent'], `${keyframePath}.outTangent`, layerId);
    }
    if (keyframe['spatialIn'] !== undefined) {
      if (allowSpatialTangents) {
        validateSpatialTangent(ctx, keyframe['spatialIn'], `${keyframePath}.spatialIn`, layerId);
      } else {
        ctx.error(
          'IR_KEYFRAME_INVALID',
          `${keyframePath}.spatialIn`,
          'is only valid for position animation',
          layerId,
        );
      }
    }
    if (keyframe['spatialOut'] !== undefined) {
      if (allowSpatialTangents) {
        validateSpatialTangent(ctx, keyframe['spatialOut'], `${keyframePath}.spatialOut`, layerId);
      } else {
        ctx.error(
          'IR_KEYFRAME_INVALID',
          `${keyframePath}.spatialOut`,
          'is only valid for position animation',
          layerId,
        );
      }
    }
  }
}

export function validateStaticProperty(
  ctx: ValidationContext,
  property: unknown,
  dimension: AnimatedDimension,
  path: string,
  layerId?: string,
): void {
  validateAnimatedProperty(ctx, property, dimension, path, layerId);

  if (isRecord(property) && property['type'] === IRPropertyType.Keyframed) {
    ctx.error(
      'IR_ANIMATED_PROPERTY_INVALID',
      `${path}.type`,
      "must be 'static' because this property is static-only",
      layerId,
    );
  }
}
