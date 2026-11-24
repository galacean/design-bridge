import type { IRBezierHandle, IRKeyframe } from '@galacean/animation-ir';
import { BezierKeyframeType } from '@galacean/effects-specification';

type BezierSegment = [number, number, number, number, number, number, number, number];

const TIME_EPSILON = 1e-10;
const VALUE_EPSILON = 1e-6;

function inverseLerp(a: number, b: number, value: number): number {
  const range = b - a;

  if (Math.abs(range) < 1e-10) {
    return 0;
  }

  return (value - a) / range;
}

export function parseBezierKeyframes(curves: unknown[], startFrame: number, endFrame: number): IRKeyframe<number>[] {
  if (curves.length === 0 || !Number.isFinite(startFrame) || !Number.isFinite(endFrame) || endFrame <= startFrame) {
    return [];
  }

  const extractedSegments = extractSegments(curves);
  const segments = normalizeScalarSegments(extractedSegments);

  if (segments == null || segments.length === 0) {
    return [];
  }

  const frames = endFrame - startFrame;
  const keyframes: IRKeyframe<number>[] = [];

  const firstSegment = segments[0];
  const firstTime = firstSegment[0];
  const firstValue = firstSegment[1];
  const secondSegment = segments[1];

  const hasPrependedHold =
    secondSegment != null &&
    Math.abs(firstValue - firstSegment[7]) < VALUE_EPSILON &&
    Math.abs(firstTime) < TIME_EPSILON &&
    Math.abs(firstSegment[6] - secondSegment[0]) < VALUE_EPSILON;

  if (hasPrependedHold) {
    segments.shift();
  }

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const t0 = segment[0];
    const v0 = segment[1];
    const outControlPointY = segment[3];
    const v1 = segment[7];

    const frameTime = t0 * frames + startFrame;

    const isHold =
      Math.abs(v0 - v1) < 1e-6 && Math.abs(outControlPointY - v0) < 1e-6 && Math.abs(segment[5] - v0) < 1e-6;

    const outTangent = parseSegmentTangent(segment, 'out', 'value');

    if (i === 0) {
      keyframes.push({
        frame: frameTime,
        value: v0,
        ...(isHold ? { hold: true } : { outTangent }),
      });
    } else {
      const previousSegment = segments[i - 1];
      const inTangent = parseSegmentTangent(previousSegment, 'in', 'value');

      keyframes.push({
        frame: frameTime,
        value: v0,
        inTangent,
        ...(isHold ? { hold: true } : { outTangent }),
      });
    }
  }

  const lastSegment = segments[segments.length - 1];
  const lastTime = lastSegment[6];
  const lastValue = lastSegment[7];
  const lastFrameTime = lastTime * frames + startFrame;

  const lastInTangent = parseSegmentTangent(lastSegment, 'in', 'value');

  keyframes.push({
    frame: lastFrameTime,
    value: lastValue,
    inTangent: lastInTangent,
  });

  return keyframes;
}

function extractSegments(curves: unknown[]): BezierSegment[] {
  if (!isSupportedEaseCurve(curves)) {
    return [];
  }

  const segments: BezierSegment[] = [];

  for (let i = 0; i < curves.length; i++) {
    const entry = curves[i] as [BezierKeyframeType, number[], BezierKeyframeType];
    const type = entry[0];
    const data = entry[1];

    if (type === BezierKeyframeType.EASE_OUT) {
      // EASE_OUT: [t, v, out_cx, out_cy] — first keyframe of a segment

      if (i + 1 < curves.length) {
        const nextEntry = curves[i + 1] as [BezierKeyframeType, number[], BezierKeyframeType];
        const nextType = nextEntry[0];
        const nextData = nextEntry[1];

        if (nextType === BezierKeyframeType.EASE_IN) {
          segments.push([data[0], data[1], data[2], data[3], nextData[0], nextData[1], nextData[2], nextData[3]]);
        } else if (nextType === BezierKeyframeType.EASE) {
          segments.push([data[0], data[1], data[2], data[3], nextData[0], nextData[1], nextData[2], nextData[3]]);
        }
      }
    } else if (type === BezierKeyframeType.EASE && i + 1 < curves.length) {
      // EASE: [in_cx, in_cy, t, v, out_cx, out_cy] — middle keyframe
      const nextEntry = curves[i + 1] as [BezierKeyframeType, number[], BezierKeyframeType];
      const nextType = nextEntry[0];
      const nextData = nextEntry[1];

      if (nextType === BezierKeyframeType.EASE_IN) {
        segments.push([data[2], data[3], data[4], data[5], nextData[0], nextData[1], nextData[2], nextData[3]]);
      } else if (nextType === BezierKeyframeType.EASE) {
        segments.push([data[2], data[3], data[4], data[5], nextData[0], nextData[1], nextData[2], nextData[3]]);
      }
    }
  }

  return segments;
}

