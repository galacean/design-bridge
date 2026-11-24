export type SVGComparisonMode = 'static' | 'animated';
export type SVGModeDetection = SVGComparisonMode | 'uncertain' | 'invalid' | 'empty';

interface StyleDeclaration {
  style: CSSStyleDeclaration;
  selector?: string;
}

function detectStyleAnimation(style: CSSStyleDeclaration, keyframes: ReadonlySet<string>): SVGModeDetection {
  const names = style.getPropertyValue('animation-name').trim();
  const animation = style.getPropertyValue('animation').trim();

  if (/\bvar\s*\(/i.test(names) || /\bvar\s*\(/i.test(animation)) { return 'uncertain'; }
  const referenced = names.split(',').map(name => name.trim()).filter(name => name !== '' && name.toLowerCase() !== 'none');

  if (referenced.some(name => keyframes.has(name.replace(/^(['"])(.*)\1$/, '$2')))) { return 'animated'; }
  if (referenced.length > 0) { return 'uncertain'; }
  const transition = style.getPropertyValue('transition-property').trim();

  return transition !== '' && transition.toLowerCase() !== 'none' ? 'uncertain' : 'static';
}

function collectStylesheetRules(
  rules: CSSRuleList, keyframes: Set<string>, declarations: StyleDeclaration[],
): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSKeyframesRule) {
      keyframes.add(rule.name);
    } else if (rule instanceof CSSStyleRule) {
      declarations.push({ style: rule.style, selector: rule.selectorText });
    } else if (rule instanceof CSSGroupingRule) {
      if (rule instanceof CSSMediaRule && !window.matchMedia(rule.conditionText).matches) { continue; }
      if (rule instanceof CSSSupportsRule && !CSS.supports(rule.conditionText)) { continue; }
      collectStylesheetRules(rule.cssRules, keyframes, declarations);
    }
  }
}

/** Detect declared animation without relying on the conversion result. */
export function detectSVGComparisonMode(source: string): SVGModeDetection {
  if (source.trim() === '') { return 'empty'; }
  if (typeof DOMParser !== 'function') { return 'uncertain'; }
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;

  if (root.localName.toLowerCase() !== 'svg' || document.querySelector('parsererror') != null) { return 'invalid'; }
  let uncertain = Array.from(document.childNodes).some(node =>
    node.nodeType === Node.PROCESSING_INSTRUCTION_NODE && node.nodeName.toLowerCase() === 'xml-stylesheet');
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  const smil = new Set(['animate', 'animatetransform', 'animatemotion', 'animatecolor', 'set']);
  const keyframes = new Set<string>();
  const declarations: StyleDeclaration[] = [];

  for (const element of elements) {
    const name = element.localName.toLowerCase();

    if (smil.has(name) && (element.namespaceURI == null || element.namespaceURI === 'http://www.w3.org/2000/svg')) {
      return 'animated';
    }
    if (name === 'script' || name === 'link' ||
      Array.from(element.attributes).some(attribute => /^on[a-z]/i.test(attribute.name))) {
      uncertain = true;
    }
    const href = element.getAttribute('href') ?? element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';

    if ((name === 'use' && href !== '' && !href.startsWith('#')) ||
      (name === 'image' && /^(?:data:image\/(?:svg\+xml|gif|webp))|\.(?:svgz?|gif|webp)(?:[?#]|$)/i.test(href))) {
      uncertain = true;
    }
    const inlineStyle = element.getAttribute('style');

    if (inlineStyle != null) {
      const style = globalThis.document.createElement('div').style;

      style.cssText = inlineStyle;
      declarations.push({ style });
    }
    if (name === 'style') {
      const css = element.textContent ?? '';

      if (/@import\b/i.test(css)) { uncertain = true; }
      try {
        const sheet = new CSSStyleSheet();

        sheet.replaceSync(css);
        collectStylesheetRules(sheet.cssRules, keyframes, declarations);
      } catch {
        uncertain = true;
      }
    }
  }
  for (const declaration of declarations) {
    const mode = detectStyleAnimation(declaration.style, keyframes);

    if (mode === 'static') { continue; }
    if (declaration.selector != null) {
      if (/:(?:hover|active|focus|focus-within|target|checked)\b/i.test(declaration.selector)) {
        uncertain = true;
        continue;
      }
      try {
        if (!root.matches(declaration.selector) && root.querySelector(declaration.selector) == null) { continue; }
      } catch {
        uncertain = true;
        continue;
      }
    }
    if (mode === 'animated') { return mode; }
    uncertain = true;
  }

  return uncertain ? 'uncertain' : 'static';
}
