import { SVG } from '@svgdotjs/svg.js';
import { readPresentationAttribute } from '../../../parse-svg/read-presentation-attribute';

const normalValues = new Set(['normal', 'initial', 'inherit', 'unset', 'revert', 'revert-layer']);

interface BlendDowngrade {
  mode: string;
  selector: string;
}

/** Replace non-normal mix-blend-mode declarations with normal and report each downgrade. */
export function normalizeLayerBlending(source: string): { source: string; downgrades: BlendDowngrade[] } {
  const svg = SVG(source);
  const downgrades: BlendDowngrade[] = [];
  let changed = false;

  for (const element of [svg.node, ...Array.from(svg.node.querySelectorAll('*'))]) {
    const tag = element.tagName.toLowerCase();
    const id = element.getAttribute('id') ?? '';
    const selector = id === '' ? tag : `${tag}#${id}`;
    const mode = readPresentationAttribute(element, 'mix-blend-mode')?.replace(/\/\*[\s\S]*?\*\//g, '').trim();

    if (mode != null && !normalValues.has(mode.toLowerCase())) {
      downgrades.push({ mode, selector });
    }
    const style = element.getAttribute('style');

    if (style != null) {
      const normalized = normalizeBlendDeclarations(style);

      if (normalized !== style) {
        element.setAttribute('style', normalized);
        changed = true;
      }
    }
    const attribute = element.getAttribute('mix-blend-mode');

    if (attribute != null && !normalValues.has(attribute.trim().toLowerCase())) {
      element.setAttribute('mix-blend-mode', 'normal');
      changed = true;
    }
    if (tag === 'style') {
      const text = element.textContent ?? '';
      const normalized = normalizeBlendDeclarations(text, value => downgrades.push({ mode: value, selector }));

      if (normalized !== text) {
        element.textContent = normalized;
        changed = true;
      }
    }
  }

  return { source: changed ? svg.svg() : source, downgrades };
}

/** Match declaration boundaries without changing strings, comments or function arguments. */
function normalizeBlendDeclarations(source: string, onDowngrade?: (mode: string) => void): string {
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  let start = 0;
  let colon = -1;
  let parentheses = 0;
  let quote: string | undefined;
  let comment = false;
  const finish = (end: number): void => {
    if (colon < start) { return; }
    const name = source.slice(start, colon).replace(/\/\*[\s\S]*?\*\//g, '').trim().toLowerCase();

    if (name !== 'mix-blend-mode') { return; }
    const value = source.slice(colon + 1, end).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const mode = value.replace(/\s*!important\s*$/i, '').trim();

    if (mode === '' || normalValues.has(mode.toLowerCase())) { return; }
    onDowngrade?.(mode);
    replacements.push({
      start: colon + 1, end, value: /!important\s*$/i.test(value) ? ' normal !important' : ' normal',
    });
  };

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    const next = source[index + 1];

    if (comment) {
      if (character === '*' && next === '/') { comment = false; index++; }
      continue;
    }
    if (quote != null) {
      if (character === '\\') { index++; } else if (character === quote) { quote = undefined; }
      continue;
    }
    if (character === '/' && next === '*') { comment = true; index++; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '(') { parentheses++; continue; }
    if (character === ')') { parentheses = Math.max(0, parentheses - 1); continue; }
    if (parentheses > 0) { continue; }
    if (character === ':' && colon < start) { colon = index; }
    if (character === ';' || character === '}' || character === '{') {
      if (character !== '{') { finish(index); }
      start = index + 1;
      colon = -1;
    }
  }
  finish(source.length);
  let result = '';
  let cursor = 0;

  for (const replacement of replacements) {
    result += source.slice(cursor, replacement.start) + replacement.value;
    cursor = replacement.end;
  }

  return result + source.slice(cursor);
}
