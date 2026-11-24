/**
 * SVG <clipPath> → IRMask(挂到被裁图层的 mask 字段)。
 *
 * IR 只负责把 mask 几何挂到被裁图层；IR→Effects 的结构组装由 `@galacean/ge-ir` 负责。
 *
 * 收集 clipPath 内所有形状几何,合并成一个 IRBezierPath(多 subpath 并集语义)的 points/handles。
 * clipPath 内 path/polygon/polyline/rect 可直接收集，circle/ellipse 使用 cubic 圆弧；
 * clip-rule even-odd/nonzero 不处理；IR mask 使用默认规则。
 *
 * 被裁元素通过 clip-path="url(#id)" 引用,svg2ir 扫描时把对应 IRMask 挂到该元素图层。
 */
import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element as SVGElementNode } from '@svgdotjs/svg.js';
import type { IRBezierPath, IRMask } from '@galacean/animation-ir';
import { accumulateAncestors, IDENTITY, multiply, parseTransform, transformPoint } from '../../matrix';
import { collectShapeGeometry, transformVector, type MaskGeometry } from '../../converter/clip/collect-geometry';
import { mergeClosedSubpaths } from '../../normalize-path';

/**
 * 从 clipPath/mask 元素合并所有子形状几何 → IRMask{path}（当前合并为单点集）。
 *
 * 支持子元素为直接形状(rect/circle/path...)或 `<use href="#shapeId">` 引用声明区形状。
 *
 * **坐标基准(mask 真正的坑)**:SVG mask content 在 `maskContentUnits=userSpaceOnUse`(默认)下,
 * "userSpace" = **mask 元素所在的 userSpace**——即 mask 元素自身 transform + 祖先 `<g>` transform
 * 累乘后的空间。mask 与被裁 `<image>` 可能位于同一个带 transform 的 `<g>` 里,故 content
 * 形状的 (0,0) 是 g 局部原点，需要累计 g 的 transform 才能得到 SVG 绝对坐标。clipPath 通常位于
 * defs 中并直接使用文档坐标，因此保持局部坐标；mask 则累计其宿主变换后再与被裁图层对齐。
 */
export function buildClipMask (
  es: EditableSVG,
  clipPathEl: SVGElementNode,
  rootEl?: SVGElementNode,
  applyAncestorTransform = false,
  applyShapeOwnTransform = false,
): IRMask | null {
  void es; // DOM 直接读属性,clipPath/mask 子是 DOM node 非 svg.js Element,不经解析底座。
  const shapeEls = collectShapeChildren(clipPathEl, rootEl);

  if (shapeEls.length === 0) { return null; }

  const geometry: MaskGeometry = { paths: [] };

  for (const shapeEl of shapeEls) {
    const tag = shapeEl.node.tagName?.toLowerCase() ?? '';

    collectShapeGeometry(shapeEl, tag, geometry, applyShapeOwnTransform);
  }

  const [mergedPath] = mergeClosedSubpaths(geometry.paths);

  if (mergedPath == null || mergedPath.points.length === 0) { return null; }

  // mask:把 content 点累计 mask 元素自身 transform + 祖先 g transform,得到 SVG 绝对 userSpace。
  // 用与 parse-shape/image 一致的 accumulateAncestors(DOM getAttribute 上溯父 g 累乘),保证与
  // 被裁 layer 的 position 和 anchor 位于同一坐标系，可直接计算重定位偏移。
  const containerMatrix = applyAncestorTransform ? accumulateAncestors(clipPathEl) : null;
  const path: IRBezierPath = containerMatrix == null
    ? mergedPath
    : {
      points: mergedPath.points.map(point => transformPoint(containerMatrix, point.x, point.y)),
      inTangents: mergedPath.inTangents.map(tangent => transformVector(containerMatrix, tangent)),
      outTangents: mergedPath.outTangents.map(tangent => transformVector(containerMatrix, tangent)),
      closed: true,
    };

  return { path, mode: 'add' as const };
}

/**
 * 构建 `<g mask="url(#X)">` 的组级 mask。
 * mask 坐标与子代使用同一 comp-absolute 坐标系；定义几何先在局部收集，
 * 再叠加宿主 g 的祖先变换和自身 transform。解析不到 mask 或没有形状时返回 null。
 */
