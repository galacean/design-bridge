/**
 * 将 SVG 基本形状元素解析为 IRShape。
 *
 * 支持 rect、circle、ellipse、line、polygon、polyline 和 path；坐标使用 SVG 设计像素。
 */
import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type {
  IRBezierPath,
  IRCustomShape,
  IREllipseShape,
  IRLineCap,
  IRLineJoin,
  IRRectangleShape,
  IRShapeStyle,
} from '@galacean/animation-ir';
import { IRPaintType, IRShapePrimitiveType } from '@galacean/animation-ir';
import { readSVGNumberAttribute } from '../../read-attributes';
import { mapSVGColorToIRColor } from '../../map-color';
import { accumulateAncestors, decomposeMatrix } from '../../matrix';
import { mergeClosedSubpaths, normalizePathCommands, normalizedToCustomShapePaths } from '../../normalize-path';
import { resolveGradientPaint, type ShapeBBox } from '../paint/resolve-gradient';
import { canSynthesizeDash, parseDashArray, synthesizeDashSubpaths } from '../../converter/shape/parse-dash';

type IRShapePaint = NonNullable<IRShapeStyle['fills']>[number];

/** 从元素读 fill/stroke + opacity → IRShapePaint[](纯色或渐变,可能空)。
 *  元素级 opacity 会乘到 fill/stroke alpha 上(与 SVG 渲染一致)。
 */
