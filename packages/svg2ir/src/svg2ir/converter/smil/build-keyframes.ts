import type { IRAnimatedProperty, IRKeyframe, IRPropertyValue, IRVec3 } from '@galacean/animation-ir';
import { decomposeMatrix, IDENTITY, multiply, type SVGMatrix } from '../../matrix';
import {
  interpolateValues, sampleExpandedValue, splitCubicAtRatio,
} from './parse-timeline';
import { EPSILON, type SMILAnimation, type SMILSample } from './types';

function decorateKeyframes<T extends IRPropertyValue> (
  animation: SMILAnimation,
  keyframes: IRKeyframe<T>[],
): void {
  for (let i = 0; i < keyframes.length - 1; i++) {
    const sample = animation.samples[i];
    const nextSample = animation.samples[i + 1];

    if (sample == null || nextSample == null || nextSample.time <= sample.time + EPSILON) { continue; }
    if (animation.calcMode === 'discrete') {
      keyframes[i].hold = true;
      continue;
    }
    if (animation.calcMode !== 'spline' || sample.cycle !== nextSample.cycle) { continue; }
    const partialSegment = nextSample.activeEndSegment;
    const spline = animation.keySplines[sample.sourceIndex];

    if (spline != null) {
      if (partialSegment != null) {
        const authoredSpan = partialSegment.endTime - partialSegment.startTime;
        const simpleTime = nextSample.time - partialSegment.cycleStartTime;
        const authoredRatio = authoredSpan <= EPSILON
          ? 1
          : (simpleTime - partialSegment.startTime) / authoredSpan;
        const split = splitCubicAtRatio(
          Math.max(0, Math.min(1, authoredRatio)),
          spline,
        );

        keyframes[i].outTangent = split.out;
        keyframes[i + 1].inTangent = split.in;
      } else {
        keyframes[i].outTangent = spline[0];
        keyframes[i + 1].inTangent = spline[1];
      }
    }
  }
}

export function makeKeyframes<T extends IRPropertyValue> (
  animation: SMILAnimation,
  frameRate: number,
  mapValue: (value: number[], index: number) => T,
  baseValue?: T,
): IRKeyframe<T>[] {
  let keyframes: IRKeyframe<T>[] = animation.samples.map((sample, index) => ({
    frame: sample.time * frameRate,
    value: mapValue(sample.value, index),
  }));

  decorateKeyframes(animation, keyframes);
  if (baseValue != null && animation.begin > 0) {
    keyframes.unshift({ frame: 0, value: baseValue, hold: true });
  }
  if (baseValue != null) {
    for (let index = 0; index < animation.intervals.length; index++) {
      const interval = animation.intervals[index];
      const next = animation.intervals[index + 1];
      const last = keyframes[interval.sampleEnd - 1 + (animation.begin > 0 ? 1 : 0)];
      const hasGap = next == null || next.begin > interval.end + EPSILON;

      if (last == null || !hasGap) { continue; }
      if (animation.fill === 'remove' && !animation.indefinite) {
        const endFrame = interval.end * frameRate;

        if (last.frame < endFrame - EPSILON) {
          keyframes.push({ frame: endFrame, value: last.value });
        }
        if (!keyframeValuesEqual(last.value, baseValue)) {
          keyframes.push({ frame: endFrame, value: baseValue, hold: true });
        } else if (next != null) {
          last.hold = true;
        }
      } else if (next != null) {
        last.hold = true;
      }
    }
  }
  keyframes.sort((a, b) => a.frame - b.frame);
  keyframes = ensureStrictlyIncreasingFrames(keyframes);

  if (animation.calcMode === 'discrete') {
    // 标量 Bezier 编码会把 hold 段的结束值合并到下一个曲线点。
    // 直接使用 [old(hold), new] 会丢失跳变，因此保留 hold 语义，并在每次跳变前插入
    // sub-frame bridge。bridge 宽度为 0.001 帧，满足 IR 帧号严格递增约束。
    const expanded: IRKeyframe<T>[] = [];

    for (let i = 0; i < keyframes.length; i++) {
      const current = keyframes[i];
      const next = keyframes[i + 1];

      expanded.push(current);
      if (next == null || current.hold !== true) { continue; }
      const gap = next.frame - current.frame;

      if (gap <= EPSILON) { continue; }
      const bridgeWidth = Math.min(0.001, gap / 2);

      expanded.push({ frame: next.frame - bridgeWidth, value: current.value });
    }
    keyframes = expanded;
  }

  return keyframes;
}

