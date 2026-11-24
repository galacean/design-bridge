import type {
  IRAnimatedProperty,
  IRKeyframe,
  IRRotation,
  IRSpatialTangent,
  IRStaticProperty,
  IRVec3,
} from '@galacean/animation-ir';
import { resolveFiniteNumber, secondsToFrames } from '../common/utils';
import type { AnimatedProperty, AnimationCurve } from '../dsl/schema';

export function convertDSLPropertyToIRVec3(
  property: AnimatedProperty | undefined,
  frameRate: number,
  fallback: IRVec3,
  includeSpatialTangents = false,
): IRAnimatedProperty<IRVec3> {
  if (property?.a === true) {
    if (property.animation.length > 0) {
      return {
        type: 'keyframed',
        keyframes: convertDSLCurvesToIRKeyframes(
          property.animation,
          frameRate,
          value => convertDSLValueToIRVec3(value, fallback),
          includeSpatialTangents,
        ),
      };
    }

    return { type: 'static', value: [...fallback] };
  }

  return {
    type: 'static',
    value: convertDSLValueToIRVec3(property?.value ?? fallback, fallback),
  };
}

export function convertDSLPropertyToStaticIRVec3(
  property: AnimatedProperty | undefined,
  fallback: IRVec3,
): IRStaticProperty<IRVec3> {
  if (property?.a !== true) {
    return { type: 'static', value: convertDSLValueToIRVec3(property?.value ?? fallback, fallback) };
  }

  return {
    type: 'static',
    value: convertDSLValueToIRVec3(property.animation[0]?.start ?? fallback, fallback),
  };
}

export function convertDSLPropertyToIRNumber(
  property: AnimatedProperty | undefined,
  frameRate: number,
  fallback: number,
): IRAnimatedProperty<number> {
  if (property?.a === true) {
    if (property.animation.length > 0) {
      return {
        type: 'keyframed',
        keyframes: convertDSLCurvesToIRKeyframes(
          property.animation,
          frameRate,
          value => convertDSLValueToIRNumber(value, fallback),
          false,
        ),
      };
    }

    return { type: 'static', value: fallback };
  }

  return {
    type: 'static',
    value: convertDSLValueToIRNumber(property?.value ?? fallback, fallback),
  };
}

export function convertDSLPropertyToIRRotation(
  property: AnimatedProperty | undefined,
  frameRate: number,
  fallback: IRVec3,
): IRRotation {
  const rotationVector = convertDSLPropertyToIRVec3(property, frameRate, fallback, false);

  return {
    x: projectVectorAxis(rotationVector, 0),
    y: projectVectorAxis(rotationVector, 1),
    z: projectVectorAxis(rotationVector, 2),
  };
}

function projectVectorAxis(property: IRAnimatedProperty<IRVec3>, axisIndex: number): IRAnimatedProperty<number> {
  if (property.type === 'static') {
    return { type: 'static', value: property.value[axisIndex] ?? 0 };
  }

  return {
    type: 'keyframed',
    keyframes: property.keyframes.map((keyframe): IRKeyframe<number> => ({
      frame: keyframe.frame,
      value: keyframe.value[axisIndex] ?? 0,
      ...(keyframe.endValue != null && { endValue: keyframe.endValue[axisIndex] ?? 0 }),
      ...(keyframe.hold != null && { hold: keyframe.hold }),
      ...(keyframe.inTangent != null && { inTangent: keyframe.inTangent }),
      ...(keyframe.outTangent != null && { outTangent: keyframe.outTangent }),
    })),
  };
}

