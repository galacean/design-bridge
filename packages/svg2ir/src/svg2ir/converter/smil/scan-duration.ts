/** SVG SMIL 动画时长扫描入口(animation 活跃区间 → composition/layer 时长)。 */
import { comparisonEnd, resolveBegin } from '../../converter/smil/parse-timeline';
import { getBeginTimeCache } from './timeline-schedule';

/** 返回 root 下全部 SMIL 动画的有限比较区间。 */
export function getSMILDuration (element: { node?: globalThis.Element | null }): number {
  const node = element.node;

  if (node == null) { return 0; }
  const root = ((node as globalThis.SVGElement).ownerSVGElement ?? node) as globalThis.Element;
  const beginCache = getBeginTimeCache(root);
  let maxEnd = 0;

  for (const animation of Array.from(node.querySelectorAll('animateTransform,animate,animateColor,animateMotion,set'))) {
    const begin = resolveBegin(animation, root, beginCache);

    if (begin != null) { maxEnd = Math.max(maxEnd, comparisonEnd(animation, begin)); }
  }

  return maxEnd;
}
