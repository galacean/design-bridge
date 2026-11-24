/** 将 IR 动画关键帧编码为 Effects Bezier 曲线。 */
import type { IRAnimatedProperty, IRBezierHandle, IRKeyframe, IRPropertyValue } from '@galacean/animation-ir';
import {
  type BezierKeyframeValue,
  BezierKeyframeType,
} from '@galacean/effects-specification';

/** 与 ge-ir IRToGETimeContext 同构的图层可见帧区间。 */
export interface IRToGETimeContext {
  startFrame: number;
  endFrame: number;
}

const DEFAULT_OUT_TANGENT: IRBezierHandle = { x: 0.33, y: 0.33 };
const DEFAULT_IN_TANGENT: IRBezierHandle = { x: 0.67, y: 0.67 };

function roundNumber (value: number, digits: number): number {
  const factor = 10 ** digits;

  return Math.round(value * factor) / factor;
}

function lerp (from: number, to: number, ratio: number): number {
  return from + (to - from) * ratio;
}

function normalizeTime (frameTime: number, startFrame: number, endFrame: number): number {
  const frames = Math.max(1, endFrame - startFrame);

  return (frameTime - startFrame) / frames;
}

function getScalarValue (keyframe: IRKeyframe, dimensionIndex?: number): number {
  const value = keyframe.value;

  if (typeof value === 'number') {
    return value;
  }

  if (Array.isArray(value) && dimensionIndex != null) {
    return value[dimensionIndex] ?? 0;
  }

  return 0;
}

function valuesDiffer (a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length !== b.length || a.some((value, index) => Math.abs(Number(value) - Number(b[index])) > 1e-9);
  }

  return Math.abs(Number(a) - Number(b)) > 1e-9;
}

/**
 * Effects 曲线编码将每个曲线点作为相邻两段的端点。IR hold 后跟不同值时,只有两个原始点
 * 无法同时表达“保持到边界”和“边界处跳变”:在边界前插入一个非 hold 过渡点保持旧值,
 * 下一小段完成跳变。SVG 离散模式已插入的过渡点天然幂等(非 hold)。
 */
function expandHoldTransitions<T extends IRPropertyValue> (keyframes: IRKeyframe<T>[]): IRKeyframe<T>[] {
  const expanded: IRKeyframe<T>[] = [];

  for (let index = 0; index < keyframes.length; index++) {
    const current = keyframes[index];
    const next = keyframes[index + 1];

    expanded.push(current);

    if (current.hold !== true || next == null) { continue; }
    const gap = next.frame - current.frame;

    if (gap <= 1e-9 || !valuesDiffer(current.value, next.value)) { continue; }
    expanded.push({
      frame: next.frame - Math.min(0.001, gap / 2),
      value: current.value,
    });
  }

  return expanded;
}

function makeEaseOut (segment: number[]): BezierKeyframeValue {
  return [BezierKeyframeType.EASE_OUT, [
    roundNumber(segment[0], 6), roundNumber(segment[1], 6),
    roundNumber(segment[2], 6), roundNumber(segment[3], 6),
  ], BezierKeyframeType.EASE_OUT] as BezierKeyframeValue;
}

function makeEaseIn (previousSegment: number[]): BezierKeyframeValue {
  return [BezierKeyframeType.EASE_IN, [
    roundNumber(previousSegment[4], 6), roundNumber(previousSegment[5], 6),
    roundNumber(previousSegment[6], 6), roundNumber(previousSegment[7], 6),
  ], BezierKeyframeType.EASE_IN] as BezierKeyframeValue;
}

function makeEase (previousSegment: number[], currentSegment: number[]): BezierKeyframeValue {
  return [BezierKeyframeType.EASE, [
    roundNumber(previousSegment[4], 6), roundNumber(previousSegment[5], 6),
    roundNumber(previousSegment[6], 6), roundNumber(previousSegment[7], 6),
    roundNumber(currentSegment[2], 6), roundNumber(currentSegment[3], 6),
  ], BezierKeyframeType.EASE] as BezierKeyframeValue;
}

function serializeBezierSegments (segments: number[][]): BezierKeyframeValue[] | undefined {
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

function buildCurveForDimension (
  keyframes: IRKeyframe[],
  timeContext: IRToGETimeContext,
  dimensionIndex: number | undefined,
): BezierKeyframeValue[] | undefined {
  if (keyframes.length < 2) {
    return undefined;
  }

  const expandedKeyframes = expandHoldTransitions(keyframes);
  const bezierCurves: number[][] = [];

  for (let i = 0; i < expandedKeyframes.length - 1; i++) {
    const keyframe = expandedKeyframes[i];
    const nextKeyframe = expandedKeyframes[i + 1];
    const t0 = normalizeTime(keyframe.frame, timeContext.startFrame, timeContext.endFrame);
    const t1 = normalizeTime(nextKeyframe.frame, timeContext.startFrame, timeContext.endFrame);
    const v0 = getScalarValue(keyframe, dimensionIndex);
    const endKeyframe = keyframe.endValue != null ? { ...keyframe, value: keyframe.endValue } : nextKeyframe;
    const v1 = keyframe.hold === true ? v0 : getScalarValue(endKeyframe, dimensionIndex);
    const outHandle = keyframe.hold === true
      ? { x: 0, y: 0 }
      : (keyframe.outTangent ?? DEFAULT_OUT_TANGENT);
    const inHandle = keyframe.hold === true
      ? { x: 1, y: 1 }
      : (nextKeyframe.inTangent ?? DEFAULT_IN_TANGENT);

    bezierCurves.push([
      t0, v0,
      lerp(t0, t1, outHandle.x), lerp(v0, v1, outHandle.y),
      lerp(t0, t1, inHandle.x), lerp(v0, v1, inHandle.y),
      t1, v1,
    ]);
  }

  if (bezierCurves.length === 0) {
    return undefined;
  }

  const firstTime = bezierCurves[0][0];

  if (firstTime > 0) {
    const firstValue = bezierCurves[0][1];

    bezierCurves.unshift([
      0, firstValue, 0, firstValue, firstTime, firstValue, firstTime, firstValue,
    ]);
  }

  return serializeBezierSegments(bezierCurves);
}

/** 把 1D 动画属性编码为 Effects BezierKeyframeValue 曲线(单维外层数组)。 */
export function convertIRScalarKeyframesToGE (
  property: IRAnimatedProperty<number>,
  timeContext: IRToGETimeContext,
): BezierKeyframeValue[][] | undefined {
  if (property.type !== 'keyframed' || property.keyframes == null || property.keyframes.length < 2) {
    return undefined;
  }

  const curve = buildCurveForDimension(property.keyframes, timeContext, undefined);

  return curve != null ? [curve] : undefined;
}
