import { describe, expect, it } from 'vitest';
import { DataType, ItemType } from '@galacean/effects-specification';
import { convertGEToIR, convertIRToGE } from '../../src';

function maskedScene(version: string, inverted: boolean) {
  return {
    version, compositionId: 'root', images: [{ id: 'image', url: 'https://example.com/image.png' }],
    textures: [{ id: 'texture', source: { id: 'image' } }], miscs: [], animations: [],
    compositions: [{ id: 'root', duration: 1, previewSize: [100, 100],
      components: [{ id: 'composition' }],
      ...(version === '3.7' && { children: [{ id: 'source' }, { id: 'target' }] }) }],
    items: ['source', 'target'].map(id => ({
      id, name: id, type: ItemType.sprite, delay: 0, duration: 1,
      components: [{ id: `${id}-component` }],
      transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, size: { x: 1, y: 1 } },
    })),
    components: [{ id: 'composition', dataType: DataType.CompositionComponent, item: { id: 'root' },
      items: [{ id: 'source' }, { id: 'target' }], sceneBindings: [] },
    { id: 'source-component', dataType: DataType.SpriteComponent, item: { id: 'source' },
      renderer: { texture: { id: 'texture' } }, options: { startColor: [1, 1, 1, 1] },
      mask: { isMask: true, alphaMaskEnabled: true } },
    { id: 'target-component', dataType: DataType.SpriteComponent, item: { id: 'target' },
      renderer: { texture: { id: 'texture' } }, options: { startColor: [1, 1, 1, 1] },
      mask: { reference: { id: 'source-component' }, inverted } }],
  };
}

describe('GE legacy mask compatibility', () => {
  it.each([
    ['3.6', false], ['3.6', true], ['3.7', false], ['3.7', true],
  ] as const)('preserves legacy %s mask references (inverted=%s) without mutating input', (version, inverted) => {
    const source = maskedScene(version, inverted);
    const snapshot = structuredClone(source);
    const imported = convertGEToIR(source, { frameRate: 30 });
    const exported = convertIRToGE(imported.scene, { preservedData: imported.preservedData });
    const target = exported.scene.components.find(component => component.id === 'target-component');

    expect(target).toMatchObject({ mask: {
      references: [{ mask: { id: 'source-component' }, inverted }],
    } });
    expect(target).not.toHaveProperty('mask.reference');
    expect(imported.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'GE_MASK_UNSUPPORTED' }));
    const repeated = convertGEToIR(source, { frameRate: 30 });
    const repeatedExport = convertIRToGE(repeated.scene, { preservedData: repeated.preservedData });
    const reimported = convertGEToIR(JSON.parse(JSON.stringify(exported.scene)), { frameRate: 30 });
    const secondExport = convertIRToGE(reimported.scene, { preservedData: reimported.preservedData });

    for (const output of [repeatedExport, secondExport]) {
      expect(output.scene.components.find(component => component.id === 'target-component'))
        .toHaveProperty('mask.references', [{ mask: { id: 'source-component' }, inverted }]);
    }
    expect(source).toEqual(snapshot);
  });

  it.each([
    { references: [] }, { references: [{ mask: { id: 'source-component' }, inverted: false }] },
  ])('keeps existing references authoritative ($references)', ({ references }) => {
    const source = maskedScene('3.7', true);
    const target = source.components.find(component => component.id === 'target-component')!;

    Object.assign(target, { mask: { ...target.mask, references } });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const exported = convertIRToGE(imported.scene, { preservedData: imported.preservedData });
    const output = exported.scene.components.find(component => component.id === 'target-component');

    if (references.length === 0) {
      expect(output).not.toHaveProperty('mask');
    } else {
      expect(output).toMatchObject({ mask: { references } });
    }
  });

  it('defaults missing inversion to false and retains alpha-mask options', () => {
    const source = maskedScene('3.6', false);
    const target = source.components.find(component => component.id === 'target-component')!;

    Object.assign(target, { mask: { reference: { id: 'source-component' }, alphaMaskEnabled: true } });
    const snapshot = structuredClone(source);
    const imported = convertGEToIR(source, { frameRate: 30 });
    const exported = convertIRToGE(imported.scene, { preservedData: imported.preservedData });

    expect(exported.scene.components.find(component => component.id === 'target-component')).toMatchObject({
      mask: { alphaMaskEnabled: true, references: [{ mask: { id: 'source-component' }, inverted: false }] },
    });
    expect(source).toEqual(snapshot);
  });
});
