import type { IRAnimatedProperty, IRLayer, IRTransform, IRVec3 } from '@galacean/animation-ir';
import type {
  BezierCurvePathValue,
  BezierKeyframeValue,
  ColorOverLifetime,
  FixedNumberExpression,
  PositionOverLifetime,
  RotationOverLifetime,
  SizeOverLifetime,
  TransformPlayableAssetData,
} from '@galacean/effects-specification';
import { ValueType } from '@galacean/effects-specification';
import {
  convertIRPositionKeyframesToGE,
  convertIRScalarKeyframesToGE,
  convertIRVectorKeyframesToGE,
  type IRToGETimeContext,
} from './bezier';
import { convert2dTo3dPoint } from '../../common/coordinate-mapping';
import { roundNumber } from '../../common/math';
import { getTimeContext } from './transform';

interface NormalizedAnimationContext {
  width: number;
  height: number;
}

type NormalizedTransformAnimation = Pick<
  TransformPlayableAssetData,
  'positionOverLifetime' | 'rotationOverLifetime' | 'sizeOverLifetime'
>;

/**
 * Encode normalized IR transform channels as GE timeline payloads without
 * consulting composition-specific passthrough data.
 */
export function buildNormalizedTransformAnimation(
  layer: IRLayer,
  ctx: NormalizedAnimationContext,
): NormalizedTransformAnimation {
  const transform = layer.transform;

  if (transform == null) {
    return {};
  }

  const timeContext = getTimeContext(layer);

  return {
    positionOverLifetime: buildPositionAnimation(transform, timeContext, ctx),
    rotationOverLifetime: buildRotationAnimation(transform, timeContext),
    sizeOverLifetime: buildSizeAnimation(transform, timeContext),
  };
}

function buildPositionAnimation(
  transform: IRTransform,
  timeContext: IRToGETimeContext,
  ctx: NormalizedAnimationContext,
): PositionOverLifetime | undefined {
  if (transform.position == null || transform.position.type === 'static') {
    return undefined;
  }

  const positionResult = convertIRPositionKeyframesToGE(transform.position, timeContext);

  if (positionResult == null) {
    return undefined;
  }

  const pathPoints: [number, number, number][] = [];
  const controlPoints: [number, number, number][] = [];

  const firstPathPoint = positionResult.pathPoints[0]?.[0];

  if (firstPathPoint != null) {
    const point3d = convert2dTo3dPoint(firstPathPoint[0], firstPathPoint[1], firstPathPoint[2], ctx.width, ctx.height);

    pathPoints.push(point3d);
  }

  for (const pathPoint of positionResult.pathPoints) {
    const endPoint3d = convert2dTo3dPoint(pathPoint[1][0], pathPoint[1][1], pathPoint[1][2], ctx.width, ctx.height);

    pathPoints.push(endPoint3d);
  }

  for (let i = 0; i < positionResult.controlPoints.length; i++) {
    const controlPointPair = positionResult.controlPoints[i];
    const pathPointPair = positionResult.pathPoints[i];

    const firstControlPoint = convert2dTo3dPoint(
      controlPointPair[0][0] + pathPointPair[0][0],
      controlPointPair[0][1] + pathPointPair[0][1],
      controlPointPair[0][2] + pathPointPair[0][2],
      ctx.width,
      ctx.height,
    );
    const secondControlPoint = convert2dTo3dPoint(
      controlPointPair[1][0] + pathPointPair[1][0],
      controlPointPair[1][1] + pathPointPair[1][1],
      controlPointPair[1][2] + pathPointPair[1][2],
      ctx.width,
      ctx.height,
    );

    controlPoints.push(firstControlPoint, secondControlPoint);
  }

  const curveData = positionResult.curves[0] ?? [];
  const easingData: BezierKeyframeValue[] = curveData.map(
    (keyframeValue: BezierKeyframeValue) => [keyframeValue[0], keyframeValue[1]] as BezierKeyframeValue,
  );

  const roundedPathPoints = pathPoints.map(roundPathPoint);
  const roundedControlPoints = controlPoints.map(roundPathPoint);

  const pathPayload: BezierCurvePathValue = [easingData, roundedPathPoints, roundedControlPoints];

  return {
    path: [ValueType.BEZIER_CURVE_PATH, pathPayload],
  };
}

function roundPathPoint(point: [number, number, number]): [number, number, number] {
  return [roundNumber(point[0], 4), roundNumber(point[1], 4), point[2]];
}

