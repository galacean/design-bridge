/**
 * SVG transform matrix 累乘 + 点变换(嵌套 g 父子 transform 用)。
 *
 * SVG 规范:子元素最终变换 = 父 g transform × 子自身 transform(矩阵左乘)。
 * svg2ir 用 find('*') 平铺遍历,丢失 DOM 嵌套继承。这里算祖先结构容器的累计 matrix,
 * 应用到子元素的 position/scale(rectify 坐标)。比建 null parent 层轻(IR 直接烘焙世界变换，避免额外重建 DOM 父子层级)。
 *
 * matrix(a,b,c,d,e,f): [a c e; b d f; 0 0 1]。点 变换后:(a*x+c*y+e, b*x+d*y+f)。
 */
export interface SVGMatrix { a: number; b: number; c: number; d: number; e: number; f: number }

interface SVGAncestorNode {
  tagName?: string;
  getAttribute?: (name: string) => string | null;
  parentNode?: SVGAncestorNode | null;
}

function getSVGAncestorNode (node: unknown): SVGAncestorNode | undefined {
  return node != null && typeof node === 'object' ? node : undefined;
}

export const IDENTITY: SVGMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** 解析 `matrix(a b c d e f)`、`translate(x y)`、`scale(s)`、`rotate(d)` 为 SVGMatrix。 */
export function parseTransform (transform: string): SVGMatrix {
  const s = transform.trim();

  if (s === '') { return IDENTITY; }
  // 多个 transform 函数串联:左乘累加(后一个 premultiply)。如 "translate(10,0) scale(2)"。
  const fns = s.match(/(matrix|translate|scale|rotate|skewX|skewY)\s*\([^)]*\)/gi) ?? [];

  let m = IDENTITY;

  // SVG transform 列表按规范组合为 M = T1 × T2 × ... × Tn；从左到右进行 postmultiply。
  for (const fn of fns) {
    const fm = parseSingleTransform(fn);

    m = multiply(m, fm);
  }

  return m;
}

function parseSingleTransform (fn: string): SVGMatrix {
  const m = fn.match(/^(\w+)\s*\(([^)]*)\)$/i);

  if (m == null) { return IDENTITY; }
  const op = m[1].toLowerCase();
  const nums = (m[2].match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);

  switch (op) {
    case 'matrix': {
      if (nums.length < 6) { return IDENTITY; }

      return { a: nums[0], b: nums[1], c: nums[2], d: nums[3], e: nums[4], f: nums[5] };
    }
    case 'translate': {
      const tx = nums[0] ?? 0;
      const ty = nums[1] ?? 0;

      return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
    }
    case 'scale': {
      const sx = nums[0] ?? 1;
      const sy = nums[1] ?? sx;

      return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
    }
    case 'rotate': {
      const deg = nums[0] ?? 0;
      const rad = deg * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const cx = nums[1];
      const cy = nums[2];

      if (cx == null || cy == null) {
        return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      }

  // SVG rotate(angle cx cy) = T(cx,cy) × R(angle) × T(-cx,-cy)。
      return {
        a: cos,
        b: sin,
        c: -sin,
        d: cos,
        e: cx - cos * cx + sin * cy,
        f: cy - sin * cx - cos * cy,
      };
    }
    case 'skewx': {
      const rad = (nums[0] ?? 0) * Math.PI / 180;

      return { a: 1, b: 0, c: Math.tan(rad), d: 1, e: 0, f: 0 };
    }
    case 'skewy': {
      const rad = (nums[0] ?? 0) * Math.PI / 180;

      return { a: 1, b: Math.tan(rad), c: 0, d: 1, e: 0, f: 0 };
    }
    default: return IDENTITY;
  }
}

/** 矩阵乘法 result = a × b(矩阵乘,用于 transform 累乘)。 */
export function multiply (a: SVGMatrix, b: SVGMatrix): SVGMatrix {
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    e: a.a * b.e + a.c * b.f + a.e,
    f: a.b * b.e + a.d * b.f + a.f,
  };
}

/** 用矩阵变换点 → (a*x+c*y+e, b*x+d*y+f)。 */
export function transformPoint (m: SVGMatrix, x: number, y: number): { x: number; y: number } {
  return {
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  };
}

/** 2D affine 矩阵 {a,b,c,d,e,f}([a c e; b d f; 0 0 1])求逆。det=ad-bc,不可逆(退化)返回 IDENTITY。
 * 用于把"经 transform 的世界坐标点"映回 transform 前的局部坐标(rotation/scale/translate 都正确处理)。 */
export function invertSVGMatrix (m: SVGMatrix): SVGMatrix {
  const det = m.a * m.d - m.b * m.c;

  if (Math.abs(det) < 1e-12) { return { ...IDENTITY }; }
  const inv = 1 / det;

  return {
    a: m.d * inv,
    b: -m.b * inv,
    c: -m.c * inv,
    d: m.a * inv,
    e: (m.c * m.f - m.d * m.e) * inv,
    f: (m.b * m.e - m.a * m.f) * inv,
  };
}

/** 把 2×3 矩阵拆成 scale(允许负号表达镜像) + rotation(度)。
 *  假设无 shear(skew 已在转换侧 warn 并丢弃);非均匀缩放由 sx/sy 不同表达。
 *  rotation 用度,与 IR transform.rotation.z / IR 坐标约定一致。
 */
