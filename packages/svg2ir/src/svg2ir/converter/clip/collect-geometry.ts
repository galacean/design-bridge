import type { IRBezierPath } from '@galacean/animation-ir';
import { parseTransform, transformPoint, type SVGMatrix } from '../../matrix';
import { normalizePathCommands, normalizedToCustomShapePaths } from '../../normalize-path';

type MaskPoint = { x: number; y: number };

export interface MaskGeometry {
  paths: IRBezierPath[];
}

/** 把单个 SVG 形状转换为一个或多个独立 mask 轮廓，并保留曲线控制柄。 */
export function collectShapeGeometry (
  el: { node: globalThis.Element },
  tag: string,
  geometry: MaskGeometry,
  applyShapeOwnTransform = false,
): void {
  const paths = buildShapePaths(el, tag);

  if (applyShapeOwnTransform) {
    const transform = el.node.getAttribute?.('transform') ?? '';

    if (transform !== '') {
      const matrix = parseTransform(transform);

      for (const path of paths) {
        transformPathInPlace(matrix, path);
      }
    }
  }

  geometry.paths.push(...paths);
}

function buildShapePaths(el: { node: globalThis.Element }, tag: string): IRBezierPath[] {
  switch (tag) {
    case 'rect': {
      const x = attrNum(el, 'x', 0);
      const y = attrNum(el, 'y', 0);
      const width = attrNum(el, 'width', 0);
      const height = attrNum(el, 'height', 0);

      return [buildLinearPath([
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ])];
    }
    case 'circle':
    case 'ellipse':
      return [buildEllipsePath(el, tag === 'circle')];
    case 'polygon':
    case 'polyline':
      return [buildLinearPath(parseNumPairs(el.node.getAttribute('points') ?? ''))];
    case 'line':
      return [buildLinearPath([
        { x: attrNum(el, 'x1', 0), y: attrNum(el, 'y1', 0) },
        { x: attrNum(el, 'x2', 0), y: attrNum(el, 'y2', 0) },
      ])];
    case 'path':
      return normalizedToCustomShapePaths(normalizePathCommands(el.node.getAttribute('d') ?? '', { arcSegmentAngle: Infinity }))
        .map(path => ({ ...path, closed: true }));
    default:
      return [];
  }
}

function buildLinearPath(points: MaskPoint[]): IRBezierPath {
  return {
    points,
    inTangents: points.map(() => ({ x: 0, y: 0 })),
    outTangents: points.map(() => ({ x: 0, y: 0 })),
    closed: true,
  };
}

function buildEllipsePath(el: { node: globalThis.Element }, isCircle: boolean): IRBezierPath {
  const cx = attrNum(el, 'cx', 0);
  const cy = attrNum(el, 'cy', 0);
  const rx = isCircle ? attrNum(el, 'r', 0) : attrNum(el, 'rx', 0);
  const ry = isCircle ? rx : attrNum(el, 'ry', 0);
  const segments = 8;
  const handleScale = (4 / 3) * Math.tan(Math.PI / (2 * segments));
  const points: MaskPoint[] = [];
  const inTangents: MaskPoint[] = [];
  const outTangents: MaskPoint[] = [];

  for (let index = 0; index < segments; index++) {
    const angle = index / segments * Math.PI * 2;
    const tangent = {
      x: -rx * Math.sin(angle) * handleScale,
      y: ry * Math.cos(angle) * handleScale,
    };

    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
    inTangents.push({ x: -tangent.x, y: -tangent.y });
    outTangents.push(tangent);
  }

  return { points, inTangents, outTangents, closed: true };
}

function transformPathInPlace(matrix: SVGMatrix, path: IRBezierPath): void {
  for (const point of path.points) {
    const transformed = transformPoint(matrix, point.x, point.y);

    point.x = transformed.x;
    point.y = transformed.y;
  }
  transformVectorsInPlace(matrix, path.inTangents);
  transformVectorsInPlace(matrix, path.outTangents);
}

function parseNumPairs(s: string): MaskPoint[] {
  const numbers = (s.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const points: MaskPoint[] = [];

  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }

  return points;
}

