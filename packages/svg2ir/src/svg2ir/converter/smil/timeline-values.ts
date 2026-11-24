/**
 * SMIL 数值、曲线和采样处理。
 *
 * 本模块不解析 begin/end 事件，只负责动画值的解释、插值和时间窗口内采样。
 */
import { mapSVGColorToIRColor } from '../../map-color';
import type { IRBezierHandle } from '@galacean/animation-ir';
import { EPSILON, type SMILAnimation, type SMILSample, type SMILValueParser } from './types';

export function parseNumberList (value: string): number[] {
  return (value.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}

function parseRotateValue (value: string): number[] {
  const p = parseNumberList(value);

  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
}

function parseTranslateValue (value: string): number[] {
  const p = parseNumberList(value);

  return [p[0] ?? 0, p[1] ?? 0];
}

function parseScaleValue (value: string): number[] {
  const p = parseNumberList(value);
  const sx = p[0] ?? 1;

  return [sx, p[1] ?? sx];
}

export function parseValue (value: string, type: string): number[] {
  if (type === 'rotate') { return parseRotateValue(value); }
  if (type === 'translate') { return parseTranslateValue(value); }
  if (type === 'scale') { return parseScaleValue(value); }

  return [Number(value.trim()) || 0];
}

export function parseColorValue (value: string): number[] | null {
  const color = mapSVGColorToIRColor(value, 1);

  return color == null ? null : color;
}

export function parsePointValue (value: string): [number, number] {
  const points = parseNumberList(value);

  return [points[0] ?? 0, points[1] ?? 0];
}
export function parseKeySplines (tag: globalThis.Element, segmentCount: number): IRBezierHandle[][] {
  const raw = tag.getAttribute('keySplines') ?? '';
  const splines = raw.split(';').map(segment => parseNumberList(segment)).filter(values => values.length >= 4);

  if (splines.length !== segmentCount) { return []; }

  return splines.map(values => [
    { x: values[0], y: values[1] },
    { x: values[2], y: values[3] },
  ]);
}

function trimTrailingEmptyValues (values: string[]): string[] {
  let end = values.length;

  while (end > 0 && values[end - 1].trim() === '') {
    end--;
  }

  return values.slice(0, end);
}

/** 根据相邻值的数值距离计算 paced 动画的时间节点，忽略 authored keyTimes。 */
export function parsePacedKeyTimes (values: number[][]): number[] {
  if (values.length <= 1) { return values.map(() => 0); }
  const distances = values.slice(1).map((value, index) => {
    const previous = values[index] ?? [];
    const length = Math.max(previous.length, value.length);
    let squared = 0;

    for (let component = 0; component < length; component++) {
      const delta = (value[component] ?? 0) - (previous[component] ?? 0);

      squared += delta * delta;
    }

    return Math.sqrt(squared);
  });
  const totalDistance = distances.reduce((sum, distance) => sum + distance, 0);

  if (totalDistance <= EPSILON) {
    return values.map((_, index) => index / (values.length - 1));
  }
  const keyTimes = [0];
  let distance = 0;

  for (const segmentDistance of distances) {
    distance += segmentDistance;
    keyTimes.push(distance / totalDistance);
  }

  return keyTimes;
}

export function parseValues (
  tag: globalThis.Element,
  type: string,
  valueParser: SMILValueParser = parseValue,
  underlyingValue?: number[],
): number[][] {
  const parseAll = (rawValues: string[]): number[][] => {
    const parsed = rawValues.map(value => valueParser(value, type));

    return parsed.some(value => value == null) ? [] : parsed as number[][];
  };
  const valuesRaw = tag.getAttribute('values');

  if (valuesRaw != null && valuesRaw.trim() !== '') {
    return parseAll(trimTrailingEmptyValues(valuesRaw.split(';')));
  }
  const from = tag.getAttribute('from');
  const to = tag.getAttribute('to');

  if (from != null && to != null) {
    return parseAll([from, to]);
  }
  if (from != null && tag.getAttribute('by') != null) {
    const parsedFrom = valueParser(from, type);
    const parsedBy = valueParser(tag.getAttribute('by')!, type);

    if (parsedFrom == null || parsedBy == null) { return []; }

    return [parsedFrom, parsedFrom.map((value, index) => value + (parsedBy[index] ?? 0))];
  }
  if (to != null && underlyingValue != null) {
    const parsedTo = valueParser(to, type);

    return parsedTo == null ? [] : [underlyingValue, parsedTo];
  }
  const by = tag.getAttribute('by');

  if (by != null) {
    const delta = valueParser(by, type);

    if (delta == null) { return []; }
    const zero = delta.map(() => 0);

    return [zero, delta];
  }

  return [];
}

export function valuesEqual (a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) < EPSILON);
}

