import { describe, expect, it } from 'vitest';
import { DataType, ItemType, TextSizeMode, type TransformPlayableAssetData, ValueType } from '@galacean/effects-specification';
import { convertGEToIR, convertIRToGE } from '../../src';

describe('GE text sizing defaults', () => {
  it.each([true, false])('ignores legacy autoWidth=%s when autoResize is absent', autoWidth => {
    const source = {
      version: '3.6', type: 'ge', compositionId: 'scene',
      compositions: [{ id: 'scene', duration: 2, previewSize: [640, 480], components: [{ id: 'runtime' }] }],
      items: [{
        id: 'text', name: 'Title', type: ItemType.text, duration: 2,
        components: [{ id: 'text-component' }],
        transform: {
          position: { x: 1, y: 1, z: 0 }, scale: { x: 2, y: 0.5, z: 1 },
          size: { x: 2, y: 0.5 },
        },
      }],
      components: [{
        id: 'runtime', dataType: DataType.CompositionComponent, item: { id: 'scene' },
        items: [{ id: 'text' }], sceneBindings: [],
      }, {
        id: 'text-component', dataType: DataType.TextComponent, item: { id: 'text' },
        options: {
          text: 'Speed', fontFamily: 'Arial', fontSize: 50, fontWeight: 'normal',
          textColor: [1, 0, 0, 1], textWidth: 200, textHeight: 50, autoWidth,
        },
        renderer: { renderMode: 1, anchor: [0, 0.5] },
      }],
      images: [], textures: [], miscs: [],
    };
    const imported = convertGEToIR(source, { frameRate: 30 });
    const restored = convertIRToGE(imported.scene, { preservedData: imported.preservedData });
    const item = restored.scene.items.find(entry => entry.id === 'text');

    expect(item?.transform?.size?.x).toBeCloseTo(200 * 0.0123, 4);
    expect(item?.transform?.size?.y).toBeCloseTo(50 * 0.0123, 4);
    const scaleAsset = restored.scene.miscs?.find(misc =>
      misc.dataType === DataType.TransformPlayableAsset) as TransformPlayableAssetData;
    const scale = scaleAsset.sizeOverLifetime?.x;

    if (scale?.[0] !== ValueType.CONSTANT) {
      throw new Error('Expected constant glyph scale');
    }
    expect(item!.transform!.scale.x * scale[1] * 0.0123).toBeCloseTo(2 / 200, 10);
    expect(imported.scene.compositions[0].layers[0].localBounds).toMatchObject({ width: 200, height: 50 });
    const text = restored.scene.components.find(component => component.id === 'text-component');

    expect(text).toMatchObject({ options: { autoResize: TextSizeMode.fixed } });
  });
});