function isSupportedEaseCurve(curves: unknown[]): boolean {
  if (curves.length < 2) {
    return false;
  }

  return curves.every((entry, index) => {
    if (!Array.isArray(entry) || !Array.isArray(entry[1])) {
      return false;
    }

    const expectedType =
      index === 0
        ? BezierKeyframeType.EASE_OUT
        : index === curves.length - 1
          ? BezierKeyframeType.EASE_IN
          : BezierKeyframeType.EASE;
    const expectedLength = expectedType === BezierKeyframeType.EASE ? 6 : 4;

    return (
      entry[0] === expectedType &&
      entry[1].length >= expectedLength &&
      entry[1].slice(0, expectedLength).every(value => typeof value === 'number' && Number.isFinite(value))
    );
  });
}

/**
 * Remove zero-duration segments with equal endpoints. Instantaneous jumps are not
 * representable in normalized IR and remain in raw passthrough data.
 */
function normalizeScalarSegments(segments: BezierSegment[]): BezierSegment[] | undefined {
  const normalized: BezierSegment[] = [];

  for (const segment of segments) {
    const duration = segment[6] - segment[0];

    if (duration < -TIME_EPSILON) {
      return undefined;
    }
    if (Math.abs(duration) <= TIME_EPSILON) {
      if (Math.abs(segment[7] - segment[1]) > VALUE_EPSILON) {
        return undefined;
      }
      continue;
    }

    const outTangentX = inverseLerp(segment[0], segment[6], segment[2]);
    const inTangentX = inverseLerp(segment[0], segment[6], segment[4]);

    if (outTangentX < 0 || outTangentX > 1 || inTangentX < 0 || inTangentX > 1) {
      return undefined;
    }

    normalized.push(segment);
  }

  return normalized;
}

export function parsePositionTimingKeyframes(
  curves: unknown[],
  startFrame: number,
  endFrame: number,
): Array<{ frame: number; outTangent?: IRBezierHandle; inTangent?: IRBezierHandle }> {
  const segments = extractSegments(curves);

  if (segments.length === 0) {
    return [];
  }

  const frames = endFrame - startFrame;
  const result: Array<{ frame: number; outTangent?: IRBezierHandle; inTangent?: IRBezierHandle }> = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const t0 = segment[0];

    const frameTime = t0 * frames + startFrame;

    const outTangent = parseSegmentTangent(segment, 'out', 'time');

    if (i === 0) {
      result.push({ frame: frameTime, outTangent });
    } else {
      const previousSegment = segments[i - 1];
      const inTangent = parseSegmentTangent(previousSegment, 'in', 'time');

      result.push({ frame: frameTime, outTangent, inTangent });
    }
  }

  const lastSegment = segments[segments.length - 1];
  const lastFrameTime = lastSegment[6] * frames + startFrame;

  const lastInTangent = parseSegmentTangent(lastSegment, 'in', 'time');

  result.push({ frame: lastFrameTime, inTangent: lastInTangent });

  return result;
}

function parseSegmentTangent(
  segment: BezierSegment,
  direction: 'in' | 'out',
  valueDomain: 'time' | 'value',
): IRBezierHandle {
  const controlPointIndex = direction === 'out' ? 2 : 4;
  const valueStart = valueDomain === 'time' ? segment[0] : segment[1];
  const valueEnd = valueDomain === 'time' ? segment[6] : segment[7];

  return {
    x: inverseLerp(segment[0], segment[6], segment[controlPointIndex]),
    y: inverseLerp(valueStart, valueEnd, segment[controlPointIndex + 1]),
  };
}
