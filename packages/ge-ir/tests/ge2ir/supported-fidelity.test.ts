import { describe, expect, it } from 'vitest';
import { DataType, ItemType } from '@galacean/effects-specification';
import { convertGEToIR, convertIRToGE, updateGEToIRPreservedData } from '../../src';

function createScene() {
  return {
    version: '3.6', type: 'ge', compositionId: 'scene',
    compositions: [{
      id: 'scene', duration: 2, previewSize: [640, 480], components: [{ id: 'runtime' }],
      camera: { fov: 45, position: [0, -2, 12], rotation: [0, 0, 0], near: 0.1, far: 50, clipMode: 0 },
    }],
    items: [{
      id: 'sprite', type: ItemType.sprite, duration: 2, components: [{ id: 'renderer' }],
      transform: { position: { x: 1, y: 2, z: 0 }, size: { x: 2, y: 3 }, scale: { x: 1, y: 1, z: 1 } },
    }],
    components: [{
      id: 'runtime', dataType: DataType.CompositionComponent, item: { id: 'scene' },
      items: [{ id: 'sprite' }], sceneBindings: [
        { key: { id: 'item-track' }, value: { id: 'sprite' } },
        { key: { id: 'component-track' }, value: { id: 'renderer' } },
      ],
    }, {
      id: 'renderer', dataType: DataType.SpriteComponent, item: { id: 'sprite' },
      options: { startColor: [1, 1, 1, 1] },
      renderer: { renderMode: 1, occlusion: true, transparentOcclusion: true, anchor: [0.2, 0.7] },
    }],
    miscs: [
      { id: 'item-track', dataType: DataType.ObjectBindingTrack,
        children: [{ id: 'active' }, { id: 'component-track' }] },
      { id: 'active', dataType: DataType.ActivationTrack, clips: [{ start: 0, duration: 2, endBehavior: 0 }] },
      { id: 'component-track', dataType: DataType.ObjectBindingTrack, children: [{ id: 'color-track' }] },
      { id: 'color-track', dataType: 'ColorPropertyTrack', path: 'color',
        children: [], clips: [{ start: 0.25, duration: 1.5, endBehavior: 4, asset: { id: 'color-asset' } }] },
      { id: 'color-asset', dataType: 'ColorPropertyPlayableAsset', color: [1, 0, 0, 0.5] },
    ],
    images: [], textures: [],
  };
}

