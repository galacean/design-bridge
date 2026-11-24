/** 读 svg.js 元素属性,归一类型(svg.js attr 返 any)。 */
function attrVal (el: Element, name: string): string | number | null | undefined {
  const v = el.attr(name) as unknown;

  if (v == null) { return undefined; }

  return v as string | number;
}

/**
 * SVG 渐变 paint 解析 → IRGradientPaint。
 *
 * 支持 linearGradient 的 userSpaceOnUse/objectBoundingBox。radialGradient 因 IR 仅有
 * gradientStart/End，使用水平直径近似；gradientTransform 只处理可稳定映射的子集。
 *
 * 坐标(IR gradient 使用归一化 UV 空间):效果运行时 shape 片元着色器用 uv0(顶点位置按 shape bbox
 * 归一化到 0-1)比对 _StartPoint/_EndPoint。故渐变起止点必须是相对 shape bbox 的 0-1 UV,
 * 不是 world-local 单位。这里把 userSpaceOnUse / objectBoundingBox 坐标统一转成 UV 存进 IR;
 * GE 适配阶段再将这些 UV 坐标映射到运行时渐变参数。
 */
import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { IRColor, IRGradientPaint } from '@galacean/animation-ir';
import { IRPaintType } from '@galacean/animation-ir';
import { mapSVGColorToIRColor } from '../../map-color';
import { parseTransform, transformPoint } from '../../matrix';

type GradientStops = IRGradientPaint['gradientStops'];

export interface ShapeBBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

const gradientElementCache = new WeakMap<object, Map<string, Element | null>>();
const gradientNodeCache = new WeakMap<object, Map<string, globalThis.Element | null>>();

function findGradientElement (es: EditableSVG, id: string): Element | null {
  const root = (es.svg as unknown as { node?: unknown }).node;

  if (root == null || typeof root !== 'object') {
    return es.svg.findOne(`#${id}`) as unknown as Element | null;
  }
  let cache = gradientElementCache.get(root);

  if (cache == null) {
    cache = new Map();
    gradientElementCache.set(root, cache);
  }
  if (cache.has(id)) { return cache.get(id) ?? null; }
  const gradient = es.svg.findOne(`#${id}`) as unknown as Element | null;

  cache.set(id, gradient);

  return gradient;
}

function findGradientNode (root: globalThis.Element, id: string): globalThis.Element | null {
  let cache = gradientNodeCache.get(root);

  if (cache == null) {
    cache = new Map();
    gradientNodeCache.set(root, cache);
  }
  if (cache.has(id)) { return cache.get(id) ?? null; }
  const gradient = Array.from(root.querySelectorAll('[id]')).find(candidate => candidate.getAttribute('id') === id) ?? null;

  cache.set(id, gradient);

  return gradient;
}

/** 从渐变取 t=0.5 的颜色,作为文本 fill=url(#渐变) 的降级纯色。
 *  返回归一化 [r,g,b,a] 或 null(目标不是渐变/未找到)。
 */
export function getGradientMidpointColor (
  es: EditableSVG,
  raw: string | number | null | undefined,
  opacity = 1,
): IRColor | null {
  if (typeof raw !== 'string') { return null; }

  const m = raw.match(/^url\(\s*["']?#([^)"'\s]+)\s*["']?\)$/i);

  if (!m) { return null; }
  const grad = findGradientElement(es, m[1]);

  if (grad == null || grad.node == null) { return null; }
  const tag = (grad.node.tagName || '').toLowerCase();

  if (tag !== 'lineargradient' && tag !== 'radialgradient') { return null; }
  const stops = parseStops(grad, opacity);

  return sampleStopsAt(stops, 0.5);
}

function sampleStopsAt (stops: NonNullable<GradientStops>, t: number): IRColor | null {
  if (stops.length === 0) { return null; }
  if (stops.length === 1) { return stops[0].slice(1) as IRColor; }

  let lo = stops[0];
  let hi = stops[stops.length - 1];

  for (let i = 0; i < stops.length - 1; i++) {
    if (stops[i][0] <= t && stops[i + 1][0] >= t) {
      lo = stops[i];
      hi = stops[i + 1];

      break;
    }
  }

  const range = hi[0] - lo[0];
  const ratio = range === 0 ? 0 : (t - lo[0]) / range;
  const mix = (a: number, b: number) => a + (b - a) * ratio;

  return [
    mix(lo[1], hi[1]),
    mix(lo[2], hi[2]),
    mix(lo[3], hi[3]),
    mix(lo[4], hi[4]),
  ] as IRColor;
}

