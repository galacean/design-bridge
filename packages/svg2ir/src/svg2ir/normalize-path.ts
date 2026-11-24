/**
 * SVG path d 命令 → IRBezierPath(顶点切线模型)。
 *
 * 两步处理：(1) tokenize 并升阶到 M/L/C/Z；(2) 按 IR 顶点切线模型填充
 * points/inTangents/outTangents。使用本地 tokenizer，按 SVG 规范命令表解析，不引入额外布局依赖。
 *
 * IR 顶点切线模型:每个顶点 i 携带 inTangents[i]/outTangents[i](相对该顶点的入/出切线偏移)。
 * 段 i→i+1 三次贝塞尔的两个控制点 = points[i]+outTangents[i] 与 points[i+1]+inTangents[i+1]。
 */
import type { IRBezierPath } from '@galacean/animation-ir';
import { arcToCubics } from './convert-arc';

/** 规整化后的命令:只剩 M/L/C/Z(绝对坐标)。 */
type NormalizedCommand =
  | { cmd: 'M'; x: number; y: number }
  | { cmd: 'L'; x: number; y: number }
  | { cmd: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { cmd: 'Z' };

const COMMAND_LETTERS = 'MLCSQTAHZV';

interface NormalizePathOptions {
  arcSegmentAngle?: number;
}

/** tokenize + 相对转绝对 + H/V→L + Q/T/S/A 升阶成 C。M 开头(规整化补 M(0,0) 防 C/L 越界)。 */
export function normalizePathCommands (d: string, options: NormalizePathOptions = {}): NormalizedCommand[] {
  const tokens = tokenize(d);
  const out: NormalizedCommand[] = [];
  let curX = 0;
  let curY = 0;
  // SVG 的 `Z` 不会把当前点留在最后一个显式顶点；后续相对命令从子路径起点继续。
  // 单独保存该起点，才能正确处理导出图标中常见的 `M...Z m...Z`。
  let subpathStartX = 0;
  let subpathStartY = 0;
  let lastCtrlQ: { x: number; y: number } | null = null;   // 上一 Q/T 的控制点(用于 T 反射)
  let lastCtrlC2: { x: number; y: number } | null = null;  // 上一 C/S 的第二控制点(用于 S 反射)

  if (tokens.length === 0 || tokens[0].letter !== 'M' && tokens[0].letter !== 'm') {
    // 保证 M 开头,防 C/L 在空点上越界。
    out.push({ cmd: 'M', x: 0, y: 0 });
  }

  for (const tok of tokens) {
    const rel = tok.letter === tok.letter.toLowerCase() && tok.letter !== tok.letter.toUpperCase();
    const L = tok.letter.toUpperCase();
    const p = tok.params;

  // 一个命令后可以连续跟随多组参数而不重复命令字母（如 `M0 0 10 0 10 10`、`C... ...`）。
  // SVG 将首个 M/m 参数对之后的每组参数视为隐式 L/l。
    if (L === 'Z') {
      out.push({ cmd: 'Z' });
      curX = subpathStartX;
      curY = subpathStartY;
      lastCtrlQ = null;
      lastCtrlC2 = null;

      continue;
    }

    const arity = PATH_COMMAND_ARITY[L];

    if (arity == null) { continue; }

    let paramIndex = 0;
    let firstGroup = true;

    while (paramIndex + arity <= p.length) {
      const group = p.slice(paramIndex, paramIndex + arity);

      paramIndex += arity;
      const command = L === 'M' && !firstGroup ? 'L' : L;

      firstGroup = false;

      switch (command) {
      case 'M': {
        curX = rel ? curX + group[0] : group[0];
        curY = rel ? curY + group[1] : group[1];
        subpathStartX = curX;
        subpathStartY = curY;
        out.push({ cmd: 'M', x: curX, y: curY });
        lastCtrlQ = null;
        lastCtrlC2 = null;

        break;
      }
      case 'L': {
        curX = rel ? curX + group[0] : group[0];
        curY = rel ? curY + group[1] : group[1];
        out.push({ cmd: 'L', x: curX, y: curY });
        lastCtrlQ = null;
        lastCtrlC2 = null;

        break;
      }
      case 'H': {
        curX = rel ? curX + group[0] : group[0];
        out.push({ cmd: 'L', x: curX, y: curY });
        lastCtrlQ = null;
        lastCtrlC2 = null;

        break;
      }
      case 'V': {
        curY = rel ? curY + group[0] : group[0];
        out.push({ cmd: 'L', x: curX, y: curY });
        lastCtrlQ = null;
        lastCtrlC2 = null;

        break;
      }
      case 'C': {
        const x1 = rel ? curX + group[0] : group[0], y1 = rel ? curY + group[1] : group[1];
        const x2 = rel ? curX + group[2] : group[2], y2 = rel ? curY + group[3] : group[3];
        const x = rel ? curX + group[4] : group[4], y = rel ? curY + group[5] : group[5];

        out.push({ cmd: 'C', x1, y1, x2, y2, x, y });
        curX = x; curY = y;
        lastCtrlC2 = { x: x2, y: y2 };
        lastCtrlQ = null;

        break;
      }
      case 'S': {
        // S: 第一控制点 = 上一 C/S 第二控制点关于当前点反射。
        const reflect: { x: number; y: number } = lastCtrlC2 ?? { x: curX, y: curY };
        const x1 = 2 * curX - reflect.x, y1 = 2 * curY - reflect.y;
        const x2 = rel ? curX + group[0] : group[0], y2 = rel ? curY + group[1] : group[1];
        const x = rel ? curX + group[2] : group[2], y = rel ? curY + group[3] : group[3];

        out.push({ cmd: 'C', x1, y1, x2, y2, x, y });
        curX = x; curY = y;
        lastCtrlC2 = { x: x2, y: y2 };
        lastCtrlQ = null;

        break;
      }
      case 'Q': {
        const qx1 = rel ? curX + group[0] : group[0], qy1 = rel ? curY + group[1] : group[1];
        const qx2 = rel ? curX + group[2] : group[2], qy2 = rel ? curY + group[3] : group[3];
        // Q → C 升阶:C1 = P0 + 2/3(Q1−P0), C2 = P2 + 2/3(Q1−P2)
        const x1 = curX + (2 / 3) * (qx1 - curX), y1 = curY + (2 / 3) * (qy1 - curY);
        const x2 = qx2 + (2 / 3) * (qx1 - qx2), y2 = qy2 + (2 / 3) * (qy1 - qy2);

        out.push({ cmd: 'C', x1, y1, x2, y2, x: qx2, y: qy2 });
        curX = qx2; curY = qy2;
        lastCtrlQ = { x: qx1, y: qy1 };
        lastCtrlC2 = null;

        break;
      }
      case 'T': {
        // T: 控制点 = 上一 Q/T 控制点关于当前点反射,升阶成 C。
        const reflect: { x: number; y: number } = lastCtrlQ ?? { x: curX, y: curY };
        const qx1 = 2 * curX - reflect.x, qy1 = 2 * curY - reflect.y;
        const qx2 = rel ? curX + group[0] : group[0], qy2 = rel ? curY + group[1] : group[1];
        const x1 = curX + (2 / 3) * (qx1 - curX), y1 = curY + (2 / 3) * (qy1 - curY);
        const x2 = qx2 + (2 / 3) * (qx1 - qx2), y2 = qy2 + (2 / 3) * (qy1 - qy2);

        out.push({ cmd: 'C', x1, y1, x2, y2, x: qx2, y: qy2 });
        curX = qx2; curY = qy2;
        lastCtrlQ = { x: qx1, y: qy1 };
        lastCtrlC2 = null;

        break;
      }
      case 'A': {
        // A 椭圆弧 → 多段 C(arc-to-bezier)。本版用最简近似:轴向椭圆、长弧/旋转按角度分段。
        // 旋转角为 0 的圆形或轴对齐椭圆弧可转换；其余复杂 arc 进入降级路径。
        const rx = group[0], ry = group[1];
        const xAxisRotation = group[2], largeArcFlag = group[3], sweepFlag = group[4];
        const x = rel ? curX + group[5] : group[5], y = rel ? curY + group[6] : group[6];

        if (xAxisRotation === 0 && rx > 0 && ry > 0) {
          for (const seg of arcToCubics(curX, curY, rx, ry, x, y, !!largeArcFlag, !!sweepFlag, options.arcSegmentAngle)) {
            out.push({ cmd: 'C', x1: seg[0], y1: seg[1], x2: seg[2], y2: seg[3], x: seg[4], y: seg[5] });
          }
        } else {
          // 旋转 arc 或异常半径无法稳定映射时退化为直线。
          out.push({ cmd: 'L', x, y });
        }
        curX = x; curY = y;
        lastCtrlQ = null;
        lastCtrlC2 = null;

        break;
      }
      }
    }
  }

  return out;
}

const PATH_COMMAND_ARITY: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
};

