import type { Element } from '@svgdotjs/svg.js';
import { canConvertLineGeometryAnimations, isLineGeometryAttribute } from './collect-geometry-animation';
import { collectSMILAnimationElements, resolveSMILAnimationTarget } from './resolve-animation-target';

const SMIL_TRANSFORM_OWNER_TAGS = new Set([
  'g', 'a', 'switch', 'use', 'rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line', 'text', 'image',
]);

const SMIL_SHAPE_OWNER_TAGS = new Set([
  'use', 'rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line', 'image',
]);

const SMIL_GEOMETRY_ATTRIBUTES_BY_TAG: Readonly<Record<string, ReadonlySet<string>>> = {
  rect: new Set(['x', 'y', 'width', 'height']),
  circle: new Set(['cx', 'cy', 'r']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry']),
  path: new Set(['d']),
  polygon: new Set(['points']),
  polyline: new Set(['points']),
  use: new Set(['x', 'y']),
  image: new Set(['x', 'y', 'width', 'height']),
};

const lineGeometryAnimationSupportCache = new WeakMap<object, boolean>();

function supportsLineGeometryAnimations (
  target: globalThis.Element,
  root: globalThis.Element,
): boolean {
  const cached = lineGeometryAnimationSupportCache.get(target);

  if (cached != null) { return cached; }
  const supported = canConvertLineGeometryAnimations(target, root);

  lineGeometryAnimationSupportCache.set(target, supported);

  return supported;
}

/** 判断 SMIL 动画是否由 SVG→IR 支持。 */
function isSolidPaintAnimation (node: globalThis.Element, target: globalThis.Element | null, attributeName: 'fill' | 'stroke'): boolean {
  const basePaint = target?.getAttribute(attributeName)?.trim().toLowerCase() ?? '';

  if (basePaint === '' || basePaint === 'none' || /^url\(/i.test(basePaint)) { return false; }
  const authoredValues = [
    node.getAttribute('from'),
    node.getAttribute('to'),
    node.getAttribute('by'),
    node.getAttribute('values'),
  ].filter((value): value is string => value != null);

  return authoredValues.length > 0 && authoredValues.every(value => (
    !/(?:^|;)\s*(?:none|url\()/i.test(value)
  ));
}

export function isMappedSMILAnimationElement (el: Element, tag: string): boolean {
  const node = (el as unknown as { node?: globalThis.Element }).node;
  const root = node == null ? null : ((node as globalThis.SVGElement).ownerSVGElement ?? node) as globalThis.Element;
  const target = node == null || root == null ? node?.parentElement ?? null : resolveSMILAnimationTarget(node, root);
  const parentTag = target?.tagName?.toLowerCase();

  if (parentTag == null || !SMIL_TRANSFORM_OWNER_TAGS.has(parentTag)) { return false; }

  if (tag === 'animatetransform') {
    const attributeName = node?.getAttribute('attributeName')?.trim().toLowerCase();
    const transformType = node?.getAttribute('type')?.trim().toLowerCase();

    return attributeName === 'transform' && ['translate', 'scale', 'rotate'].includes(transformType ?? '');
  }

  if (tag === 'animate' || tag === 'set') {
    if (tag === 'set' && (node?.getAttribute('to')?.trim() === '' || node?.getAttribute('dur')?.trim() === '')) {
      return false;
    }
    const attributeName = node?.getAttribute('attributeName')?.trim().toLowerCase();

    if (attributeName === 'opacity' || attributeName === 'display' || attributeName === 'visibility') { return true; }
    if (attributeName == null || !SMIL_SHAPE_OWNER_TAGS.has(parentTag)) { return false; }
    if (parentTag === 'line' && isLineGeometryAttribute(attributeName)) {
      return target != null && root != null && supportsLineGeometryAnimations(target, root);
    }
    if (SMIL_GEOMETRY_ATTRIBUTES_BY_TAG[parentTag]?.has(attributeName) === true) { return true; }
    if (['fill-opacity', 'stroke-opacity', 'stroke-width'].includes(attributeName)) { return true; }
    if (attributeName === 'fill' || attributeName === 'stroke') {
      if (node == null) { return false; }

      return target != null && isSolidPaintAnimation(node, target, attributeName);
    }

    return false;
  }

  // 已支持的 SMIL 动画属性不产生 warning。
  return tag === 'animatemotion';
}

/** 判断元素或祖先是否存在 opacity 动画。 */
export function hasDirectOpacityAnimation (node: globalThis.Element | null | undefined): boolean {
  if (node == null) { return false; }
  const root = ((node as globalThis.SVGElement).ownerSVGElement ?? node) as globalThis.Element;

  return collectSMILAnimationElements(node, root, new Set(['animate', 'set'])).some(animation => (
    ['opacity', 'display', 'visibility'].includes(animation.getAttribute('attributeName')?.toLowerCase() ?? '')
  ));
}

export function hasAnimatedVisibility (el: Element): boolean {
  const node = (el as unknown as { node?: globalThis.Element | null }).node;

  if (node == null) { return false; }
  const root = ((node as globalThis.SVGElement).ownerSVGElement ?? node) as globalThis.Element;
  let current: globalThis.Element | null = node;

  while (current != null) {
    if (collectSMILAnimationElements(current, root, new Set(['animate', 'set'])).some(animation => (
      ['display', 'visibility'].includes(animation.getAttribute('attributeName')?.toLowerCase() ?? '')
    ))) {
      return true;
    }
    if (current.tagName.toLowerCase() === 'svg') { break; }
    current = current.parentElement;
  }

  return false;
}

export function hasAnimatedAncestorOpacity (el: Element): boolean {
  let parent = (el as unknown as { node?: globalThis.Element | null }).node?.parentElement;

  while (parent != null && parent.tagName.toLowerCase() !== 'svg') {
    if (hasDirectOpacityAnimation(parent)) { return true; }
    parent = parent.parentElement;
  }

  return false;
}