/** 尝试把 fill/stroke 属性值解析为渐变 paint;非 url(#id) 返回 null。 */
export function resolveGradientPaint (
  es: EditableSVG,
  raw: string | number | null | undefined,
  opacity: number,
  bbox: ShapeBBox,
): IRGradientPaint | null {
  if (typeof raw !== 'string') { return null; }

  const m = raw.match(/^url\(\s*["']?#([^)"'\s]+)\s*["']?\)$/i);

  if (!m) { return null; }

  const id = m[1];
  const grad = findGradientElement(es, id);

  if (grad == null || grad.node == null) { return null; }

  const tag = (grad.node.tagName || '').toLowerCase();

  if (tag === 'lineargradient') {
    return parseLinear(grad, opacity, bbox);
  }

  if (tag === 'radialgradient') {
    return parseRadial(grad, opacity, bbox);
  }

  return null;
}

function parseLinear (
  grad: Element,
  opacity: number,
  bbox: ShapeBBox,
): IRGradientPaint | null {
  const units = String(grad.attr('gradientUnits') ?? 'objectBoundingBox').toLowerCase();
  // objectBoundingBox 默认值:x1=0 y1=0 x2=1 y2=0(水平从左到右)。
  let x1 = readCoord(attrVal(grad, 'x1'), units, 'x', 0, bbox);
  let y1 = readCoord(attrVal(grad, 'y1'), units, 'y', 0, bbox);
  let x2 = readCoord(attrVal(grad, 'x2'), units, 'x', 1, bbox);
  let y2 = readCoord(attrVal(grad, 'y2'), units, 'y', 0, bbox);
  const stops = parseStops(grad, opacity);

  if (stops.length === 0) { return null; }

  // gradientTransform 需要烘焙到起止点，因为 IR 没有独立的 transform 字段。
  // Effects 线性渐变使用沿起止点的投影并采用 pad 语义；当前精确处理对角缩放、平移和轴对齐渐变。
  // 旋转与非均匀缩放、shear 等组合无法用两个端点表达，保留原始渐变并由调用方报告能力边界。
  const gt = String(grad.attr('gradientTransform') ?? '').trim();
  let baked = false;

  if (gt !== '') {
    const M = parseTransform(gt);
    // dx/dy 在 gradientUnits 空间里的"渐变方向":OBB 下 x1.. 是 abs 坐标(已 readCoord 转 abs),用户空间同理。
    const dx = x2 - x1, dy = y2 - y1;
    // 仅对无旋转、无错切的轴对齐或等比缩放进行变换烘焙。
    const noShearNoRot = Math.abs(M.b) < 1e-9 && Math.abs(M.c) < 1e-9;
    const diagUniformScale = noShearNoRot && Math.abs(Math.abs(M.a) - Math.abs(M.d)) < 1e-6;
    const axisAlignedGrad = noShearNoRot && (Math.abs(dy) < 1e-9 || Math.abs(dx) < 1e-9);
    const canBake = diagUniformScale || axisAlignedGrad;

    if (canBake) {
      // objectBoundingBox:M 作用在 0-1 frac 坐标。先把 abs 端点映回 frac(M 在 frac 空间定义),变换后再 abs + toUV。
      //   userSpaceOnUse:M 作用在 SVG 绝对坐标,直接 transformPoint。
      if (units === 'userspaceonuse') {
        const A = transformPoint(M, x1, y1), B = transformPoint(M, x2, y2);

        x1 = A.x; y1 = A.y; x2 = B.x; y2 = B.y;
      } else {
        const fx1 = bbox.width !== 0 ? (x1 - bbox.minX) / bbox.width : 0;
        const fy1 = bbox.height !== 0 ? (y1 - bbox.minY) / bbox.height : 0;
        const fx2 = bbox.width !== 0 ? (x2 - bbox.minX) / bbox.width : 0;
        const fy2 = bbox.height !== 0 ? (y2 - bbox.minY) / bbox.height : 0;
        const A = transformPoint(M, fx1, fy1), B = transformPoint(M, fx2, fy2);

        x1 = bbox.minX + A.x * bbox.width; y1 = bbox.minY + A.y * bbox.height;
        x2 = bbox.minX + B.x * bbox.width; y2 = bbox.minY + B.y * bbox.height;
      }
      baked = true;
    }
  }
  void baked;

  return {
    type: IRPaintType.LinearGradient,
    gradientStops: stops,
    gradientStart: toUV(x1, y1, bbox),
    gradientEnd: toUV(x2, y2, bbox),
  };
}