function buildRotationAnimation(
  transform: IRTransform,
  timeContext: IRToGETimeContext,
): RotationOverLifetime | undefined {
  const result: RotationOverLifetime = {};
  const rotation = transform.rotation;
  const x = buildRotationAxis(rotation?.x, timeContext);
  const y = buildRotationAxis(rotation?.y, timeContext);
  const z = buildRotationAxis(rotation?.z, timeContext);
  const hasX = x != null;
  const hasY = y != null;
  const hasZ = z != null;

  if (x != null) {
    result.x = x;
  }
  if (y != null) {
    result.y = y;
  }
  if (z != null) {
    result.z = z;
  }

  if (!hasZ && !hasX && !hasY) {
    return undefined;
  }

  result.asRotation = true;
  const axisCount = (hasX ? 1 : 0) + (hasY ? 1 : 0) + (hasZ ? 1 : 0);

  if (axisCount > 1 || hasX || hasY) {
    result.separateAxes = true;
  }

  return result;
}

function buildRotationAxis(
  property: IRAnimatedProperty<number> | undefined,
  timeContext: IRToGETimeContext,
): FixedNumberExpression | undefined {
  if (property == null) {
    return undefined;
  }
  if (property.type === 'static') {
    return property.value !== 0 ? [ValueType.CONSTANT, property.value] : undefined;
  }
  if (property.keyframes.length === 1) {
    const value = property.keyframes[0].value;

    return value !== 0 ? [ValueType.CONSTANT, value] : undefined;
  }
  if (!axisHasRotationValue(property)) {
    return undefined;
  }
  const curves = convertIRScalarKeyframesToGE(property, timeContext);

  return curves != null ? [ValueType.BEZIER_CURVE, curves[0]] : undefined;
}

function axisHasRotationValue(
  rotation: Extract<NonNullable<IRTransform['rotation']>['x'], { type: 'keyframed' }>,
): boolean {
  return rotation.keyframes.some(
    keyframe => Math.abs(keyframe.value) > 0.0001 || Math.abs(keyframe.endValue ?? 0) > 0.0001,
  );
}

function buildSizeAnimation(
  transform: IRTransform,
  timeContext: IRToGETimeContext,
): SizeOverLifetime | undefined {
  if (transform.scale == null) {
    return undefined;
  }

  if (transform.scale.type === 'keyframed') {
    if (transform.scale.keyframes.length === 1) {
      return buildConstantSizeAnimation(transform.scale.keyframes[0].value);
    }
    const curves = convertIRVectorKeyframesToGE(transform.scale, timeContext);

    if (curves != null && curves.length >= 2) {
      return {
        separateAxes: true,
        x: [ValueType.BEZIER_CURVE, curves[0]],
        y: [ValueType.BEZIER_CURVE, curves[1]],
        ...(curves.length >= 3 && { z: [ValueType.BEZIER_CURVE, curves[2]] }),
      };
    }

    return undefined;
  }

  return buildConstantSizeAnimation(transform.scale.value);
}

function buildConstantSizeAnimation(scale: IRVec3): SizeOverLifetime | undefined {
  if (scale.every(value => Math.abs(value - 1) <= 1e-6)) {
    return undefined;
  }

  return {
    separateAxes: true,
    x: [ValueType.CONSTANT, scale[0]],
    y: [ValueType.CONSTANT, scale[1]],
    z: [ValueType.CONSTANT, scale[2]],
  };
}

/** Encode normalized IR opacity as a GE color-over-lifetime payload. */
export function buildNormalizedColorAnimation(layer: IRLayer): ColorOverLifetime | undefined {
  const transform = layer.transform;

  if (transform?.opacity == null) {
    return undefined;
  }

  const timeContext = getTimeContext(layer);

  if (timeContext.outFrame - timeContext.inFrame <= 0) {
    return {
      opacity: [ValueType.CONSTANT, 0],
    };
  }

  if (transform.opacity.type === 'keyframed') {
    if (transform.opacity.keyframes.length === 1) {
      const opacityValue = transform.opacity.keyframes[0].value;

      return opacityValue !== 1 ? { opacity: [ValueType.CONSTANT, opacityValue] } : undefined;
    }
    const curves = convertIRScalarKeyframesToGE(transform.opacity, timeContext);

    if (curves != null) {
      return {
        opacity: [ValueType.BEZIER_CURVE, curves[0]],
      };
    }

    return undefined;
  }

  const opacityValue = transform.opacity.value;

  if (typeof opacityValue === 'number' && opacityValue !== 1) {
    return {
      opacity: [ValueType.CONSTANT, opacityValue],
    };
  }

  return undefined;
}
