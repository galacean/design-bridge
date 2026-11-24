import { SVG } from '@svgdotjs/svg.js';
import { buildElementTreePath } from '../../../parse-svg/build-element-tree-path';

/** Mask and clipPath definitions do not produce visible layers. */
export function collectNonRenderingDeclarationPaths(source: string): Set<string> {
  const root = SVG(source).node;
  const elements = Array.from(root.querySelectorAll('*')).filter(element => {
    const tag = element.tagName.toLowerCase();

    return tag === 'mask' || tag === 'clippath';
  });

  return new Set(elements.map(buildElementTreePath));
}

/** A stylesheet diagnostic is resolved only when every element it can affect was baked. */
export function collectBakedStylesheetPaths(source: string, isBaked: (path: string) => boolean): Set<string> {
  const resolved = new Set<string>();

  if (typeof DOMParser === 'undefined' || typeof CSSStyleSheet !== 'function') { return resolved; }
  const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
  const allUsesBaked = Array.from(root.querySelectorAll('use')).every(element => isBaked(buildElementTreePath(element)));
  const isHandled = (element: Element): boolean => {
    if (isBaked(buildElementTreePath(element))) { return true; }
    if (element.closest('defs, symbol, marker, pattern, clipPath, mask, filter') != null) { return allUsesBaked; }

    return false;
  };

  for (const style of Array.from(root.querySelectorAll('style'))) {
    const sheet = new CSSStyleSheet();

    sheet.replaceSync(style.textContent ?? '');
    const rules = Array.from(sheet.cssRules);
    const handled = rules.every(rule => {
      if (!isStyleRule(rule)) { return false; }
      if (Array.from(rule.style).every(name => name === 'mix-blend-mode')) { return true; }
      const matched = [root, ...Array.from(root.querySelectorAll('*'))]
        .filter(element => element.matches(rule.selectorText));

      return matched.every(isHandled);
    });

    if (handled) { resolved.add(buildElementTreePath(style)); }
  }

  return resolved;
}

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return rule.type === 1;
}
