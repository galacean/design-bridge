/** Structural source identity, independent of optional or duplicate SVG IDs. */
export function buildElementTreePath(element: Element): string {
  const indices: number[] = [];
  let current = element;

  while (isElementNode(current.parentNode)) {
    const parent = current.parentNode;

    indices.unshift(Array.from(parent.children).indexOf(current));
    current = parent;
  }

  return indices.join('/');
}

function isElementNode(node: Node | null): node is Element {
  return node?.nodeType === 1;
}
