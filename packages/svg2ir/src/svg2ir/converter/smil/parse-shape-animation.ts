import type { IRBezierPath, IRShape } from '@galacean/animation-ir';
import type { Element } from '@svgdotjs/svg.js';
import type { SVGPreservedShapeAnimation } from '../../../svg-preserved-data';
import { normalizePathCommands, normalizedToCustomShapePaths } from '../../normalize-path';
import { collectSMILAnimationElements } from './resolve-animation-target';
import { parseSMILTag } from './parse-timeline';
import { parseNumberList } from './timeline-values';
import type { SMILAnimation } from './types';

interface ShapeAnimationSpec {
  pathSets: IRBezierPath[][];
  valueIndexes: Map<string, number>;
  additiveNeedsBase: boolean;
  accumulationPaths?: IRBezierPath[];
  discrete: boolean;
}

export function parseShapeGeometryAnimation (
  el: Element,
  shape: IRShape,
  comparisonDuration: number,
): SVGPreservedShapeAnimation | undefined {
  if (shape.primitiveType !== 'custom') { return undefined; }
  const node = (el as unknown as { node?: globalThis.Element | null }).node;
  const root = ((node as globalThis.SVGElement | null)?.ownerSVGElement ?? node) as globalThis.Element | null;
  const shapeAttribute = readAnimatedShapeAttribute(node);

  if (node == null || root == null || shapeAttribute == null) { return undefined; }
  const { attributeName, closed } = shapeAttribute;
  const baseRaw = node.getAttribute(attributeName) ?? '';
  const basePaths = readBasePaths(shape, baseRaw);
  const animations = collectSMILAnimationElements(node, root, new Set(['animate', 'set']))
    .filter(animation => (animation.getAttribute('attributeName') ?? '').trim().toLowerCase() === attributeName);

  if (animations.length === 0) { return undefined; }
  const frames: Array<{ time: number; paths: IRBezierPath[]; order: number }> = [];
  const beginCache = new Map<globalThis.Element, number[]>();

  animations.forEach((animationElement, order) => {
    const spec = buildShapeAnimationSpec(
      animationElement,
      attributeName,
      closed,
      shape.position[0],
      shape.position[1],
      basePaths,
    );

    if (spec == null) { return; }
    const valueParser = (value: string): number[] | null => {
      const index = spec.valueIndexes.get(value.trim());

      return index == null ? null : [index];
    };
    const animation = parseSMILTag(
      animationElement,
      root,
      beginCache,
      comparisonDuration,
      valueParser,
      [0],
    );

    if (animation == null) { return; }
    appendAnimationFrames(frames, animation, spec, basePaths, order);
  });

  if (frames.length === 0) { return undefined; }
  frames.sort((left, right) => left.time - right.time || left.order - right.order);
  const keyframes: Array<{ time: number; paths: IRBezierPath[] }> = [];

  for (const frame of frames) {
    const previous = keyframes.at(-1);

    if (previous != null && previous.time === frame.time) {
      previous.paths = frame.paths;
    } else if (previous == null || !pathsEqual(previous.paths, frame.paths)) {
      keyframes.push({ time: frame.time, paths: frame.paths });
    }
  }

  return keyframes.length > 1 ? { keyframes } : undefined;
}

function readAnimatedShapeAttribute (node: globalThis.Element | null | undefined): { attributeName: 'd' | 'points'; closed: boolean } | null {
  const tagName = node?.tagName?.toLowerCase();

  if (tagName === 'path') { return { attributeName: 'd', closed: false }; }
  if (tagName === 'polygon' || tagName === 'polyline') {
    return { attributeName: 'points', closed: tagName === 'polygon' };
  }

  return null;
}

