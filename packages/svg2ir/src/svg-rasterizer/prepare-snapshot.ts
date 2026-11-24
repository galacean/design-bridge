import { buildElementTreePath } from '../parse-svg/build-element-tree-path';

const animatedElements = new Set(['animate', 'animatetransform', 'animatemotion', 'set']);

const declarations = new Set([
  'defs', 'style', 'title', 'desc', 'metadata', 'symbol', 'clippath', 'mask', 'filter',
  'lineargradient', 'radialgradient', 'pattern', 'marker',
]);

export interface SVGSnapshotContext {
  root: Element;
  target: Element;
  elements: readonly Element[];
  dependencies: ReadonlySet<Element>;
  readStyle: (element: Element) => CSSStyleDeclaration;
}

/** Preserve selector context until styles are frozen, then isolate the requested paint subtree. */
export function prepareSVGSnapshot(
  source: string,
  path: string,
  size: [number, number],
  inspect?: (context: SVGSnapshotContext) => void,
): string {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');

  if (parsed.querySelector('parsererror') != null) { throw new Error('Invalid SVG document.'); }
  const root = parsed.documentElement;
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  const selected = elements.find(element => buildElementTreePath(element) === path);

  if (selected == null) { throw new Error('The graphic source element could not be located.'); }
  if (root.querySelector('script, foreignObject') != null) {
    throw new Error('Scripts and foreignObject are outside static graphic baking support.');
  }
  if (Array.from(root.querySelectorAll('style')).some(element => /@import|@font-face/i.test(element.textContent ?? ''))) {
    throw new Error('External stylesheets and fonts require explicit resource preparation.');
  }
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) { element.removeAttributeNode(attribute); }
    }
  }
  const frame = document.createElement('iframe');

  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${size[0]}px;height:${size[1]}px;border:0;`;
  document.body.appendChild(frame);
  try {
    const frameDocument = frame.contentDocument;
    const frameWindow = frame.contentWindow;

    if (frameDocument == null || frameWindow == null) { throw new Error('Unable to create isolated SVG context.'); }
    frameDocument.body.style.cssText = 'margin:0;';
    const mounted = frameDocument.importNode(root, true);

    mounted.setAttribute('width', String(size[0]));
    mounted.setAttribute('height', String(size[1]));
    frameDocument.body.appendChild(mounted);
    const mountedElements = [mounted, ...Array.from(mounted.querySelectorAll('*'))];
    const selectedIndex = elements.indexOf(selected);
    const target = mountedElements[selectedIndex];
    const normalizeReference = (url: string): string => {
      if (url.startsWith('#')) { return url; }
      const hash = url.indexOf('#');

      if (hash >= 0 && url.slice(0, hash) === frameDocument.baseURI.split('#')[0]) { return url.slice(hash); }
      throw new Error('External paint resources require explicit resource preparation.');
    };
    const frozenStyles: Array<string | null> = [];
    const templateRoots = Array.from(mounted.querySelectorAll('use')).flatMap(element => {
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
      const template = href.startsWith('#') ? mountedElements.find(candidate => candidate.id === href.slice(1)) : null;

      return template == null ? [] : [template];
    });
    const styleRules: CSSStyleRule[] = [];
    const collectRules = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        if (isStyleRule(rule)) {
          styleRules.push(rule);
        } else if (hasNestedRules(rule)) {
          if (isMediaRule(rule) && !frameWindow.matchMedia(rule.conditionText).matches) { continue; }
          collectRules(rule.cssRules);
        }
      }
    };

    for (const sheet of Array.from(frameDocument.styleSheets)) { collectRules(sheet.cssRules); }

    for (const element of mountedElements) {
      const computed = frameWindow.getComputedStyle(element);
      const inside = target.contains(element);
      const ancestor = element !== target && element.contains(target);

      if ((inside || ancestor) && (computed.animationName !== 'none'
        || hasAnimationChildren(element))) {
        throw new Error('Animated graphics require an explicit sampling policy.');
      }
      // Freezing inherited defaults on a definition changes <use> instance inheritance.
      // Freeze only authored declarations, after matching selectors in the intact source tree.
      const authored = frameDocument.createElement('div').style;

      authored.cssText = element.getAttribute('style') ?? '';
      const names = new Set(Array.from(authored));

      for (const rule of styleRules) {
        if (element.matches(rule.selectorText)) {
          for (const name of Array.from(rule.style)) { names.add(name); }
        }
      }
      const properties = Array.from(names, name => {
        let value = computed.getPropertyValue(name);

        value = value.replace(/url\(["']?([^)'"\s]+)["']?\)/g, (_match: string, url: string) => {
          return `url("${normalizeReference(url)}")`;
        });

        return `${name}:${value} !important;`;
      });

      const isTemplate = templateRoots.some(template => template.contains(element));

      frozenStyles.push(isTemplate ? null : properties.join(''));
    }
    for (let index = 0; index < mountedElements.length; index++) {
      const style = frozenStyles[index];

      if (style != null) { mountedElements[index].setAttribute('style', style); }
    }
    const byId = new Map(mountedElements.filter(element => element.id !== '').map(element => [element.id, element]));
    const seen = new Set<Element>();
    const checkDependencies = (element: Element): void => {
      if (seen.has(element)) { return; }
      seen.add(element);
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.localName === 'href' && element.tagName.toLowerCase() === 'a') { continue; }
        if (attribute.localName === 'href' && !attribute.value.startsWith('#')
          && !(['image', 'feimage'].includes(element.tagName.toLowerCase()) && /^data:image\//i.test(attribute.value))) {
          throw new Error('External SVG references require explicit resource preparation.');
        }
        const normalized = attribute.value.replace(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g,
          (_match: string, url: string) => `url("${normalizeReference(url)}")`);
        const ids = Array.from(normalized.matchAll(/url\(["']?#([^)'"\s]+)["']?\)/g), match => match[1]);

        if (normalized !== attribute.value) { element.setAttribute(attribute.name, normalized); }

        if (attribute.localName === 'href' && attribute.value.startsWith('#')) { ids.push(attribute.value.slice(1)); }
        for (const id of ids) {
          const dependency = byId.get(id);

          if (dependency == null) { throw new Error(`Missing SVG reference: #${id}.`); }
          checkDependencies(dependency);
        }
      }
      for (const child of Array.from(element.children)) {
        if (!declarations.has(child.tagName.toLowerCase())) { checkDependencies(child); }
      }
    };

    checkDependencies(target);
    for (const dependency of seen) {
      if (frameWindow.getComputedStyle(dependency).animationName !== 'none'
        || hasAnimationChildren(dependency)) {
        throw new Error('Animated graphics require an explicit sampling policy.');
      }
    }
    inspect?.({
      root: mounted, target, elements: mountedElements, dependencies: seen,
      readStyle: element => frameWindow.getComputedStyle(element),
    });
    const isolate = (element: Element): void => {
      for (const child of Array.from(element.children)) {
        const tag = child.tagName.toLowerCase();

        if (declarations.has(tag) || child === target || target.contains(child)) { continue; }
        if (child.contains(target)) {
          isolate(child);
        } else {
          const definitions = frameDocument.createElementNS('http://www.w3.org/2000/svg', 'defs');

          child.replaceWith(definitions);
          definitions.appendChild(child);
        }
      }
    };

    if (target !== mounted) { isolate(mounted); }

    return new XMLSerializer().serializeToString(mounted);
  } finally {
    frame.remove();
  }
}

/** Only animations attached to this element reject its own bake scope, not unrelated subtrees. */
function hasAnimationChildren(element: Element): boolean {
  return Array.from(element.children)
    .some(child => animatedElements.has(child.tagName.toLowerCase()));
}

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return rule.type === 1;
}

function hasNestedRules(rule: CSSRule): rule is CSSGroupingRule {
  return 'cssRules' in rule;
}

function isMediaRule(rule: CSSRule): rule is CSSMediaRule {
  return rule.type === 4;
}