function keyframeValuesEqual<T extends IRPropertyValue> (a: T, b: T): boolean {
  if (typeof a === 'number' && typeof b === 'number') { return Math.abs(a - b) < EPSILON; }
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) { return false; }

  return a.every((value, index) => Math.abs(value - b[index]) < EPSILON);
}

/**
 * 帧取整可能使 repeat 的最终值与下一周期初始值落在同一帧。
 * 将 outgoing value 移到边界前的 sub-frame bridge；相同值冲突时合并，保持 IR 帧号严格递增。
 */
function ensureStrictlyIncreasingFrames<T extends IRPropertyValue> (keyframes: IRKeyframe<T>[]): IRKeyframe<T>[] {
  const ordered: IRKeyframe<T>[] = [];

  for (const keyframe of keyframes) {
    const previous = ordered[ordered.length - 1];

    if (previous == null || keyframe.frame > previous.frame + EPSILON) {
      ordered.push(keyframe);
      continue;
    }
    if (keyframeValuesEqual(previous.value, keyframe.value)) {
      ordered[ordered.length - 1] = { ...previous, ...keyframe, frame: previous.frame };
      continue;
    }

    const beforePrevious = ordered[ordered.length - 2];
    const boundaryFrame = Math.max(previous.frame, keyframe.frame);
    const available = boundaryFrame - (beforePrevious?.frame ?? -Infinity);

    if (boundaryFrame > 0 && available > EPSILON) {
      previous.frame = boundaryFrame - Math.min(0.001, available / 2);
      keyframe.frame = boundaryFrame;
    } else {
      // 帧 0 的退化冲突没有可表示的前置时刻，因此按 authored 顺序保留两个值，并使用极小偏移。
      keyframe.frame = previous.frame + 0.001;
    }
    ordered.push(keyframe);
  }

  return ordered;
}

export function matrixForTransformValue (type: string, value: number[]): SVGMatrix {
  if (type === 'translate') {
    return { a: 1, b: 0, c: 0, d: 1, e: value[0] ?? 0, f: value[1] ?? 0 };
  }
  if (type === 'scale') {
    const sx = value[0] ?? 1;
    const sy = value[1] ?? sx;

    return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
  }
  if (type === 'rotate') {
    const angle = (value[0] ?? 0) * Math.PI / 180;
    const cx = value[1] ?? 0;
    const cy = value[2] ?? 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotation: SVGMatrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
    const toPivot: SVGMatrix = { a: 1, b: 0, c: 0, d: 1, e: cx, f: cy };
    const fromPivot: SVGMatrix = { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy };

    return multiply(multiply(toPivot, rotation), fromPivot);
  }

  return IDENTITY;
}

