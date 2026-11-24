import type { LottieVisualLayer } from '../common/conversion-types';

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function toFiniteNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter(isFiniteNumber);

  return values.length === value.length ? values : undefined;
}

export function toFirstNumber(value: unknown): number | undefined {
  if (isFiniteNumber(value)) {
    return value;
  }

  const values = toFiniteNumberArray(value);

  return values?.[0];
}

function isAnimatedFlag(flag: unknown): boolean {
  return flag === 1 || flag === true;
}

export function isKeyframedProperty(property: Record<string, unknown>): boolean {
  return isAnimatedFlag(property['a']);
}

export function toFiniteNumber(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

interface LottieKeyframe {
  t: number;
  s?: number[];
  e?: number[];
  h?: number;
  i?: { x: number | number[]; y: number | number[] };
  o?: { x: number | number[]; y: number | number[] };
}

interface LottieAnimProp {
  k: number | number[] | LottieKeyframe[];
  a?: number;
  [key: string]: unknown;
}

interface SeparatedAxisStatic {
  a?: 0;
  k: number | number[];
  [key: string]: unknown;
}
interface SeparatedAxisAnimated {
  a: 1;
  k: LottieKeyframe[];
  [key: string]: unknown;
}
type SeparatedAxisProp = SeparatedAxisStatic | SeparatedAxisAnimated;

function asSeparatedAxisProp(value: unknown): SeparatedAxisProp | undefined {
  const record = asRecord(value);

  if (record == null || !('k' in record)) {
    return undefined;
  }

  return record as SeparatedAxisProp;
}

function resolveAxisValue(kf: LottieKeyframe, prevKf: LottieKeyframe | undefined): number {
  if (kf.s != null) {
    return kf.s[0] ?? 0;
  }

  if (prevKf?.e != null) {
    return prevKf.e[0] ?? 0;
  }

  return prevKf?.s?.[0] ?? 0;
}

function interpolateAxisValue(keyframes: LottieKeyframe[], targetTime: number): number {
  if (keyframes.length === 0) {
    return 0;
  }
  if (targetTime <= keyframes[0].t) {
    return resolveAxisValue(keyframes[0], undefined);
  }
  const lastKf = keyframes[keyframes.length - 1];

  if (targetTime >= lastKf.t) {
    return resolveAxisValue(lastKf, keyframes.length >= 2 ? keyframes[keyframes.length - 2] : undefined);
  }
  for (let i = 0; i < keyframes.length - 1; i++) {
    const currentKf = keyframes[i];
    const nextKf = keyframes[i + 1];

    if (targetTime >= currentKf.t && targetTime <= nextKf.t) {
      const progress = (targetTime - currentKf.t) / (nextKf.t - currentKf.t);
      const startVal = resolveAxisValue(currentKf, i > 0 ? keyframes[i - 1] : undefined);
      const endVal = resolveAxisValue(nextKf, currentKf);

      return startVal + (endVal - startVal) * progress;
    }
  }

  return resolveAxisValue(lastKf, keyframes.length >= 2 ? keyframes[keyframes.length - 2] : undefined);
}

function normalizeHandleValue(value: number | number[] | undefined): number[] {
  if (value == null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function haveEqualHandles(
  left: LottieKeyframe['i'] | LottieKeyframe['o'],
  right: LottieKeyframe['i'] | LottieKeyframe['o'],
): boolean {
  const leftX = normalizeHandleValue(left?.x);
  const leftY = normalizeHandleValue(left?.y);
  const rightX = normalizeHandleValue(right?.x);
  const rightY = normalizeHandleValue(right?.y);

  return leftX.length === rightX.length && leftY.length === rightY.length &&
    leftX.every((value, index) => value === rightX[index]) &&
    leftY.every((value, index) => value === rightY[index]);
}

function haveCompatibleKeyframes(left: LottieKeyframe[], right: LottieKeyframe[]): boolean {
  return left.length === right.length && left.every((keyframe, index) => {
    const other = right[index];

    return other != null && keyframe.t === other.t && keyframe.h === other.h &&
      haveEqualHandles(keyframe.i, other.i) && haveEqualHandles(keyframe.o, other.o);
  });
}

function mergeSeparatedPosition(pRecord: Record<string, unknown>): { property: LottieAnimProp; approximated: boolean } {
  const xProp = asSeparatedAxisProp(pRecord['x']);
  const yProp = asSeparatedAxisProp(pRecord['y']);

  const xAnimated = xProp?.a === 1;
  const yAnimated = yProp?.a === 1;

  function getStaticAxisValue(prop: SeparatedAxisProp | undefined): number {
    if (prop == null) {
      return 0;
    }
    if (typeof prop.k === 'number') {
      return prop.k;
    }
    if (Array.isArray(prop.k) && prop.k.length > 0 && typeof prop.k[0] === 'number') {
      return prop.k[0];
    }

    return 0;
  }

  if (!xAnimated && !yAnimated) {
    return {
      property: { a: 0, k: [getStaticAxisValue(xProp), getStaticAxisValue(yProp), 0] },
      approximated: false,
    };
  }

  const xKeyframes = xProp?.a === 1 ? xProp.k : [];
  const yKeyframes = yProp?.a === 1 ? yProp.k : [];
  const xStaticVal = !xAnimated ? getStaticAxisValue(xProp) : 0;
  const yStaticVal = !yAnimated ? getStaticAxisValue(yProp) : 0;

  const timeSet = new Set<number>();

  for (const kf of xKeyframes) {
    timeSet.add(kf.t);
  }
  for (const kf of yKeyframes) {
    timeSet.add(kf.t);
  }
  const allTimes = Array.from(timeSet).sort((a, b) => a - b);

  const mergedKeyframes: LottieKeyframe[] = [];

  for (let ti = 0; ti < allTimes.length; ti++) {
    const time = allTimes[ti];
    const xIdx = xKeyframes.findIndex(kf => kf.t === time);
    const yIdx = yKeyframes.findIndex(kf => kf.t === time);
    const xKf = xIdx >= 0 ? xKeyframes[xIdx] : undefined;
    const yKf = yIdx >= 0 ? yKeyframes[yIdx] : undefined;

    const xVal =
      xKf != null
        ? resolveAxisValue(xKf, xIdx > 0 ? xKeyframes[xIdx - 1] : undefined)
        : xAnimated
          ? interpolateAxisValue(xKeyframes, time)
          : xStaticVal;
    const yVal =
      yKf != null
        ? resolveAxisValue(yKf, yIdx > 0 ? yKeyframes[yIdx - 1] : undefined)
        : yAnimated
          ? interpolateAxisValue(yKeyframes, time)
          : yStaticVal;

    const merged: LottieKeyframe = {
      t: time,
      s: [xVal, yVal, 0],
    };

    const sourceKf = xKf ?? yKf;

    if (sourceKf?.i && sourceKf?.o) {
      merged.i = {
        x: Array.isArray(sourceKf.i.x) ? sourceKf.i.x : [sourceKf.i.x],
        y: Array.isArray(sourceKf.i.y) ? sourceKf.i.y : [sourceKf.i.y],
      };
      merged.o = {
        x: Array.isArray(sourceKf.o.x) ? sourceKf.o.x : [sourceKf.o.x],
        y: Array.isArray(sourceKf.o.y) ? sourceKf.o.y : [sourceKf.o.y],
      };
    }
    if (sourceKf?.h != null) {
      merged.h = sourceKf.h;
    }

    mergedKeyframes.push(merged);
  }

  return {
    property: { a: 1, k: mergedKeyframes },
    approximated: xAnimated && yAnimated && !haveCompatibleKeyframes(xKeyframes, yKeyframes),
  };
}

/**
 * Returns a Layer whose separated position channels are represented by one combined `ks.p` property.
 *
 * Animated axes are merged on the union of their keyframe times; an axis without a keyframe at a merged time is
 * linearly sampled between its surrounding values.
 */
export function normalizeSeparatedPosition(
  lottieLayer: LottieVisualLayer,
): { layer: LottieVisualLayer; approximated: boolean } {
  const ks = lottieLayer.ks;

  if (ks == null || typeof ks !== 'object') {
    return { layer: lottieLayer, approximated: false };
  }
  const ksRecord = ks as Record<string, unknown>;
  const pRaw = ksRecord['p'];

  if (pRaw == null || typeof pRaw !== 'object') {
    return { layer: lottieLayer, approximated: false };
  }
  const pRecord = pRaw as Record<string, unknown>;

  if (pRecord['s'] !== true) {
    return { layer: lottieLayer, approximated: false };
  }
  if (!('x' in pRecord) && !('y' in pRecord)) {
    return { layer: lottieLayer, approximated: false };
  }

  const normalized = mergeSeparatedPosition(pRecord);

  return {
    layer: {
      ...lottieLayer,
      ks: { ...lottieLayer.ks, p: normalized.property },
    } as LottieVisualLayer,
    approximated: normalized.approximated,
  };
}
