/** Rewrite local fragment URLs without changing color values or external URLs. */
export function namespaceSvgStyleUrls(value: string, ids: ReadonlyMap<string, string>): string {
  return value.replace(/url\(\s*(?:(["'])#(.*?)\1|#([^\s)]+))\s*\)/gi, (match, quote, quotedId, bareId) => {
    const id = typeof quotedId === 'string' ? quotedId : String(bareId);
    const replacement = ids.get(decodeCssIdentifier(id));

    if (replacement == null) { return match; }
    const delimiter = typeof quote === 'string' ? quote : '';
    const escaped = replacement.replace(/[\\()'"\s]/g, character => `\\${character}`);

    return `url(${delimiter}#${escaped}${delimiter})`;
  });
}

function decodeCssIdentifier(value: string): string {
  return value.replace(/\\([\da-f]{1,6})[ \t\r\n\f]?|\\([^\r\n\f])/gi, (_match, hex, escaped) => {
    if (typeof hex !== 'string') { return String(escaped); }
    const point = Number.parseInt(hex, 16);

    return String.fromCodePoint(point === 0 || point > 0x10ffff ? 0xfffd : point);
  });
}

function namespaceSelector(selector: string, ids: ReadonlyMap<string, string>): string {
  // CSSOM separates selectors from declarations, so hashes in colors remain untouched.
  const strings = String.raw`"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'`;
  const identifiers = String.raw`#((?:\\[\da-fA-F]{1,6}[ \t\r\n\f]?|\\[^\r\n\f]|[-\w\u0080-\uffff])+)`;
  const tokens = new RegExp(`${strings}|${identifiers}`, 'g');

  return selector.replace(tokens, (match, identifier) => {
    if (typeof identifier !== 'string') { return match; }
    const replacement = ids.get(decodeCssIdentifier(identifier));

    return replacement == null ? match : `#${CSS.escape(replacement)}`;
  });
}

function namespaceRule(rule: CSSRule, ids: ReadonlyMap<string, string>): void {
  if (rule instanceof CSSStyleRule) {
    rule.selectorText = namespaceSelector(rule.selectorText, ids);
  }
  if (rule instanceof CSSStyleRule || rule instanceof CSSKeyframeRule) {
    for (const property of Array.from(rule.style)) {
      const value = rule.style.getPropertyValue(property);
      const replacement = namespaceSvgStyleUrls(value, ids);

      if (replacement !== value) {
        rule.style.setProperty(property, replacement, rule.style.getPropertyPriority(property));
      }
    }
  }
  if (rule instanceof CSSGroupingRule || rule instanceof CSSKeyframesRule) {
    for (const child of Array.from(rule.cssRules)) { namespaceRule(child, ids); }
  }
}

/** Keep stylesheets attached to the same elements and paint servers after ID isolation. */
export function namespaceSvgStyles(svg: string, ids: ReadonlyMap<string, string>): string {
  return svg.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_match, opening, content, closing) => {
    const css = String(content);
    const cdata = css.trim().startsWith('<![CDATA[');
    const sheet = new CSSStyleSheet();

    sheet.replaceSync(cdata ? css.trim().slice(9, -3) : css);
    for (const rule of Array.from(sheet.cssRules)) { namespaceRule(rule, ids); }
    const rewritten = Array.from(sheet.cssRules, rule => rule.cssText).join('\n');

    return `${String(opening)}${cdata ? `<![CDATA[${rewritten}]]>` : rewritten}${String(closing)}`;
  });
}