export function buildGroupMaskForG (
  es: EditableSVG,
  gEl: SVGElementNode,
  rootEl: SVGElementNode,
): IRMask | null {
  void es; // DOM 直读(同 buildClipMask)。
  const gNode = (gEl as unknown as { node?: { getAttribute?: (n: string) => string | null } }).node;
  const maskAttr = gNode?.getAttribute?.('mask') ?? '';
  const m = maskAttr.match(/^url\(\s*["']?#([^)"'\s]+)\s*["']?\)$/i);

  if (m == null) { return null; } // <g> 无 mask 或非 url 引用。
  const maskEl = findById(rootEl, m[1]);

  if (maskEl == null) { return null; } // mask 定义缺失。

  // mask 内容形状的自身 transform 先应用到局部几何，再叠加宿主 g 的变换。
  const rawMask = buildClipMask(es, { node: maskEl } as unknown as SVGElementNode, rootEl, false, true);

  if (rawMask == null) { return null; }

  // 组的完整世界链 = 祖先变换 × <g> 自身变换。
  const gSelfAttr = gNode?.getAttribute?.('transform') ?? '';
  const gSelf = gSelfAttr !== '' ? parseTransform(gSelfAttr) : IDENTITY;
  const gChain = multiply(accumulateAncestors(gEl), gSelf);
  const pts = rawMask.path.points.map(p => transformPoint(gChain, p.x, p.y));
  const inTangents = rawMask.path.inTangents.map(t => transformVector(gChain, t));
  const outTangents = rawMask.path.outTangents.map(t => transformVector(gChain, t));

  return { mode: 'add' as const,
    path: {
      points: pts,
      inTangents,
      outTangents,
      closed: true,
    },
    // Group coverage composes with descendant masks through the parent hierarchy.
  };
}

/**
 * clipPath/mask 直接形状子元素(DOM node,跳过非形状)。遇 `<use href="#id">` 展开:
 * 从 rootEl(scope)按 id 查被引用形状并收集其几何。
 */
function collectShapeChildren (clipPathEl: SVGElementNode, rootEl?: SVGElementNode): Array<{ node: globalThis.Element }> {
  const children: Array<{ node: globalThis.Element }> = [];
  let node: unknown = (clipPathEl as unknown as { node?: { firstChild?: unknown } }).node?.firstChild;

  while (node != null) {
    const tag = (node as { tagName?: string }).tagName?.toLowerCase();

    if (tag != null && ['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line'].includes(tag)) {
      children.push({ node: node as Element });
    } else if (tag === 'use') {
      // use 引用的形状几何(id 查全文档)。href 取 href/xlink:href 任一。
      const href = (node as globalThis.Element).getAttribute?.('href')
        ?? (node as globalThis.Element).getAttributeNS?.('http://www.w3.org/1999/xlink', 'href')
        ?? '';
      const id = href.startsWith('#') ? href.slice(1) : '';
      const refEl = id !== '' && rootEl != null ? findById(rootEl, id) : null;

      if (refEl != null) { children.push({ node: refEl }); }
    }
    node = (node as { nextSibling?: unknown }).nextSibling;
  }

  return children;
}

/** 按 id 查 DOM element。优先全文档 ownerDocument.getElementById(被引用形状常在别处 <defs>,
 * 不在 mask/clipPath 子树内,querySelector 限子树会漏);fallback querySelector 子树 + rootEl 查。 */
export function findById (el: SVGElementNode, id: string): globalThis.Element | null {
  const node = (el as unknown as { node?: globalThis.Element }).node;
  // ownerDocument.getElementById 全文档 O(1) 查,最可靠。
  const byDoc = node?.ownerDocument?.getElementById?.(id);

  if (byDoc) { return byDoc; }
  // fallback:rootEl(文档根)子树 querySelector;最后 el 自身子树。
  const root = (el as unknown as { root?: () => SVGElementNode }).root?.();
  const rootBySel = root != null
    ? (root as unknown as { node?: globalThis.Element }).node?.querySelector?.(`#${cssEscape(id)}`)
    : undefined;

  return rootBySel ?? node?.querySelector?.(`#${cssEscape(id)}`) ?? null;
}

/** 为没有全局 CSS.escape 的运行环境提供简单的 id 转义。 */
function cssEscape (s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') { return CSS.escape(s); }

  return s.replace(/[^a-zA-Z0-9_-]/g, c => `\\${c}`);
}
