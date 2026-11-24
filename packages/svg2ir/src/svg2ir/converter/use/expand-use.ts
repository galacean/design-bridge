/**
 * SVG `<use href="#id">` 展开成实例图层。
 *
 * Effects shape 使用按值数据，没有 SVG symbol/use 的共享引用语义，因此 SVG → IR 阶段复制
 * 目标形状或文本并应用 use 的 x/y、transform 与继承样式。多次 use 会生成独立实例。
 */
import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import { IRLineCap, IRLineJoin, IRPaintType, IRShapePrimitiveType, type IRBezierPath, type IRShape, type IRShapePaint, type IRTransform, type IRVec3 } from '@galacean/animation-ir';
import { readSVGElementOpacity, readSVGNumberAttribute } from '../../read-attributes';
import { accumulateAncestors, decomposeMatrix, IDENTITY, multiply, parseTransform, transformPoint, type SVGMatrix } from '../../matrix';
import { mapSVGColorToIRColor } from '../../map-color';
import { resolveGradientPaint, type ShapeBBox } from '../paint/resolve-gradient';
import { readPresentationAttribute } from '../../../parse-svg/read-presentation-attribute';

/** 读取 <use> 引用的目标 id，支持 href 和 xlink:href。 */
export function readUseTarget (es: EditableSVG, el: Element): string | undefined {
  const href = readHref(es, el);

  if (href == null) { return undefined; }
  const m = href.match(/^#(.+)$/);

  return m ? m[1] : undefined;
}

function readHref (es: EditableSVG, el: Element): string | undefined {
  const href = es.getAttr(el, 'href');

  if (typeof href === 'string' && href !== '') { return href; }
  const xhref = es.getAttr(el, 'xlink:href');

  return typeof xhref === 'string' && xhref !== '' ? xhref : undefined;
}

/** 读取 <use> 的 x/y 平移属性。 */
export function readUseTranslate (es: EditableSVG, el: Element): { x: number; y: number } {
  const x = readSVGNumberAttribute(es, el, 'x', 0) ?? 0;
  const y = readSVGNumberAttribute(es, el, 'y', 0) ?? 0;

  return { x, y };
}

export function buildUseMatrix (useEl: Element, useX: number, useY: number): SVGMatrix {
  const mAnc = accumulateAncestors(useEl);
  const selfAttr = (useEl as unknown as { node?: { getAttribute?: (n: string) => string | null } }).node?.getAttribute?.('transform') ?? '';
  const mSelf = selfAttr !== '' ? parseTransform(selfAttr) : IDENTITY;
  const mXY: SVGMatrix = { a: 1, b: 0, c: 0, d: 1, e: useX, f: useY };

  return multiply(multiply(mAnc, mSelf), mXY);
}

/**
 * 构建 use 实例的完整 transform。
 *
 * 矩阵顺序为 `祖先变换 × use 自身 transform × translate(x, y)`；shape.position
 * 作为实例的局部 anchor，避免在 Effects lowering 阶段重复计算形状中心。
 */
export function buildUseTransform (
  useEl: Element,
  shape: IRShape,
  useX: number,
  useY: number,
  targetMatrix: SVGMatrix = IDENTITY,
  targetOpacity = 1,
): IRTransform {
  const m = multiply(buildUseMatrix(useEl, useX, useY), targetMatrix);
  const localCenter = shape.position;
  const worldCenter = transformPoint(m, localCenter[0], localCenter[1]);
  const opacity = Math.max(0, Math.min(1, readSVGElementOpacity(useEl) * targetOpacity));
  const { sx, sy, rotation } = decomposeMatrix(m);

  return {
    position: { type: 'static', value: [worldCenter.x, worldCenter.y, 0] as IRVec3 },
    scale: { type: 'static', value: [sx, sy, 1] },
    rotation: { z: { type: 'static', value: rotation } },
    // 使用目标形状的局部几何中心作为 anchor。
    anchor: { type: 'static', value: [localCenter[0], localCenter[1], 0] as IRVec3 },
    opacity: { type: 'static', value: opacity },
  };
}

function cloneShapePaint (paint: IRShapePaint): IRShapePaint {
  if (paint.type === IRPaintType.Solid) {
    return { ...paint, color: [...paint.color] as typeof paint.color };
  }
  if (paint.type === IRPaintType.Texture) { return { ...paint }; }

  return {
    ...paint,
    gradientStops: paint.gradientStops.map(stop => [...stop] as typeof stop),
    gradientStart: [...paint.gradientStart] as typeof paint.gradientStart,
    gradientEnd: [...paint.gradientEnd] as typeof paint.gradientEnd,
  };
}

function cloneBezierPath (path: IRBezierPath): IRBezierPath {
  return {
    ...path,
    points: path.points.map(point => ({ ...point })),
    inTangents: path.inTangents.map(point => ({ ...point })),
    outTangents: path.outTangents.map(point => ({ ...point })),
  };
}

function cloneShapeForUse (shape: IRShape): IRShape {
  const style = {
    position: [...shape.position] as typeof shape.position,
    fills: shape.fills.map(cloneShapePaint),
    strokes: shape.strokes.map(stroke => ({ ...stroke, paint: cloneShapePaint(stroke.paint) })),
  };

  if (shape.primitiveType === IRShapePrimitiveType.Custom) {
    return { ...shape, ...style, customPaths: shape.customPaths.map(cloneBezierPath) };
  }

  return { ...shape, ...style };
}

/**
 * 用 use 自身的 presentation 属性覆盖目标 shape 的 paint 与线条属性。
 * use 的显式属性优先于目标属性；未显式设置时，沿 use 所在 DOM 树读取继承值。
 * 带 filter 的 use 保留目标 paint，因为 Effects 不支持 filter，直接应用覆盖色会产生错误的硬边阴影。
 */
export function applyUseStyleOverrides (
  es: EditableSVG,
  useEl: Element,
  targetEl: Element | undefined,
  shape: IRShape,
): IRShape {
  // 每个 use 都要拿到独立的值对象，不能直接复用 defs/symbol 中缓存的 shape。
  const merged = cloneShapeForUse(shape);

  // Effects 不支持 use 的 filter，保留目标 paint 以避免把阴影降级为硬色块。
  if (getRawAttr(useEl, 'filter') !== '') { return merged; }

  const bbox = computeShapeBBox(merged);
  const fills = parseUsePaint(es, useEl, targetEl, 'fill', bbox);
  const strokePaints = parseUsePaint(es, useEl, targetEl, 'stroke', bbox);

  if (fills !== undefined) { merged.fills = fills; }
  if (strokePaints !== undefined) {
    const fallbackStroke = merged.strokes[0];

    merged.strokes = strokePaints.map((paint, index) => {
      const sourceStroke = merged.strokes[index] ?? fallbackStroke;

      return {
        paint,
        width: sourceStroke?.width ?? 1,
        cap: sourceStroke?.cap ?? IRLineCap.Round,
        join: sourceStroke?.join ?? IRLineJoin.Miter,
      };
    });
  }

  const strokeWidthRaw = getRawAttr(useEl, 'stroke-width');
  const strokeWidth = strokeWidthRaw !== '' ? Number(strokeWidthRaw) : undefined;
  const cap = getRawAttr(useEl, 'stroke-linecap').toLowerCase();
  const join = getRawAttr(useEl, 'stroke-linejoin').toLowerCase();

  // stroke 宽/端点样式在 strokes[].width/cap/join 上覆盖(不在 shape 顶层)。
  if (merged.strokes.length > 0) {
    const firstStroke = merged.strokes[0];
    const width = strokeWidth !== undefined && Number.isFinite(strokeWidth) ? strokeWidth
      : (firstStroke.width ?? 1);
    const strokeCap = (cap === 'butt' || cap === 'round' || cap === 'square') ? cap : firstStroke.cap;
    const strokeJoin = (join === 'miter' || join === 'round' || join === 'bevel') ? join : firstStroke.join;

    merged.strokes = [{ ...firstStroke, width, cap: strokeCap, join: strokeJoin }, ...merged.strokes.slice(1)];
  }

  return merged;
}

/** 解析 use 上的 fill/stroke 覆盖;undefined=未指定保留目标原值,[]=none,其余=新 paint。 */
function parsePaintOverride (
  es: EditableSVG,
  el: Element,
  attr: 'fill' | 'stroke',
  bbox: ShapeBBox,
  rawOverride?: string,
  opacityRawOverride?: string,
): IRShapePaint[] | undefined {
  const raw = rawOverride ?? getRawAttr(el, attr);

  if (raw === '' || raw.toLowerCase() === 'inherit') { return undefined; }
  if (raw.toLowerCase() === 'none') { return []; } // 显式覆盖为无填充

  const opacityAttr = attr === 'fill' ? 'fill-opacity' : 'stroke-opacity';
  const opacityRaw = opacityRawOverride ?? getRawAttr(el, opacityAttr);
  const paintOpacity = opacityRaw === '' ? 1 : Number(opacityRaw);
  const opacity = Number.isFinite(paintOpacity) ? Math.max(0, Math.min(1, paintOpacity)) : 1;

  // 优先解析 paint server，无法解析时再按纯色处理。
  const gradient = resolveGradientPaint(es, raw, opacity, bbox);

  if (gradient != null) { return [gradient]; }

  const color = mapSVGColorToIRColor(raw, opacity);

  if (color != null) { return [{ type: IRPaintType.Solid, color }]; }

  return [];
}

/**
 * 按引用上下文解析 use 实例的 paint。
 *
 * 属性优先级：use 自身显式属性 > 目标元素自身显式属性 > use 祖先继承属性 > 原型默认值。
 * 实例继承属性沿 use 的 DOM 父链读取，目标元素的显式属性由目标 shape 提供。
 */
function parseUsePaint (
  es: EditableSVG,
  useEl: Element,
  targetEl: Element | undefined,
  attr: 'fill' | 'stroke',
  bbox: ShapeBBox,
): IRShapePaint[] | undefined {
  const ownRaw = getRawAttr(useEl, attr);

  // use 自身显式 paint 覆盖目标 paint，包括显式 none。
  if (ownRaw !== '' && ownRaw.toLowerCase() !== 'inherit') {
    return parsePaintOverride(es, useEl, attr, bbox, ownRaw);
  }

  // 目标元素有显式 paint 时保留目标值，不应用 use 祖先的继承值。
  const targetRaw = getRawAttr(targetEl, attr);

  if (targetRaw !== '' && targetRaw.toLowerCase() !== 'inherit') {
    return undefined;
  }

  const inheritedRaw = readUseContextAttr(useEl, attr);

  if (inheritedRaw == null || inheritedRaw === '' || inheritedRaw.toLowerCase() === 'inherit') {
    return undefined;
  }

  const opacityAttr = attr === 'fill' ? 'fill-opacity' : 'stroke-opacity';
  const inheritedOpacityRaw = readUseContextAttr(useEl, opacityAttr);

  return parsePaintOverride(es, useEl, attr, bbox, inheritedRaw, inheritedOpacityRaw ?? undefined);
}

/** 读取 use 所在树上最近的原始 presentation 属性,不包含 use 自身。 */
function readUseContextAttr (useEl: Element, attr: string): string | undefined {
  let node: unknown = (useEl as unknown as { node?: { parentNode?: unknown } }).node?.parentNode;

  while (node != null) {
    const raw = readPresentationAttribute(node, attr) ?? '';

    if (raw !== '') { return raw; }
    node = (node as { parentNode?: unknown }).parentNode;
  }

  return undefined;
}

/** 读取元素自身的 presentation 属性，不包含祖先继承值。 */
function getRawAttr (el: Element | undefined, attr: string): string {
  if (el == null) { return ''; }

  const node = (el as unknown as { node?: { getAttribute?: (n: string) => string | null } }).node;

  return readPresentationAttribute(node, attr) ?? '';
}

/** 根据目标 shape 的几何计算 bbox，用于渐变坐标转换。 */
function computeShapeBBox (shape: IRShape): ShapeBBox {
  switch (shape.primitiveType) {
    case IRShapePrimitiveType.Rectangle:
      return {
        minX: shape.position[0] - shape.width / 2,
        minY: shape.position[1] - shape.height / 2,
        width: shape.width,
        height: shape.height,
      };
    case IRShapePrimitiveType.Ellipse:
      return {
        minX: shape.position[0] - shape.xRadius,
        minY: shape.position[1] - shape.yRadius,
        width: shape.xRadius * 2,
        height: shape.yRadius * 2,
      };
    case IRShapePrimitiveType.Polygon:
      return {
        minX: shape.position[0] - shape.radius,
        minY: shape.position[1] - shape.radius,
        width: shape.radius * 2,
        height: shape.radius * 2,
      };
    case IRShapePrimitiveType.Star:
      return {
        minX: shape.position[0] - shape.outerRadius,
        minY: shape.position[1] - shape.outerRadius,
        width: shape.outerRadius * 2,
        height: shape.outerRadius * 2,
      };
    case IRShapePrimitiveType.Custom:
    default:
      return computeCustomBBox(shape.position, shape.customPaths);
  }
}

function computeCustomBBox (position: [number, number], paths?: IRBezierPath[]): ShapeBBox {
  if (paths == null || paths.length === 0) {
    return { minX: position[0], minY: position[1], width: 0, height: 0 };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const path of paths) {
    for (const pt of path.points) {
      const x = position[0] + pt.x;
      const y = position[1] + pt.y;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return {
    minX: Number.isFinite(minX) ? minX : position[0],
    minY: Number.isFinite(minY) ? minY : position[1],
    width: Number.isFinite(maxX - minX) ? maxX - minX : 0,
    height: Number.isFinite(maxY - minY) ? maxY - minY : 0,
  };
}
