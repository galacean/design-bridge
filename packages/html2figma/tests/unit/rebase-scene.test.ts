import { describe, expect, it } from 'vitest';
import { rebaseScene } from '../../src/core/rebase-scene';
import { makeSceneNode } from '../helpers/scene-factories';

describe('rebaseScene', () => {
  it('moves the complete scene tree to a zero-based origin', () => {
    const scene = makeSceneNode({
      x: -12,
      y: 8,
      children: [
        makeSceneNode({ x: 20, y: -6 }),
        makeSceneNode({ x: 4, y: 24 }),
      ],
    });

    const origin = rebaseScene(scene);

    expect(origin).toEqual({ minX: -12, minY: -6 });
    expect(scene).toMatchObject({ x: 0, y: 14 });
    expect(scene.children[0]).toMatchObject({ x: 32, y: 0 });
    expect(scene.children[1]).toMatchObject({ x: 16, y: 30 });
  });
});
