const SMIL_ANIMATION_TAGS = new Set(['animate', 'animatecolor', 'animatetransform', 'animatemotion', 'set']);
const animationTargetCache = new WeakMap<object, globalThis.Element | null>();
const animationElementsCache = new WeakMap<object, globalThis.Element[]>();

function findSMILRoot (node: globalThis.Element): globalThis.Element {
  let current = node;

  while (current.parentNode != null && current.tagName.toLowerCase() !== 'svg') {
    current = current.parentNode as globalThis.Element;
  }

  return current;
}

function findElementById (root: globalThis.Element, id: string): globalThis.Element | null {
  if (root.getAttribute('id') === id) { return root; }

  return Array.from(root.querySelectorAll('[id]')).find(element => element.getAttribute('id') === id) ?? null;
}

function readAnimationParent (animation: globalThis.Element): globalThis.Element | null {
  const parent = animation.parentNode;

  return parent != null && typeof (parent as { tagName?: unknown }).tagName === 'string'
    ? parent as globalThis.Element
    : animation.parentElement;
}

function matchesAnimationTarget (
  animation: globalThis.Element,
  target: globalThis.Element,
  root: globalThis.Element,
  tags: ReadonlySet<string>,
): boolean {
  return tags.has(animation.tagName.toLowerCase())
    && resolveSMILAnimationTarget(animation, root) === target;
}

/** Resolve the element animated by a direct or href-targeted SMIL element. */
export function resolveSMILAnimationTarget (
  animation: globalThis.Element,
  root: globalThis.Element,
): globalThis.Element | null {
  const cached = animationTargetCache.get(animation);

  if (cached != null) { return cached; }
  if (animationTargetCache.has(animation)) { return null; }
  const svgRoot = findSMILRoot(root);
  const href = animation.getAttribute('href') ?? animation.getAttribute('xlink:href');
  let target: globalThis.Element | null;

  if (href != null && href.trim().startsWith('#')) {
    target = findElementById(svgRoot, href.trim().slice(1));
  } else {
    target = readAnimationParent(animation);
  }
  animationTargetCache.set(animation, target);

  return target;
}

/** Collect direct and href-targeted SMIL elements for one SVG element in document order. */
export function collectSMILAnimationElements (
  target: globalThis.Element,
  root: globalThis.Element,
  tags: ReadonlySet<string> = SMIL_ANIMATION_TAGS,
): globalThis.Element[] {
  const svgRoot = findSMILRoot(root);
  let animations = animationElementsCache.get(svgRoot);

  if (animations == null) {
    animations = Array.from(svgRoot.querySelectorAll('*')).filter(element => (
      SMIL_ANIMATION_TAGS.has(element.tagName.toLowerCase())
    ));
    animationElementsCache.set(svgRoot, animations);
  }

  return animations.filter(element => matchesAnimationTarget(element, target, svgRoot, tags));
}