function transformVectorsInPlace(matrix: SVGMatrix, vectors: MaskPoint[]): void {
  for (const vector of vectors) {
    const x = matrix.a * vector.x + matrix.c * vector.y;
    const y = matrix.b * vector.x + matrix.d * vector.y;

    vector.x = x;
    vector.y = y;
  }
}

export function transformVector(matrix: SVGMatrix, vector: MaskPoint): MaskPoint {
  return {
    x: matrix.a * vector.x + matrix.c * vector.y,
    y: matrix.b * vector.x + matrix.d * vector.y,
  };
}

function attrNum(el: { node: globalThis.Element }, attribute: string, fallback: number): number {
  const value = el.node.getAttribute?.(attribute);

  if (value == null || value === '') { return fallback; }
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

// 已建好的 mask 点集合上的覆盖/包含判定:用于决定 mask 是否可跳过(no-op 全覆盖)或落点异常,
// 与上方"从形状收集几何"的构建职责相对。所有函数都是纯几何,不读 DOM、不依赖 IR。
type MaskPolygon = Array<{ x: number; y: number }>;

/** 多边形是否为轴对齐矩形(4 个角,边与坐标轴平行)。 */
export function isAxisAlignedRect (pts: MaskPolygon, eps = 1e-6): boolean {
  if (pts.length !== 4) { return false; }
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const uniqueX = new Set(xs.map(x => Math.round(x / eps)));
  const uniqueY = new Set(ys.map(y => Math.round(y / eps)));

  return uniqueX.size === 2 && uniqueY.size === 2;
}

function distPointToSegment (
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;

  if (len2 === 0) { return Math.hypot(p.x - a.x, p.y - a.y); }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;

  t = Math.max(0, Math.min(1, t));

  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 点是否在多边形内(ray casting);边界上的点也算在内。 */
function pointInPolygon (pt: { x: number; y: number }, poly: MaskPolygon, eps = 1e-6): boolean {
  const n = poly.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = poly[i];
    const pj = poly[j];

    if (distPointToSegment(pt, pi, pj) <= eps) { return true; }
  }

  let inside = false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    const intersect = ((pi.y > pt.y) !== (pj.y > pt.y)) &&
      (pt.x < (pj.x - pi.x) * (pt.y - pi.y) / (pj.y - pi.y) + pi.x);

    if (intersect) { inside = !inside; }
  }

  return inside;
}

/** mask pts 的轴对齐 bbox 是否罩住 shapeBbox(每边余 eps)。非轴对齐 mask 不在此判(走 pointInPolygon)。 */
export function rangeCovers (pts: MaskPolygon, bbox: { minX: number; minY: number; maxX: number; maxY: number }, eps: number): boolean {
  let pminX = Infinity, pminY = Infinity, pmaxX = -Infinity, pmaxY = -Infinity;

  for (const p of pts) {
    pminX = Math.min(pminX, p.x); pminY = Math.min(pminY, p.y);
    pmaxX = Math.max(pmaxX, p.x); pmaxY = Math.max(pmaxY, p.y);
  }

  return pminX <= bbox.minX + eps && pminY <= bbox.minY + eps && pmaxX >= bbox.maxX - eps && pmaxY >= bbox.maxY - eps;
}

/** 判断 rebase 后的 mask 尺寸是否明显偏离被裁区域。 */
export function maskSizeAbnormal (pts: MaskPolygon, w: number, h: number): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const bw = maxX - minX, bh = maxY - minY;

  return bw * bh < (w * h) * 0.1 || bw * bh > (w * h) * 9;
}

/** 判断 mask 是否完全覆盖被裁区域。矩形使用 bbox，其他形状检查区域四角。 */
export function maskCoversFull (pts: MaskPolygon, w: number, h: number): boolean {
  if (pts.length < 3) { return false; }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }

  // 轴对齐矩形允许少量边缘误差，以覆盖常见的 padding。
  if (isAxisAlignedRect(pts) && minX <= 5 && minY <= 5 && maxX >= w - 5 && maxY >= h - 5) {
    return true;
  }

  // 非矩形 mask 逐个检查区域四角，边界点也视为覆盖。
  const corners = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];

  return corners.every(c => pointInPolygon(c, pts));
}
