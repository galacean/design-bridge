import { mapIRParticleScalarValues } from '@galacean/animation-ir/adapter';
import { normalizeJSONValue } from './json-normalization';
import type {
  IRParticleCurveKeyframe, IRParticleCurvePoint, IRParticleScalarExpression,
} from '@galacean/animation-ir';
import {
  BezierKeyframeType, type BezierKeyframeValue, type NumberExpression, ValueType,
} from '@galacean/effects-specification';

function isFiniteTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(
    entry => typeof entry === 'number' && Number.isFinite(entry),
  );
}

function createPoint(progress: number, value: number): IRParticleCurvePoint {
  return { progress, value };
}

interface ParsedBezierKeyframe {
  keyframe: IRParticleCurveKeyframe;
  holdIn: boolean;
  holdOut: boolean;
}

function createParsedKeyframe(keyframe: IRParticleCurveKeyframe): ParsedBezierKeyframe {
  return { keyframe, holdIn: false, holdOut: false };
}

function parseBezierKeyframe(value: unknown): ParsedBezierKeyframe | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entry = value as unknown[];
  const type = entry[0];
  const data = entry[1];
  const mark = entry[2];

  switch (type) {
    case BezierKeyframeType.EASE:
      return isFiniteTuple(data, 6)
        ? createParsedKeyframe({
            inControl: createPoint(data[0], data[1]),
            progress: data[2],
            value: data[3],
            outControl: createPoint(data[4], data[5]),
          })
        : undefined;
    case BezierKeyframeType.EASE_IN:
      return isFiniteTuple(data, 4)
        ? createParsedKeyframe({
            inControl: createPoint(data[0], data[1]),
            progress: data[2],
            value: data[3],
          })
        : undefined;
    case BezierKeyframeType.EASE_OUT:
      return isFiniteTuple(data, 4)
        ? createParsedKeyframe({
            progress: data[0],
            value: data[1],
            outControl: createPoint(data[2], data[3]),
          })
        : undefined;
    case BezierKeyframeType.LINE:
      return isFiniteTuple(data, 2)
        ? createParsedKeyframe({ progress: data[0], value: data[1] })
        : undefined;
    case BezierKeyframeType.HOLD:
      return parseHoldKeyframe(data, mark);
    default:
      return undefined;
  }
}

function parseHoldKeyframe(data: unknown, mark: unknown): ParsedBezierKeyframe | undefined {
  if (mark === BezierKeyframeType.EASE_IN && isFiniteTuple(data, 4)) {
    return {
      keyframe: {
        inControl: createPoint(data[0], data[1]),
        progress: data[2],
        value: data[3],
      },
      holdIn: false,
      holdOut: true,
    };
  }
  if (mark === BezierKeyframeType.EASE_OUT && isFiniteTuple(data, 4)) {
    return {
      keyframe: {
        progress: data[0],
        value: data[1],
        outControl: createPoint(data[2], data[3]),
      },
      holdIn: true,
      holdOut: false,
    };
  }
  if (!isFiniteTuple(data, 2)) {
    return undefined;
  }
  if (mark === BezierKeyframeType.LINE) {
    return {
      keyframe: { progress: data[0], value: data[1] },
      holdIn: false,
      holdOut: true,
    };
  }
  if (mark === BezierKeyframeType.LINE_OUT) {
    return {
      keyframe: { progress: data[0], value: data[1] },
      holdIn: true,
      holdOut: false,
    };
  }
  if (mark === BezierKeyframeType.HOLD) {
    return {
      keyframe: { progress: data[0], value: data[1] },
      holdIn: true,
      holdOut: true,
    };
  }

  return undefined;
}

function parseBezierCurve(value: unknown): IRParticleScalarExpression | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const parsedKeyframes = value.map(parseBezierKeyframe);

  if (!parsedKeyframes.every((keyframe): keyframe is ParsedBezierKeyframe => keyframe != null)) {
    return undefined;
  }

  const keyframes = parsedKeyframes.map(parsed => ({ ...parsed.keyframe }));

  for (const [index, keyframe] of keyframes.entries()) {
    const current = parsedKeyframes[index];
    const next = parsedKeyframes[index + 1];

    if (current.holdOut || next?.holdIn === true) {
      keyframe.hold = true;
    }
  }

  return { type: 'curve', keyframes };
}

function parseLineCurve(value: unknown): IRParticleScalarExpression | undefined {
  if (!Array.isArray(value) || value.length === 0 || !value.every(point => isFiniteTuple(point, 2))) {
    return undefined;
  }

  return {
    type: 'curve',
    keyframes: value.map(point => ({ progress: point[0], value: point[1] })),
  };
}

