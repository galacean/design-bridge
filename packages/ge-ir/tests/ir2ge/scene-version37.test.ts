import { describe, expect, it } from 'vitest';
import { IREndBehavior, type IRComposition } from '@galacean/animation-ir';
import { createIRScene } from '@galacean/animation-ir/adapter';
import { DataType, ItemType, TextSizeMode } from '@galacean/effects-specification';
import { convertGEToIR, convertIRToGE } from '../../src';
import { get2dTo3dRatio } from '../../src/common/coordinate-mapping';

function createTextScene() {
  const composition: IRComposition = {
    id: 'root', name: 'Text', width: 720, height: 480, frameRate: 30,
    inPoint: 0, outPoint: 90, endBehavior: IREndBehavior.Loop,
    layers: [{
      id: 'parent', name: 'Parent', type: 'null', visible: true, time: { inFrame: 0, outFrame: 90 },
    }, {
      id: 'text', name: 'Title', type: 'text', visible: true, parentId: 'parent', time: { inFrame: 0, outFrame: 90 },
      localBounds: { x: 0, y: 0, width: 200, height: 40 },
      content: {
        text: 'GE 3.7', fontAssetId: 'font', fontSize: 24, lineHeight: 30,
        letterSpacing: 0, textAlign: 'left', color: [1, 1, 1, 1],
      },
    }],
  };

  return createIRScene(composition, [{
    id: 'font', type: 'font', family: 'Arial', style: 'normal', weight: 400, source: { kind: 'system' },
  }]);
}

describe('GE 3.7 scene export', () => {
  it('writes a child hierarchy instead of a flat CompositionComponent item list', () => {
    const { scene } = convertIRToGE(createTextScene());
    const parent = scene.items.find(item => item.name === 'Parent')!;
    const text = scene.items.find(item => item.name === 'Title')!;
    const component = scene.components.find(value => value.dataType === DataType.CompositionComponent)!;

    expect(scene.version).toBe('3.7');
    expect(scene.compositions[0].children).toEqual([{ id: parent.id }]);
    expect(parent.children).toEqual([{ id: text.id }]);
    expect(text.children).toEqual([]);
    expect(component).not.toHaveProperty('items');
    expect(text.parentId).toBe(parent.id);
  });

  it('separates text scale from glyph dimensions and uses autoResize', () => {
    const { scene } = convertIRToGE(createTextScene());
    const text = scene.items.find(item => item.type === ItemType.text)!;
    const scale = get2dTo3dRatio(720, 480) / 0.0123;
    const component = scene.components.find(value => value.dataType === DataType.TextComponent)!;

    expect(text.transform?.scale.x).toBeCloseTo(scale, 4);
    expect(text.transform?.scale.y).toBeCloseTo(scale, 4);
    expect(text.transform?.scale.z).toBeCloseTo(scale, 4);
    expect(text.transform?.size).toEqual({ x: 200 * 0.0123, y: 40 * 0.0123 });
    expect(component).toMatchObject({ options: { autoResize: TextSizeMode.fixed } });
    expect(component).not.toHaveProperty('options.autoWidth');
    expect(component).not.toHaveProperty('options.autoHeight');
  });

  it('imports exported children without losing layers or applying text scale twice', () => {
    const { scene } = convertIRToGE(createTextScene());

    for (const item of scene.items) {
      delete item.parentId;
    }
    const imported = convertGEToIR(JSON.parse(JSON.stringify(scene)), { frameRate: 30 });
    const exported = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;
    const before = scene.items.find(item => item.type === ItemType.text)!;
    const after = exported.items.find(item => item.type === ItemType.text)!;

    expect(imported.scene.compositions[0].layers).toHaveLength(2);
    expect(after.transform?.scale).toEqual(before.transform?.scale);
    expect(after.transform?.size).toEqual(before.transform?.size);
    expect(after.parentId).toBeDefined();
  });

  it('retains near-unit text scaling introduced by world-width precision', () => {
    const document = createTextScene();

    document.compositions[0].layers[1].transform = { scale: { type: 'static', value: [1.00001, 1.00001, 1] } };
    const { scene } = convertIRToGE(document);
    const transformAssets = scene.miscs.filter(value => value.dataType === DataType.TransformPlayableAsset);

    expect(transformAssets).toContainEqual(expect.objectContaining({
      sizeOverLifetime: expect.objectContaining({ x: [0, 1.00001], y: [0, 1.00001] }),
    }));
  });
});
