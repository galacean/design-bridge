import type {
  VectorVertex,
  VectorSegment,
  VectorNetwork,
  VectorBounds,
  SvgParseResult,
  SvgPathCommand,
} from '../types';

// ---- SVG Path Parser ----

interface PathToken {
  type: 'cmd' | 'num';
  value: string | number;
}

function tokenizePath(d: string): PathToken[] {
  const tokens: PathToken[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(d)) !== null) {
    if (m[1]) {
      tokens.push({ type: 'cmd', value: m[1] });
    } else {
      tokens.push({ type: 'num', value: parseFloat(m[2]) });
    }
  }

  return tokens;
}

export function parseSvgPath(d: string): SvgPathCommand[][] {
  const tokens = tokenizePath(d);
  const subpaths: SvgPathCommand[][] = [];
  let currentSubpath: SvgPathCommand[] = [];
  let cx = 0,
    cy = 0;
  let sx = 0,
    sy = 0;
  let lastCmd = '';
  let lastCx2 = 0,
    lastCy2 = 0;
  let i = 0;

  function nextNum(): number {
    while (i < tokens.length && tokens[i].type === 'cmd') {
      i++;
    }
    if (i >= tokens.length) {
      return 0;
    }

    return tokens[i++].value as number;
  }

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type !== 'cmd') {
      const repeatCmd = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd;

      tokens.splice(i, 0, { type: 'cmd', value: repeatCmd });
      continue;
    }

    const cmd = token.value as string;

    i++;

    switch (cmd) {
      case 'M': {
        if (currentSubpath.length > 0) {
          subpaths.push(currentSubpath);
        }
        currentSubpath = [];
        cx = nextNum();
        cy = nextNum();
        sx = cx;
        sy = cy;
        currentSubpath.push({ type: 'M', x: cx, y: cy });

        break;
      }
      case 'm': {
        if (currentSubpath.length > 0) {
          subpaths.push(currentSubpath);
        }
        currentSubpath = [];
        cx += nextNum();
        cy += nextNum();
        sx = cx;
        sy = cy;
        currentSubpath.push({ type: 'M', x: cx, y: cy });

        break;
      }
      case 'L': {
        cx = nextNum();
        cy = nextNum();
        currentSubpath.push({ type: 'L', x: cx, y: cy });

        break;
      }
      case 'l': {
        cx += nextNum();
        cy += nextNum();
        currentSubpath.push({ type: 'L', x: cx, y: cy });

        break;
      }
      case 'H': {
        cx = nextNum();
        currentSubpath.push({ type: 'L', x: cx, y: cy });

        break;
      }
      case 'h': {
        cx += nextNum();
        currentSubpath.push({ type: 'L', x: cx, y: cy });

        break;
      }
      case 'V': {
        cy = nextNum();
        currentSubpath.push({ type: 'L', x: cx, y: cy });

        break;
      }
      case 'v': {
        cy += nextNum();
        currentSubpath.push({ type: 'L', x: cx, y: cy });

        break;
      }
      case 'C': {
        const x1 = nextNum(),
          y1 = nextNum();
        const x2 = nextNum(),
          y2 = nextNum();
        const x = nextNum(),
          y = nextNum();

        currentSubpath.push({ type: 'C', x1, y1, x2, y2, x, y });
        lastCx2 = x2;
        lastCy2 = y2;
        cx = x;
        cy = y;

        break;
      }
      case 'c': {
        const dx1 = nextNum(),
          dy1 = nextNum();
        const dx2 = nextNum(),
          dy2 = nextNum();
        const dx = nextNum(),
          dy = nextNum();
        const x1 = cx + dx1,
          y1 = cy + dy1;
        const x2 = cx + dx2,
          y2 = cy + dy2;
        const x = cx + dx,
          y = cy + dy;

        currentSubpath.push({ type: 'C', x1, y1, x2, y2, x, y });
        lastCx2 = x2;
        lastCy2 = y2;
        cx = x;
        cy = y;

        break;
      }
      case 'S': {
        const rx1 = 2 * cx - lastCx2;
        const ry1 = 2 * cy - lastCy2;
        const x2 = nextNum(),
          y2 = nextNum();
        const x = nextNum(),
          y = nextNum();

        currentSubpath.push({ type: 'C', x1: rx1, y1: ry1, x2, y2, x, y });
        lastCx2 = x2;
        lastCy2 = y2;
        cx = x;
        cy = y;

        break;
      }
      case 's': {
        const rx1 = 2 * cx - lastCx2;
        const ry1 = 2 * cy - lastCy2;
        const dx2 = nextNum(),
          dy2 = nextNum();
        const dx = nextNum(),
          dy = nextNum();
        const x2 = cx + dx2,
          y2 = cy + dy2;
        const x = cx + dx,
          y = cy + dy;

        currentSubpath.push({ type: 'C', x1: rx1, y1: ry1, x2, y2, x, y });
        lastCx2 = x2;
        lastCy2 = y2;
        cx = x;
        cy = y;

        break;
      }
      case 'Q': {
        const qx1 = nextNum(),
          qy1 = nextNum();
        const x = nextNum(),
          y = nextNum();
        const cx1 = cx + (2 / 3) * (qx1 - cx);
        const cy1 = cy + (2 / 3) * (qy1 - cy);
        const cx2 = x + (2 / 3) * (qx1 - x);
        const cy2 = y + (2 / 3) * (qy1 - y);

        currentSubpath.push({ type: 'C', x1: cx1, y1: cy1, x2: cx2, y2: cy2, x, y });
        lastCx2 = qx1;
        lastCy2 = qy1;
        cx = x;
        cy = y;

        break;
      }
      case 'q': {
        const dqx1 = nextNum(),
          dqy1 = nextNum();
        const dx = nextNum(),
          dy = nextNum();
        const qx1 = cx + dqx1,
          qy1 = cy + dqy1;
        const x = cx + dx,
          y = cy + dy;
        const cx1 = cx + (2 / 3) * (qx1 - cx);
        const cy1 = cy + (2 / 3) * (qy1 - cy);
        const cx2 = x + (2 / 3) * (qx1 - x);
        const cy2 = y + (2 / 3) * (qy1 - y);

        currentSubpath.push({ type: 'C', x1: cx1, y1: cy1, x2: cx2, y2: cy2, x, y });
        lastCx2 = qx1;
        lastCy2 = qy1;
        cx = x;
        cy = y;

        break;
      }
      case 'T': {
        const rx = 2 * cx - lastCx2;
        const ry = 2 * cy - lastCy2;
        const x = nextNum(),
          y = nextNum();
        const cx1 = cx + (2 / 3) * (rx - cx);
        const cy1 = cy + (2 / 3) * (ry - cy);
        const cx2 = x + (2 / 3) * (rx - x);
        const cy2 = y + (2 / 3) * (ry - y);

        currentSubpath.push({ type: 'C', x1: cx1, y1: cy1, x2: cx2, y2: cy2, x, y });
        lastCx2 = rx;
        lastCy2 = ry;
        cx = x;
        cy = y;

        break;
      }
      case 't': {
        const rx = 2 * cx - lastCx2;
        const ry = 2 * cy - lastCy2;
        const x = cx + nextNum(),
          y = cy + nextNum();
        const cx1 = cx + (2 / 3) * (rx - cx);
        const cy1 = cy + (2 / 3) * (ry - cy);
        const cx2 = x + (2 / 3) * (rx - x);
        const cy2 = y + (2 / 3) * (ry - y);

        currentSubpath.push({ type: 'C', x1: cx1, y1: cy1, x2: cx2, y2: cy2, x, y });
        lastCx2 = rx;
        lastCy2 = ry;
        cx = x;
        cy = y;

        break;
      }
      case 'A':
      case 'a': {
        const arx = Math.abs(nextNum()),
          ary = Math.abs(nextNum());
        const xRot = nextNum();
        const largeArc = nextNum();
        const sweep = nextNum();
        let ex = nextNum(),
          ey = nextNum();

        if (cmd === 'a') {
          ex += cx;
          ey += cy;
        }
        const arcs = arcToCubic(cx, cy, ex, ey, arx, ary, xRot, largeArc, sweep);

        for (const arc of arcs) {
          currentSubpath.push({
            type: 'C',
            x1: arc[0],
            y1: arc[1],
            x2: arc[2],
            y2: arc[3],
            x: arc[4],
            y: arc[5],
          });
        }
        cx = ex;
        cy = ey;

        break;
      }
      case 'Z':
      case 'z': {
        currentSubpath.push({ type: 'Z' });
        cx = sx;
        cy = sy;

        break;
      }
    }

    if (
      cmd !== 'C' &&
      cmd !== 'c' &&
      cmd !== 'S' &&
      cmd !== 's' &&
      cmd !== 'Q' &&
      cmd !== 'q' &&
      cmd !== 'T' &&
      cmd !== 't'
    ) {
      lastCx2 = cx;
      lastCy2 = cy;
    }
    lastCmd = cmd;
  }

  if (currentSubpath.length > 0) {
    subpaths.push(currentSubpath);
  }

  return subpaths;
}

