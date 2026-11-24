/**
 * SVG stroke-dasharray 到 IR open subpath 的转换。
 *
 * 该模块只处理虚线判断和几何切分，不负责普通 shape 的解析或样式组装。
 */
import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { IRBezierPath, IRShapeStroke, IRShapeStyle } from '@galacean/animation-ir';
import { readSVGNumberAttribute } from '../../read-attributes';

type IRShapePaint = NonNullable<IRShapeStyle['fills']>[number];

/** 解析 stroke-dasharray / stroke-dashoffset → { dash(偶数长), offset∈[0,patternLen), patternLen }。null=无有效虚线。
 *  SVG spec:dash 奇数个时复制一遍(e.g. "7" → "7 7");偶索引是 on(实)、奇索引是 off(虚)。 */
export function parseDashArray (es: EditableSVG, el: Element): { dash: number[]; offset: number; patternLen: number } | null {
  const raw = String(es.getAttr(el, 'stroke-dasharray') ?? '').trim();

  if (raw === '' || raw.toLowerCase() === 'none') { return null; }
  let dash = raw.split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n) && n >= 0);

  if (dash.length === 0) { return null; }
  if (dash.length % 2 === 1) { dash = dash.concat(dash); }   // SVG: 奇数个复制一遍
  const patternLen = dash.reduce((s, n) => s + n, 0);

  if (patternLen <= 0) { return null; }
  const offRaw = readSVGNumberAttribute(es, el, 'stroke-dashoffset', 0) ?? 0;
  const offset = ((offRaw % patternLen) + patternLen) % patternLen;   // 归一到 [0,patternLen)

  return { dash, offset, patternLen };
}

/** 共享虚线合成判断，并决定是否生成对应 warning。
 *  合成 ROI:有虚线描边、无 fill、无 0 长度 on-dash、所有 subpath 全直线(切线恒 {0,0})且 open。任一不满足返 false。 */
export function canSynthesizeDash (
  es: EditableSVG,
  el: Element,
  fills: IRShapePaint[],
  strokes: IRShapeStroke[],
  strokeWidth: number | undefined,
  customPaths: IRBezierPath[] | undefined,
): boolean {
  if (strokes.length === 0 || strokeWidth == null || strokeWidth <= 0) { return false; }
  if (fills.length > 0) { return false; }   // fill+dash 需两个 IR shape,超界
  const d = parseDashArray(es, el);

  if (d == null) { return false; }
  if (d.dash.some((n, i) => i % 2 === 0 && n === 0)) { return false; }   // 0 长度 on-dash = 点,本不实现
  if (customPaths == null || customPaths.length === 0) { return false; }
  for (const p of customPaths) {
    if (p.closed) { return false; }   // closed(polygon/path-with-Z)超界
    for (let i = 0; i < p.points.length; i++) {
      const it = p.inTangents[i], ot = p.outTangents[i];

      if ((it != null && (it.x !== 0 || it.y !== 0)) || (ot != null && (ot.x !== 0 || ot.y !== 0))) {
        return false;   // 非零切线 = 曲线 C 段,弧长 ≠ 弦长,线性走切会错
      }
    }
  }

  return true;
}

/** 把直线 open subpath 按虚线 on-区间切成多条 open 子路径(绝对 SVG 坐标,之后照常 -cx/-cy 转相对)。
 *  SVG dash 跨顶点连续:一个跨顶点的 on-dash 是一条横跨该顶点的段(join 在此渲,只在 dash 自身端点渲 cap)。 */
export function synthesizeDashSubpaths (paths: IRBezierPath[], dash: number[], offset: number, patternLen: number): IRBezierPath[] {
  // 一个 period [0,patternLen) 内的 on-区间 [a,b]。
  const onIntervals: Array<[number, number]> = [];
  let acc = 0;

  for (let i = 0; i < dash.length; i++) {
    if (i % 2 === 0) { onIntervals.push([acc, acc + dash[i]]); }
    acc += dash[i];
  }

  const out: IRBezierPath[] = [];

  for (const path of paths) {
    const pts = path.points;

    if (pts.length < 2) { continue; }
    // 累积段长 cum[i]=顶点 i 的距离(0-based),seg[i]=段 i 长度(i→i+1)。
    const cum: number[] = [0];
    const seg: number[] = [];

    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;

      seg[i] = Math.hypot(dx, dy);
      cum[i + 1] = cum[i] + seg[i];
    }
    const totalLen = cum[pts.length - 1];

    if (totalLen <= 0) { continue; }

    // pattern 从 -offset 起(period k 起点 = k·patternLen - offset),正 offset 把虚线前移。
    for (let k = 0; ; k++) {
      const periodStart = k * patternLen - offset;

      if (periodStart > totalLen) { break; }   // 本 period 最早点(periodStart)已过路径尾
      for (const [a, b] of onIntervals) {
        const s = periodStart + a, e = periodStart + b;
        const ns = Math.max(s, 0), ne = Math.min(e, totalLen);

        if (ne > ns) {   // 裁到 [0,totalLen] 后仍有正长度才出段
          const sub = buildOpenSubpath(pts, cum, seg, ns, ne);

          if (sub != null) { out.push(sub); }
        }
      }
    }
  }

  return out;
}

/** 在直线 subpath 上按距离 [s,e] 切出一条 open 子路径:[s 处插值点, …严格位于(s,e)内的原顶点…, e 处插值点]。切线恒 {0,0}(直线段无控制柄)。 */
function buildOpenSubpath (
  pts: Array<{ x: number; y: number }>,
  cum: number[],
  seg: number[],
  s: number,
  e: number,
): IRBezierPath | null {
  // 起点所在段 i:cum[i] ≤ s ≤ cum[i+1](取最大 i 使 cum[i] ≤ s)。
  let i = 0;

  while (i < cum.length - 1 && cum[i + 1] < s) { i++; }
  const lastIdx = pts.length - 1;

  if (i >= lastIdx) { return null; }   // s 落在/过尾点,无段可切
  const tS = seg[i] > 0 ? (s - cum[i]) / seg[i] : 0;
  const pStart = { x: pts[i].x + (pts[i + 1].x - pts[i].x) * tS, y: pts[i].y + (pts[i + 1].y - pts[i].y) * tS };
  const out: Array<{ x: number; y: number }> = [pStart];

  // 严格位于 (s, e) 内的原顶点(cum[k] > s 且 < e),作为内部顶点保留 → 跨这些顶点的 dash 在此渲 join。
  for (let k = i + 1; k < lastIdx; k++) {
    if (cum[k] > s && cum[k] < e) { out.push({ x: pts[k].x, y: pts[k].y }); }
  }

  // 终点所在段 m:cum[m] ≤ e ≤ cum[m+1]。
  let m = i;

  while (m < lastIdx && cum[m + 1] < e) { m++; }
  if (m >= lastIdx) {
    out.push({ x: pts[lastIdx].x, y: pts[lastIdx].y });   // e 落在/过尾点,直接用尾点
  } else {
    const tE = seg[m] > 0 ? (e - cum[m]) / seg[m] : 0;

    out.push({ x: pts[m].x + (pts[m + 1].x - pts[m].x) * tE, y: pts[m].y + (pts[m + 1].y - pts[m].y) * tE });
  }

  return {
    points: out,
    inTangents: out.map(() => ({ x: 0, y: 0 })),
    outTangents: out.map(() => ({ x: 0, y: 0 })),
    closed: false,
  };
}