function parseHermiteCurve(value: unknown): IRParticleScalarExpression | undefined {
  if (!Array.isArray(value) || value.length === 0 || !value.every(point => isFiniteTuple(point, 4))) {
    return undefined;
  }

  const points = value;
  const keyframes: IRParticleCurveKeyframe[] = points.map(point => ({
    progress: point[0],
    value: point[1],
  }));

  for (let index = 0; index < points.length - 1; index++) {
    const point = points[index];
    const nextPoint = points[index + 1];
    const progressDelta = nextPoint[0] - point[0];

    keyframes[index].outControl = createPoint(
      point[0] + progressDelta / 3,
      point[1] + point[3] * progressDelta / 3,
    );
    keyframes[index + 1].inControl = createPoint(
      nextPoint[0] - progressDelta / 3,
      nextPoint[1] - nextPoint[2] * progressDelta / 3,
    );
  }

  return { type: 'curve', keyframes };
}

export function parseGEParticleScalarExpression(value: unknown): IRParticleScalarExpression | undefined {
  const expression = parseScalarExpression(value);

  return expression?.type === 'curve'
    ? { ...expression, keyframes: cropCurve(expression.keyframes) }
    : expression;
}

function parseScalarExpression(value: unknown): IRParticleScalarExpression | undefined {
  if (!Array.isArray(value) || value.length !== 2) {
    return undefined;
  }

  switch (value[0]) {
    case ValueType.CONSTANT:
      return typeof value[1] === 'number' && Number.isFinite(value[1])
        ? { type: 'constant', value: value[1] }
        : undefined;
    case ValueType.RANDOM:
      return isFiniteTuple(value[1], 2)
        ? { type: 'randomBetweenConstants', min: Math.min(...value[1]), max: Math.max(...value[1]) }
        : undefined;
    case ValueType.LINE:
      return parseLineCurve(value[1]);
    case ValueType.CURVE:
      return parseHermiteCurve(value[1]);
    case ValueType.BEZIER_CURVE: {
      return parseBezierCurve(value[1]);
    }
    default:
      return undefined;
  }
}

function pointValues(point: IRParticleCurvePoint): [number, number] {
  return [point.progress, point.value];
}

function convertIRCurveKeyframeToGE(keyframe: IRParticleCurveKeyframe): BezierKeyframeValue {
  const point = pointValues(keyframe);
  const outgoingHold = keyframe.hold === true;

  if (outgoingHold) {
    if (keyframe.inControl != null) {
      return [
        BezierKeyframeType.HOLD,
        [...pointValues(keyframe.inControl), ...point],
        BezierKeyframeType.EASE_IN,
      ];
    }

    return [BezierKeyframeType.HOLD, point, BezierKeyframeType.LINE];
  }
  if (keyframe.inControl != null && keyframe.outControl != null) {
    return [
      BezierKeyframeType.EASE,
      [...pointValues(keyframe.inControl), ...point, ...pointValues(keyframe.outControl)],
      BezierKeyframeType.EASE,
    ];
  }
  if (keyframe.inControl != null) {
    return [
      BezierKeyframeType.EASE_IN,
      [...pointValues(keyframe.inControl), ...point],
      BezierKeyframeType.EASE_IN,
    ];
  }
  if (keyframe.outControl != null) {
    return [
      BezierKeyframeType.EASE_OUT,
      [...point, ...pointValues(keyframe.outControl)],
      BezierKeyframeType.EASE_OUT,
    ];
  }

  return [BezierKeyframeType.LINE, point, BezierKeyframeType.LINE];
}

export function convertIRParticleScalarExpressionToGE(
  expression: IRParticleScalarExpression,
): NumberExpression {
  switch (expression.type) {
    case 'constant':
      return [ValueType.CONSTANT, expression.value];
    case 'randomBetweenConstants':
      return [ValueType.RANDOM, [expression.min, expression.max]];
    case 'curve':
      return [ValueType.BEZIER_CURVE, expression.keyframes.map(convertIRCurveKeyframeToGE)];
  }
}

