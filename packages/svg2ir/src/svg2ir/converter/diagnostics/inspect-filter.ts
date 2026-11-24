import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import { findById } from '../clip/build-clip-mask';

/** 判断 filter 是否替换原始图形。 */
export function filterReplacesSource (es: EditableSVG, el: Element, rootEl: Element): boolean {
  void es;
  const filterAttr = (el as unknown as { node?: { getAttribute?: (n: string) => string | null } }).node?.getAttribute?.('filter') ?? '';

  if (filterAttr === '') { return false; }
  const m = filterAttr.match(/^url\(\s*["']?#([^)"'\s]+)\s*["']?\)$/i);

  if (m == null) { return false; }
  const filterEl = findById(rootEl, m[1]);

  if (filterEl == null) { return false; }
  // 扫 filter 下所有 fe* 后代(含 feMergeNode 等)的 in/in2;任一显式含 SourceGraphic 即"增强型",返回 false(不跳过)。
  const feDescendants = filterEl.querySelectorAll('*');
  let firstFeIn: string | null = null; // 滤镜链首个原语的 in 值(SVG 首原语默认 in=SourceGraphic)

  for (const fe of feDescendants) {
    const ct = fe.tagName?.toLowerCase() ?? '';

    if (ct.startsWith('fe')) {
      const in1 = fe.getAttribute?.('in') ?? '';
      const in2 = fe.getAttribute?.('in2') ?? '';

      if (firstFeIn === null) { firstFeIn = in1; }
      if (in1 === 'SourceGraphic' || in2 === 'SourceGraphic') { return false; }
    }
  }

  // 首个原语没有显式 in 时，SVG 默认使用 SourceGraphic；这种 filter 增强源图形，
  // 因此保留源元素并单独报告 filter 能力缺失。显式使用 SourceAlpha 等输入时，
  // 源元素按替换型 filter 处理。
  if (firstFeIn === '') { return false; }

  return true; // 无任何 SourceGraphic(显式或首原语默认)= 替换源型
}
