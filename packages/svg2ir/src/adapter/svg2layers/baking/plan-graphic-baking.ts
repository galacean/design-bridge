import { SVG } from '@svgdotjs/svg.js';
import { buildElementTreePath } from '../../../parse-svg/build-element-tree-path';
import type { SVGSnapshotContext } from '../../../svg-rasterizer/prepare-snapshot';

const declarations = new Set([
  'defs', 'style', 'title', 'desc', 'metadata', 'symbol', 'clippath', 'mask', 'filter',
  'lineargradient', 'radialgradient', 'pattern', 'marker',
]);
const graphics = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'use']);
const containers = new Set(['svg', 'g', 'a', 'switch']);
const groupEffects = ['opacity', 'filter', 'mask', 'clip-path'];
const native = new Set(['text', 'image', 'foreignobject']);

interface GraphicBakeScope {
  path: string;
  selector: string;
  isGroup: boolean;
}

interface GraphicBakingPlan {
  scopes: GraphicBakeScope[];
  warnings: Array<{ message: string; selector: string }>;
}

/** Select graphic-only subtrees; keep native text and images as separate layers. */
export function planGraphicBaking(source: string): GraphicBakingPlan {
  const root = SVG(source).node;
  const scopes: GraphicBakeScope[] = [];
  const warnings: GraphicBakingPlan['warnings'] = [];
  const effectRules = collectGroupEffectRules(root);
  const byId = new Map(Array.from(root.querySelectorAll('[id]')).map(element =>
    [element.getAttribute('id') ?? '', element],
  ));
  const tagOf = (element: Element): string => element.tagName.toLowerCase();
  const selectorOf = (element: Element): string => {
    const id = element.getAttribute('id') ?? '';

    return `${tagOf(element)}${id === '' ? '' : `#${id}`}`;
  };
  const references = (element: Element): Element[] => {
    const ids = Array.from(element.attributes).flatMap(attribute => {
      const values = Array.from(attribute.value.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g), match => match[1]);

      if ((attribute.localName === 'href') && attribute.value.startsWith('#')) {
        values.push(attribute.value.slice(1));
      }

      return values;
    });

    return ids.flatMap(id => {
      const target = byId.get(id);

      return target == null ? [] : [target];
    });
  };
  const containsNative = (element: Element, seen = new Set<Element>()): boolean => {
    if (seen.has(element)) { return false; }
    seen.add(element);
    if (native.has(tagOf(element))) { return true; }

    return Array.from(element.children).some(child => !declarations.has(tagOf(child)) && containsNative(child, seen))
      || references(element).some(target => containsNative(target, seen));
  };
  const hasGraphics = (element: Element): boolean => graphics.has(tagOf(element))
    || Array.from(element.children).some(child => !declarations.has(tagOf(child)) && hasGraphics(child));
  const hasGroupEffect = (element: Element): boolean => {
    const style = element.getAttribute('style') ?? '';

    return effectRules.some(rule => element.matches(rule.selectorText)) || hasGraphicGroupEffect(name =>
      element.getAttribute(name)
        ?? new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(style)?.[1]?.trim(),
    );
  };
  const visit = (element: Element): void => {
    const tag = tagOf(element);
    const style = element.getAttribute('style') ?? '';
    const display = /(?:^|;)\s*display\s*:\s*([^;]+)/.exec(style)?.[1]?.trim()
      ?? element.getAttribute('display');

    if (display === 'none') { return; }
    if (declarations.has(tag) || native.has(tag)) { return; }
    if (!containers.has(tag) && !graphics.has(tag)) { return; }
    if (!hasGraphics(element)) { return; }
    if ((graphics.has(tag) || tag === 'switch') && !containsNative(element)) {
      scopes.push({ path: buildElementTreePath(element), selector: selectorOf(element), isGroup: containers.has(tag) });

      return;
    }
    if (hasGroupEffect(element) && !containsNative(element)) {
      scopes.push({ path: buildElementTreePath(element), selector: selectorOf(element), isGroup: containers.has(tag) });

      return;
    }
    if (hasGroupEffect(element)) {
      warnings.push({
        message: 'A compositing group contains native text or images; its graphics cannot be baked separately.',
        selector: selectorOf(element),
      });

      return;
    }
    for (const child of Array.from(element.children)) { visit(child); }
  };

  visit(root);

  return { scopes, warnings };
}

function collectGroupEffectRules(root: Element): CSSStyleRule[] {
  const result: CSSStyleRule[] = [];

  if (typeof CSSStyleSheet !== 'function') { return result; }
  const visit = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if (isStyleRule(rule)) {
        const affectsGroup = hasGraphicGroupEffect(name => {
          const value = rule.style.getPropertyValue(name).trim();

          return value === '' || value === 'initial' || value === 'unset' ? undefined : value;
        });

        if (affectsGroup) { result.push(rule); }
      } else if (hasNestedRules(rule)) {
        visit(rule.cssRules);
      }
    }
  };

  for (const style of Array.from(root.querySelectorAll('style'))) {
    const sheet = new CSSStyleSheet();

    sheet.replaceSync(style.textContent ?? '');
    visit(sheet.cssRules);
  }

  return result;
}

/** Reject text/image dependencies and effects that cannot be rendered independently. */
export function validateGraphicSnapshot(context: SVGSnapshotContext): void {
  const { root, target, elements, dependencies, readStyle } = context;

  for (const element of dependencies) {
    if (['text', 'image', 'foreignobject'].includes(element.tagName.toLowerCase())) {
      throw new Error('Graphic dependencies contain native text or images; they must remain editable.');
    }
  }
  for (const element of elements) {
    const computed = readStyle(element);
    const ancestor = element !== target && element.contains(target);
    const groupEffect = ancestor && hasGraphicGroupEffect(name => name === 'mask'
      ? computed.maskImage : computed.getPropertyValue(name));

    if (ancestor && (groupEffect || computed.mixBlendMode !== 'normal')) {
      throw new Error('A mixed group effect cannot be applied independently to its graphics.');
    }
    if (target.contains(element) && target !== root && computed.mixBlendMode !== 'normal') {
      throw new Error('Blend modes that depend on an external backdrop cannot be baked independently.');
    }
  }
}

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return rule.type === 1;
}

function hasNestedRules(rule: CSSRule): rule is CSSGroupingRule {
  return 'cssRules' in rule;
}

function hasGraphicGroupEffect(readValue: (name: string) => string | null | undefined): boolean {
  return groupEffects.some(name => {
    const value = readValue(name);

    return value != null && value !== 'none' && value !== 'normal' && value !== '1';
  });
}