function arcToCubic(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  angle: number,
  largeArcFlag: number,
  sweepFlag: number,
): number[][] {
  if (rx === 0 || ry === 0) {
    return [[x1, y1, x2, y2, x2, y2]];
  }

  const phi = (angle * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  let rxSq = rx * rx,
    rySq = ry * ry;
  const x1pSq = x1p * x1p,
    y1pSq = y1p * y1p;

  const lambda = x1pSq / rxSq + y1pSq / rySq;

  if (lambda > 1) {
    const s = Math.sqrt(lambda);

    rx *= s;
    ry *= s;
    rxSq = rx * rx;
    rySq = ry * ry;
  }

  let sq = Math.max(0, (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq));

  sq = Math.sqrt(sq);
  if (largeArcFlag === sweepFlag) {
    sq = -sq;
  }

  const cxp = (sq * rx * y1p) / ry;
  const cyp = (-sq * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  function vecAngle(ux: number, uy: number, vx: number, vy: number): number {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));

    if (ux * vy - uy * vx < 0) {
      a = -a;
    }

    return a;
  }

  const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = vecAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);

  if (!sweepFlag && dtheta > 0) {
    dtheta -= 2 * Math.PI;
  }
  if (sweepFlag && dtheta < 0) {
    dtheta += 2 * Math.PI;
  }

  const segments = Math.ceil(Math.abs(dtheta) / (Math.PI / 2));
  const delta = dtheta / segments;
  const t = (4 / 3) * Math.tan(delta / 4);
  const result: number[][] = [];

  for (let i = 0; i < segments; i++) {
    const a1 = theta1 + i * delta;
    const a2 = theta1 + (i + 1) * delta;

    const cos1 = Math.cos(a1),
      sin1 = Math.sin(a1);
    const cos2 = Math.cos(a2),
      sin2 = Math.sin(a2);

    const ep2x = rx * cos2,
      ep2y = ry * sin2;

    const cp1x = rx * cos1 - t * rx * sin1;
    const cp1y = ry * sin1 + t * ry * cos1;
    const cp2x = ep2x + t * rx * sin2;
    const cp2y = ep2y - t * ry * cos2;

    const bx1 = cosPhi * cp1x - sinPhi * cp1y + cx;
    const by1 = sinPhi * cp1x + cosPhi * cp1y + cy;
    const bx2 = cosPhi * cp2x - sinPhi * cp2y + cx;
    const by2 = sinPhi * cp2x + cosPhi * cp2y + cy;
    const bx = cosPhi * ep2x - sinPhi * ep2y + cx;
    const by = sinPhi * ep2x + cosPhi * ep2y + cy;

    result.push([bx1, by1, bx2, by2, bx, by]);
  }

  return result;
}

