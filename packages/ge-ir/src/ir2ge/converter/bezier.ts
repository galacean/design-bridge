/**
 * Encode IR keyframes as GE BezierKeyframeValue payloads.
 *
 * Wire format:
 * - First:  [EASE_OUT(3), [t, v, out_cp_x, out_cp_y]]
 * - Middle: [EASE(1),     [in_cp_x, in_cp_y, t, v, out_cp_x, out_cp_y]]
 * - Last:   [EASE_IN(2),  [in_cp_x, in_cp_y, t, v]]
 *
 * Time is normalized to the layer's visible frame range.
 */

import type { IRAnimatedProperty, IRBezierHandle, IRKeyframe, IRVec3 } from '@galacean/animation-ir';
import { type BezierKeyframeValue, BezierKeyframeType } from '@galacean/effects-specification';
import { lerp, roundNumber } from '../../common/math';

export interface IRToGETimeContext {
  /** Layer visible start frame. */
  inFrame: number;
  /** Layer visible end frame. */
  outFrame: number;
}

interface GEPositionAnimationData {
  /** One-dimensional timing curves in BezierKeyframeValue format. */
  curves: BezierKeyframeValue[][];
  /** Segment start and end positions, including depth. */
  pathPoints: [IRVec3, IRVec3][];
  /** Outgoing and incoming control offsets in the same coordinates as the endpoints. */
  controlPoints: [IRVec3, IRVec3][];
}

const DEFAULT_OUT_TANGENT: IRBezierHandle = { x: 0.33, y: 0.33 };
const DEFAULT_IN_TANGENT: IRBezierHandle = { x: 0.67, y: 0.67 };

function normalizeTime(frameTime: number, startFrame: number, endFrame: number): number {
  const frames = Math.max(1, endFrame - startFrame);

  return (frameTime - startFrame) / frames;
}

function getScalarValue(keyframe: IRKeyframe<number | IRVec3>, dimensionIndex?: number): number {
  const value = keyframe.value;

  if (typeof value === 'number') {
    return value;
  }

  if (Array.isArray(value) && dimensionIndex != null) {
    return value[dimensionIndex] ?? 0;
  }

  return 0;
}

/** Convert a scalar property to a single GE Bezier curve. */
export function convertIRScalarKeyframesToGE(
  property: IRAnimatedProperty<number>,
  timeContext: IRToGETimeContext,
): BezierKeyframeValue[][] | undefined {
  if (property.type === 'static' || property.keyframes == null || property.keyframes.length < 2) {
    return undefined;
  }

  const curve = buildCurveForDimension(property.keyframes, timeContext, undefined);

  return curve != null ? [curve] : undefined;
}

/** Convert a vector property to one GE Bezier curve per dimension. */
export function convertIRVectorKeyframesToGE(
  property: IRAnimatedProperty<IRVec3>,
  timeContext: IRToGETimeContext,
): BezierKeyframeValue[][] | undefined {
  if (property.type === 'static' || property.keyframes == null || property.keyframes.length < 2) {
    return undefined;
  }

  const firstValue = property.keyframes[0].value;
  const dimensions = Array.isArray(firstValue) ? firstValue.length : 1;
  const curves: BezierKeyframeValue[][] = [];

  for (let dimensionIndex = 0; dimensionIndex < dimensions; dimensionIndex++) {
    const curve = buildCurveForDimension(property.keyframes, timeContext, dimensionIndex);

    curves.push(curve ?? []);
  }

  return curves.length > 0 ? curves : undefined;
}