function buildShapeAnimationSpec (
  element: globalThis.Element,
  attributeName: 'd' | 'points',
  closed: boolean,
  centerX: number,
  centerY: number,
  basePaths: IRBezierPath[] | undefined,
): ShapeAnimationSpec | null {
  const explicitAdditive = (element.getAttribute('additive') ?? '').trim().toLowerCase() === 'sum';
  const accumulates = (element.getAttribute('accumulate') ?? '').trim().toLowerCase() === 'sum';
  const valueCenterX = explicitAdditive ? 0 : centerX;
  const valueCenterY = explicitAdditive ? 0 : centerY;
  const values = readAnimationValues(element);

  if (values != null) {
    const pathSets = values.map(value => resolveShapeValue(value, attributeName, closed, valueCenterX, valueCenterY, basePaths));

    if (pathSets.some(paths => paths == null)) { return null; }
    const resolved = materializeEmptyPathSets(pathSets.filter(isPaths));
    const discrete = !hasCompatibleTopology(values, resolved, attributeName, closed);

    return {
      pathSets: resolved,
      valueIndexes: indexValues(values),
      additiveNeedsBase: explicitAdditive,
      discrete,
      ...(accumulates && { accumulationPaths: resolved.at(-1) }),
    };
  }

  const from = element.getAttribute('from');
  const to = element.getAttribute('to');
  const by = element.getAttribute('by');

  if (from != null && to != null) {
    const end = resolveShapeValue(to, attributeName, closed, valueCenterX, valueCenterY, basePaths);

    if (end == null) { return null; }
    const start = resolveShapeValue(from, attributeName, closed, valueCenterX, valueCenterY, basePaths)
      ?? zeroShapeLike(end, centerX, centerY);

    return buildPairSpec(start, end, from, to, explicitAdditive, accumulates ? end : undefined, from, to, attributeName, closed);
  }

  if (from != null && by != null) {
    const delta = resolveShapeValue(by, attributeName, closed, 0, 0, undefined);

    if (delta == null) { return null; }
    const start = resolveShapeValue(from, attributeName, closed, valueCenterX, valueCenterY, basePaths)
      ?? basePaths
      ?? zeroShapeLike(delta, centerX, centerY);
    const end = addPathSets(start, delta);

    if (end != null) {
      return buildPairSpec(start, end, from, by, explicitAdditive, accumulates ? end : undefined, from, by, attributeName, closed);
    }

    return buildPairSpec(start, delta, from, by, false, accumulates ? delta : undefined, from, by, attributeName, closed);
  }

  if (to != null) {
    const end = resolveShapeValue(to, attributeName, closed, valueCenterX, valueCenterY, basePaths);

    if (end == null) { return null; }
    const start = basePaths ?? zeroShapeLike(end, centerX, centerY);

    return buildPairSpec(start, end, undefined, to, explicitAdditive, accumulates ? end : undefined, undefined, to, attributeName, closed);
  }

  if (by != null) {
    const delta = resolveShapeValue(by, attributeName, closed, 0, 0, undefined);

    if (delta == null) { return null; }
    const start = basePaths ?? zeroShapeLike(delta, centerX, centerY);
    const end = basePaths == null ? delta : addPathSets(start, delta);

    if (end == null) {
      return buildPairSpec(start, delta, undefined, by, false, undefined, undefined, by, attributeName, closed);
    }

    return buildPairSpec(start, end, undefined, by, false, undefined, undefined, by, attributeName, closed);
  }

  return null;
}

function readAnimationValues (element: globalThis.Element): string[] | null {
  const values = element.getAttribute('values');

  if (values == null || values.trim() === '') { return null; }
  const rawValues = values.split(';').map(value => value.trim());
  let end = rawValues.length;

  while (end > 0 && rawValues[end - 1] === '') { end--; }

  return rawValues.slice(0, end);
}

function buildPairSpec (
  start: IRBezierPath[],
  end: IRBezierPath[],
  startRaw: string | undefined,
  endRaw: string,
  additiveNeedsBase: boolean,
  accumulationPaths: IRBezierPath[] | undefined,
  startSignature: string | undefined,
  endSignature: string | undefined,
  attributeName: 'd' | 'points',
  closed: boolean,
): ShapeAnimationSpec | null {
  const valueIndexes = new Map<string, number>();

  if (startRaw != null) { valueIndexes.set(startRaw.trim(), 0); }
  valueIndexes.set(endRaw.trim(), 1);

  const pathSets = materializeEmptyPathSets([start, end]);

  return {
    pathSets,
    valueIndexes,
    additiveNeedsBase,
    discrete: !hasCompatibleTopology(
      [startSignature ?? '', endSignature ?? ''],
      pathSets,
      attributeName,
      closed,
    ),
    accumulationPaths,
  };
}

function indexValues(values: string[]): Map<string, number> {
  return new Map(values.map((value, index) => [value.trim(), index]));
}

function resolveShapeValue (
  raw: string,
  attributeName: 'd' | 'points',
  closed: boolean,
  centerX: number,
  centerY: number,
  basePaths: IRBezierPath[] | undefined,
): IRBezierPath[] | null {
  const normalized = raw.trim().toLowerCase();

  if (normalized === '') { return basePaths ?? []; }
  if (normalized === 'inherit') { return basePaths ?? null; }

  return parseShapePaths(raw, attributeName, closed, centerX, centerY);
}