function convertDSLCurvesToIRKeyframes<T extends number | IRVec3>(
  animationCurves: AnimationCurve[],
  frameRate: number,
  convertValue: (value: number[]) => T,
  includeSpatialTangents: boolean,
): IRKeyframe<T>[] {
  const keyframes: IRKeyframe<T>[] = [];

  for (const curve of animationCurves) {
    const startValue = convertValue(curve.start);
    const endValue = convertValue(curve.end);
    const [x1, y1, x2, y2] = resolveDSLEasing(curve.easing);
    const spatialOut = includeSpatialTangents ? convertDSLSpatialTangentToIR(curve.out) : undefined;
    const spatialIn = includeSpatialTangents ? convertDSLSpatialTangentToIR(curve.in) : undefined;
    const startKeyframe: IRKeyframe<T> = {
      frame: secondsToFrames(curve.t[0], frameRate),
      value: startValue,
      endValue,
      outTangent: { x: x1, y: y1 },
      ...(spatialOut != null && { spatialOut }),
    };
    const endKeyframe: IRKeyframe<T> = {
      frame: secondsToFrames(curve.t[1], frameRate),
      value: structuredClone(endValue),
      inTangent: { x: x2, y: y2 },
      ...(spatialIn != null && { spatialIn }),
    };

    appendOrMergeKeyframe(keyframes, startKeyframe);
    appendOrMergeKeyframe(keyframes, endKeyframe);
  }

  return normalizeKeyframeOrder(keyframes);
}

function normalizeKeyframeOrder<T extends number | IRVec3>(keyframes: IRKeyframe<T>[]): IRKeyframe<T>[] {
  const sortedKeyframes = [...keyframes].sort((left, right) => left.frame - right.frame);
  const normalizedKeyframes: IRKeyframe<T>[] = [];

  for (const keyframe of sortedKeyframes) {
    appendOrMergeKeyframe(normalizedKeyframes, keyframe);
  }

  return normalizedKeyframes;
}

export function resolveDSLEasing(value: unknown): [number, number, number, number] {
  if (Array.isArray(value) && value.length === 4) {
    const [x1, y1, x2, y2] = value.map(point => resolveFiniteNumber(point, NaN));

    if (x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1 && Number.isFinite(y1) && Number.isFinite(y2)) {
      return [x1, y1, x2, y2];
    }
  }

  return [0, 0, 1, 1];
}

function convertDSLSpatialTangentToIR(value: unknown): IRSpatialTangent | undefined {
  if (!Array.isArray(value) || value.length !== 3) {
    return undefined;
  }
  const [tx, ty, tz] = value.map(point => resolveFiniteNumber(point, NaN));

  return Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(tz) ? [tx, ty, tz] : undefined;
}

function appendOrMergeKeyframe<T extends number | IRVec3>(keyframes: IRKeyframe<T>[], keyframe: IRKeyframe<T>): void {
  const previousKeyframe = keyframes[keyframes.length - 1];

  if (previousKeyframe == null || previousKeyframe.frame !== keyframe.frame) {
    keyframes.push(keyframe);

    return;
  }

  previousKeyframe.value = keyframe.value;
  if (keyframe.endValue != null) {
    previousKeyframe.endValue = keyframe.endValue;
  }
  if (keyframe.inTangent != null) {
    previousKeyframe.inTangent = keyframe.inTangent;
  }
  if (keyframe.outTangent != null) {
    previousKeyframe.outTangent = keyframe.outTangent;
  }
  if (keyframe.spatialIn != null) {
    previousKeyframe.spatialIn = keyframe.spatialIn;
  }
  if (keyframe.spatialOut != null) {
    previousKeyframe.spatialOut = keyframe.spatialOut;
  }
}

function convertDSLValueToIRVec3(value: number | number[], fallback: IRVec3): IRVec3 {
  if (Array.isArray(value)) {
    return [
      resolveFiniteNumber(value[0], fallback[0]),
      resolveFiniteNumber(value[1], fallback[1]),
      resolveFiniteNumber(value[2], fallback[2]),
    ];
  }

  return [resolveFiniteNumber(value, fallback[0]), fallback[1], fallback[2]];
}

function convertDSLValueToIRNumber(value: number | number[], fallback: number): number {
  return Math.min(1, Math.max(0, resolveFiniteNumber(Array.isArray(value) ? value[0] : value, fallback)));
}
