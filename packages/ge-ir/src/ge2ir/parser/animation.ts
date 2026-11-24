import type {
  IRAnimatedProperty,
  IRBezierHandle,
  IRKeyframe,
  IRRotation,
  IRSpatialTangent,
  IRTransform,
  IRVec3,
} from '@galacean/animation-ir';
import { ValueType } from '@galacean/effects-specification';
import { convert3dTo2dPoint } from '../../common/coordinate-mapping';
import { parseBezierKeyframes, parsePositionTimingKeyframes } from './keyframe';
import type { GESceneContext } from '../types';

const POSITION_EPSILON = 1e-6;

type PositionTimingKeyframe = {
  frame: number;
  outTangent?: IRBezierHandle;
  inTangent?: IRBezierHandle;
};

export function parseTransformAnimation(
  asset: Record<string, unknown>,
  startFrame: number,
  endFrame: number,
  ctx: GESceneContext,
): Partial<IRTransform> {
  const channels: Partial<IRTransform> = {};

  const positionOverLifetime = asset['positionOverLifetime'] as Record<string, unknown> | undefined;

  if (positionOverLifetime != null) {
    const positionAnimation = parsePositionAnimation(positionOverLifetime, startFrame, endFrame, ctx);

    if (positionAnimation != null) {
      channels.position = positionAnimation;
    }
  }

  const rotationOverLifetime = asset['rotationOverLifetime'] as Record<string, unknown> | undefined;

  if (rotationOverLifetime != null) {
    const rotation = parseRotationAnimation(rotationOverLifetime, startFrame, endFrame);

    if (rotation != null) {
      channels.rotation = rotation;
    }
  }

  const sizeOverLifetime = asset['sizeOverLifetime'] as Record<string, unknown> | undefined;

  if (sizeOverLifetime != null) {
    const scaleAnimation = parseScaleAnimation(sizeOverLifetime, startFrame, endFrame);

    if (scaleAnimation != null) {
      channels.scale = scaleAnimation;
    }
  }

  return channels;
}

export function parseOpacityAnimation(
  asset: Record<string, unknown>,
  startFrame: number,
  endFrame: number,
): IRAnimatedProperty<number> | undefined {
  const colorOverLifetime = asset['colorOverLifetime'] as Record<string, unknown> | undefined;

  if (colorOverLifetime == null) {
    return undefined;
  }

  const opacity = colorOverLifetime['opacity'] as unknown[] | undefined;

  return parseScalarChannel(opacity, startFrame, endFrame);
}