export function applyRotateSpatialTangents (
  animation: SMILAnimation,
  keyframes: IRKeyframe<IRVec3>[],
  baseMatrix: SVGMatrix,
  localCenter: [number, number],
): void {
  const keyframeOffset = animation.begin > 0 ? 1 : 0;

  for (let i = 0; i < animation.samples.length - 1; i++) {
    const start = animation.samples[i];
    const end = animation.samples[i + 1];

    if (start.cycle !== end.cycle || start.value[1] !== end.value[1] || start.value[2] !== end.value[2]) { continue; }
    const delta = ((end.value[0] ?? 0) - (start.value[0] ?? 0)) * Math.PI / 180;

    if (Math.abs(delta) < EPSILON || Math.abs(delta) >= Math.PI * 2 - EPSILON) { continue; }
    const pivotX = start.value[1] ?? 0;
    const pivotY = start.value[2] ?? 0;
    const radiusX = localCenter[0] - pivotX;
    const radiusY = localCenter[1] - pivotY;
    const startAngle = (start.value[0] ?? 0) * Math.PI / 180;
    const endAngle = (end.value[0] ?? 0) * Math.PI / 180;
    const rotateRadius = (angle: number): [number, number] => [
      Math.cos(angle) * radiusX - Math.sin(angle) * radiusY,
      Math.sin(angle) * radiusX + Math.cos(angle) * radiusY,
    ];
    const mapVector = (vector: [number, number]): [number, number] => [
      baseMatrix.a * vector[0] + baseMatrix.c * vector[1],
      baseMatrix.b * vector[0] + baseMatrix.d * vector[1],
    ];
    const startRadius = rotateRadius(startAngle);
    const endRadius = rotateRadius(endAngle);
    const startTangent = mapVector([-startRadius[1], startRadius[0]]);
    const endTangent = mapVector([-endRadius[1], endRadius[0]]);
    const handleScale = 4 / 3 * Math.tan(delta / 4);
    const startKeyframe = keyframes[i + keyframeOffset];
    const endKeyframe = keyframes[i + 1 + keyframeOffset];

    startKeyframe.spatialOut = [startTangent[0] * handleScale, startTangent[1] * handleScale];
    endKeyframe.spatialIn = [-endTangent[0] * handleScale, -endTangent[1] * handleScale];
  }
}

export function staticValue<T extends number | IRVec3> (property: IRAnimatedProperty<T> | undefined, fallback: T): T {
  if (property == null) { return fallback; }
  if (property.type === 'keyframed') { return property.keyframes[0]?.value ?? fallback; }

  return property.value;
}

export function subdivideFullTurn (animation: SMILAnimation): SMILAnimation {
  if (animation.type !== 'rotate' || !['linear', 'paced'].includes(animation.calcMode)) { return animation; }
  const samples: SMILSample[] = [];

  for (let i = 0; i < animation.samples.length - 1; i++) {
    const start = animation.samples[i];
    const end = animation.samples[i + 1];

    if (i === 0) { samples.push(start); }
    const delta = (end.value[0] ?? 0) - (start.value[0] ?? 0);
    const steps = start.cycle === end.cycle && end.time > start.time + EPSILON
      ? Math.max(1, Math.ceil(Math.abs(delta) / 90))
      : 1;

    for (let step = 1; step < steps; step++) {
      const ratio = step / steps;

      samples.push({
        time: start.time + (end.time - start.time) * ratio,
        value: interpolateValues(start.value, end.value, ratio),
        cycle: start.cycle,
        sourceIndex: start.sourceIndex,
      });
    }
    samples.push(end);
  }

  return samples.length > 0 ? { ...animation, samples } : animation;
}

export function unwrapRotationValues (animation: SMILAnimation, matrices: SVGMatrix[]): number[] {
  if (animation.type !== 'rotate') {
    return matrices.map(matrix => decomposeMatrix(matrix).rotation);
  }
  const values: number[] = [];

  for (let i = 0; i < matrices.length; i++) {
    const raw = decomposeMatrix(matrices[i]).rotation;

    if (i === 0) {
      values.push(raw);
      continue;
    }
    const authoredDelta = (animation.samples[i].value[0] ?? 0) - (animation.samples[i - 1].value[0] ?? 0);
    const expected = values[i - 1] + authoredDelta;

    values.push(raw + Math.round((expected - raw) / 360) * 360);
  }

  return values;
}

export function sampleAnimationValue (animation: SMILAnimation, time: number): number[] | null {
  if (time < animation.begin - EPSILON) { return null; }
  let frozen: number[] | null = null;

  for (const interval of animation.intervals) {
    if (time < interval.begin - EPSILON) { break; }
    const intervalSamples = animation.samples.slice(interval.sampleStart, interval.sampleEnd);

    if (time < interval.end - EPSILON) {
      return sampleExpandedValue(intervalSamples, time, animation.calcMode, animation.keySplines)?.value ?? null;
    }
    if (animation.fill === 'freeze') {
      frozen = intervalSamples[intervalSamples.length - 1]?.value ?? frozen;
    } else {
      frozen = null;
    }
  }

  return frozen;
}
