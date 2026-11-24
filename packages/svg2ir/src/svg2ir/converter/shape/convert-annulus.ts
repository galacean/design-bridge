import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type {
  IRBezierPath, IRShape,
  IREllipseShape,
} from '@galacean/animation-ir';
import { IRPaintType, IRLineCap, IRLineJoin, IRShapePrimitiveType } from '@galacean/animation-ir';
import { normalizePathCommands, normalizedToCustomShapePaths } from '../../normalize-path';

/**
 * 将精确的 SVG 环形结构 `outer-circle + inner-circle` 转换为椭圆中心线和描边。
 *
 * 该判断比通用嵌套轮廓转换更严格：渐变填充、paint 动画、非圆形路径和任意圆角图形
 * 继续使用 custom path，避免改变这些 SVG 的填充语义。
 */
export function convertCircularAnnulusToEllipseStroke (
  es: EditableSVG,
  el: Element,
  shape: IRShape,
): IREllipseShape | null {
  const { fills, strokes, position } = shape;
  const d = String(es.getAttr(el, 'd') ?? '');
  const customPaths = normalizedToCustomShapePaths(normalizePathCommands(d));

  if (
    fills.length !== 1
    || fills[0].type !== IRPaintType.Solid
    || strokes.length !== 0
    || customPaths.length !== 2
    || !customPaths.every(path => path.closed)
    || hasAnimatedPaintAttribute(el)
  // 存在直接 paint 动画时保留复合圆环的 custom path，图元转换无法保留该结构。
    || shouldKeepAnimatedAnnulusAsCustom(el)
  ) {
    return null;
  }

  const contours = customPaths
    .map(getCircularContour)
    .filter((contour): contour is CircularContour => contour != null);

  if (contours.length !== 2) {
    return null;
  }

  const outer = contours[0].radius >= contours[1].radius ? contours[0] : contours[1];
  const inner = contours[0].radius >= contours[1].radius ? contours[1] : contours[0];
  const radiusTolerance = Math.max(1e-4, outer.radius * 1e-4);
  const centersMatch = Math.hypot(outer.centerX - inner.centerX, outer.centerY - inner.centerY) <= radiusTolerance;
  const fillRule = String(es.getAttr(el, 'fill-rule') ?? 'nonzero').trim().toLowerCase();
  const oppositeWinding = Math.sign(outer.area) !== 0
    && Math.sign(inner.area) !== 0
    && Math.sign(outer.area) !== Math.sign(inner.area);

  // nonzero 规则下，同向嵌套轮廓是实心并集；evenodd 始终把内轮廓视为洞，
  // nonzero 下反向绕序也会形成洞。
  if (
    !centersMatch
    || inner.radius <= radiusTolerance
    || outer.radius - inner.radius <= radiusTolerance
    || (fillRule !== 'evenodd' && !oppositeWinding)
  ) {
    return null;
  }

  return {
    fills: [],
    strokes: fills.map(p => ({ paint: p, width: outer.radius - inner.radius, cap: IRLineCap.Round, join: IRLineJoin.Round })),
    position,
    primitiveType: IRShapePrimitiveType.Ellipse,
    xRadius: (outer.radius + inner.radius) / 2,
    yRadius: (outer.radius + inner.radius) / 2,
  };
}

interface CircularContour {
  centerX: number;
  centerY: number;
  radius: number;
  area: number;
}