export function decomposeMatrix (m: { a: number; b: number; c: number; d: number }): { sx: number; sy: number; rotation: number } {
  const sx = Math.hypot(m.a, m.b);
  const rotation = sx === 0 ? 0 : Math.atan2(m.b, m.a) * 180 / Math.PI;
  // signed scaleY = determinant / sx,保留镜像的负号。
  const sy = sx === 0 ? 0 : (m.a * m.d - m.b * m.c) / sx;

  return { sx, sy, rotation };
}

/** 累乘元素及其所有祖先 <g> 的 opacity(遇 svg 停止),模拟 group opacity 对子元素的影响。
 *  SVG 中 opacity 在 <g> 上作用于整组合成,但 svg2ir 把组拍平,这里把祖先 opacity
 *  乘到每个子元素,比完全忽略更接近浏览器效果。
 */
export function accumulateOpacity (el: { node?: unknown }): number {
  let opacity = 1;
  let node = getSVGAncestorNode(el.node);

  // 从父节点开始累乘,不包含元素自身(自身 opacity 由调用方单独读取)。
  node = node?.parentNode ?? undefined;

  while (node != null) {
    const op = node.getAttribute?.('opacity');

    if (op != null && op !== '') {
      const n = Number(op);

      if (Number.isFinite(n)) { opacity *= Math.max(0, Math.min(1, n)); }
    }
    if (node.tagName?.toLowerCase() === 'svg') { break; }
    node = node.parentNode ?? undefined;
  }

  return opacity;
}

/**
 * 累乘元素所有祖先 <g> 的 transform(从自身往上,每层左乘),返回 M_最外×...×M_最内父。
 * 用 DOM getAttribute('transform') 取原始值,绕过 SVG 解析底座的继承(它对自带 transform
 * 的子元素不 inherit g,且多层嵌套只合最内层、外层丢失)。调用方再 × 自身 transform = 完整世界矩阵。
 * 遇 <svg> root 停止。非 g 祖先(如 <svg>/<defs>)跳过(不累乘)。
 */
export function accumulateAncestors (el: { node?: unknown }): SVGMatrix {
  let m = IDENTITY;
  let node = getSVGAncestorNode(el.node);

  node = node?.parentNode ?? undefined;

  while (node != null) {
    const tag = node.tagName?.toLowerCase();

    if (tag === 'g' || tag === 'a' || tag === 'switch') {
      const t = node.getAttribute?.('transform');

      if (t != null && t !== '') {
        m = multiply(parseTransform(t), m);
      }
    }
    if (tag === 'svg') {
      // SVG 根 viewBox 到 outer viewport 的仿射只在等比缩放且原点为 0 时可直接折叠到 IR transform；
      // 非等比缩放或非零原点保留原坐标语义，避免把 skew 混入 position/scale 分解。
      const vp = buildViewBoxMatrix(node);

      if (vp != null) {
        m = multiply(vp, m);
      }

      break;
    }
    node = node.parentNode ?? undefined;
  }

  return m;
}

/** 构建 SVG viewBox → 外部 viewport 的仿射矩阵(preserveAspectRatio 支持 meet/slice/none)。 */
export function buildViewBoxMatrix(
  node: { getAttribute?: (name: string) => string | null },
  viewport?: { width: number; height: number },
): SVGMatrix | undefined {
  const rawViewBox = node.getAttribute?.('viewBox') ?? '';
  const viewBox = rawViewBox.trim().split(/[\s,]+/).map(Number);

  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite)) { return undefined; }
  const [minX, minY, viewBoxWidth, viewBoxHeight] = viewBox;

  if (viewBoxWidth <= 0 || viewBoxHeight <= 0) { return undefined; }
  const outerWidth = viewport?.width ?? parseViewportLength(node.getAttribute?.('width')) ?? viewBoxWidth;
  const outerHeight = viewport?.height ?? parseViewportLength(node.getAttribute?.('height')) ?? viewBoxHeight;

  if (outerWidth <= 0 || outerHeight <= 0) { return undefined; }
  const preserveAspectRatio = (node.getAttribute?.('preserveAspectRatio') ?? '').trim();
  const parts = preserveAspectRatio.split(/\s+/).filter(part => part !== '' && part.toLowerCase() !== 'defer');
  const alignment = (parts[0] ?? 'xMidYMid').toLowerCase();
  const mode = (parts[1] ?? 'meet').toLowerCase();
  const rawScaleX = outerWidth / viewBoxWidth;
  const rawScaleY = outerHeight / viewBoxHeight;

  if (alignment === 'none') {
    return {
      a: rawScaleX, b: 0, c: 0, d: rawScaleY,
      e: -minX * rawScaleX, f: -minY * rawScaleY,
    };
  }

  const scale = mode === 'slice'
    ? Math.max(rawScaleX, rawScaleY)
    : Math.min(rawScaleX, rawScaleY);
  const contentWidth = viewBoxWidth * scale;
  const contentHeight = viewBoxHeight * scale;
  const alignX = alignment.includes('xmax') ? 1 : alignment.includes('xmid') ? 0.5 : 0;
  const alignY = alignment.includes('ymax') ? 1 : alignment.includes('ymid') ? 0.5 : 0;

  return {
    a: scale, b: 0, c: 0, d: scale,
    e: (outerWidth - contentWidth) * alignX - minX * scale,
    f: (outerHeight - contentHeight) * alignY - minY * scale,
  };
}

function parseViewportLength(value: string | null | undefined): number | undefined {
  const match = value?.trim().match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)(?:px)?$/i);
  const parsed = match == null ? NaN : Number(match[1]);

  return Number.isFinite(parsed) ? parsed : undefined;
}
