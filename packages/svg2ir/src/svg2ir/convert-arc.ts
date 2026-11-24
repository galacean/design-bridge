/**
 * SVG 圆弧到三次 Bezier 的转换。
 *
 * path 命令归一化只消费 `arcToCubics`，具体圆弧几何和细分规则集中在这里。
 */

const TAU = Math.PI * 2;
const ARC_EPS = 1e-6;

function normalizeAngle (a: number): number {
  a = a % TAU;

  if (a < 0) { a += TAU; }

  return a;
}

/** 挑选满足 SVG sweep/largeArc 语义的一段圆弧。
 *  sweep 对应“正角方向”(标准 atan2 下角度递增),largeArc 对应弧角≥180°。
 */
function pickCircularArc (
  x0: number, y0: number,
  x1: number, y1: number,
  sweep: boolean, largeArc: boolean,
  c1: { x: number; y: number },
  c2: { x: number; y: number },
): { cx: number; cy: number; startAngle: number; angleSpan: number } | null {
  for (const c of [c1, c2]) {
    const a0 = Math.atan2(y0 - c.y, x0 - c.x);
    const a1 = Math.atan2(y1 - c.y, x1 - c.x);
    let delta = normalizeAngle(a1 - a0); // [0, 2π)
    const semicircle = Math.abs(delta - Math.PI) < ARC_EPS;

    let matches: boolean;
    let span: number;

    if (sweep) {
      span = delta;
      matches = semicircle || (delta > Math.PI) === largeArc;
    } else {
      span = delta - TAU; // 负值
      matches = semicircle || ((TAU - delta) > Math.PI) === largeArc;
    }

    if (matches) {
      return { cx: c.x, cy: c.y, startAngle: a0, angleSpan: span };
    }
  }

  return null;
}

function circularArcSegment (
  cx: number, cy: number, r: number,
  startAngle: number, span: number,
): number[] {
  const a0 = startAngle;
  const a1 = startAngle + span;
  const cos0 = Math.cos(a0);
  const sin0 = Math.sin(a0);
  const cos1 = Math.cos(a1);
  const sin1 = Math.sin(a1);

  const p0x = cx + r * cos0;
  const p0y = cy + r * sin0;
  const p1x = cx + r * cos1;
  const p1y = cy + r * sin1;

  // 方向:+1 为正角(CCW 于标准 atan2),-1 为负角(CW)。
  const dir = Math.sign(span) || 1;
  const t0x = -sin0 * dir;
  const t0y = cos0 * dir;
  const t1x = -sin1 * dir;
  const t1y = cos1 * dir;

  // 单位圆 90° 弧的控制点系数 k ≈ 0.55228475;任意弧度: (4/3)*tan(|span|/4)。
  const k = (4 / 3) * Math.tan(Math.abs(span) / 4) * r;

  return [
    p0x + k * t0x, p0y + k * t0y, // C1
    p1x - k * t1x, p1y - k * t1y, // C2
    p1x, p1y,                     // 终点
  ];
}

/** 椭圆弧(轴对齐,xAxisRotation=0)→多段三次贝塞尔。
 *  已正确支持 rx==ry 的圆角矩形/圆形弧(largeArc/sweep 语义完整);
 *  当前无法稳定映射的椭圆弧会退化为直线。
 */
export function arcToCubics (
  x0: number,
  y0: number,
  rx: number,
  ry: number,
  x1: number,
  y1: number,
  largeArc: boolean,
  sweep: boolean,
  arcSegmentAngle = Math.PI / 4,
): number[][] {
  // 仅精确处理圆;退化/椭圆先直线连接(至少不生成错误曲线)。
  if (rx <= ARC_EPS || ry <= ARC_EPS || Math.abs(rx - ry) > ARC_EPS * Math.max(rx, ry, 1)) {
    return [[x0, y0, x1, y1, x1, y1]];
  }

  const r = rx;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);

  if (d < ARC_EPS || d > 2 * r + ARC_EPS) {
    return [[x0, y0, x1, y1, x1, y1]];
  }

  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));

  // 弦的单位方向与法向
  const ux = dx / d;
  const uy = dy / d;
  const nx = -uy;
  const ny = ux;

  const c1 = { x: mx + h * nx, y: my + h * ny };
  const c2 = { x: mx - h * nx, y: my - h * ny };

  const arc = pickCircularArc(x0, y0, x1, y1, sweep, largeArc, c1, c2);

  if (arc == null) {
    return [[x0, y0, x1, y1, x1, y1]];
  }

  const { cx, cy, startAngle, angleSpan } = arc;
  const absSpan = Math.abs(angleSpan);

  if (absSpan < ARC_EPS) {
    return [[x0, y0, x1, y1, x1, y1]];
  }

  // 实际渲染在 24×24 小画布上时,90° cubic 的几何误差会被旋转后的像素边界放大。
  // 按 45° 分段,让 SVG 原生 arc 与 Effects custom path 的轮廓更接近。
  const segments: number[][] = [];
  let remaining = absSpan;
  let a = startAngle;
  const sign = Math.sign(angleSpan) || 1;

  // mask/path-boundary 只需要 authored arc endpoint 时使用 `Infinity`，不额外引入细分顶点。
  // 普通 shape 转换保留 45° 上限；动态小路径可以请求更细的有限细分角度。
  const segmentAngle = arcSegmentAngle === Infinity
    ? absSpan
    : Number.isFinite(arcSegmentAngle) && arcSegmentAngle > ARC_EPS
      ? Math.min(Math.PI / 4, arcSegmentAngle)
      : Math.PI / 4;

  while (remaining > ARC_EPS) {
    const seg = Math.min(remaining, segmentAngle) * sign;

    segments.push(circularArcSegment(cx, cy, r, a, seg));
    a += seg;
    remaining -= Math.abs(seg);
  }

  return segments;
}
