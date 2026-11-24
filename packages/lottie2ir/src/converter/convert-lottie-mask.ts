import { IRMaskMode, type IRMask } from '@galacean/animation-ir';

function hasFullStaticOpacity(mask: Record<string, unknown>): boolean {
  const opacity = mask['o'];

  if (opacity == null) {
    return true;
  }
  if (opacity === 100) {
    return true;
  }
  if (typeof opacity !== 'object' || Array.isArray(opacity)) {
    return false;
  }

  const property = opacity as Record<string, unknown>;
  const value = property['k'];

  return property['a'] !== 1 && (value === 100 || (Array.isArray(value) && value.length === 1 && value[0] === 100));
}

function isSupportedLottieMaskMode(mode: unknown): boolean {
  return mode == null || mode === 'a' || mode === 's' || mode === 'i';
}

function mapLottieMaskMode(mode: unknown): IRMask['mode'] | undefined {
  switch (mode ?? 'i') {
    case 'a':
      return IRMaskMode.Add;
    case 's':
      return IRMaskMode.Subtract;
    case 'i':
      return IRMaskMode.Intersect;
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isFinitePointTuple(value: unknown): value is [number, number, ...number[]] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  );
}

function resolveMaskPathData(mask: Record<string, unknown>): Record<string, unknown> | undefined {
  const maskPt = mask['pt'];

  if (!isRecord(maskPt)) {
    return undefined;
  }

  const rawK = maskPt['k'];

  if (!Array.isArray(rawK)) {
    return isRecord(rawK) ? rawK : undefined;
  }
  if (rawK.length === 0 || !isRecord(rawK[0])) {
    return undefined;
  }

  const firstFrame = rawK[0];

  if (firstFrame['s'] != null) {
    return undefined;
  }
  if (firstFrame['v'] != null) {
    return firstFrame;
  }

  return undefined;
}

function collectMaskPathIssues(mask: Record<string, unknown>): string[] {
  const maskPt = mask['pt'];

  if (!isRecord(maskPt) || maskPt['k'] == null) {
    return ['missing-mask-path'];
  }
  if (Array.isArray(maskPt['k']) && maskPt['k'].length === 0) {
    return ['empty-mask-path'];
  }
  if (Array.isArray(maskPt['k']) && isRecord(maskPt['k'][0]) && maskPt['k'][0]['s'] != null) {
    return ['animated-mask-path'];
  }

  const pathData = resolveMaskPathData(mask);

  if (pathData == null) {
    return ['invalid-mask-path'];
  }

  const vertices = pathData['v'];
  const inTangents = pathData['i'];
  const outTangents = pathData['o'];

  if (!Array.isArray(vertices) || vertices.length === 0) {
    return ['empty-mask-path'];
  }
  if (
    !Array.isArray(inTangents) ||
    !Array.isArray(outTangents) ||
    inTangents.length !== vertices.length ||
    outTangents.length !== vertices.length ||
    !vertices.every(isFinitePointTuple) ||
    !inTangents.every(isFinitePointTuple) ||
    !outTangents.every(isFinitePointTuple)
  ) {
    return ['invalid-mask-path'];
  }

  return pathData['c'] === true ? [] : ['open-mask-path'];
}

interface LottieMaskConversion {
  masks: IRMask[];
  unsupportedFeatures: string[];
}

/** Converts the ordered authored Mask stack and reports features that prevent conversion. */
export function convertLottieMasks(maskInfo: unknown): LottieMaskConversion {
  if (!Array.isArray(maskInfo)) {
    return { masks: [], unsupportedFeatures: ['invalid-mask-data'] };
  }

  const hasInvalidEntry = maskInfo.some(mask => !isRecord(mask));
  const activeMasks = maskInfo.filter(isRecord).filter(mask => mask['mode'] !== 'n');

  if (activeMasks.length === 0) {
    return { masks: [], unsupportedFeatures: hasInvalidEntry ? ['invalid-mask-data'] : [] };
  }

  const features = new Set<string>();

  if (hasInvalidEntry) {
    features.add('invalid-mask-data');
  }

  for (const mask of activeMasks) {
    if (!isSupportedLottieMaskMode(mask['mode'])) {
      features.add(`mask-mode-${String(mask['mode'])}`);
    }
    if (!hasFullStaticOpacity(mask)) {
      features.add('unsupported-mask-opacity');
    }
    for (const issue of collectMaskPathIssues(mask)) {
      features.add(issue);
    }
  }

  const unsupportedFeatures = Array.from(features).sort();

  if (unsupportedFeatures.length > 0) {
    return { masks: [], unsupportedFeatures };
  }
  const masks: IRMask[] = [];

  for (const mask of activeMasks) {
    const converted = convertMaskEntry(mask);

    if (converted == null) {
      return { masks: [], unsupportedFeatures: ['invalid-mask-data'] };
    }
    masks.push(converted);
  }

  return { masks, unsupportedFeatures: [] };
}

function convertMaskEntry(mask: Record<string, unknown>): IRMask | undefined {
  const pathData = resolveMaskPathData(mask);
  const mode = mapLottieMaskMode(mask['mode']);

  if (pathData == null || mode == null) {
    return undefined;
  }

  const vertices = pathData['v'] as number[][];
  const relativeInTangents = pathData['i'] as number[][];
  const relativeOutTangents = pathData['o'] as number[][];
  const pointCount = vertices.length;

  const points: Array<{ x: number; y: number }> = [];
  const inTangents: Array<{ x: number; y: number }> = [];
  const outTangents: Array<{ x: number; y: number }> = [];

  for (let index = 0; index < pointCount; index++) {
    points.push({ x: vertices[index][0], y: vertices[index][1] });
    inTangents.push({ x: relativeInTangents[index][0], y: relativeInTangents[index][1] });
    outTangents.push({ x: relativeOutTangents[index][0], y: relativeOutTangents[index][1] });
  }

  const path: IRMask['path'] = {
    points,
    inTangents,
    outTangents,
    closed: true,
  };

  return { path, mode, ...(mask['inv'] === true && { inverted: true }) };
}
