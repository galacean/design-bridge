/** 读取 SVG presentation attribute，inline style 的同名属性优先。 */
export function readPresentationAttribute(
  node: { getAttribute?: (name: string) => string | null } | null | undefined,
  attributeName: string,
): string | null {
  if (node == null) { return null; }
  const inlineValue = readInlineStyleProperty(node.getAttribute?.('style') ?? null, attributeName);

  return inlineValue ?? node.getAttribute?.(attributeName) ?? null;
}

export function readInlineStyleProperty(style: string | null, propertyName: string): string | null {
  if (style == null || style.trim() === '') { return null; }
  const expectedName = propertyName.toLowerCase();
  let resolvedValue: string | null = null;

  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');

    if (separator < 0) { continue; }
    const name = declaration.slice(0, separator).trim().toLowerCase();

    if (name !== expectedName) { continue; }
    const value = declaration.slice(separator + 1).trim().replace(/\s*!important\s*$/i, '');

    resolvedValue = value === '' ? null : value;
  }

  return resolvedValue;
}