function cropCurve(source: IRParticleCurveKeyframe[]): IRParticleCurveKeyframe[] {
  if (source.some((keyframe, index) => index > 0 && keyframe.progress <= source[index - 1].progress)) {
    return source;
  }
  const keyframes = normalizeJSONValue(source);

  for (const boundary of [0, 1]) {
    const index = keyframes.findIndex((keyframe, i) =>
      keyframe.progress < boundary && (keyframes[i + 1]?.progress ?? -Infinity) > boundary,
    );

    if (index < 0) {
      continue;
    }
    const left = keyframes[index];
    const right = keyframes[index + 1];
    let middle: IRParticleCurveKeyframe;

    if (left.hold === true) {
      middle = { progress: boundary, value: left.value, hold: true };
    } else if (left.outControl == null && right.inControl == null) {
      middle = interpolatePoint(left, right, (boundary - left.progress) / (right.progress - left.progress));
      middle.progress = boundary;
    } else {
      const control1 = left.outControl ?? left;
      const control2 = right.inControl ?? right;
      let low = 0;
      let high = 1;

      for (let iteration = 0; iteration < 50; iteration++) {
        const t = (low + high) / 2;
        const a = interpolatePoint(left, control1, t);
        const b = interpolatePoint(control1, control2, t);
        const c = interpolatePoint(control2, right, t);
        const point = interpolatePoint(interpolatePoint(a, b, t), interpolatePoint(b, c, t), t);

        if (point.progress < boundary) {
          low = t;
        } else {
          high = t;
        }
      }
      const t = (low + high) / 2;
      const a = interpolatePoint(left, control1, t);
      const b = interpolatePoint(control1, control2, t);
      const c = interpolatePoint(control2, right, t);
      const d = interpolatePoint(a, b, t);
      const e = interpolatePoint(b, c, t);

      middle = { ...interpolatePoint(d, e, t), progress: boundary, inControl: d, outControl: e };
      left.outControl = a;
      right.inControl = c;
    }
    keyframes.splice(index + 1, 0, middle);
  }
  const cropped = keyframes.filter(keyframe => keyframe.progress >= 0 && keyframe.progress <= 1);

  if (cropped.length > 0) {
    return cropped;
  }
  const nearest = keyframes[0].progress > 1 ? keyframes[0] : keyframes[keyframes.length - 1];

  return [{ progress: Math.max(0, Math.min(1, nearest.progress)), value: nearest.value }];
}

function interpolatePoint(a: IRParticleCurvePoint, b: IRParticleCurvePoint, t: number): IRParticleCurvePoint {
  return { progress: a.progress + (b.progress - a.progress) * t, value: a.value + (b.value - a.value) * t };
}

function matchesParticleExpression(
  source: IRParticleScalarExpression,
  current: IRParticleScalarExpression,
  lifetimeFrameRate?: number,
): boolean {
  const matchesValue = (value: number, actual: number): boolean => {
    if (lifetimeFrameRate === undefined) {
      return value === actual;
    }
    const expected = value * lifetimeFrameRate;

    // Resampling seconds through two composition frame rates can change the last few bits.
    return expected === actual || Math.abs(actual - expected) <= 4 * Number.EPSILON * Math.abs(actual);
  };
  const matchesPoint = (a?: IRParticleCurvePoint, b?: IRParticleCurvePoint): boolean =>
    a == null || b == null ? a === b : a.progress === b.progress && matchesValue(a.value, b.value);

  switch (source.type) {
    case 'constant':
      return current.type === 'constant' && matchesValue(source.value, current.value);
    case 'randomBetweenConstants':
      return current.type === 'randomBetweenConstants' &&
        matchesValue(source.min, current.min) && matchesValue(source.max, current.max);
    case 'curve':
      return current.type === 'curve' && source.keyframes.length === current.keyframes.length &&
        source.keyframes.every((a, i) => {
          const b = current.keyframes[i];

          return matchesPoint(a, b) && (a.hold === true) === (b.hold === true) &&
            matchesPoint(a.inControl, b.inControl) && (a.hold === true || matchesPoint(a.outControl, b.outControl));
        });
  }
}

/** Preserve GE evaluation and seeded random ordering until the normalized parameter changes. */
export function restoreGEParticleScalarExpression(
  expression: IRParticleScalarExpression,
  source: unknown,
  lifetimeFrameRate?: number,
): unknown {
  const parsed = parseGEParticleScalarExpression(source);

  if (parsed != null && matchesParticleExpression(parsed, expression, lifetimeFrameRate)) {
    return normalizeJSONValue(source);
  }
  const converted = lifetimeFrameRate === undefined
    ? expression
    : mapIRParticleScalarValues(expression, frames => frames / lifetimeFrameRate);

  return convertIRParticleScalarExpressionToGE(converted);
}