/** Convert position keyframes to GE path, control-point, and timing payloads. */
export function convertIRPositionKeyframesToGE(
  property: IRAnimatedProperty<IRVec3>,
  timeContext: IRToGETimeContext,
): GEPositionAnimationData | undefined {
  if (property.type === 'static' || property.keyframes == null || property.keyframes.length < 2) {
    return undefined;
  }

  const keyframes = property.keyframes;
  const pathPoints: [IRVec3, IRVec3][] = [];
  const controlPoints: [IRVec3, IRVec3][] = [];
  const timingCurvePoints: Array<{
    normalizedTime: number;
    outTangent: IRBezierHandle;
    inTangent: IRBezierHandle;
  }> = [];

  for (let i = 0; i < keyframes.length; i++) {
    const keyframe = keyframes[i];
    const normalizedTime = normalizeTime(keyframe.frame, timeContext.inFrame, timeContext.outFrame);

    timingCurvePoints.push({
      normalizedTime,
      outTangent: keyframe.outTangent ?? DEFAULT_OUT_TANGENT,
      inTangent: keyframe.inTangent ?? DEFAULT_IN_TANGENT,
    });

    if (i < keyframes.length - 1) {
      const nextKeyframe = keyframes[i + 1];
      const startPosition = keyframe.value ?? [0, 0, 0];
      const segmentEnd =
        keyframe.hold === true ? startPosition : (keyframe.endValue ?? nextKeyframe.value ?? startPosition);

      pathPoints.push([
        [...startPosition],
        [...segmentEnd],
      ]);

      // IR stores the outgoing handle on the current keyframe and the incoming
      // handle on the next. Missing handles use linear one-third offsets.
      let outgoingControlPoint: IRVec3;
      let incomingControlPoint: IRVec3;

      if (keyframe.hold === true) {
        outgoingControlPoint = [0, 0, 0];
        incomingControlPoint = [0, 0, 0];
      } else if (keyframe.spatialOut != null && nextKeyframe.spatialIn != null) {
        outgoingControlPoint = [keyframe.spatialOut[0], keyframe.spatialOut[1], keyframe.spatialOut[2] ?? 0];
        incomingControlPoint = [nextKeyframe.spatialIn[0], nextKeyframe.spatialIn[1], nextKeyframe.spatialIn[2] ?? 0];
      } else {
        const startX = startPosition[0] ?? 0;
        const startY = startPosition[1] ?? 0;
        const endX = segmentEnd[0] ?? 0;
        const endY = segmentEnd[1] ?? 0;
        const dz = (segmentEnd[2] - startPosition[2]) / 3;

        outgoingControlPoint = [-startX / 3 + endX / 3, -startY / 3 + endY / 3, dz];
        incomingControlPoint = [startX / 3 - endX / 3, startY / 3 - endY / 3, (startPosition[2] - segmentEnd[2]) / 3];
      }
      controlPoints.push([outgoingControlPoint, incomingControlPoint]);

      const nextStart = nextKeyframe.value;

      if (segmentEnd.some((value, dimension) => value !== nextStart[dimension])) {
        // Coincident times preserve a reset without interpolating across it.
        timingCurvePoints.push({
          normalizedTime: normalizeTime(nextKeyframe.frame, timeContext.inFrame, timeContext.outFrame),
          inTangent: nextKeyframe.inTangent ?? DEFAULT_IN_TANGENT,
          outTangent: DEFAULT_OUT_TANGENT,
        });
        pathPoints.push([[...segmentEnd], [...nextStart]]);
        controlPoints.push([[0, 0, 0], [0, 0, 0]]);
      }
    }
  }

  // A delayed position animation needs a stationary bridge from time zero.
  // Override the first incoming handle so the bridge remains flat.
  if (timingCurvePoints.length > 0 && timingCurvePoints[0].normalizedTime > 0) {
    timingCurvePoints[0].inTangent = { x: 1, y: 1 };
    timingCurvePoints.unshift({
      normalizedTime: 0,
      outTangent: { x: 0, y: 0 },
      inTangent: { x: 1, y: 1 },
    });
    pathPoints.unshift([pathPoints[0][0], pathPoints[0][0]]);
    controlPoints.unshift([
      [0, 0, 0],
      [0, 0, 0],
    ]);
  }

  const timingCurves = buildPositionTimingCurves(timingCurvePoints);

  return {
    curves: timingCurves != null ? [timingCurves] : [[]],
    pathPoints,
    controlPoints,
  };
}

function makeEaseOut(segment: number[]): BezierKeyframeValue {
  return [
    BezierKeyframeType.EASE_OUT,
    [roundNumber(segment[0], 4), roundNumber(segment[1], 4), roundNumber(segment[2], 4), roundNumber(segment[3], 4)],
    BezierKeyframeType.EASE_OUT,
  ] as BezierKeyframeValue;
}

function makeEaseIn(previousSegment: number[]): BezierKeyframeValue {
  return [
    BezierKeyframeType.EASE_IN,
    [
      roundNumber(previousSegment[4], 4),
      roundNumber(previousSegment[5], 4),
      roundNumber(previousSegment[6], 4),
      roundNumber(previousSegment[7], 4),
    ],
    BezierKeyframeType.EASE_IN,
  ] as BezierKeyframeValue;
}