describe('supported GE fidelity', () => {
  it('restores the camera and renderer depth settings without mutating the source', () => {
    const source = createScene();
    const baseline = structuredClone(source);
    const imported = convertGEToIR(source, { frameRate: 30 });
    const result = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    expect(result.compositions[0].camera).toEqual(source.compositions[0].camera);
    expect(result.components.find(component => component.id === 'renderer')).toMatchObject({
      renderer: { occlusion: true, transparentOcclusion: true },
    });
    expect(source).toEqual(baseline);
  });

  it('retains geometry resources and reports their invalidation after a bounds edit', () => {
    const source = createScene();

    Object.assign(source.components[1], { geometry: { id: 'quad' } });
    Object.assign(source, { geometries: [{ id: 'quad', dataType: DataType.Geometry, attributes: {} }] });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const result = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    expect(result.components.find(component => component.id === 'renderer')).toMatchObject({
      geometry: { id: 'quad' },
    });
    expect(result.geometries).toContainEqual(expect.objectContaining({ id: 'quad' }));
    const edited = structuredClone(imported.scene);
    const layer = edited.compositions[0].layers[0];
    const changes: string[] = [];

    layer.localBounds!.width += 10;
    const preservedData = updateGEToIRPreservedData(imported.scene, edited, imported.preservedData, {
      onChange: change => changes.push(change.field),
    });
    const updated = convertIRToGE(edited, { preservedData }).scene;

    expect(updated.components.find(component => component.id === 'renderer')).not.toHaveProperty('geometry');
    expect(changes).toContain('geometry');
  });

  it('reconnects component property tracks and their playable assets', () => {
    const imported = convertGEToIR(createScene(), { frameRate: 30 });
    const result = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;
    const runtime = result.components.find(component => component.dataType === DataType.CompositionComponent);

    expect(runtime).toMatchObject({ sceneBindings: expect.arrayContaining([
      { key: { id: 'component-track' }, value: { id: 'renderer' } },
    ]) });
    expect(result.miscs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'color-asset' }),
      expect.objectContaining({ id: 'color-track', clips: [{
        start: 0.25, duration: 1.5, endBehavior: 4, asset: { id: 'color-asset' },
      }] }),
      expect.objectContaining({ children: expect.arrayContaining([{ id: 'component-track' }]) }),
    ]));
  });

  it('invalidates preserved color tracks when normalized opacity is edited', () => {
    const imported = convertGEToIR(createScene(), { frameRate: 30 });
    const edited = structuredClone(imported.scene);
    const layer = edited.compositions[0].layers[0];

    layer.transform = { ...layer.transform, opacity: { type: 'static', value: 0.25 } };
    const preservedData = updateGEToIRPreservedData(imported.scene, edited, imported.preservedData);
    const result = convertIRToGE(edited, { preservedData }).scene;

    expect(result.miscs?.some(misc => misc.id === 'color-track' || misc.id === 'color-asset')).toBe(false);
  });

  it('keeps texture sampling and resolves alternate image URLs until the asset changes', () => {
    const source: Record<string, unknown> = createScene();
    const components = source['components'] as Record<string, unknown>[];

    source['images'] = [{ id: 'image', url: './image.png', webp: './image.webp' }];
    source['textures'] = [{ id: 'texture', source: { id: 'image' }, flipY: false, minFilter: 9728 }];
    components[1]['renderer'] = { texture: { id: 'texture' }, renderMode: 1 };
    const imported = convertGEToIR(source, { frameRate: 30, resourceBaseUrl: 'https://example.com/art/scene.json' });
    const result = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    expect(result.images).toContainEqual(expect.objectContaining({
      url: 'https://example.com/art/image.png', webp: 'https://example.com/art/image.webp',
    }));
    expect(result.textures).toContainEqual(expect.objectContaining({ flipY: false, minFilter: 9728 }));
    const edited = structuredClone(imported.scene);
    const image = edited.assets.find(asset => asset.type === 'image');

    if (image?.type !== 'image') {
      throw new Error('Expected image asset');
    }
    image.source = { kind: 'url', url: 'https://example.com/replacement.png' };
    const preservedData = updateGEToIRPreservedData(imported.scene, edited, imported.preservedData);
    const replacement = convertIRToGE(edited, { preservedData }).scene;

    expect(replacement.images).toContainEqual(expect.objectContaining({ url: 'https://example.com/replacement.png' }));
    expect(replacement.images.some(entry => entry.webp != null)).toBe(false);
  });

  it('retains a looping Item duration independently of its Activation clip', () => {
    const source: Record<string, unknown> = createScene();
    const items = source['items'] as Record<string, unknown>[];

    items[0]['type'] = ItemType.null;
    items[0]['components'] = [];
    items[0]['duration'] = 0.5;
    items[0]['endBehavior'] = 5;
    const imported = convertGEToIR(source, { frameRate: 30 });
    const result = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    expect(result.items.find(item => item.id === 'sprite')).toMatchObject({ duration: 0.5, endBehavior: 5 });
    expect(result.miscs).toContainEqual(expect.objectContaining({
      dataType: DataType.ActivationTrack, clips: [expect.objectContaining({ duration: 2 })],
    }));
    const edited = structuredClone(imported.scene);

    edited.compositions[0].layers[0].time.outFrame = 30;
    const preservedData = updateGEToIRPreservedData(imported.scene, edited, imported.preservedData);
    const updated = convertIRToGE(edited, { preservedData }).scene;

    expect(updated.items.find(item => item.id === 'sprite')?.duration).toBe(1);
  });

  it('preserves the static scale multiplied by a source Transform track', () => {
    const source: Record<string, unknown> = createScene();
    const items = source['items'] as Record<string, unknown>[];
    const transform = items[0]['transform'] as Record<string, unknown>;
    const miscs = source['miscs'] as Record<string, unknown>[];

    transform['scale'] = { x: 2, y: 3, z: 4 };
    (miscs[0]['children'] as { id: string }[]).push({ id: 'transform-track' });
    miscs.push({ id: 'transform-track', dataType: DataType.TransformTrack,
      children: [], clips: [{ start: 0, duration: 2, asset: { id: 'transform-asset' } }] },
    { id: 'transform-asset', dataType: DataType.TransformPlayableAsset, sizeOverLifetime: { size: [0, 2] } });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const result = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    expect(result.items.find(item => item.id === 'sprite')?.transform?.scale).toEqual({ x: 2, y: 3, z: 4 });
    expect(imported.scene.compositions[0].layers[0].transform?.scale).toMatchObject({
      type: 'static', value: [4, 6, 4],
    });
    const edited = structuredClone(imported.scene);
    const layer = edited.compositions[0].layers[0];

    layer.transform = { ...layer.transform, scale: { type: 'static', value: [1, 2, 1] } };
    const preservedData = updateGEToIRPreservedData(imported.scene, edited, imported.preservedData);
    const updated = convertIRToGE(edited, { preservedData }).scene;

    expect(updated.items.find(item => item.id === 'sprite')?.transform?.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(updated.miscs).toContainEqual(expect.objectContaining({
      dataType: DataType.TransformPlayableAsset,
      sizeOverLifetime: expect.objectContaining({ x: [0, 1], y: [0, 2], z: [0, 1] }),
    }));
  });

  it('keeps GE precomposition world coordinates when the canvases have different sizes', () => {
    const source: Record<string, unknown> = createScene();
    const compositions = source['compositions'] as Record<string, unknown>[];
    const items = source['items'] as Record<string, unknown>[];
    const components = source['components'] as Record<string, unknown>[];

    compositions.push({ id: 'nested', duration: 2, previewSize: [320, 240], components: [{ id: 'nested-runtime' }] });
    components.push({ id: 'nested-runtime', dataType: DataType.CompositionComponent, item: { id: 'nested' },
      items: [{ id: 'sprite' }], sceneBindings: [] });
    components[0]['items'] = [{ id: 'precomp' }];
    components[0]['sceneBindings'] = [];
    items.push({ id: 'precomp', type: ItemType.composition, duration: 2, components: [],
      content: { options: { refId: 'nested' } },
      transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const result = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    expect(result.items.find(item => item.id === 'precomp')?.transform?.scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('uses Item timing when its binding track has no Activation clip', () => {
    const source = createScene();

    source.items[0].duration = 2;
    source.miscs[0].children = [];
    const imported = convertGEToIR(source, { frameRate: 30 });
    const result = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    expect(imported.scene.compositions[0].layers[0].time).toMatchObject({ inFrame: 0, outFrame: 60 });
    expect(result.items.find(item => item.id === 'sprite')?.duration).toBe(2);
  });

  it('retains an imported visual parent in its original coordinate space', () => {
    const source = createScene();

    source.items.push({
      ...source.items[0], id: 'child', type: ItemType.null, components: [],
      transform: { position: { x: 0.5, y: -0.5, z: 0 }, size: { x: 1, y: 1 }, scale: { x: 1, y: 1, z: 1 } },
      parentId: 'sprite',
    } as typeof source.items[number]);
    source.components[0].items!.push({ id: 'child' });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const result = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;
    const parent = result.items.find(item => item.id === 'sprite');
    const child = result.items.find(item => item.id === 'child');

    expect(parent?.type).toBe(ItemType.sprite);
    expect(parent?.transform?.position?.x).toBeCloseTo(1, 10);
    expect(child?.parentId).toBe('sprite');
    expect(child?.transform?.position?.x).toBeCloseTo(0.5, 10);
    expect(child?.transform?.position?.y).toBeCloseTo(-0.5, 10);
  });

  it.each(['x', 'y'] as const)('normalizes negative %s size into positive bounds and a reflection', axis => {
    const source = createScene();

    source.items[0].transform.size[axis] *= -1;
    const imported = convertGEToIR(source, { frameRate: 30 });
    const layer = imported.scene.compositions[0].layers[0];

    expect(layer.localBounds!.width).toBeGreaterThan(0);
    expect(layer.localBounds!.height).toBeGreaterThan(0);
    expect(layer.transform?.scale).toMatchObject({
      type: 'static', value: axis === 'x' ? [-1, 1, 1] : [1, -1, 1],
    });
  });
});
