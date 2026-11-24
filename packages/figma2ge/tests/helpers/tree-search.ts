import type { FigmaIRNode } from '@galacean/figma2ge';

export function findFirstNode(
  node: FigmaIRNode,
  predicate: (candidate: FigmaIRNode) => boolean,
): FigmaIRNode | undefined {
  if (predicate(node)) {
    return node;
  }

  for (const child of node.children) {
    const found = findFirstNode(child, predicate);

    if (found) {
      return found;
    }
  }

  return undefined;
}
