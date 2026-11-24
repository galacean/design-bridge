import { normalizePathCommands, normalizedToCustomShapePaths } from '../../normalize-path';
import type { SVGMatrix } from '../../matrix';
import {
  activeDuration, comparisonEnd, cubicBezierRatio, findAnimationById,
  parseClockValue, parseKeySplines, parseNumberList, parsePointValue, resolveBeginTimes,
} from './parse-timeline';
import {
  EPSILON, type BeginTimeCache, type MotionAnimation, type MotionPath,
  type MotionPathSegment, type SMILAnimation,
} from './types';

function cubicPoint (
  segment: Pick<MotionPathSegment, 'p0' | 'p1' | 'p2' | 'p3'>,
  t: number,
): [number, number] {
  const inv = 1 - t;
  const a = inv * inv * inv;
  const b = 3 * inv * inv * t;
  const c = 3 * inv * t * t;
  const d = t * t * t;

  return [
    a * segment.p0[0] + b * segment.p1[0] + c * segment.p2[0] + d * segment.p3[0],
    a * segment.p0[1] + b * segment.p1[1] + c * segment.p2[1] + d * segment.p3[1],
  ];
}

function cubicDerivative (
  segment: Pick<MotionPathSegment, 'p0' | 'p1' | 'p2' | 'p3'>,
  t: number,
): [number, number] {
  const inv = 1 - t;

  return [
    3 * inv * inv * (segment.p1[0] - segment.p0[0])
      + 6 * inv * t * (segment.p2[0] - segment.p1[0])
      + 3 * t * t * (segment.p3[0] - segment.p2[0]),
    3 * inv * inv * (segment.p1[1] - segment.p0[1])
      + 6 * inv * t * (segment.p2[1] - segment.p1[1])
      + 3 * t * t * (segment.p3[1] - segment.p2[1]),
  ];
}

function buildMotionSegment (
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
): MotionPathSegment {
  const segment: MotionPathSegment = { p0, p1, p2, p3, length: 0, samples: [{ t: 0, length: 0 }] };
  let previous = p0;
  // 通过小型弧长查找表保持 paced motion 的确定性，并保留源 cubic 几何。
  const subdivisions = 24;

  for (let index = 1; index <= subdivisions; index++) {
    const t = index / subdivisions;
    const point = cubicPoint(segment, t);

    segment.length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    segment.samples.push({ t, length: segment.length });
    previous = point;
  }

  return segment;
}

function buildMotionPathFromPoints (points: Array<[number, number]>): MotionPath | null {
  if (points.length < 2) { return null; }
  const segments: MotionPathSegment[] = [];

  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[index];
    const p3 = points[index + 1];
    const p1: [number, number] = [p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3];
    const p2: [number, number] = [p0[0] + (p3[0] - p0[0]) * 2 / 3, p0[1] + (p3[1] - p0[1]) * 2 / 3];

    segments.push(buildMotionSegment(p0, p1, p2, p3));
  }

  return finalizeMotionPath(segments);
}

function finalizeMotionPath (segments: MotionPathSegment[]): MotionPath | null {
  if (segments.length === 0) { return null; }
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);

  if (totalLength <= EPSILON) { return null; }
  const vertexProgress = [0];
  let cumulative = 0;

  for (const segment of segments) {
    cumulative += segment.length;
    vertexProgress.push(cumulative / totalLength);
  }

  return { segments, totalLength, vertexProgress };
}

function buildMotionPathFromData (data: string): MotionPath | null {
  const paths = normalizedToCustomShapePaths(normalizePathCommands(data));
  const path = paths[0];

  if (path == null || path.points.length < 2) { return null; }
  const segments: MotionPathSegment[] = [];
  const segmentCount = path.closed ? path.points.length : path.points.length - 1;

  for (let index = 0; index < segmentCount; index++) {
    const nextIndex = (index + 1) % path.points.length;
    const start = path.points[index];
    const end = path.points[nextIndex];
    const out = path.outTangents[index] ?? { x: 0, y: 0 };
    const incoming = path.inTangents[nextIndex] ?? { x: 0, y: 0 };

    segments.push(buildMotionSegment(
      [start.x, start.y],
      [start.x + out.x, start.y + out.y],
      [end.x + incoming.x, end.y + incoming.y],
      [end.x, end.y],
    ));
  }

  return finalizeMotionPath(segments);
}