function getCircularContour (path: IRBezierPath): CircularContour | null {
  if (path.points.length < 4) {
    return null;
  }

  const points = path.points.slice();
  const inTangents = path.inTangents.slice();
  const outTangents = path.outTangents.slice();
  const first = points[0];
  const lastIndex = points.length - 1;

  if (Math.hypot(first.x - points[lastIndex].x, first.y - points[lastIndex].y) <= 1e-7) {
    points.pop();
    inTangents[0] = path.inTangents[lastIndex];
    inTangents.pop();
    outTangents.pop();
  }

  // 完整圆可以表示为四段四分之一圆弧或八段 45° 圆弧。
  // 限制可接受的结构，避免圆角矩形或任意 Bezier 环路被静默改变表示方式。
  if (
    (points.length !== 4 && points.length !== 8)
    || inTangents.length !== points.length
    || outTangents.length !== points.length
  ) {
    return null;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const radius = Math.max(maxX - minX, maxY - minY) / 2;
  const tolerance = Math.max(1e-4, radius * 1e-4);

  if (
    !Number.isFinite(radius)
    || radius <= 0
    || Math.abs((maxX - minX) - (maxY - minY)) > tolerance
    || points.some(point => Math.abs(Math.hypot(point.x - centerX, point.y - centerY) - radius) > tolerance)
  ) {
    return null;
  }

  const hasLeft = points.some(point => point.x <= centerX - radius * 0.9);
  const hasRight = points.some(point => point.x >= centerX + radius * 0.9);
  const hasTop = points.some(point => point.y <= centerY - radius * 0.9);
  const hasBottom = points.some(point => point.y >= centerY + radius * 0.9);

  if (!hasLeft || !hasRight || !hasTop || !hasBottom) {
    return null;
  }

  const segmentAngle = (Math.PI * 2) / points.length;
  const expectedHandleLength = radius * (4 / 3) * Math.tan(segmentAngle / 4);

  for (let index = 0; index < points.length; index++) {
    if (
      Math.abs(Math.hypot(inTangents[index].x, inTangents[index].y) - expectedHandleLength) > tolerance
      || Math.abs(Math.hypot(outTangents[index].x, outTangents[index].y) - expectedHandleLength) > tolerance
    ) {
      return null;
    }
  }

  let area = 0;

  for (let index = 0; index < points.length; index++) {
    const previous = points[(index + points.length - 1) % points.length];
    const current = points[index];

    area += previous.x * current.y - current.x * previous.y;
  }

  return { centerX, centerY, radius, area: area / 2 };
}

function hasAnimatedPaintAttribute (el: Element): boolean {
  const node = (el as unknown as { node?: globalThis.Element }).node;

  return Array.from(node?.children ?? []).some(child => {
    const tag = child.tagName.toLowerCase();

    if (tag !== 'animate' && tag !== 'set') {
      return false;
    }

    const attributeName = child.getAttribute('attributeName')?.toLowerCase();

    return attributeName === 'fill' || attributeName === 'fill-opacity' || attributeName === 'color';
  });
}

function hasAnimatedTransformAttribute (el: Element): boolean {
  const node = (el as unknown as { node?: globalThis.Element }).node;

  return Array.from(node?.children ?? []).some(child => (
    child.tagName.toLowerCase() === 'animatetransform'
    && (child.getAttribute('attributeName') ?? '').trim().toLowerCase() === 'transform'
  ));
}

/**
 * Effects 椭圆描边图元通常最适合表示动画圆环；当动画变换会改变填充洞的几何时，
 * 在满足结构条件的情况下保留复合 custom path，而不是替换为描边。
 */
function shouldKeepAnimatedAnnulusAsCustom (el: Element): boolean {
  if (!hasAnimatedTransformAttribute(el)) { return false; }

  const node = (el as unknown as { node?: globalThis.Element }).node;
  const parent = node?.parentElement;

  if (parent == null) { return false; }

  const siblings = Array.from(parent.children)
    .filter(child => child.tagName.toLowerCase() === 'path');

  if (siblings.length !== 2) { return false; }

  const d = node?.getAttribute('d')?.replace(/\s+/g, ' ').trim();

  if (d == null || siblings.some(sibling => sibling.getAttribute('d')?.replace(/\s+/g, ' ').trim() !== d)) {
    return false;
  }

  return siblings.every(sibling => {
    const transforms = Array.from(sibling.children)
      .filter(child => child.tagName.toLowerCase() === 'animatetransform')
      .filter(child => (child.getAttribute('attributeName') ?? '').trim().toLowerCase() === 'transform');
    const transformTypes = new Set(transforms.map(child => (child.getAttribute('type') ?? '').trim().toLowerCase()));
    const opacityAnimation = Array.from(sibling.children).some(child => (
      (child.tagName.toLowerCase() === 'animate' || child.tagName.toLowerCase() === 'set')
      && (child.getAttribute('attributeName') ?? '').trim().toLowerCase() === 'opacity'
    ));

    return transformTypes.has('translate') && transformTypes.has('scale') && opacityAnimation;
  });
}