function makeEase(previousSegment: number[], currentSegment: number[]): BezierKeyframeValue {
  return [
    BezierKeyframeType.EASE,
    [
      roundNumber(previousSegment[4], 4),
      roundNumber(previousSegment[5], 4),
      roundNumber(previousSegment[6], 4),
      roundNumber(previousSegment[7], 4),
      roundNumber(currentSegment[2], 4),
      roundNumber(currentSegment[3], 4),
    ],
    BezierKeyframeType.EASE,
  ] as BezierKeyframeValue;
}

function serializeBezierSegments(segments: number[][]): BezierKeyframeValue[] | undefined {
  if (segments.length === 0) {
    return undefined;
  }

  const result: BezierKeyframeValue[] = [];
  const totalPoints = segments.length + 1;

  for (let i = 0; i < totalPoints; i++) {
    if (i === 0) {
      result.push(makeEaseOut(segments[0]));
    } else if (i === totalPoints - 1) {
      result.push(makeEaseIn(segments[i - 1]));
    } else {
      result.push(makeEase(segments[i - 1], segments[i]));
    }
  }

  return result;
}

function buildCurveForDimension(
  keyframes: IRKeyframe<number | IRVec3>[],
  timeContext: IRToGETimeContext,
  dimensionIndex: number | undefined,
): BezierKeyframeValue[] | undefined {
  if (keyframes.length < 2) {
    return undefined;
  }

  const bezierCurves: number[][] = [];

  for (let i = 0; i < keyframes.length - 1; i++) {
    const keyframe = keyframes[i];
    const nextKeyframe = keyframes[i + 1];
    const t0 = normalizeTime(keyframe.frame, timeContext.inFrame, timeContext.outFrame);
    const t1 = normalizeTime(nextKeyframe.frame, timeContext.inFrame, timeContext.outFrame);
    const v0 = getScalarValue(keyframe, dimensionIndex);
    const endKeyframe = keyframe.endValue != null ? { ...keyframe, value: keyframe.endValue } : nextKeyframe;
    const v1 = keyframe.hold === true ? v0 : getScalarValue(endKeyframe, dimensionIndex);
    const outHandle = keyframe.hold === true ? { x: 0, y: 0 } : (keyframe.outTangent ?? DEFAULT_OUT_TANGENT);
    // IR stores a segment's incoming tangent on its ending keyframe.
    const inHandle = keyframe.hold === true ? { x: 1, y: 1 } : (nextKeyframe.inTangent ?? DEFAULT_IN_TANGENT);

    const outControlPointX = lerp(t0, t1, outHandle.x);
    const outControlPointY = lerp(v0, v1, outHandle.y);
    const inControlPointX = lerp(t0, t1, inHandle.x);
    const inControlPointY = lerp(v0, v1, inHandle.y);

    bezierCurves.push([t0, v0, outControlPointX, outControlPointY, inControlPointX, inControlPointY, t1, v1]);
    const nextValue = getScalarValue(nextKeyframe, dimensionIndex);

    if (v1 !== nextValue) {
      bezierCurves.push([t1, v1, t1, v1, t1, nextValue, t1, nextValue]);
    }
  }

  if (bezierCurves.length === 0) {
    return undefined;
  }

  const firstTime = bezierCurves[0][0];

  if (firstTime > 0) {
    const firstValue = bezierCurves[0][1];

    bezierCurves.unshift([0, firstValue, 0, firstValue, firstTime, firstValue, firstTime, firstValue]);
  }

  return serializeBezierSegments(bezierCurves);
}

function buildPositionTimingCurves(
  points: Array<{ normalizedTime: number; outTangent: IRBezierHandle; inTangent: IRBezierHandle }>,
): BezierKeyframeValue[] | undefined {
  if (points.length < 2) {
    return undefined;
  }

  const bezierCurves: number[][] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const currentPoint = points[i];
    const nextPoint = points[i + 1];
    const t0 = currentPoint.normalizedTime;
    const t1 = nextPoint.normalizedTime;
    const outControlPointX = lerp(t0, t1, currentPoint.outTangent.x);
    const outControlPointY = lerp(t0, t1, currentPoint.outTangent.y);
    // IR stores a segment's incoming tangent on its ending keyframe.
    const inControlPointX = lerp(t0, t1, nextPoint.inTangent.x);
    const inControlPointY = lerp(t0, t1, nextPoint.inTangent.y);

    bezierCurves.push([t0, t0, outControlPointX, outControlPointY, inControlPointX, inControlPointY, t1, t1]);
  }

  return serializeBezierSegments(bezierCurves);
}
