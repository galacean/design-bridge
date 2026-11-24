import { SVG } from '@svgdotjs/svg.js';

const animatedTags = new Set(['animate', 'animatetransform', 'animatemotion', 'set']);

/** Static layers cannot sample animation; drop SMIL nodes so elements keep their authored state. */
export function stripLayerAnimation(source: string): { source: string; removed: number } {
  const svg = SVG(source) as unknown as { node?: Element; svg: () => string } | null;

  if (svg?.node == null) { return { source, removed: 0 }; }
  const elements = Array.from(svg.node.querySelectorAll('*'))
    .filter(element => animatedTags.has(element.tagName.toLowerCase()));

  if (elements.length === 0) { return { source, removed: 0 }; }
  for (const element of elements) { element.remove(); }

  return { source: svg.svg(), removed: elements.length };
}