function readBasePaths (shape: Extract<IRShape, { primitiveType: 'custom' }>, baseRaw: string): IRBezierPath[] | undefined {
  const hasAuthoredGeometry = baseRaw.trim() !== '';
  const hasParsedGeometry = shape.customPaths.some(path => path.closed || path.points.length > 1);

  return hasAuthoredGeometry || hasParsedGeometry ? shape.customPaths : undefined;
}

function parseShapePaths (
  raw: string,
  attributeName: 'd' | 'points',
  closed: boolean,
  centerX: number,
  centerY: number,
): IRBezierPath[] | null {
  const d = attributeName === 'd' ? raw : pointsToPath(raw, closed);

  if (d.trim() === '') { return null; }
  const paths = normalizedToCustomShapePaths(normalizePathCommands(d));

  return paths.length === 0 ? null : translatePaths(paths, centerX, centerY);
}

function pointsToPath (raw: string, closed: boolean): string {
  const points = parseNumberList(raw);

  if (points.length < 4 || points.length % 2 !== 0) { return ''; }
  const commands = [`M${points[0]} ${points[1]}`];

  for (let index = 2; index < points.length; index += 2) {
    commands.push(`L${points[index]} ${points[index + 1]}`);
  }

  return `${commands.join(' ')}${closed ? ' Z' : ''}`;
}

function translatePaths (paths: IRBezierPath[], centerX: number, centerY: number): IRBezierPath[] {
  return paths.map(path => ({
    ...path,
    points: path.points.map(point => ({ x: point.x - centerX, y: point.y - centerY })),
  }));
}

function appendAnimationFrames (
  frames: Array<{ time: number; paths: IRBezierPath[]; order: number }>,
  animation: SMILAnimation,
  spec: ShapeAnimationSpec,
  basePaths: IRBezierPath[] | undefined,
  order: number,
): void {
  for (const sample of animation.samples) {
    const cycle = spec.accumulationPaths == null ? 0 : sample.cycle;
    const paths = resolveSamplePaths(animation, spec, basePaths, sample.value[0] ?? 0, cycle);

    if (paths == null) { continue; }
    if (spec.accumulationPaths != null && sample.cycle > 0 && sample.sourceIndex === 0) {
      const previousCycleEnd = resolveSamplePaths(animation, spec, basePaths, spec.pathSets.length - 1, sample.cycle - 1);

      if (previousCycleEnd != null) {
        frames.push({
          time: Math.max(0, sample.time - 1e-4),
          paths: previousCycleEnd,
          order: order - 1,
        });
      }
    }
    frames.push({ time: sample.time, paths, order });
  }
}

function resolveSamplePaths (
  animation: SMILAnimation,
  spec: ShapeAnimationSpec,
  basePaths: IRBezierPath[] | undefined,
  value: number,
  cycle: number,
): IRBezierPath[] | null {
  const progress = value - cycle;
  const paths = spec.discrete
    ? spec.pathSets[Math.max(0, Math.min(spec.pathSets.length - 1, Math.round(progress)))] ?? null
    : interpolatePathSets(spec.pathSets, progress);

  if (paths == null) { return null; }
  let resolved = paths;

  if (spec.accumulationPaths != null && cycle > 0) {
    const accumulatedPaths = addPathSets(resolved, scalePathSet(spec.accumulationPaths, cycle));

    if (accumulatedPaths == null) { return null; }
    resolved = accumulatedPaths;
  }
  if (animation.additive === 'sum' && spec.additiveNeedsBase && basePaths != null) {
    const additivePaths = addPathSets(basePaths, resolved);

    if (additivePaths == null) { return null; }
    resolved = additivePaths;
  }

  return resolved;
}

function interpolatePathSets (pathSets: IRBezierPath[][], progress: number): IRBezierPath[] | null {
  if (pathSets.length === 0 || !Number.isFinite(progress)) { return null; }
  const lastIndex = pathSets.length - 1;
  const lowerIndex = progress <= 0 ? 0 : Math.min(lastIndex - 1, Math.floor(progress));
  const upperIndex = Math.min(lastIndex, lowerIndex + 1);
  const ratio = progress <= 0 ? progress : progress - lowerIndex;
  const lower = pathSets[lowerIndex];
  const upper = pathSets[upperIndex];

  if (lower == null || upper == null || !hasSameTopology([lower, upper])) { return null; }

  return lower.map((path, pathIndex) => interpolatePath(path, upper[pathIndex], ratio));
}