function parsePositionAnimation(
  positionOverLifetime: Record<string, unknown>,
  startFrame: number,
  endFrame: number,
  ctx: GESceneContext,
): IRAnimatedProperty<IRVec3> | undefined {
  const pathData = positionOverLifetime['path'] as unknown[] | undefined;

  if (pathData == null || !Array.isArray(pathData) || pathData.length < 2) {
    return undefined;
  }

  const valueType = pathData[0] as ValueType;

  if (valueType !== ValueType.BEZIER_CURVE_PATH) {
    return undefined;
  }

  const payload = pathData[1] as unknown[];

  if (!Array.isArray(payload) || payload.length < 2) {
    return undefined;
  }

  const easingData = payload[0];
  const pathPoints = payload[1] as [number, number, number][];
  const controlPointsRaw = payload[2] as [number, number, number][] | undefined;

  if (!Array.isArray(easingData) || !Array.isArray(pathPoints) || pathPoints.length < 2) {
    return undefined;
  }

  const timingKeyframes = parsePositionTimingKeyframes(easingData, startFrame, endFrame);

  if (timingKeyframes.length < 2) {
    return undefined;
  }

  const startIndex = isPrependedPositionBridge(timingKeyframes, pathPoints, controlPointsRaw, startFrame) ? 1 : 0;

  const keyframes: IRKeyframe<IRVec3>[] = [];
  const pendingSpatialIn = new Map<number, IRSpatialTangent>();

  for (let i = startIndex; i < timingKeyframes.length; i++) {
    const timing = timingKeyframes[i];
    const pathPoint = pathPoints[Math.min(i, pathPoints.length - 1)];
    const position2d = convert3dTo2dPoint(pathPoint[0], pathPoint[1], pathPoint[2] ?? 0, ctx.width, ctx.height);

    const keyframe: IRKeyframe<IRVec3> = {
      frame: timing.frame,
      value: position2d,
    };

    if (i > startIndex && timing.inTangent != null) {
      keyframe.inTangent = timing.inTangent;
    }
    if (i < timingKeyframes.length - 1 && timing.outTangent != null) {
      keyframe.outTangent = timing.outTangent;
    }

    const keyframeIndex = keyframes.length;
    const pendingSpatialInTangent = pendingSpatialIn.get(keyframeIndex);

    if (pendingSpatialInTangent != null) {
      keyframe.spatialIn = pendingSpatialInTangent;
    }

    if (controlPointsRaw != null && i < timingKeyframes.length - 1) {
      const segmentIndex = i;
      const firstControlPointIndex = segmentIndex * 2;
      const secondControlPointIndex = segmentIndex * 2 + 1;

      if (firstControlPointIndex < controlPointsRaw.length && secondControlPointIndex < controlPointsRaw.length) {
        const firstControlPoint = controlPointsRaw[firstControlPointIndex];
        const secondControlPoint = controlPointsRaw[secondControlPointIndex];
        const startPathPoint = pathPoints[i];
        const endPathPoint = pathPoints[Math.min(i + 1, pathPoints.length - 1)];
        const startPathPoint2d = convert3dTo2dPoint(
          startPathPoint[0],
          startPathPoint[1],
          startPathPoint[2] ?? 0,
          ctx.width,
          ctx.height,
        );
        const endPathPoint2d = convert3dTo2dPoint(
          endPathPoint[0],
          endPathPoint[1],
          endPathPoint[2] ?? 0,
          ctx.width,
          ctx.height,
        );
        const firstControlPoint2d = convert3dTo2dPoint(
          firstControlPoint[0],
          firstControlPoint[1],
          firstControlPoint[2] ?? 0,
          ctx.width,
          ctx.height,
        );
        const secondControlPoint2d = convert3dTo2dPoint(
          secondControlPoint[0],
          secondControlPoint[1],
          secondControlPoint[2] ?? 0,
          ctx.width,
          ctx.height,
        );

        keyframe.spatialOut = [
          firstControlPoint2d[0] - startPathPoint2d[0],
          firstControlPoint2d[1] - startPathPoint2d[1],
        ];

        pendingSpatialIn.set(keyframeIndex + 1, [
          secondControlPoint2d[0] - endPathPoint2d[0],
          secondControlPoint2d[1] - endPathPoint2d[1],
        ]);
      }
    }

    keyframes.push(keyframe);
  }

  if (keyframes.length < 2) {
    return undefined;
  }

  return { type: 'keyframed', keyframes };
}

function isPrependedPositionBridge(
  timingKeyframes: PositionTimingKeyframe[],
  pathPoints: [number, number, number][],
  controlPoints: [number, number, number][] | undefined,
  startFrame: number,
): boolean {
  if (timingKeyframes.length <= 2 || pathPoints.length <= 2) {
    return false;
  }

  const firstTiming = timingKeyframes[0];
  const secondTiming = timingKeyframes[1];
  const firstPathPoint = pathPoints[0];
  const secondPathPoint = pathPoints[1];

  if (
    firstTiming == null ||
    secondTiming == null ||
    firstPathPoint == null ||
    secondPathPoint == null ||
    Math.abs(firstTiming.frame - startFrame) >= POSITION_EPSILON ||
    !pointNearlyEquals(firstPathPoint, secondPathPoint)
  ) {
    return false;
  }

  const bridgeDuration = secondTiming.frame - firstTiming.frame;
  const isZeroDurationNoOp = Math.abs(bridgeDuration) < POSITION_EPSILON;
  const isDelayedHoldBridge =
    bridgeDuration > POSITION_EPSILON &&
    bezierHandleNearlyEquals(firstTiming.outTangent, 0, 0) &&
    bezierHandleNearlyEquals(secondTiming.inTangent, 1, 1);

  if (!isZeroDurationNoOp && !isDelayedHoldBridge) {
    return false;
  }

  if (controlPoints == null) {
    return true;
  }

  return pointNearlyEquals(controlPoints[0], firstPathPoint) && pointNearlyEquals(controlPoints[1], secondPathPoint);
}

