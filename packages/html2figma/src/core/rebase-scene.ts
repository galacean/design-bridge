import type { SceneNode } from '../types';

export interface SceneBoundsOrigin {
  minX: number;
  minY: number;
}

export function rebaseScene(scene: SceneNode): SceneBoundsOrigin {
  const origin = { minX: Infinity, minY: Infinity };

  function scan(node: SceneNode): void {
    origin.minX = Math.min(origin.minX, node.x);
    origin.minY = Math.min(origin.minY, node.y);
    node.children.forEach(scan);
  }

  scan(scene);

  if (!Number.isFinite(origin.minX) || !Number.isFinite(origin.minY)) {
    return { minX: 0, minY: 0 };
  }

  function rebase(node: SceneNode): void {
    node.x -= origin.minX;
    node.y -= origin.minY;
    node.children.forEach(rebase);
  }

  rebase(scene);

  return origin;
}