// ---- SVG Path → Figma VectorNetwork ----

export function svgPathToVectorNetwork(subpaths: SvgPathCommand[][]): VectorNetwork {
  const vertices: VectorVertex[] = [];
  const segments: VectorSegment[] = [];
  const loops: number[][] = [];

  for (const subpath of subpaths) {
    if (subpath.length === 0) {
      continue;
    }

    const loopSegmentIndices: number[] = [];
    let firstVertexIdx = -1;
    let prevVertexIdx = -1;

    for (const cmd of subpath) {
      switch (cmd.type) {
        case 'M': {
          firstVertexIdx = vertices.length;
          vertices.push({ handleMirroring: 0, x: cmd.x!, y: cmd.y! });
          prevVertexIdx = firstVertexIdx;

          break;
        }
        case 'L': {
          const vi = vertices.length;

          vertices.push({ handleMirroring: 0, x: cmd.x!, y: cmd.y! });
          loopSegmentIndices.push(segments.length);
          segments.push({
            flags: 0,
            start: prevVertexIdx,
            tangentStartX: 0,
            tangentStartY: 0,
            end: vi,
            tangentEndX: 0,
            tangentEndY: 0,
          });
          prevVertexIdx = vi;

          break;
        }
        case 'C': {
          const vi = vertices.length;

          vertices.push({ handleMirroring: 0, x: cmd.x!, y: cmd.y! });
          const tsX = cmd.x1! - vertices[prevVertexIdx].x;
          const tsY = cmd.y1! - vertices[prevVertexIdx].y;
          const teX = cmd.x2! - cmd.x!;
          const teY = cmd.y2! - cmd.y!;

          loopSegmentIndices.push(segments.length);
          segments.push({
            flags: 0,
            start: prevVertexIdx,
            tangentStartX: tsX,
            tangentStartY: tsY,
            end: vi,
            tangentEndX: teX,
            tangentEndY: teY,
          });
          prevVertexIdx = vi;

          break;
        }
        case 'Z': {
          if (prevVertexIdx !== firstVertexIdx && firstVertexIdx >= 0) {
            const firstVertex = vertices[firstVertexIdx];
            const closeVertexIdx = vertices.length;

            vertices.push({
              handleMirroring: 0,
              x: firstVertex.x,
              y: firstVertex.y,
            });
            loopSegmentIndices.push(segments.length);
            segments.push({
              flags: 0,
              start: prevVertexIdx,
              tangentStartX: 0,
              tangentStartY: 0,
              end: closeVertexIdx,
              tangentEndX: 0,
              tangentEndY: 0,
            });
          }
          prevVertexIdx = firstVertexIdx;

          break;
        }
      }
    }

    if (loopSegmentIndices.length > 0) {
      loops.push(loopSegmentIndices);
    }
  }

  return { vertices, segments, loops };
}

