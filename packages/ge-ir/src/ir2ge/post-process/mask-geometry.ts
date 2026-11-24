import { IRMaskMode, type IRMask } from '@galacean/animation-ir';
import { DataType } from '@galacean/effects-specification';
import { isRecord } from '../../common/json-normalization';
import type { GeneratedCompositionData, GeneratedMiscData, GeneratedVFXItemData } from '../types';

interface Point2D {
  x: number;
  y: number;
}

interface Affine2D {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

/** A positive, closed mask boundary expressed in one Composition's local space. */
export interface RuntimeMaskGeometry {
  points: Point2D[];
}

export type MaskContainment = 'equal' | 'existing-contains-source' | 'source-contains-existing' | 'none';

const NUMERIC_EPSILON = 1e-8;
/**
 * Lottie paths commonly extend a fraction of a source pixel beyond a Precomp
 * viewport. Treat that export noise as the same boundary when proving containment.
 */
const CONTAINMENT_TOLERANCE = 0.025;
const CURVE_FLATNESS = 0.002;
const MAX_CURVE_DEPTH = 10;

export function buildRuntimeMaskGeometry(
  mask: IRMask,
  ratio: number,
  coordinateOrigin: [number, number],
): RuntimeMaskGeometry | undefined {
  const path = mask.path;

  const effectiveInverted = mask.mode === IRMaskMode.Subtract ? mask.inverted !== true : mask.inverted === true;

  if (effectiveInverted || !path.closed || path.points.length < 3) {
    return undefined;
  }

  const points = path.points.map(point => convertPoint(point, ratio, coordinateOrigin));
  const easingIns = path.inTangents.map(point => convertVector(point, ratio));
  const easingOuts = path.outTangents.map(point => convertVector(point, ratio));
  const flattened: Point2D[] = [points[0]];

  for (let index = 0; index < points.length; index++) {
    const nextIndex = (index + 1) % points.length;
    const start = points[index];
    const end = points[nextIndex];
    const control1 = addPoints(start, easingOuts[index] ?? { x: 0, y: 0 });
    const control2 = addPoints(end, easingIns[nextIndex] ?? { x: 0, y: 0 });

    flattenCubic(start, control1, control2, end, flattened, 0);
  }

  if (pointsEqual(flattened[0], flattened[flattened.length - 1])) {
    flattened.pop();
  }

  return flattened.length >= 3 ? { points: flattened } : undefined;
}

export function mapMaskGeometryIntoPrecomp(
  geometry: RuntimeMaskGeometry | undefined,
  precompItem: GeneratedVFXItemData,
  items: GeneratedVFXItemData[],
  animatedItemIds: ReadonlySet<string>,
): RuntimeMaskGeometry | undefined {
  if (geometry == null) {
    return undefined;
  }
  const itemById = new Map(items.map(item => [item.id, item] as const));
  const chain: GeneratedVFXItemData[] = [];
  const visited = new Set<string>();
  let current: GeneratedVFXItemData | undefined = precompItem;

  while (current != null && !visited.has(current.id)) {
    if (animatedItemIds.has(current.id)) {
      return undefined;
    }
    visited.add(current.id);
    chain.unshift(current);
    current = current.parentId == null ? undefined : itemById.get(current.parentId);
  }

  let world = identityMatrix();

  for (const item of chain) {
    world = multiplyMatrices(world, buildItemMatrix(item));
  }
  const inverse = invertMatrix(world);

  if (inverse == null) {
    return undefined;
  }

  return { points: geometry.points.map(point => transformPoint(inverse, point)) };
}

export function collectAnimatedTransformItemIds(
  generatedCompositions: GeneratedCompositionData[],
  miscs: GeneratedMiscData[],
): Set<string> {
  const miscById = new Map(miscs.map(misc => [misc.id, misc] as const));
  const animatedItemIds = new Set<string>();

  for (const generated of generatedCompositions) {
    for (const binding of generated.itemBindings) {
      if (binding.objectBindingTrackId == null) {
        continue;
      }
      const objectBindingTrack = miscById.get(binding.objectBindingTrackId);
      const childReferences = objectBindingTrack?.['children'];

      if (!Array.isArray(childReferences)) {
        continue;
      }
      for (const childReference of childReferences) {
        if (!isRecord(childReference) || typeof childReference['id'] !== 'string') {
          continue;
        }
        const track = miscById.get(childReference['id']);

        if (track?.dataType !== DataType.TransformTrack || !transformTrackHasAnimation(track, miscById)) {
          continue;
        }
        animatedItemIds.add(binding.itemId);

        break;
      }
    }
  }

  return animatedItemIds;
}

export function compareMaskContainment(
  existing: RuntimeMaskGeometry | undefined,
  source: RuntimeMaskGeometry | undefined,
): MaskContainment {
  if (existing == null || source == null) {
    return 'none';
  }
  const sourceInsideExisting = containsPolygon(existing.points, source.points);
  const existingInsideSource = containsPolygon(source.points, existing.points);

  if (sourceInsideExisting && existingInsideSource) {
    return 'equal';
  }
  if (sourceInsideExisting) {
    return 'existing-contains-source';
  }
  if (existingInsideSource) {
    return 'source-contains-existing';
  }

  return 'none';
}

function convertPoint(point: Point2D, ratio: number, coordinateOrigin: [number, number]): Point2D {
  return {
    x: (point.x - coordinateOrigin[0]) * ratio,
    y: -(point.y - coordinateOrigin[1]) * ratio,
  };
}

function convertVector(point: Point2D, ratio: number): Point2D {
  return { x: point.x * ratio, y: -point.y * ratio };
}

function addPoints(left: Point2D, right: Point2D): Point2D {
  return { x: left.x + right.x, y: left.y + right.y };
}

function flattenCubic(
  start: Point2D,
  control1: Point2D,
  control2: Point2D,
  end: Point2D,
  output: Point2D[],
  depth: number,
): void {
  if (depth >= MAX_CURVE_DEPTH || isCubicFlat(start, control1, control2, end)) {
    output.push(end);

    return;
  }
  const startControl = midpoint(start, control1);
  const controls = midpoint(control1, control2);
  const controlEnd = midpoint(control2, end);
  const leftControl = midpoint(startControl, controls);
  const rightControl = midpoint(controls, controlEnd);
  const center = midpoint(leftControl, rightControl);

  flattenCubic(start, startControl, leftControl, center, output, depth + 1);
  flattenCubic(center, rightControl, controlEnd, end, output, depth + 1);
}

function isCubicFlat(start: Point2D, control1: Point2D, control2: Point2D, end: Point2D): boolean {
  return Math.max(
    distanceToLine(control1, start, end),
    distanceToLine(control2, start, end),
  ) <= CURVE_FLATNESS;
}

function distanceToLine(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (length <= NUMERIC_EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length;
}

function midpoint(left: Point2D, right: Point2D): Point2D {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function pointsEqual(left: Point2D | undefined, right: Point2D | undefined): boolean {
  return left != null && right != null &&
    Math.abs(left.x - right.x) <= NUMERIC_EPSILON &&
    Math.abs(left.y - right.y) <= NUMERIC_EPSILON;
}

function containsPolygon(container: Point2D[], inner: Point2D[]): boolean {
  if (
    container.length < 3 ||
    inner.length < 3 ||
    !inner.every(point => pointInPolygonOrBoundary(point, container))
  ) {
    return false;
  }

  if (isConvexPolygon(container)) {
    return true;
  }

  for (let innerIndex = 0; innerIndex < inner.length; innerIndex++) {
    const innerStart = inner[innerIndex];
    const innerEnd = inner[(innerIndex + 1) % inner.length];

    for (let outerIndex = 0; outerIndex < container.length; outerIndex++) {
      const outerStart = container[outerIndex];
      const outerEnd = container[(outerIndex + 1) % container.length];

      if (segmentsProperlyIntersect(innerStart, innerEnd, outerStart, outerEnd)) {
        return false;
      }
    }
  }

  return true;
}

function isConvexPolygon(points: Point2D[]): boolean {
  let direction = 0;

  for (let index = 0; index < points.length; index++) {
    const cross = orientation(
      points[index],
      points[(index + 1) % points.length],
      points[(index + 2) % points.length],
    );

    if (Math.abs(cross) <= NUMERIC_EPSILON) {
      continue;
    }
    const currentDirection = Math.sign(cross);

    if (direction !== 0 && currentDirection !== direction) {
      return false;
    }
    direction = currentDirection;
  }

  return direction !== 0;
}

function pointInPolygonOrBoundary(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous];
    const end = polygon[index];

    if (pointOnSegment(point, start, end)) {
      return true;
    }
    const crossesRay = (start.y > point.y) !== (end.y > point.y) &&
      point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x;

    if (crossesRay) {
      inside = !inside;
    }
  }

  return inside;
}

function pointOnSegment(point: Point2D, start: Point2D, end: Point2D): boolean {
  if (distanceToLine(point, start, end) > CONTAINMENT_TOLERANCE) {
    return false;
  }

  return point.x >= Math.min(start.x, end.x) - CONTAINMENT_TOLERANCE &&
    point.x <= Math.max(start.x, end.x) + CONTAINMENT_TOLERANCE &&
    point.y >= Math.min(start.y, end.y) - CONTAINMENT_TOLERANCE &&
    point.y <= Math.max(start.y, end.y) + CONTAINMENT_TOLERANCE;
}

function segmentsProperlyIntersect(
  firstStart: Point2D,
  firstEnd: Point2D,
  secondStart: Point2D,
  secondEnd: Point2D,
): boolean {
  const firstSideStart = orientation(firstStart, firstEnd, secondStart);
  const firstSideEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondSideStart = orientation(secondStart, secondEnd, firstStart);
  const secondSideEnd = orientation(secondStart, secondEnd, firstEnd);

  return firstSideStart * firstSideEnd < -NUMERIC_EPSILON &&
    secondSideStart * secondSideEnd < -NUMERIC_EPSILON;
}

function orientation(start: Point2D, end: Point2D, point: Point2D): number {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
}

function identityMatrix(): Affine2D {
  return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
}

function buildItemMatrix(item: GeneratedVFXItemData): Affine2D {
  const transform = item.transform;
  const angle = (transform.eulerHint.z * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const anchorX = transform.anchor?.x ?? 0;
  const anchorY = transform.anchor?.y ?? 0;
  const a = cosine * transform.scale.x;
  const b = sine * transform.scale.x;
  const c = -sine * transform.scale.y;
  const d = cosine * transform.scale.y;

  return {
    a,
    b,
    c,
    d,
    tx: transform.position.x + anchorX - a * anchorX - c * anchorY,
    ty: transform.position.y + anchorY - b * anchorX - d * anchorY,
  };
}

function multiplyMatrices(parent: Affine2D, child: Affine2D): Affine2D {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    tx: parent.a * child.tx + parent.c * child.ty + parent.tx,
    ty: parent.b * child.tx + parent.d * child.ty + parent.ty,
  };
}

function invertMatrix(matrix: Affine2D): Affine2D | undefined {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;

  if (Math.abs(determinant) <= NUMERIC_EPSILON) {
    return undefined;
  }
  const inverseDeterminant = 1 / determinant;
  const a = matrix.d * inverseDeterminant;
  const b = -matrix.b * inverseDeterminant;
  const c = -matrix.c * inverseDeterminant;
  const d = matrix.a * inverseDeterminant;

  return {
    a,
    b,
    c,
    d,
    tx: -(a * matrix.tx + c * matrix.ty),
    ty: -(b * matrix.tx + d * matrix.ty),
  };
}

function transformPoint(matrix: Affine2D, point: Point2D): Point2D {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
}

function transformTrackHasAnimation(
  track: GeneratedMiscData,
  miscById: ReadonlyMap<string, GeneratedMiscData>,
): boolean {
  const clips = track['clips'];

  if (!Array.isArray(clips)) {
    return false;
  }

  return clips.some(clip => {
    if (!isRecord(clip)) {
      return false;
    }
    const assetReference = clip['asset'];

    if (!isRecord(assetReference) || typeof assetReference['id'] !== 'string') {
      return false;
    }
    const asset = miscById.get(assetReference['id']);

    return asset?.dataType === DataType.TransformPlayableAsset && [
      asset['positionOverLifetime'],
      asset['rotationOverLifetime'],
      asset['sizeOverLifetime'],
    ].some(hasAnimationPayload);
  });
}

function hasAnimationPayload(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : isRecord(value) && Object.keys(value).length > 0;
}