function bezierHandleNearlyEquals(handle: IRBezierHandle | undefined, x: number, y: number): boolean {
  return handle != null && Math.abs(handle.x - x) < POSITION_EPSILON && Math.abs(handle.y - y) < POSITION_EPSILON;
}

function pointNearlyEquals(
  left: [number, number, number] | undefined,
  right: [number, number, number] | undefined,
): boolean {
  return (
    left != null &&
    right != null &&
    Math.abs(left[0] - right[0]) < POSITION_EPSILON &&
    Math.abs(left[1] - right[1]) < POSITION_EPSILON &&
    Math.abs((left[2] ?? 0) - (right[2] ?? 0)) < POSITION_EPSILON
  );
}

function parseRotationAnimation(
  rotationOverLifetime: Record<string, unknown>,
  startFrame: number,
  endFrame: number,
): IRRotation | undefined {
  const separateAxes = rotationOverLifetime['separateAxes'] === true;
  const xData = rotationOverLifetime['x'] as unknown[] | undefined;
  const yData = rotationOverLifetime['y'] as unknown[] | undefined;
  const zData = rotationOverLifetime['z'] as unknown[] | undefined;
  const x = separateAxes ? parseScalarChannel(xData, startFrame, endFrame) : undefined;
  const y = separateAxes ? parseScalarChannel(yData, startFrame, endFrame) : undefined;
  const z = parseScalarChannel(zData, startFrame, endFrame);

  if (x == null && y == null && z == null) {
    return undefined;
  }

  return {
    ...(x != null && { x }),
    ...(y != null && { y }),
    ...(z != null && { z }),
  };
}

function parseScaleAnimation(
  sizeOverLifetime: Record<string, unknown>,
  startFrame: number,
  endFrame: number,
): IRAnimatedProperty<IRVec3> | undefined {
  const uniform = sizeOverLifetime['separateAxes'] !== true ? sizeOverLifetime['size'] : undefined;
  const xData = (uniform ?? sizeOverLifetime['x']) as unknown[] | undefined;
  const yData = (uniform ?? sizeOverLifetime['y']) as unknown[] | undefined;
  const zData = (uniform ?? sizeOverLifetime['z']) as unknown[] | undefined;

  const x = parseScalarChannel(xData, startFrame, endFrame);
  const y = parseScalarChannel(yData, startFrame, endFrame);
  const z = parseScalarChannel(zData, startFrame, endFrame);

  if (x == null && y == null && z == null) {
    return undefined;
  }

  const axes = [toScaleAxis(x), toScaleAxis(y), toScaleAxis(z)] as const;
  const animatedAxes = axes
    .map(axis => axis.animation)
    .filter((animation): animation is ScalarKeyframedProperty => animation != null);

  if (animatedAxes.length === 0) {
    return {
      type: 'static',
      value: [axes[0].staticValue, axes[1].staticValue, axes[2].staticValue],
    };
  }

  if (!animatedAxes.every(animation => scalarAnimationIsContinuous(animation))) {
    return undefined;
  }
  if (!scaleAnimationFramesAreAligned(animatedAxes)) {
    return undefined;
  }

  const template = animatedAxes[0];
  const segmentHandles: ScaleSegmentHandles[] = [];

  for (let index = 0; index < template.keyframes.length - 1; index++) {
    const handles = resolveScaleSegmentHandles(animatedAxes, index);

    if (handles == null) {
      return undefined;
    }
    segmentHandles.push(handles);
  }

  const keyframes: IRKeyframe<IRVec3>[] = template.keyframes.map((keyframe, index) => ({
    frame: keyframe.frame,
    value: [readScaleAxisValue(axes[0], index), readScaleAxisValue(axes[1], index), readScaleAxisValue(axes[2], index)],
    ...(segmentHandles[index - 1]?.inTangent != null && {
      inTangent: segmentHandles[index - 1].inTangent,
    }),
    ...(segmentHandles[index]?.outTangent != null && {
      outTangent: segmentHandles[index].outTangent,
    }),
  }));

  return { type: 'keyframed', keyframes };
}

type ScalarKeyframedProperty = Extract<IRAnimatedProperty<number>, { type: 'keyframed' }>;

interface ScaleAxis {
  staticValue: number;
  animation?: ScalarKeyframedProperty;
}