/** 规整化命令 → IRBezierPath(顶点切线模型,每个 sub-path 一个)。一行 d 多 sub-path 时产多个。 */
export function normalizedToCustomShapePaths (cmds: NormalizedCommand[]): IRBezierPath[] {
  const paths: IRBezierPath[] = [];
  let points: Array<{ x: number; y: number }> = [];
  let inTangents: Array<{ x: number; y: number }> = [];
  let outTangents: Array<{ x: number; y: number }> = [];
  let closed = false;
  let hasSubPath = false;

  const flush = () => {
    if (hasSubPath && points.length > 0) {
      paths.push({ points, inTangents, outTangents, closed });
    }
    points = []; inTangents = []; outTangents = []; closed = false; hasSubPath = false;
  };

  for (const cmd of cmds) {
    switch (cmd.cmd) {
      case 'M':
        flush();
        points.push({ x: cmd.x, y: cmd.y });
        inTangents.push({ x: 0, y: 0 });
        outTangents.push({ x: 0, y: 0 });
        hasSubPath = true;

        break;
      case 'L':
        points.push({ x: cmd.x, y: cmd.y });
        inTangents.push({ x: 0, y: 0 });
        outTangents.push({ x: 0, y: 0 });
        if (!hasSubPath) { hasSubPath = true; }

        break;
      case 'C': {
        const prevIdx = points.length - 1;

        if (prevIdx >= 0) {
          outTangents[prevIdx] = { x: cmd.x1 - points[prevIdx].x, y: cmd.y1 - points[prevIdx].y };
        }
        points.push({ x: cmd.x, y: cmd.y });
        inTangents.push({ x: cmd.x2 - cmd.x, y: cmd.y2 - cmd.y });
        outTangents.push({ x: 0, y: 0 });
        if (!hasSubPath) { hasSubPath = true; }

        break;
      }
      case 'Z':
        closed = true;
        flush();

        break;
    }
  }

  flush();

  return paths;
}