function interpolatePath (from: IRBezierPath, to: IRBezierPath, ratio: number): IRBezierPath {
  const interpolatePoint = (left: { x: number; y: number }, right: { x: number; y: number }) => ({
    x: left.x + (right.x - left.x) * ratio,
    y: left.y + (right.y - left.y) * ratio,
  });

  return {
    closed: from.closed,
    points: from.points.map((point, index) => interpolatePoint(point, to.points[index])),
    inTangents: from.inTangents.map((point, index) => interpolatePoint(point, to.inTangents[index])),
    outTangents: from.outTangents.map((point, index) => interpolatePoint(point, to.outTangents[index])),
  };
}

function scalePathSet (paths: IRBezierPath[], factor: number): IRBezierPath[] {
  return paths.map(path => ({
    closed: path.closed,
    points: path.points.map(point => scalePoint(point, factor)),
    inTangents: path.inTangents.map(point => scalePoint(point, factor)),
    outTangents: path.outTangents.map(point => scalePoint(point, factor)),
  }));
}

function scalePoint (point: { x: number; y: number }, factor: number): { x: number; y: number } {
  return { x: point.x * factor, y: point.y * factor };
}

function addPathSets (left: IRBezierPath[], right: IRBezierPath[]): IRBezierPath[] | null {
  if (!hasSameTopology([left, right])) { return null; }

  return left.map((path, pathIndex) => {
    const other = right[pathIndex];

    return {
      closed: path.closed,
      points: path.points.map((point, index) => addPoint(point, other.points[index])),
      inTangents: path.inTangents.map((point, index) => addPoint(point, other.inTangents[index])),
      outTangents: path.outTangents.map((point, index) => addPoint(point, other.outTangents[index])),
    };
  });
}

function addPoint (left: { x: number; y: number }, right: { x: number; y: number }): { x: number; y: number } {
  return { x: left.x + right.x, y: left.y + right.y };
}

function zeroShapeLike (paths: IRBezierPath[], centerX: number, centerY: number): IRBezierPath[] {
  return paths.map(path => ({
    closed: path.closed,
    points: path.points.map(() => ({ x: -centerX, y: -centerY })),
    inTangents: path.points.map(() => ({ x: 0, y: 0 })),
    outTangents: path.points.map(() => ({ x: 0, y: 0 })),
  }));
}

function hasCompatibleTopology (
  rawValues: string[],
  paths: IRBezierPath[][],
  attributeName: 'd' | 'points',
  closed: boolean,
): boolean {
  if (!hasSameTopology(paths)) { return false; }
  const signatures = rawValues
    .map(value => shapeCommandSignature(value, attributeName, closed))
    .filter(signature => signature !== '');

  return signatures.length < 2 || signatures.every(signature => signature === signatures[0]);
}

function materializeEmptyPathSets (pathSets: IRBezierPath[][]): IRBezierPath[][] {
  const templatePath = pathSets.find(paths => paths.length > 0)?.[0];

  if (templatePath == null) { return pathSets; }

  return pathSets.map(paths => paths.length === 0
    ? [zeroShapeLike([templatePath], 0, 0)[0]]
    : paths);
}

function shapeCommandSignature (raw: string, attributeName: 'd' | 'points', closed: boolean): string {
  if (raw.trim() === '') { return ''; }
  if (attributeName === 'points') {
    const points = parseNumberList(raw);

    return points.length >= 4 && points.length % 2 === 0
      ? `M${points.length / 2 - 1}${closed ? 'Z' : ''}`
      : '';
  }

  return normalizePathCommands(raw).map(command => command.cmd).join('');
}

function hasSameTopology (paths: IRBezierPath[][]): boolean {
  const first = paths[0];

  return first != null && paths.every(candidate => candidate.length === first.length
    && candidate.every((path, index) => path.closed === first[index]?.closed && path.points.length === first[index]?.points.length));
}

function pathsEqual (left: IRBezierPath[], right: IRBezierPath[]): boolean {
  if (!hasSameTopology([left, right])) { return false; }

  return left.every((path, pathIndex) => {
    const other = right[pathIndex];

    return path.points.every((point, index) => point.x === other.points[index].x && point.y === other.points[index].y)
      && path.inTangents.every((point, index) => point.x === other.inTangents[index].x && point.y === other.inTangents[index].y)
      && path.outTangents.every((point, index) => point.x === other.outTangents[index].x && point.y === other.outTangents[index].y);
  });
}

function isPaths (value: IRBezierPath[] | null): value is IRBezierPath[] {
  return value != null;
}