export function interpolateValues (from: number[], to: number[], ratio: number): number[] {
  return from.map((value, index) => value + ((to[index] ?? value) - value) * ratio);
}

function cubicBezierCoordinate (t: number, p1: number, p2: number): number {
  const inv = 1 - t;

  return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
}

export function cubicBezierRatio (ratio: number, handles: IRBezierHandle[]): number {
  const [outHandle, inHandle] = handles;

  if (outHandle == null || inHandle == null) { return ratio; }
  let low = 0;
  let high = 1;

  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    const x = cubicBezierCoordinate(mid, outHandle.x, inHandle.x);

    if (x < ratio) { low = mid; } else { high = mid; }
  }

  return cubicBezierCoordinate((low + high) / 2, outHandle.y, inHandle.y);
}
export function splitCubicAtRatio (
  ratio: number,
  handles: IRBezierHandle[],
): { out: IRBezierHandle; in: IRBezierHandle } {
  const [outHandle, inHandle] = handles;
  const target = Math.max(0, Math.min(1, ratio));

  if (outHandle == null || inHandle == null || target <= EPSILON || target >= 1 - EPSILON) {
    return {
      out: outHandle ?? { x: 0.33, y: 0.33 },
      in: inHandle ?? { x: 0.67, y: 0.67 },
    };
  }

// 查找 x 坐标等于 authored-time ratio 的 Bezier 参数。
  let low = 0;
  let high = 1;

  for (let iteration = 0; iteration < 32; iteration++) {
    const parameter = (low + high) / 2;

    if (cubicBezierCoordinate(parameter, outHandle.x, inHandle.x) < target) {
      low = parameter;
    } else {
      high = parameter;
    }
  }

  const parameter = (low + high) / 2;
  const p0 = { x: 0, y: 0 };
  const p1 = { x: outHandle.x, y: outHandle.y };
  const p2 = { x: inHandle.x, y: inHandle.y };
  const p3 = { x: 1, y: 1 };
  const lerpPoint = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: a.x + (b.x - a.x) * parameter,
    y: a.y + (b.y - a.y) * parameter,
  });
  const q1 = lerpPoint(p0, p1);
  const r1 = lerpPoint(p1, p2);
  const r2 = lerpPoint(p2, p3);
  const q2 = lerpPoint(q1, r1);
  const s1 = lerpPoint(r1, r2);
  const q3 = lerpPoint(q2, s1);

  return {
    out: {
      x: q3.x <= EPSILON ? 0 : q1.x / q3.x,
      y: q3.y <= EPSILON ? 0 : q1.y / q3.y,
    },
    in: {
      x: q3.x <= EPSILON ? 1 : q2.x / q3.x,
      y: q3.y <= EPSILON ? 1 : q2.y / q3.y,
    },
  };
}

export function sampleExpandedValue (
  samples: SMILSample[],
  time: number,
  calcMode: SMILAnimation['calcMode'],
  keySplines: IRBezierHandle[][],
): SMILSample | null {
  let previous: SMILSample | null = null;
  let next: SMILSample | null = null;

  for (const sample of samples) {
    if (sample.time <= time + EPSILON) {
      previous = sample;
    } else {
      next = sample;

      break;
    }
  }
  if (previous == null) { return null; }
  if (next == null || next.time <= previous.time + EPSILON || calcMode === 'discrete') {
    return { ...previous, time };
  }
  let ratio = Math.max(0, Math.min(1, (time - previous.time) / (next.time - previous.time)));

  if (calcMode === 'spline' && previous.cycle === next.cycle) {
    const activeEndSegment = next.activeEndSegment;

    if (activeEndSegment != null) {
      const authoredTime = Math.max(
        activeEndSegment.startTime,
        Math.min(activeEndSegment.endTime, time - activeEndSegment.cycleStartTime),
      );
      const authoredSpan = activeEndSegment.endTime - activeEndSegment.startTime;

      ratio = authoredSpan <= EPSILON
        ? 0
        : (authoredTime - activeEndSegment.startTime) / authoredSpan;
      ratio = Math.max(0, Math.min(1, ratio));
      const handles = keySplines[activeEndSegment.segmentIndex];

      if (handles != null) { ratio = cubicBezierRatio(ratio, handles); }

      return {
        time,
        value: interpolateValues(activeEndSegment.startValue, activeEndSegment.endValue, ratio),
        cycle: previous.cycle,
        sourceIndex: activeEndSegment.segmentIndex,
      };
    }

    const handles = keySplines[previous.sourceIndex];

    if (handles != null) { ratio = cubicBezierRatio(ratio, handles); }
  }

  return {
    time,
    value: interpolateValues(previous.value, next.value, ratio),
    cycle: previous.cycle,
    sourceIndex: previous.sourceIndex,
  };
}