function parseRadial (
  grad: Element,
  opacity: number,
  bbox: ShapeBBox,
): IRGradientPaint | null {
  // IR radial gradient 以 startPoint 为圆心，以 start/end 距离作为半径。
  // fx/fy 焦点偏移没有对应的 IR 字段，按中心焦点处理并由调用方报告能力边界。
  const units = String(grad.attr('gradientUnits') ?? 'objectBoundingBox').toLowerCase();
  let ccx = readCoord(attrVal(grad, 'cx'), units, 'x', 0.5, bbox);
  let ccy = readCoord(attrVal(grad, 'cy'), units, 'y', 0.5, bbox);
  let rAbs = absRadius(attrVal(grad, 'r'), units, bbox);
  const stops = parseStops(grad, opacity);

  if (stops.length === 0) { return null; }

  // IR 当前只表达圆形渐变。uniform scale 可以同时变换圆心和半径；非均匀 scale、旋转与 shear
  // 会改变圆形状或焦点，无法仅靠两个端点精确表达，因此不烘焙这些变换。
  const gt = String(grad.attr('gradientTransform') ?? '').trim();

  if (gt !== '') {
    const M = parseTransform(gt);
    const noShearNoRot = Math.abs(M.b) < 1e-9 && Math.abs(M.c) < 1e-9;
    const diagUniformScale = noShearNoRot && Math.abs(Math.abs(M.a) - Math.abs(M.d)) < 1e-6;

    if (diagUniformScale) {
      if (units === 'userspaceonuse') {
        const C = transformPoint(M, ccx, ccy);

        ccx = C.x; ccy = C.y;
        rAbs = Math.abs(M.a) * rAbs;
      } else {
        const fx = bbox.width !== 0 ? (ccx - bbox.minX) / bbox.width : 0;
        const fy = bbox.height !== 0 ? (ccy - bbox.minY) / bbox.height : 0;
        const C = transformPoint(M, fx, fy);

        ccx = bbox.minX + C.x * bbox.width; ccy = bbox.minY + C.y * bbox.height;
        rAbs = Math.abs(M.a) * rAbs;
      }
    }
  }

  return {
    type: IRPaintType.RadialGradient,
    gradientStops: stops,
    gradientStart: toUV(ccx, ccy, bbox),
    gradientEnd: toUV(ccx + rAbs, ccy, bbox),
  };
}

/** 解析 radial 半径。objectBoundingBox 使用 bbox 宽度作为 x 轴参考，保证转换到 UV 后半径保持一致。 */
function absRadius (v: string | number | null | undefined, units: string, bbox: ShapeBBox): number {
  if (v == null || v === '') { v = 0.5; }
  const { n, isPercent } = parseCoordNum(v);
  const frac = isPercent ? n / 100 : n;

  if (units === 'userspaceonuse') {
    return Math.abs(frac);
  }

  // objectBoundingBox:半径按 x 分数映射(r_abs=frac·width),radial 端点 toUV 后 r_uv=frac,与 uv0 同系。
  return Math.abs(frac) * bbox.width;
}

/** 解析渐变坐标并保留百分号信息。 */
function parseCoordNum (v: string | number | null | undefined): { n: number; isPercent: boolean } {
  if (typeof v === 'number') { return { n: v, isPercent: false }; }
  const s = String(v ?? '').trim();

  return { n: parseFloat(s), isPercent: s.endsWith('%') };
}