interface ScaleSegmentHandles {
  outTangent?: IRBezierHandle;
  inTangent?: IRBezierHandle;
}

function toScaleAxis(property: IRAnimatedProperty<number> | undefined): ScaleAxis {
  if (property == null) {
    return { staticValue: 1 };
  }
  if (property.type === 'static') {
    return { staticValue: property.value };
  }

  const firstValue = property.keyframes[0]?.value ?? 1;
  const constant = property.keyframes.every(
    keyframe =>
      scalarValuesEqual(keyframe.value, firstValue) &&
      (keyframe.endValue == null || scalarValuesEqual(keyframe.endValue, firstValue)),
  );

  return constant ? { staticValue: firstValue } : { staticValue: firstValue, animation: property };
}

function scalarAnimationIsContinuous(animation: ScalarKeyframedProperty): boolean {
  return animation.keyframes.slice(0, -1).every((keyframe, index) => {
    const next = animation.keyframes[index + 1];
    const endValue = keyframe.hold === true ? keyframe.value : (keyframe.endValue ?? next.value);

    return scalarValuesEqual(endValue, next.value);
  });
}

function scaleAnimationFramesAreAligned(animations: ScalarKeyframedProperty[]): boolean {
  const template = animations[0];

  return animations.every(
    animation =>
      animation.keyframes.length === template.keyframes.length &&
      animation.keyframes.every((keyframe, index) => Math.abs(keyframe.frame - template.keyframes[index].frame) < 1e-6),
  );
}

function resolveScaleSegmentHandles(
  animations: ScalarKeyframedProperty[],
  index: number,
): ScaleSegmentHandles | undefined {
  let selected: ScaleSegmentHandles | undefined;

  for (const animation of animations) {
    const keyframe = animation.keyframes[index];
    const next = animation.keyframes[index + 1];
    const endValue = keyframe.endValue ?? next.value;

    if (scalarValuesEqual(keyframe.value, endValue)) {
      continue;
    }

    const candidate: ScaleSegmentHandles = {
      ...(keyframe.outTangent != null && { outTangent: keyframe.outTangent }),
      ...(next.inTangent != null && { inTangent: next.inTangent }),
    };

    if (selected != null && !scaleSegmentHandlesEqual(selected, candidate)) {
      return undefined;
    }
    selected = candidate;
  }

  if (selected != null) {
    return selected;
  }

  const keyframe = animations[0].keyframes[index];
  const next = animations[0].keyframes[index + 1];

  return {
    ...(keyframe.outTangent != null && { outTangent: keyframe.outTangent }),
    ...(next.inTangent != null && { inTangent: next.inTangent }),
  };
}

function scaleSegmentHandlesEqual(left: ScaleSegmentHandles, right: ScaleSegmentHandles): boolean {
  return bezierHandlesEqual(left.outTangent, right.outTangent) && bezierHandlesEqual(left.inTangent, right.inTangent);
}

function bezierHandlesEqual(left: IRBezierHandle | undefined, right: IRBezierHandle | undefined): boolean {
  if (left == null || right == null) {
    return left === right;
  }

  return Math.abs(left.x - right.x) < 1e-6 && Math.abs(left.y - right.y) < 1e-6;
}

function readScaleAxisValue(axis: ScaleAxis, index: number): number {
  return axis.animation?.keyframes[index]?.value ?? axis.staticValue;
}

function scalarValuesEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-6;
}

function parseScalarChannel(
  data: unknown[] | undefined,
  startFrame: number,
  endFrame: number,
): IRAnimatedProperty<number> | undefined {
  if (data == null || !Array.isArray(data) || data.length < 2) {
    return undefined;
  }

  const valueType = data[0] as ValueType;

  if (valueType === ValueType.CONSTANT) {
    const value = data[1];

    return typeof value === 'number' && Number.isFinite(value) ? { type: 'static', value } : undefined;
  }

  if (valueType === ValueType.BEZIER_CURVE) {
    const curves = data[1];

    if (!Array.isArray(curves)) {
      return undefined;
    }

    const keyframes = parseBezierKeyframes(curves, startFrame, endFrame);

    if (keyframes.length >= 2) {
      return { type: 'keyframed', keyframes };
    }
  }

  return undefined;
}
