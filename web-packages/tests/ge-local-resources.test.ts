import { describe, expect, it } from 'vitest';
import { DataType, EndBehavior, ItemType } from '@galacean/effects-specification';
import { prepareIREditing } from '../src/pages/ir-editing/convert-ir-editing';
import { convertGEInputRoundTrip } from '../src/pages/ge2dsl/convert-ge-input-round-trip';

function createSource(url: string) {
  return {
    version: '3.6', type: 'ge', compositionId: 'root',
    compositions: [{
      id: 'root', name: 'Local image', duration: 2, startTime: 0,
      endBehavior: EndBehavior.restart, previewSize: [400, 300],
      components: [{ id: 'composition-component' }],
    }],
    items: [{
      id: 'sprite', name: 'Sprite', type: ItemType.sprite,
      duration: 2, delay: 0, visible: true, endBehavior: EndBehavior.restart,
      components: [{ id: 'sprite-component' }],
      transform: { position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1 } },
    }],
    components: [
      {
        id: 'composition-component', dataType: DataType.CompositionComponent,
        item: { id: 'root' }, items: [{ id: 'sprite' }], sceneBindings: [],
      },
      {
        id: 'sprite-component', dataType: DataType.SpriteComponent, item: { id: 'sprite' },
        renderer: { texture: { id: 'texture' } },
      },
    ],
    images: [{ id: 'image', url }],
    textures: [{ id: 'texture', dataType: DataType.Texture, source: { id: 'image' } }],
    fonts: [], plugins: [], miscs: [],
  };
}

describe('GE local resource imports', () => {
  it.each([
    {
      url: '/tmp/ge-input/bundle/images/sprite.png',
      expected: 'https://workbench.test:8443/tmp/ge-input/bundle/images/sprite.png',
    },
    {
      url: './images/sprite.png',
      expected: 'https://workbench.test:8443/tmp/ge-input/bundle/images/sprite.png',
    },
  ])('resolves $url for IR editing and DSL round trips', ({ url, expected }) => {
    const json = JSON.stringify(createSource(url));
    const baseUrl = 'https://workbench.test:8443/tmp/ge-input/bundle/scene.json';
    const editing = prepareIREditing(json, 30, baseUrl);

    expect(editing.baselineScene.assets).toContainEqual(expect.objectContaining({
      type: 'image', source: { kind: 'url', url: expected },
    }));
    const roundTrip = convertGEInputRoundTrip(json, 30, baseUrl);

    expect(roundTrip.error).toBeNull();
    expect(roundTrip.scene).not.toBeNull();
  });
});