function readMotionPathData (tag: globalThis.Element, root: globalThis.Element): string {
  const inlinePath = tag.getAttribute('path') ?? '';

  if (inlinePath.trim() !== '') { return inlinePath; }
  const mpath = Array.from(tag.children).find(child => child.tagName.toLowerCase() === 'mpath');
  const href = mpath?.getAttribute('href') ?? mpath?.getAttribute('xlink:href') ?? '';

  if (!href.startsWith('#')) { return ''; }

  const referenced = findAnimationById(root, href.slice(1));

  if (referenced == null) { return ''; }
  const path = readPathData(referenced);

  return path !== '' ? path : buildReferencedMotionPath(referenced);
}

function readPathData (element: globalThis.Element): string {
  const attribute = element.getAttribute('d')?.trim() ?? '';

  if (attribute !== '') { return attribute; }
  const style = element.getAttribute('style') ?? '';
  const match = style.match(/(?:^|;)\s*d\s*:\s*path\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)\s*(?:;|$)/i);

  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

function readMotionNumber (element: globalThis.Element, attribute: string, fallback = 0): number {
  const value = Number(element.getAttribute(attribute));

  return Number.isFinite(value) ? value : fallback;
}

function buildReferencedMotionPath (element: globalThis.Element): string {
  const tag = element.tagName.toLowerCase();

  if (tag === 'line') {
    return `M ${readMotionNumber(element, 'x1')} ${readMotionNumber(element, 'y1')} L ${readMotionNumber(element, 'x2')} ${readMotionNumber(element, 'y2')}`;
  }
  if (tag === 'rect') {
    const x = readMotionNumber(element, 'x');
    const y = readMotionNumber(element, 'y');
    const width = readMotionNumber(element, 'width');
    const height = readMotionNumber(element, 'height');

    if (width <= 0 || height <= 0) { return ''; }
    const rx = Math.min(Math.max(readMotionNumber(element, 'rx'), 0), width / 2);
    const ry = Math.min(Math.max(readMotionNumber(element, 'ry', rx), 0), height / 2);

    if (rx === 0 || ry === 0) {
      return `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`;
    }

    return [
      `M ${x + rx} ${y}`,
      `H ${x + width - rx}`,
      `A ${rx} ${ry} 0 0 1 ${x + width} ${y + ry}`,
      `V ${y + height - ry}`,
      `A ${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height}`,
      `H ${x + rx}`,
      `A ${rx} ${ry} 0 0 1 ${x} ${y + height - ry}`,
      `V ${y + ry}`,
      `A ${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
      'Z',
    ].join(' ');
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = readMotionNumber(element, 'cx');
    const cy = readMotionNumber(element, 'cy');
    const rx = tag === 'circle' ? readMotionNumber(element, 'r') : readMotionNumber(element, 'rx');
    const ry = tag === 'circle' ? rx : readMotionNumber(element, 'ry');

    if (rx <= 0 || ry <= 0) { return ''; }

    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
  }

  return '';
}

function readMotionPointValues (tag: globalThis.Element): Array<[number, number]> {
  const values = tag.getAttribute('values');

  if (values != null && values.trim() !== '') {
    return values.split(';').map(parsePointValue);
  }
  const from = tag.getAttribute('from');
  const to = tag.getAttribute('to');

  if (from != null && to != null) { return [parsePointValue(from), parsePointValue(to)]; }
  if (to != null) { return [[0, 0], parsePointValue(to)]; }
  const by = tag.getAttribute('by');

  if (by != null) { return [[0, 0], parsePointValue(by)]; }

  return [];
}

function hasValidMotionValues (tag: globalThis.Element): boolean {
  const raw = tag.getAttribute('values');

  if (raw == null) { return true; }
  const entries = raw.split(';');

  // animateMotion 的 values 必须是坐标对。Chromium 在任一项为标量时会禁用整个动画，
  // 即使同时存在有效 path 属性；不能把这些标量误当作 path 进度。
  return entries.length > 0 && entries.every(entry => parseNumberList(entry).length === 2);
}

export function parseMotionAnimation (
  tag: globalThis.Element,
  root: globalThis.Element,
  beginCache: BeginTimeCache,
  comparisonDuration?: number,
): MotionAnimation | null {
  const simpleDuration = parseClockValue(tag.getAttribute('dur') ?? '') ?? 0;
  const totalDuration = activeDuration(tag);

  if (simpleDuration <= 0 || totalDuration <= 0) { return null; }
  if (!hasValidMotionValues(tag)) { return null; }
  const pathData = readMotionPathData(tag, root);
  const pointValues = pathData.trim() === '' ? readMotionPointValues(tag) : undefined;
  const path = pathData.trim() !== ''
    ? buildMotionPathFromData(pathData)
    : buildMotionPathFromPoints(pointValues ?? []);

  if (path == null) { return null; }
  const calcModeRaw = (tag.getAttribute('calcMode') ?? 'paced').toLowerCase();
  const calcMode = (['linear', 'discrete', 'spline', 'paced'].includes(calcModeRaw) ? calcModeRaw : 'paced') as SMILAnimation['calcMode'];
  const rawKeyPoints = (tag.getAttribute('keyPoints') ?? '').split(';').map(Number).filter(Number.isFinite);
  const rawKeyTimes = (tag.getAttribute('keyTimes') ?? '').split(';').map(Number).filter(Number.isFinite);
  const usesKeyPoints = rawKeyPoints.length >= 2 || (pointValues == null && rawKeyTimes.length === path.vertexProgress.length);
  let keyPoints = rawKeyPoints.length >= 2 ? rawKeyPoints : [0, 1];

  if (rawKeyPoints.length === 0 && pointValues == null && rawKeyTimes.length === path.vertexProgress.length) {
    keyPoints = path.vertexProgress;
  }
  const pointKeyTimes = pointValues != null && !usesKeyPoints
    ? pointValues.map((_, index) => calcMode === 'discrete' ? index / pointValues.length : index / (pointValues.length - 1))
    : keyPoints.map((_, index) => index / (keyPoints.length - 1));
  let keyTimes = rawKeyTimes.length === pointKeyTimes.length
    ? rawKeyTimes
    : pointKeyTimes;

  if (keyTimes.some((value, index) => index > 0 && value < keyTimes[index - 1])) {
    keyTimes = pointKeyTimes;
  }
  const rotateRaw = (tag.getAttribute('rotate') ?? '0').trim().toLowerCase();
  const rotate = rotateRaw === 'auto' || rotateRaw === 'auto-reverse'
    ? rotateRaw
    : (Number(rotateRaw) || 0);
  const begin = resolveBeginTimes(tag, root, beginCache, comparisonDuration)[0];

  if (begin == null) { return null; }

  const indefinite = (tag.getAttribute('repeatCount') ?? '').trim().toLowerCase() === 'indefinite';

  return {
    begin,
    end: indefinite && comparisonDuration != null
      ? Math.max(comparisonEnd(tag, begin), comparisonDuration)
      : comparisonEnd(tag, begin),
    simpleDuration,
    activeDuration: totalDuration,
    fill: (tag.getAttribute('fill') ?? '').trim().toLowerCase() === 'freeze' ? 'freeze' : 'remove',
    additive: (tag.getAttribute('additive') ?? '').trim().toLowerCase() === 'sum' ? 'sum' : 'replace',
    indefinite,
    calcMode,
    keySplines: parseKeySplines(tag, keyTimes.length - 1),
    keyTimes,
    keyPoints,
    usesKeyPoints,
    path,
    pointValues,
    rotate,
  };
}

function sampleMotionPath (path: MotionPath, progress: number): { x: number; y: number; angle: number } {
  const targetLength = Math.max(0, Math.min(1, progress)) * path.totalLength;
  let beforeSegment = 0;
  let segment = path.segments[path.segments.length - 1];

  for (const candidate of path.segments) {
    if (targetLength <= beforeSegment + candidate.length + EPSILON) {
      segment = candidate;

      break;
    }
    beforeSegment += candidate.length;
  }
  const localLength = Math.max(0, Math.min(segment.length, targetLength - beforeSegment));
  let lower = segment.samples[0];
  let upper = segment.samples[segment.samples.length - 1];

  for (let index = 1; index < segment.samples.length; index++) {
    if (segment.samples[index].length >= localLength) {
      lower = segment.samples[index - 1];
      upper = segment.samples[index];

      break;
    }
  }
  const span = upper.length - lower.length;
  const ratio = span <= EPSILON ? 0 : (localLength - lower.length) / span;
  const t = lower.t + (upper.t - lower.t) * ratio;
  const point = cubicPoint(segment, t);
  let derivative = cubicDerivative(segment, t);

  if (Math.hypot(derivative[0], derivative[1]) <= EPSILON) {
    derivative = [segment.p3[0] - segment.p0[0], segment.p3[1] - segment.p0[1]];
  }

  return { x: point[0], y: point[1], angle: Math.atan2(derivative[1], derivative[0]) * 180 / Math.PI };
}

function sampleMotionPointValues (animation: MotionAnimation, ratio: number): { x: number; y: number; angle: number } {
  const points = animation.pointValues ?? [];
  const clamped = Math.max(0, Math.min(1, ratio));
  const lastPoint = points.at(-1);

  if (lastPoint != null && clamped >= (animation.keyTimes.at(-1) ?? 1) - EPSILON) {
    const previousPoint = points.at(-2) ?? lastPoint;

    return {
      x: lastPoint[0],
      y: lastPoint[1],
      angle: Math.atan2(lastPoint[1] - previousPoint[1], lastPoint[0] - previousPoint[0]) * 180 / Math.PI,
    };
  }
  let segment = points.length - 2;

  for (let index = 0; index < animation.keyTimes.length - 1; index++) {
    if (clamped < animation.keyTimes[index + 1] - EPSILON || index === animation.keyTimes.length - 2) {
      segment = index;

      break;
    }
  }
  const startTime = animation.keyTimes[segment] ?? 0;
  const endTime = animation.keyTimes[segment + 1] ?? 1;
  let localRatio = endTime <= startTime + EPSILON ? 0 : (clamped - startTime) / (endTime - startTime);

  if (animation.calcMode === 'discrete') {
    localRatio = 0;
  } else if (animation.calcMode === 'spline') {
    const spline = animation.keySplines[segment];

    if (spline != null) { localRatio = cubicBezierRatio(localRatio, spline); }
  }
  localRatio = Math.max(0, Math.min(1, localRatio));
  const start = points[segment] ?? points[0] ?? [0, 0];
  const end = points[segment + 1] ?? start;
  const x = start[0] + (end[0] - start[0]) * localRatio;
  const y = start[1] + (end[1] - start[1]) * localRatio;
  const angle = Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI;

  return { x, y, angle };
}

function motionProgressAtRatio (animation: MotionAnimation, ratio: number): number {
  const clamped = Math.max(0, Math.min(1, ratio));

  if (animation.calcMode === 'paced' && !animation.usesKeyPoints) { return clamped; }
  let segment = animation.keyTimes.length - 2;

  for (let index = 0; index < animation.keyTimes.length - 1; index++) {
    if (clamped <= animation.keyTimes[index + 1] + EPSILON) {
      segment = index;

      break;
    }
  }
  if (animation.calcMode === 'discrete') { return animation.keyPoints[segment] ?? 0; }
  const startTime = animation.keyTimes[segment] ?? 0;
  const endTime = animation.keyTimes[segment + 1] ?? 1;
  let localRatio = endTime <= startTime + EPSILON ? 0 : (clamped - startTime) / (endTime - startTime);

  if (animation.calcMode === 'spline') {
    const spline = animation.keySplines[segment];

    if (spline != null) { localRatio = cubicBezierRatio(localRatio, spline); }
  }
  const startPoint = animation.keyPoints[segment] ?? 0;
  const endPoint = animation.keyPoints[segment + 1] ?? 1;

  return startPoint + (endPoint - startPoint) * Math.max(0, Math.min(1, localRatio));
}

export function motionMatrixAtTime (animation: MotionAnimation, time: number): SVGMatrix | null {
  if (time < animation.begin - EPSILON) { return null; }
  const activeEnd = animation.begin + animation.activeDuration;
  let simpleRatio: number;

  if (!animation.indefinite && time >= activeEnd - EPSILON) {
    if (animation.fill !== 'freeze') { return null; }
    const remainder = animation.activeDuration % animation.simpleDuration;

    simpleRatio = remainder <= EPSILON ? 1 : remainder / animation.simpleDuration;
  } else {
    const elapsed = Math.max(0, time - animation.begin);
    const simpleElapsed = elapsed % animation.simpleDuration;

    simpleRatio = simpleElapsed / animation.simpleDuration;
    if (animation.indefinite && Math.abs(time - animation.end) <= EPSILON) { simpleRatio = 1; }
  }
  const point = animation.pointValues != null && !animation.usesKeyPoints
    ? sampleMotionPointValues(animation, simpleRatio)
    : sampleMotionPath(animation.path, motionProgressAtRatio(animation, simpleRatio));
  const angle = animation.rotate === 'auto'
    ? point.angle
    : animation.rotate === 'auto-reverse'
      ? point.angle + 180
      : animation.rotate;
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return { a: cos, b: sin, c: -sin, d: cos, e: point.x, f: point.y };
}