// ---- Binary Encoder ----

export function encodeVectorNetworkBlob(
  vertices: VectorVertex[],
  segments: VectorSegment[],
  loops: number[][],
  windingRule = 1,
): Uint8Array {
  const numRegions = loops.length > 0 ? 1 : 0;

  let regionSize = 0;

  if (numRegions > 0) {
    regionSize += 4 + 4;
    for (const loop of loops) {
      regionSize += 4 + loop.length * 4;
    }
    regionSize += 4;
  }

  const totalSize = 12 + vertices.length * 12 + segments.length * 28 + regionSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint32(offset, vertices.length, true);
  offset += 4;
  view.setUint32(offset, segments.length, true);
  offset += 4;
  view.setUint32(offset, numRegions, true);
  offset += 4;

  for (const v of vertices) {
    view.setUint32(offset, v.handleMirroring, true);
    offset += 4;
    view.setFloat32(offset, v.x, true);
    offset += 4;
    view.setFloat32(offset, v.y, true);
    offset += 4;
  }

  for (const s of segments) {
    view.setUint32(offset, s.flags, true);
    offset += 4;
    view.setUint32(offset, s.start, true);
    offset += 4;
    view.setFloat32(offset, s.tangentStartX, true);
    offset += 4;
    view.setFloat32(offset, s.tangentStartY, true);
    offset += 4;
    view.setUint32(offset, s.end, true);
    offset += 4;
    view.setFloat32(offset, s.tangentEndX, true);
    offset += 4;
    view.setFloat32(offset, s.tangentEndY, true);
    offset += 4;
  }

  if (numRegions > 0) {
    view.setUint32(offset, windingRule, true);
    offset += 4;
    view.setUint32(offset, loops.length, true);
    offset += 4;
    for (const loop of loops) {
      view.setUint32(offset, loop.length, true);
      offset += 4;
      for (const segIdx of loop) {
        view.setUint32(offset, segIdx, true);
        offset += 4;
      }
    }
    view.setUint32(offset, 0, true);
    offset += 4;
  }

  return new Uint8Array(buffer);
}