/** 把 gradient 坐标(userSpaceOnUse 绝对 / objectBoundingBox 0-1)统一转成绝对 SVG 坐标。 */
function readCoord (
  v: string | number | null | undefined,
  units: string,
  axis: 'x' | 'y',
  fallback: number,
  bbox: ShapeBBox,
): number {
  if (v == null || v === '') { v = fallback; }
  const { n, isPercent } = parseCoordNum(v);
  // 百分比转换为 0-1 分数。
  const frac = isPercent ? n / 100 : n;

  if (units === 'userspaceonuse') {
    return frac;
  }

  // objectBoundingBox:0-1 映射到 bbox。
  return axis === 'x'
    ? bbox.minX + frac * bbox.width
    : bbox.minY + frac * bbox.height;
}

/**
 * 绝对 SVG 坐标 → 相对 shape bbox 的 0-1 UV,且 Y 翻成 IR 的归一化坐标方向。
 *
 * 下游路径几何构建 的形状 aUV.y=(posY-minY)/sizeY,而 ge-ir 把形状顶点 Y 取反
 * (-point.y*ratio)成 GL 朝上 → 片元 uv0.y=1 在形状顶部(SVG y=0)。SVG 渐变坐标是 y 朝下(0=顶),
 * 故这里对 uy 做 1-uy 翻转,使 IR gradientStart/End 落到与 shader uv0 同向的 y 朝上空间。
 * 否则渐变线被竖直镜像(如斜向渐变方向上下颠倒、垂直渐变起止色互换)。
 * X 不翻(shape 顶点 X 未取反,uv0.x 与 SVG 同向)。ge-ir vec2ToGE 与 convert.restoreUV 是纯往返
 * (×ratio/÷ratio、-Y/反-Y),方向语义只在这里引入,不在那两处改。
 */
function toUV (absX: number, absY: number, bbox: ShapeBBox): [number, number] {
  const ux = bbox.width !== 0 ? (absX - bbox.minX) / bbox.width : 0;
  const uy = bbox.height !== 0 ? 1 - (absY - bbox.minY) / bbox.height : 0;

  return [ux, uy];
}

function parseStops (grad: Element, opacity: number): GradientStops {
  const stopEls = grad.find('stop');
  const out: NonNullable<GradientStops> = [];

  for (const s of stopEls) {
    const offsetStr = String(s.attr('offset') ?? '0').trim();
    let pos = parseFloat(offsetStr);

    if (offsetStr.endsWith('%')) {
      pos = pos / 100;
    } else if (pos > 1) {
      // 纯数字且 >1 视作百分比形式兜底。
      pos = pos / 100;
    }

    const stopOpacityStr = String(s.attr('stop-opacity') ?? '');
    const stopOpacity = stopOpacityStr === '' ? 1 : Number(stopOpacityStr);
    const color = mapSVGColorToIRColor(String(s.attr('stop-color') ?? 'black'), stopOpacity * opacity);

    if (color != null) {
      out.push([clamp01(pos), color[0], color[1], color[2], color[3]]);
    }
  }

  return out;
}

function clamp01 (n: number): number {
  if (Number.isNaN(n)) { return 0; }

  return Math.max(0, Math.min(1, n));
}

/** IR 当前仅表达 pad 渐变语义；repeat 和 reflect 没有对应的 shader 参数，因此保持未映射并报告 warning。 */

/** 读取渐变 stop 的 alpha 值。 */
export function gradientStopColorAlpha (el: Element, rawPaint: string): number[] {
  const match = rawPaint.match(/^url\(\s*["']?#([^)"'\s]+)\s*["']?\)$/i);
  const node = (el as unknown as { node?: globalThis.Element | null }).node;
  const root = node == null ? null : ((node as globalThis.SVGElement).ownerSVGElement ?? node);

  if (match == null || root == null) { return []; }
  const gradient = findGradientNode(root, match[1]);

  if (gradient == null) { return []; }

  return Array.from(gradient.children)
    .filter(child => child.tagName.toLowerCase() === 'stop')
    .map(stop => {
      const stopOpacityRaw = stop.getAttribute('stop-opacity');
      const stopOpacityValue = stopOpacityRaw == null || stopOpacityRaw.trim() === '' ? 1 : Number(stopOpacityRaw);
      const stopOpacity = Number.isFinite(stopOpacityValue) ? Math.max(0, Math.min(1, stopOpacityValue)) : 1;
      const stopColor = mapSVGColorToIRColor(stop.getAttribute('stop-color') ?? 'black', 1) ?? [0, 0, 0, 1];

      return stopColor[3] * stopOpacity;
    });
}
