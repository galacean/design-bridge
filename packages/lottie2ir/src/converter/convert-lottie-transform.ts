import type {
  IRAnimatedProperty, IRBezierHandle, IRKeyframe, IRPropertyValue, IRRotation,
  IRSpatialTangent, IRStaticProperty, IRTransform, IRVec3,
} from '@galacean/animation-ir';
import type { LottieVisualLayer } from '../common/conversion-types';
import {
  asRecord,
  isFiniteNumber,
  isKeyframedProperty,
  toFiniteNumberArray,
  toFirstNumber,
} from '../parser/parse-lottie-property';

type LottieValueReader<T> = (value: unknown) => T | undefined;

export function hasAnimatedAnchor(layer: LottieVisualLayer): boolean {
  const property = getPropertyRecord(layer, 'a');

  return property != null && isKeyframedProperty(property);
}

function toStaticAnchor(layer: LottieVisualLayer): IRStaticProperty<IRVec3> | undefined {
  const property = toAnimatedProperty(getPropertyRecord(layer, 'a'), readVector3);

  if (property == null || property.type === 'static') {
    return property;
  }

  return {
    type: 'static',
    value: property.keyframes[0]?.value ?? [0, 0, 0],
  };
}

function readVector3(value: unknown): IRVec3 | undefined {
  const values = toFiniteNumberArray(value);

  if (values == null) {
    return undefined;
  }

  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

function readSpatialTangent(value: unknown): IRSpatialTangent | undefined {
  const values = toFiniteNumberArray(value);

  if (values?.length === 2) {
    return [values[0], values[1]];
  }
  if (values?.length === 3) {
    return [values[0], values[1], values[2]];
  }

  return undefined;
}

function readScaleVector(value: unknown): IRVec3 | undefined {
  const values = toFiniteNumberArray(value)?.map(item => item / 100);

  if (values == null) {
    return undefined;
  }

  return [values[0] ?? 1, values[1] ?? 1, values[2] ?? 1];
}

function readOpacityNumber(value: unknown): number | undefined {
  const valueNumber = toFirstNumber(value);

  return valueNumber != null ? valueNumber / 100 : undefined;
}

function getPropertyRecord(layer: LottieVisualLayer, key: string): Record<string, unknown> | undefined {
  const ks = asRecord(layer.ks);
  const property = asRecord(ks?.[key]);

  if (property == null || !('k' in property)) {
    return undefined;
  }

  return property;
}

function readBezierHandle(value: unknown): IRBezierHandle | undefined {
  const record = asRecord(value);
  const x = toFirstNumber(record?.['x']);
  const y = toFirstNumber(record?.['y']);

  if (x == null || y == null) {
    return undefined;
  }

  return { x, y };
}

function readKeyframes<T extends IRPropertyValue>(
  property: Record<string, unknown>,
  reader: LottieValueReader<T>,
): IRKeyframe<T>[] | undefined {
  const rawKeyframes = property['k'];

  if (!Array.isArray(rawKeyframes)) {
    return undefined;
  }

  const keyframes: IRKeyframe<T>[] = [];
  let previousEndValue: T | undefined;
  // Lottie stores segment tangents on the start keyframe; IR assigns them to their endpoints.
  let pendingInTangent: IRBezierHandle | undefined;
  let pendingSpatialIn: IRSpatialTangent | undefined;

  for (const rawKeyframe of rawKeyframes) {
    const keyframeRecord = asRecord(rawKeyframe);
    const t = keyframeRecord?.['t'];

    if (!isFiniteNumber(t)) {
      continue;
    }

    // Terminal keyframes inherit the preceding `e` value.
    let value = reader(keyframeRecord?.['s']);

    if (value == null) {
      if (previousEndValue != null) {
        value = previousEndValue;
      } else {
        continue;
      }
    }

    const endValue = reader(keyframeRecord?.['e']);

    previousEndValue = endValue ?? value;

    const recordInTangent = readBezierHandle(keyframeRecord?.['i']);
    const outTangent = readBezierHandle(keyframeRecord?.['o']);
    const spatialOut = readSpatialTangent(keyframeRecord?.['to']);
    const recordSpatialIn = readSpatialTangent(keyframeRecord?.['ti']);

    const inTangent = pendingInTangent;
    const spatialIn = pendingSpatialIn;

    keyframes.push({
      frame: t,
      value,
      ...(endValue != null && { endValue }),
      ...(keyframeRecord?.['h'] === 1 && { hold: true }),
      ...(inTangent != null && { inTangent }),
      ...(outTangent != null && { outTangent }),
      ...(spatialOut != null && { spatialOut }),
      ...(spatialIn != null && { spatialIn }),
    });

    // Incoming tangents belong to the next IR keyframe.
    pendingInTangent = recordInTangent;
    pendingSpatialIn = recordSpatialIn;
  }

  return keyframes.length > 0 ? keyframes : undefined;
}

function toAnimatedProperty<T extends IRPropertyValue>(
  property: Record<string, unknown> | undefined,
  reader: LottieValueReader<T>,
): IRAnimatedProperty<T> | undefined {
  if (property == null) {
    return undefined;
  }

  if (isKeyframedProperty(property)) {
    const keyframes = readKeyframes(property, reader);

    if (keyframes != null && keyframes.length >= 2) {
      return { type: 'keyframed', keyframes };
    }

    const staticValue = keyframes?.[0]?.value ?? reader(property['k']);

    return staticValue != null ? { type: 'static', value: staticValue } : undefined;
  }

  const value = reader(property['k']);

  return value != null ? { type: 'static', value } : undefined;
}

/**
 * Converts Lottie transform properties and keyframes to IR units and tangent ownership.
 *
 * Scale and opacity percentages become normalized factors. Animated anchors use their first keyframe because IR anchors
 * are static.
 */
export function convertLottieTransform(layer: LottieVisualLayer): IRTransform {
  const transform: IRTransform = {};
  const anchor = toStaticAnchor(layer);
  const positionProperty = getPropertyRecord(layer, 'p');
  const position = toAnimatedProperty(positionProperty, readVector3);
  const scale = toAnimatedProperty(getPropertyRecord(layer, 's'), readScaleVector);
  const rotationZ = toAnimatedProperty(
    getPropertyRecord(layer, 'rz') ?? getPropertyRecord(layer, 'r'),
    toFirstNumber,
  );
  const rotationX = toAnimatedProperty(getPropertyRecord(layer, 'rx'), toFirstNumber);
  const rotationY = toAnimatedProperty(getPropertyRecord(layer, 'ry'), toFirstNumber);
  const opacity = toAnimatedProperty(getPropertyRecord(layer, 'o'), readOpacityNumber);

  if (anchor != null) {
    transform.anchor = anchor;
  }
  if (position != null) {
    transform.position = position;
  }
  if (scale != null) {
    transform.scale = scale;
  }

  if (rotationX != null || rotationY != null || rotationZ != null) {
    const rotation: IRRotation = {};

    if (rotationX != null) {
      rotation.x = rotationX;
    }
    if (rotationY != null) {
      rotation.y = rotationY;
    }
    if (rotationZ != null) {
      rotation.z = rotationZ;
    }
    transform.rotation = rotation;
  }

  if (opacity != null) {
    transform.opacity = opacity;
  }

  return transform;
}