// ---- High-level API ----

export function svgPathToBlob(
  pathD: string,
  viewBoxWidth = 24,
  viewBoxHeight = 24,
  renderSize?: number,
): { blob: Uint8Array; bounds: VectorBounds } {
  const subpaths = parseSvgPath(pathD);

  return svgSubpathsToBlob(subpaths, viewBoxWidth, viewBoxHeight, renderSize);
}

export function svgPathsToBlob(
  paths: string[],
  viewBoxWidth = 24,
  viewBoxHeight = 24,
  renderSize?: number,
): { blob: Uint8Array; bounds: VectorBounds } {
  const subpaths: SvgPathCommand[][] = [];

  for (const pathD of paths) {
    const parsed = parseSvgPath(pathD);

    for (const sp of parsed) {
      subpaths.push(sp);
    }
  }

  return svgSubpathsToBlob(subpaths, viewBoxWidth, viewBoxHeight, renderSize);
}

function svgSubpathsToBlob(
  subpaths: SvgPathCommand[][],
  viewBoxWidth = 24,
  viewBoxHeight = 24,
  renderSize?: number,
): { blob: Uint8Array; bounds: VectorBounds } {
  const network = svgPathToVectorNetwork(subpaths);

  if (network.vertices.length === 0 && network.segments.length === 0) {
    return {
      blob: encodeVectorNetworkBlob([], [], []),
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
  }

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const v of network.vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }
  for (const s of network.segments) {
    const sv = network.vertices[s.start];
    const ev = network.vertices[s.end];
    const cp1x = sv.x + s.tangentStartX;
    const cp1y = sv.y + s.tangentStartY;
    const cp2x = ev.x + s.tangentEndX;
    const cp2y = ev.y + s.tangentEndY;

    minX = Math.min(minX, cp1x, cp2x);
    minY = Math.min(minY, cp1y, cp2y);
    maxX = Math.max(maxX, cp1x, cp2x);
    maxY = Math.max(maxY, cp1y, cp2y);
  }

  const pathWidth = maxX - minX;
  const pathHeight = maxY - minY;
  const scale = renderSize != null ? renderSize / Math.max(viewBoxWidth, viewBoxHeight) : 1;

  for (const v of network.vertices) {
    v.x = (v.x - minX) * scale;
    v.y = (v.y - minY) * scale;
  }
  for (const s of network.segments) {
    s.tangentStartX *= scale;
    s.tangentStartY *= scale;
    s.tangentEndX *= scale;
    s.tangentEndY *= scale;
  }

  const bounds: VectorBounds = {
    x: 0,
    y: 0,
    width: pathWidth * scale,
    height: pathHeight * scale,
  };

  const blob = encodeVectorNetworkBlob(network.vertices, network.segments, network.loops);

  return { blob, bounds };
}

export function parseSvgContent(svgContent: string): SvgParseResult | null {
  const vbMatch = svgContent.match(/viewBox=["']([^"']+)["']/);
  const viewBox = vbMatch ? vbMatch[1].split(/[\s,]+/).map(Number) : [0, 0, 24, 24];

  const paths: string[] = [];
  const pathRe = /<path[^>]*\bd=["']([^"']+)["'][^>]*\/?>/g;
  let m: RegExpExecArray | null;

  while ((m = pathRe.exec(svgContent)) !== null) {
    paths.push(m[1]);
  }

  const fillRuleMatch = svgContent.match(/fill-rule=["']([^"']+)["']/);
  const fillRule = fillRuleMatch ? fillRuleMatch[1] : 'nonzero';

  return paths.length > 0 ? { paths, viewBox, fillRule } : null;
}