/** tokenize d 串为命令字母 + 参数数组。 */
interface Token { letter: string; params: number[] }

function tokenize (d: string): Token[] {
  const tokens: Token[] = [];
  const letterRe = new RegExp(`([${COMMAND_LETTERS}${COMMAND_LETTERS.toLowerCase()}])`, 'g');
  const numRe = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
  let pos = 0;
  let m: RegExpExecArray | null;

  while ((m = letterRe.exec(d)) !== null) {
    const letter = m[1];
    const segStart = letterRe.lastIndex;
    const segEnd = d.slice(segStart).search(new RegExp(`[${COMMAND_LETTERS}${COMMAND_LETTERS.toLowerCase()}]`));
    const seg = segEnd === -1 ? d.slice(segStart) : d.slice(segStart, segStart + segEnd);
    const params: number[] = [];
    let nm: RegExpExecArray | null;
    const localRe = new RegExp(numRe);

    while ((nm = localRe.exec(seg)) !== null) {
      params.push(parseFloat(nm[0]));
    }
    tokens.push({ letter, params });
    pos = segStart + seg.length;
  }

  void pos;

  return tokens;
}

const ZERO_TANGENT = { x: 0, y: 0 };

/**
 * 将多个闭合 sub-path 缝合成一条 IRBezierPath。
 *
 * Effects 的 ShapeComponent 会把 `shapes` 数组里的每个 shape 独立 triangulate/fill;因此
 * 一个外框 + 一个内框会被渲染成两个实心矩形,中间看不到洞。SVG 的 fill-rule(默认
 * nonzero / evenodd)需要在同一次 triangulation 里把所有 contour 一起处理。Effects 底层的
 * libtess 默认 odd(evenodd),所以 svg2ir 只要在同一个 CustomShape 里把 contour 连
 * 成一个简单多边形,Effects 就会按 odd 规则把内部 contour 当成洞。
 *
 * 这里用“零面积桥接”:把每个 sub-path 的起点复制一次作为闭合边,再用直线桥接到下一个
 * sub-path 的起点;桥接边在 odd 规则下互相抵消,等价于多个独立 contour。只在所有
 * sub-path 都闭合时生效。
 */
export function mergeClosedSubpaths (paths: IRBezierPath[]): IRBezierPath[] {
  if (paths.length <= 1 || !paths.every(p => p.closed)) {
    return paths;
  }

  // 把面积最大的子路径放到最前面,降低桥接线与图形边界交叉的概率。
  const ordered = [...paths].sort((a, b) => getPathBoundsArea(b) - getPathBoundsArea(a));

  const points: Array<{ x: number; y: number }> = [];
  const inTangents: Array<{ x: number; y: number }> = [];
  const outTangents: Array<{ x: number; y: number }> = [];

  const addPoint = (
    point: { x: number; y: number },
    inTangent: { x: number; y: number },
    outTangent: { x: number; y: number },
  ) => {
    points.push({ x: point.x, y: point.y });
    inTangents.push({ x: inTangent.x, y: inTangent.y });
    outTangents.push({ x: outTangent.x, y: outTangent.y });
  };

  const anchor = ordered[0].points[0];

  // 第一个顶点的入切线只用于最终闭合桥接,这里置 0 使桥接边为直线;
  // 外框真正的闭合边由外框起点的副本承载。
  addPoint(anchor, ZERO_TANGENT, ordered[0].outTangents[0]);

  for (let i = 0; i < ordered.length; i++) {
    const path = ordered[i];

    for (let j = 1; j < path.points.length; j++) {
      addPoint(path.points[j], path.inTangents[j], path.outTangents[j]);
    }

    // 复制当前 sub-path 的起点:入切线保留以维持真正的闭合曲线,出切线为 0 用于桥接。
    addPoint(path.points[0], path.inTangents[0], ZERO_TANGENT);

    if (i < ordered.length - 1) {
      const next = ordered[i + 1];

      // 除第一次外,先回到公共锚点,再桥接到下一个 sub-path 的起点。
      if (i > 0) {
        addPoint(anchor, ZERO_TANGENT, ZERO_TANGENT);
      }
      addPoint(next.points[0], ZERO_TANGENT, next.outTangents[0]);
    }
  }

  return [{ points, inTangents, outTangents, closed: true }];
}

function getPathBoundsArea (path: IRBezierPath): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const { x, y } of path.points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return (maxX - minX) * (maxY - minY);
}
