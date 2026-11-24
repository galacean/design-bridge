import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { IRLayer, IRMask, IRShape, IRTransform } from '@galacean/animation-ir';
import { IRShapePrimitiveType } from '@galacean/animation-ir';
import { isAxisAlignedRect, maskCoversFull, maskSizeAbnormal, rangeCovers } from '../../converter/clip/collect-geometry';

export function applyClipMask<T extends IRLayer> (es: EditableSVG, el: Element, layer: T, clipMasks: Map<string, IRMask>): T {
  const cp = String(es.getAttr(el, 'clip-path') ?? '');
  // mask 用 DOM getAttribute 读取元素自身属性，不使用 es.getAttr；后者会合并祖先属性。
  // 组级 mask 由 parse-layers 创建 null 父层，这里只处理元素自身的 mask 属性。
  const mc = (el as unknown as { node?: { getAttribute?: (n: string) => string | null } }).node?.getAttribute?.('mask') ?? '';
  const cpRef = cp.match(/^url\(\s*["']?#([^)"'\s]+)\s*["']?\)$/i);
  const isClip = cpRef != null;
  const ref = cpRef ?? mc.match(/^url\(\s*["']?#([^)"'\s]+)\s*["']?\)$/i);

  if (!ref) { return layer; }
  const baseMask = clipMasks.get(ref[1]);

  if (baseMask == null) { return layer; }
  if (isClip) { return { ...layer, masks: [baseMask] }; }

  const rebased = rebaseMaskToLocal(baseMask, layer);

  return rebased ? { ...layer, masks: [rebased] } : layer;
}

/** 将 SVG 绝对 mask 点转换为 image 的 asset-local 坐标。 */
function rebaseMaskToLocal (mask: IRMask, layer: IRLayer): IRMask | null {
  const pos = readVec2(layer.transform?.position);
  const sc = readVec3(layer.transform?.scale);
  const l = layer as unknown as { asset?: { width?: number; height?: number } };
  const aw = Number(l.asset?.width) || 0;
  const ah = Number(l.asset?.height) || 0;

  // 退化 scale 无法建立局部坐标。
  if (sc.x === 0 || sc.y === 0) { return null; }

  // image mask 以 asset 左上角为原点，转换为 Effects mask 时使用 asset 中心坐标。
  if (aw > 0 && ah > 0) {
    const dispW = aw * sc.x, dispH = ah * sc.y;
    const originX = pos.x - dispW / 2;   // image 显示框左上角（轴对齐）
    const originY = pos.y - dispH / 2;
    const pts = mask.path.points.map(p => ({ x: (p.x - originX) / sc.x, y: (p.y - originY) / sc.y }));

    if (maskCoversFull(pts, aw, ah)) { return null; }
    if (maskSizeAbnormal(pts, aw, ah)) { return null; }

    return { path: { points: pts, inTangents: mask.path.inTangents, outTangents: mask.path.outTangents, closed: mask.path.closed }, mode: 'add' as const };
  }

  // shape 没有 asset 尺寸，mask 需要转换到以 layer anchor 为基准的 element-local 空间。
  // 逆变换同时处理位置、缩放和旋转；skew 已在 transform 分解阶段降级。
  const anchor = readVec2(layer.transform?.anchor);
  const rotRaw = (layer.transform?.rotation as { z?: { type?: string; value?: unknown; keyframes?: Array<{ value: unknown }> } } | undefined)?.z;
  const rotVal = rotRaw == null ? undefined : (rotRaw.type === 'keyframed' ? rotRaw.keyframes?.[0]?.value : rotRaw.value);
  const rot = (Array.isArray(rotVal) ? Number(rotVal[2]) : Number(rotVal)) || 0;
  const rad = -rot * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const pts = mask.path.points.map(p => {
    const dx = p.x - pos.x, dy = p.y - pos.y;

    return {
      x: anchor.x + (c * dx - s * dy) / sc.x,
      y: anchor.y + (s * dx + c * dy) / sc.y,
    };
  });

  // 仅在轴对齐 mask 完全覆盖形状 bbox 时跳过 no-op mask；其他形状保留路径。
  const shapeBbox = shapeElementLocalBbox(layer);

  if (shapeBbox != null && isAxisAlignedRect(pts) && rangeCovers(pts, shapeBbox, 5)) {
    return null;
  }

  return { path: { points: pts, inTangents: mask.path.inTangents, outTangents: mask.path.outTangents, closed: mask.path.closed }, mode: 'add' as const };
}

/** shape layer 的 element-local bbox(以 layer.transform.anchor=localCenter 为原点)。
 *  rect/ellipse 用 w/h 居中;custom 用 customPaths 顶点(extents,顶点本就相对 anchor per parse-shape)。 */
function shapeElementLocalBbox (layer: IRLayer): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const shapes = (layer as unknown as { shapes?: IRShape[] }).shapes;

  if (shapes == null || shapes.length === 0) { return null; }
  const shape = shapes[0];

  switch (shape.primitiveType) {
    case IRShapePrimitiveType.Rectangle: {
      const r = shape;
      const w = r.width, h = r.height;

      return { minX: -w / 2, minY: -h / 2, maxX: w / 2, maxY: h / 2 };
    }
    case IRShapePrimitiveType.Ellipse: {
      const e = shape;

      return { minX: -e.xRadius, minY: -e.yRadius, maxX: e.xRadius, maxY: e.yRadius };
    }
    case IRShapePrimitiveType.Custom: {
      const cu = shape;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      for (const p of cu.customPaths) {
        for (const pt of p.points) {
          minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
          maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
        }
      }
      if (!isFinite(minX)) { return null; }

      return { minX, minY, maxX, maxY };
    }
    default:
      return null;
  }
}

function readVec2 (channel: IRTransform[keyof IRTransform] | undefined): { x: number; y: number } {
  const v = readVec3(channel);

  return { x: v.x, y: v.y };
}

function readVec3 (channel: IRTransform[keyof IRTransform] | undefined): { x: number; y: number; z: number } {
  if (channel == null) { return { x: 1, y: 1, z: 1 }; }
  const c = channel as { type?: string; value?: unknown; keyframes?: Array<{ value: unknown }> };
  const value = c.type === 'keyframed' ? c.keyframes?.[0]?.value : c.value;

  if (Array.isArray(value) && value.length >= 3) {
    return { x: Number(value[0]) || 1, y: Number(value[1]) || 1, z: Number(value[2]) || 1 };
  }

  return { x: 1, y: 1, z: 1 };
}