export function clipSamplesToComparisonWindow (
  samples: SMILSample[],
  end: number,
  calcMode: SMILAnimation['calcMode'],
  keySplines: IRBezierHandle[][],
  fill: SMILAnimation['fill'],
): SMILSample[] {
  const clipped = samples.filter(sample => sample.time > EPSILON && sample.time <= end + EPSILON);
  const atZero = sampleExpandedValue(samples, 0, calcMode, keySplines)
    ?? (fill === 'freeze' && samples.length > 0 && samples[samples.length - 1].time < 0
      ? { ...samples[samples.length - 1], time: 0 }
      : null);

  if (atZero != null) { clipped.unshift(atZero); }

  return clipped;
}
export function expandSamples (
  values: number[][],
  keyTimes: number[],
  begin: number,
  duration: number,
  totalDuration: number,
  accumulate: boolean,
  calcMode: SMILAnimation['calcMode'] = 'linear',
  keySplines: IRBezierHandle[][] = [],
): SMILSample[] {
  const samples: SMILSample[] = [];
  const cycleCount = Math.max(1, Math.ceil(totalDuration / duration - EPSILON));
  const accumulatedValue = values[values.length - 1];

  for (let cycle = 0; cycle < cycleCount; cycle++) {
    const elapsedBeforeCycle = cycle * duration;
    const remaining = Math.min(duration, totalDuration - elapsedBeforeCycle);

    if (remaining < -EPSILON) { break; }
    for (let i = 0; i < values.length; i++) {
      const localTime = keyTimes[i] * duration;

      if (localTime > remaining + EPSILON) { break; }
      const value = values[i].map((component, componentIndex) => (
        accumulate ? component + (accumulatedValue[componentIndex] ?? 0) * cycle : component
      ));
      const sample: SMILSample = { time: begin + elapsedBeforeCycle + localTime, value, cycle, sourceIndex: i };
      const previous = samples[samples.length - 1];

      if (previous != null && Math.abs(previous.time - sample.time) < EPSILON && valuesEqual(previous.value, sample.value)) {
        // 一个周期的结束也是下一个周期的开始。保留一个 keyframe，并让其 outgoing easing metadata 归属于新周期。
        samples[samples.length - 1] = sample;
      } else {
        samples.push(sample);
      }
    }

    // 小数 repeatCount/repeatDur 可能在声明的 keyTimes 之间结束，
    // 应加入精确的 active-end 值，而不是拉伸最后一个完整周期。
    if (remaining < duration - EPSILON) {
      const normalized = remaining / duration;
      let segment = Math.max(0, keyTimes.findIndex(time => time > normalized) - 1);

      if (segment < 0) { segment = keyTimes.length - 2; }
      segment = Math.min(segment, keyTimes.length - 2);
      const span = keyTimes[segment + 1] - keyTimes[segment];
      let ratio = span <= EPSILON ? 0 : (normalized - keyTimes[segment]) / span;

      ratio = Math.max(0, Math.min(1, ratio));
      if (calcMode === 'spline') {
        const handles = keySplines[segment];

        if (handles != null) { ratio = cubicBezierRatio(ratio, handles); }
      } else if (calcMode === 'discrete') {
        ratio = 0;
      }
      const startValue = values[segment].map((component, componentIndex) => (
        accumulate ? component + (accumulatedValue[componentIndex] ?? 0) * cycle : component
      ));
      const endValue = values[segment + 1].map((component, componentIndex) => (
        accumulate ? component + (accumulatedValue[componentIndex] ?? 0) * cycle : component
      ));
      const value = interpolateValues(startValue, endValue, ratio);

      samples.push({
        time: begin + totalDuration,
        value,
        cycle,
        sourceIndex: segment + 1,
        activeEndSegment: {
          cycleStartTime: begin + elapsedBeforeCycle,
          segmentIndex: segment,
          startTime: keyTimes[segment] * duration,
          endTime: keyTimes[segment + 1] * duration,
          startValue,
          endValue,
        },
      });
    }
  }

  return samples;
}