function buildPaints (
  es: EditableSVG,
  el: Element,
  colorAttr: 'fill' | 'stroke',
  bbox: ShapeBBox,
): IRShapePaint[] {
  const raw = es.getAttr(el, colorAttr);
  const opacityAttr = es.getAttr(el, colorAttr === 'fill' ? 'fill-opacity' : 'stroke-opacity');
  const paintOpacity = opacityAttr == null || opacityAttr === '' ? 1 : Number(opacityAttr);
  const opacity = Number.isFinite(paintOpacity) ? Math.max(0, Math.min(1, paintOpacity)) : 1;

  const rawStr = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);

  // url(#id) 解析失败时按 SVG 规范视为 none。
  if (/^url\(\s*["']?#/.test(rawStr)) {
    const gradient = resolveGradientPaint(es, raw, opacity, bbox);

    return gradient != null ? [gradient] : [];
  }

  // SVG presentation attribute 的初始值不同：fill 默认为不透明黑色，stroke 默认为 none。
  // 当元素及其祖先都没有设置 paint 时，EditableSVG 返回空值，因此这里补回 SVG 默认 fill。
  const initialPaint = colorAttr === 'fill' ? 'black' : null;
  const color = mapSVGColorToIRColor(rawStr === '' ? initialPaint : rawStr, opacity);
  const paints: IRShapePaint[] = [];

  if (color != null) {
    paints.push({ type: IRPaintType.Solid, color });
  }

  return paints;
}

/** 读 borderRadius 风格字段:返 number 或 undefined(解析底座数值属性返 number)。 */
/** SVG <rect x y width height rx ry> → IRRectangleShape。 */
export function parseRect (es: EditableSVG, el: Element): IRRectangleShape {
  const x = readSVGNumberAttribute(es, el, 'x', 0) ?? 0;
  const y = readSVGNumberAttribute(es, el, 'y', 0) ?? 0;
  const width = readSVGNumberAttribute(es, el, 'width', 0) ?? 0;
  const height = readSVGNumberAttribute(es, el, 'height', 0) ?? 0;
  // rx 优先,缺则用 ry(svg 规范 rx/ry 任一缺失时另一值兜底)。
  const rxRaw = readSVGNumberAttribute(es, el, 'rx');
  const rx = rxRaw ?? readSVGNumberAttribute(es, el, 'ry') ?? 0;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const style = buildStyle(es, el, cx, cy, { minX: x, minY: y, width, height });

  // Animation IR cornerRadius 使用局部像素，且不能超过短边的一半。
  const halfMin = Math.min(width, height) / 2;
  const cornerRadius = rx > 0 && halfMin > 0 ? Math.min(rx, halfMin) : 0;

  return { ...style, primitiveType: IRShapePrimitiveType.Rectangle, width, height, ...(cornerRadius ? { cornerRadius } : {}) };
}

/** SVG <circle cx cy r> / <ellipse cx cy rx ry> → IREllipseShape。 */
export function parseEllipse (es: EditableSVG, el: Element, isCircle: boolean): IREllipseShape {
  const cx = readSVGNumberAttribute(es, el, 'cx', 0) ?? 0;
  const cy = readSVGNumberAttribute(es, el, 'cy', 0) ?? 0;
  const rx = isCircle ? readSVGNumberAttribute(es, el, 'r', 0) ?? 0 : readSVGNumberAttribute(es, el, 'rx', 0) ?? 0;
  const ry = isCircle ? rx : readSVGNumberAttribute(es, el, 'ry', 0) ?? 0;
  const style = buildStyle(es, el, cx, cy, { minX: cx - rx, minY: cy - ry, width: rx * 2, height: ry * 2 });

  return { ...style, primitiveType: IRShapePrimitiveType.Ellipse, xRadius: rx, yRadius: ry };
}

/** SVG <path d> / <polygon points> / <polyline points> / <line x1 y1 x2 y2> → IRCustomShape。 */
export function parseCustomPath (es: EditableSVG, el: Element, kind: 'path' | 'polygon' | 'polyline' | 'line'): IRCustomShape | null {
  let d = '';

  if (kind === 'path') {
    d = String(es.getAttr(el, 'd') ?? '');
  } else if (kind === 'polygon' || kind === 'polyline') {
    const pointsStr = String(es.getAttr(el, 'points') ?? '');
    const nums = (pointsStr.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    const moveto = nums.length >= 2 ? `M${nums[0]} ${nums[1]}` : '';
    const lines = [];

    for (let i = 2; i + 1 < nums.length; i += 2) {
      lines.push(`L${nums[i]} ${nums[i + 1]}`);
    }
    d = [moveto, ...lines, kind === 'polygon' ? 'Z' : ''].join(' ');
  } else if (kind === 'line') {
    const x1 = readSVGNumberAttribute(es, el, 'x1', 0) ?? 0;
    const y1 = readSVGNumberAttribute(es, el, 'y1', 0) ?? 0;
    const x2 = readSVGNumberAttribute(es, el, 'x2', 0) ?? 0;
    const y2 = readSVGNumberAttribute(es, el, 'y2', 0) ?? 0;

    d = `M${x1} ${y1} L${x2} ${y2}`;
  }

  const cmds = normalizePathCommands(d, {
    // 直接旋转动画使用更细的圆弧细分；静态路径和 mask 几何保留默认细分与边界计算。
    arcSegmentAngle: hasDirectAnimatedRotate(el) ? fineArcSegmentAngle(d) : undefined,
  });

  if (cmds.length === 0) {
    return null;
  }

  let customPaths = normalizedToCustomShapePaths(cmds);

  if (customPaths.length === 0) {
    return null;
  }

  // 几何中心作为 shape.position。
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const p of customPaths) {
    for (const pt of p.points) {
      minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
    }
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const style = buildStyle(es, el, cx, cy, { minX, minY, width: maxX - minX, height: maxY - minY });

  // SVG 的 fill 初始值是 black，但 <line> 没有封闭面积，fill 对它不产生任何视觉结果。
  // IR 若保留该默认 fill，会把虚线直线误判成 fill+dash，进而跳过精确的 dash 子路径合成。
  if (kind === 'line') {
    style.fills = [];
  }

  // 闭合填充路径且没有描边时,把多个 sub-path 缝成一条路径让 Effects 的 odd 填充规则
  // 正确处理洞;否则每个 sub-path 会被独立 triangulate/fill,导致“洞”也被填充。
  // 有描边时保留原结构,避免桥接线产生额外描边。
  const hasFillOnly = style.fills.length > 0 && style.strokes.length === 0;

  if (hasFillOnly && customPaths.length > 1 && customPaths.every(p => p.closed) && shouldMergeClosedFillPaths(es, el, customPaths)) {
    customPaths = mergeClosedSubpaths(customPaths);
  }

  // Effects 没有 native dash；对无填充、开放且由直线组成的路径，将 on 区间切成多个
  // open subpath，由独立描边复现 SVG 的虚线与端点语义。其他形态保留 warning。
  if (canSynthesizeDash(es, el, style.fills, style.strokes, style.strokes[0]?.width, customPaths)) {
    const d = parseDashArray(es, el);

    if (d != null) {
      customPaths = synthesizeDashSubpaths(customPaths, d.dash, d.offset, d.patternLen);
    }
  }

  // IR customPath 顶点相对于 shape.position 保存；切线已经是相对控制柄。
  const relativePaths = customPaths.map(p => ({
    closed: p.closed,
    points: p.points.map(pt => ({ x: pt.x - cx, y: pt.y - cy })),
    inTangents: p.inTangents,
    outTangents: p.outTangents,
  }));

  return { ...style, primitiveType: IRShapePrimitiveType.Custom, customPaths: relativePaths };
}

function hasDirectAnimatedRotate (el: Element): boolean {
  const node = (el as unknown as { node?: globalThis.Element }).node;

  return Array.from(node?.children ?? []).some(child => (
    child.tagName.toLowerCase() === 'animatetransform'
    && (child.getAttribute('attributeName') ?? '').trim().toLowerCase() === 'transform'
    && (child.getAttribute('type') ?? '').trim().toLowerCase() === 'rotate'
  ));
}

function fineArcSegmentAngle (d: string): number | undefined {
  const arcCount = (d.match(/[Aa]/g) ?? []).length;

  return arcCount >= 7 ? Math.PI / 32 : undefined;
}

/**
 * Effects custom shape 三角化使用 odd/even 轮廓奇偶规则。对于 SVG nonzero 规则，
 * 同向嵌套轮廓没有零绕数区域，因此将每个轮廓作为独立填充图形可以避免内轮廓
 * 被 odd 规则误判为洞；反向绕序仍需要 bridge path 来正确表示外轮廓与内洞。
 */
function shouldMergeClosedFillPaths (es: EditableSVG, el: Element, paths: IRBezierPath[]): boolean {
  const fillRule = String(es.getAttr(el, 'fill-rule') ?? 'nonzero').trim().toLowerCase();

  if (fillRule !== 'nonzero') { return true; }

  // 端点多边形面积不足以判断带曲线轮廓的绕数；保守地沿用桥接路径，避免把
  // 曲线/弧线的 nonzero 语义误判成独立填充。
  if (paths.some(path => path.inTangents.some(nonZeroVector) || path.outTangents.some(nonZeroVector))) {
    return true;
  }

  const signs = paths
    .map(path => signedPathArea(path))
    .filter(area => Math.abs(area) > 1e-9)
    .map(area => Math.sign(area));

  return signs.length === 0 || !signs.every(sign => sign === signs[0]);
}

function nonZeroVector (vector: { x: number; y: number }): boolean {
  return Math.abs(vector.x) > 1e-9 || Math.abs(vector.y) > 1e-9;
}

function signedPathArea (path: IRBezierPath): number {
  let area = 0;

  for (let i = 0; i < path.points.length; i++) {
    const prev = path.points[(i + path.points.length - 1) % path.points.length];
    const current = path.points[i];

    area += prev.x * current.y - current.x * prev.y;
  }

  return area / 2;
}

/** 返回祖先变换对几何的等效均匀缩放，用于 non-scaling-stroke 的宽度补偿。 */
function accumulatedStrokeScale (el: Element): number {
  const m = accumulateAncestors(el);
  const { sx, sy } = decomposeMatrix(m);

  return Math.sqrt(Math.abs(sx * sy));
}

/** 读 fill/stroke/strokeWidth/cap/join + position 共用样式。 */
function buildStyle (es: EditableSVG, el: Element, posX: number, posY: number, bbox: ShapeBBox): IRShapeStyle {
  const fills = buildPaints(es, el, 'fill', bbox);
  const strokePaints = buildPaints(es, el, 'stroke', bbox);
  const strokeWidthRaw = readSVGNumberAttribute(es, el, 'stroke-width');
  const cap = String(es.getAttr(el, 'stroke-linecap') ?? '').toLowerCase();
  const join = String(es.getAttr(el, 'stroke-linejoin') ?? '').toLowerCase();

  // SVG non-scaling-stroke 要求描边宽度不随祖先和 viewport 缩放；Effects 没有对应字段，
  // 因此在 IR 阶段按累计几何缩放预先调整 strokeWidth。
  const ve = String(es.getAttr(el, 'vector-effect') ?? '').toLowerCase();
  const nonScaling = ve === 'non-scaling-stroke';
  const scale = nonScaling ? accumulatedStrokeScale(el) : 0;
  const applyNonScaling = nonScaling && scale > 0 && isFinite(scale);

  // stroke 宽/端点样式挂在 strokes[]上(不在 shape 顶层)。SVG stub strokeWidth=1,端点/连接默认 round/miter。
  const defaultWidth = strokeWidthRaw != null ? strokeWidthRaw : (strokePaints.length > 0 ? 1 : 1);
  const resolvedWidth = applyNonScaling ? defaultWidth / scale : defaultWidth;
  const resolvedCap: IRLineCap = cap === 'butt' ? 'butt' : cap === 'square' ? 'square' : 'round';
  const resolvedJoin: IRLineJoin = join === 'round' ? 'round' : join === 'bevel' ? 'bevel' : 'miter';
  const strokes = strokePaints.map(p => ({
    paint: p,
    width: resolvedWidth,
    cap: resolvedCap,
    join: resolvedJoin,
  }));

  return { fills, strokes, position: [posX, posY] };
}
