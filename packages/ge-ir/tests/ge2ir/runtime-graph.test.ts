import { describe, expect, it } from 'vitest';
import { DataType } from '@galacean/effects-specification';
import { convertGEToIR, convertIRToGE, updateGEToIRPreservedData } from '../../src';

function createScene() {
  return {
    version: '3.6', type: 'ge', compositionId: 'scene', renderSettings: { postProcessingEnabled: true },
    compositions: [{ id: 'scene', duration: 2, previewSize: [640, 480], components: [{ id: 'runtime' }] }],
    items: [
      { id: 'effect', type: 'effect', duration: 2, components: [{ id: 'effect-component' }],
        transform: { position: { x: 1, y: 2, z: 3 }, scale: { x: 1, y: 1, z: 1 } } },
      { id: 'sprite', type: '1', duration: 2, components: [{ id: 'sprite-component' }, { id: 'ffd' }],
        transform: { position: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2 } } },
    ],
    components: [
      { id: 'runtime', dataType: 'CompositionComponent', item: { id: 'scene' },
        items: [{ id: 'effect' }, { id: 'sprite' }], timelineAsset: { id: 'timeline' }, sceneBindings: [
          { key: { id: 'effect-track' }, value: { id: 'effect' } },
          { key: { id: 'sprite-track' }, value: { id: 'sprite' } },
          { key: { id: 'ffd-track' }, value: { id: 'ffd' } },
        ] },
      { id: 'effect-component', dataType: 'EffectComponent', item: { id: 'effect' },
        geometry: { id: 'geometry' }, materials: [{ id: 'material' }] },
      { id: 'sprite-component', dataType: 'SpriteComponent', item: { id: 'sprite' },
        options: { startColor: [1, 1, 1, 1] }, renderer: {} },
      { id: 'ffd', dataType: 'FFDComponent', item: { id: 'sprite' }, controlPoints: [{ x: 1, y: 2, z: 0 }] },
    ] as Array<{ id: string; dataType: string; item: { id: string }; [key: string]: unknown }>,
    miscs: [
      { id: 'timeline', dataType: 'TimelineAsset', tracks: [{ id: 'effect-track' }, { id: 'sprite-track' }] },
      { id: 'effect-track', dataType: 'ObjectBindingTrack', children: [{ id: 'material-track' }] },
      { id: 'material-track', dataType: 'MaterialTrack', children: [], materials: [{ id: 'material' }] },
      { id: 'sprite-track', dataType: 'ObjectBindingTrack', children: [{ id: 'ffd-track' }] },
      { id: 'ffd-track', dataType: 'ObjectBindingTrack', children: [{ id: 'point-track' }] },
      { id: 'point-track', dataType: 'Vector3PropertyTrack', path: 'controlPoints.0', children: [],
        clips: [{ start: 0, duration: 2, asset: { id: 'point-asset' } }] },
      { id: 'point-asset', dataType: 'Vector3PropertyPlayableAsset', value: { x: 2, y: 3, z: 0 } },
    ] as Array<{
      id: string; dataType: string; children?: { id: string }[]; tracks?: { id: string }[]; [key: string]: unknown;
    }>,
    materials: [{ id: 'material', dataType: 'Material', textures: { color: { id: 'texture' } } }],
    geometries: [{ id: 'geometry', dataType: 'Geometry', attributes: {} }],
    textures: [{ id: 'texture', source: { id: 'image' } }],
    images: [{ id: 'image', url: 'https://example.com/image.png' }],
  };
}

describe('GE runtime graph preservation', () => {
  it('restores Effect objects, materials, nested tracks and painter order alongside editable sprites', () => {
    const source = createScene();
    const baseline = structuredClone(source);
    const imported = convertGEToIR(source, { frameRate: 30 });
    const output = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;
    const runtime = output.components.find(component => component.dataType === DataType.CompositionComponent);

    expect(output.compositions[0].components).toEqual([{ id: runtime?.id }]);
    expect(output.items.find(item => item.id === 'effect')).toMatchObject(source.items[0]);
    expect(output.compositions[0].children).toEqual([{ id: 'effect' }, { id: 'sprite' }]);
    expect(output.components).toContainEqual(source.components[1]);
    expect(output.miscs).toEqual(expect.arrayContaining([source.miscs[1], source.miscs[2]]));
    expect(output.materials).toEqual(source.materials);
    expect(output.textures).toContainEqual(source.textures[0]);
    expect(output).toHaveProperty('renderSettings', source.renderSettings);
    expect(source).toEqual(baseline);
  });

  it('reconnects FFD and its property animation to the regenerated sprite item track', () => {
    const source = createScene();

    source.items[1].components.reverse();
    const imported = convertGEToIR(source, { frameRate: 30 });
    const output = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;
    const runtime = output.components.find(component => component.dataType === DataType.CompositionComponent);
    const bindings = (runtime as unknown as { sceneBindings: { key: { id: string }; value: { id: string } }[] })
      .sceneBindings;
    const spriteTrackId = bindings.find(binding => binding.value.id === 'sprite')!.key.id;

    expect(output.items.find(item => item.id === 'sprite')!.components).toEqual(source.items[1].components);
    expect(bindings).toContainEqual({ key: { id: 'ffd-track' }, value: { id: 'ffd' } });
    expect(output.miscs.find(object => object.id === spriteTrackId)).toMatchObject({
      children: expect.arrayContaining([{ id: 'ffd-track' }]),
    });
    expect(output.miscs).toContainEqual(expect.objectContaining({ id: 'point-asset' }));
  });

  it('does not revive a deleted sprite or its attached FFD', () => {
    const imported = convertGEToIR(createScene(), { frameRate: 30 });
    const edited = structuredClone(imported.scene);

    edited.compositions[0].layers = [];
    const preservedData = updateGEToIRPreservedData(imported.scene, edited, imported.preservedData);
    const output = convertIRToGE(edited, { preservedData }).scene;

    expect(output.items.map(item => item.id)).toEqual(['effect']);
    expect(output.components.some(component => component.id === 'ffd')).toBe(false);
    expect(output.miscs.some(object => object.id === 'point-asset')).toBe(false);
  });

  it.each(['reorder', 'insert'])('keeps editable %s order while retaining the Effect slot', action => {
    const source = createScene();

    source.items.push({ ...source.items[1], id: 'second', components: [{ id: 'second-component' }] });
    source.components.push({ ...source.components[2], id: 'second-component', item: { id: 'second' } });
    source.components[0].items = [{ id: 'sprite' }, { id: 'effect' }, { id: 'second' }];
    (source.components[0].sceneBindings as unknown[]).push({
      key: { id: 'second-track' }, value: { id: 'second' },
    });
    source.miscs[0].tracks = [{ id: 'sprite-track' }, { id: 'effect-track' }, { id: 'second-track' }];
    source.miscs.push({ id: 'second-track', dataType: 'ObjectBindingTrack', children: [] });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const edited = structuredClone(imported.scene);

    if (action === 'reorder') {
      edited.compositions[0].layers.reverse();
    } else {
      edited.compositions[0].layers.splice(1, 0, {
        ...structuredClone(edited.compositions[0].layers[0]), id: 'inserted', name: 'inserted',
      });
    }
    const preservedData = updateGEToIRPreservedData(imported.scene, edited, imported.preservedData);
    const output = convertIRToGE(edited, { preservedData }).scene;
    const runtime = output.components.find(component => component.dataType === DataType.CompositionComponent) as unknown as {
      sceneBindings: { key: { id: string }; value: { id: string } }[]; timelineAsset: { id: string };
    };
    const timeline = output.miscs.find(object => object.id === runtime.timelineAsset.id) as unknown as {
      tracks: { id: string }[];
    };
    const targetByTrack = new Map(runtime.sceneBindings.map(binding => [binding.key.id, binding.value.id]));

    const insertedId = output.items.find(item => item.name === 'inserted')?.id;
    const expected = action === 'reorder' ? ['second', 'effect', 'sprite'] : ['sprite', 'effect', insertedId, 'second'];

    expect(output.compositions[0].children?.map(item => item.id)).toEqual(expected);
    expect(timeline.tracks.map(track => targetByTrack.get(track.id))).toEqual(expected);
  });

  it('restores composition-owned Animator graphs and remaps the composition owner', () => {
    const source = createScene();

    source.compositions[0].components.push({ id: 'animator' });
    source.components.push({ id: 'animator', dataType: 'Animator', item: { id: 'scene' }, graphAsset: { id: 'graph' } });
    source.miscs.push({ id: 'graph', dataType: 'AnimationGraphAsset', children: [] });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const output = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    expect(output.compositions[0].components).toContainEqual({ id: 'animator' });
    expect(output.components).toContainEqual(expect.objectContaining({ id: 'animator',
      item: { id: output.compositionId } }));
    expect(output.miscs).toContainEqual(expect.objectContaining({ id: 'graph' }));
  });

  it('restores a GE 3.7 parent around an editable child and resolves numeric textures and media URLs', () => {
    const source = createScene();

    source.version = '3.7';
    Object.assign(source.compositions[0], { children: [{ id: 'effect' }] });
    Object.assign(source.items[0], { children: [{ id: 'sprite' }] });
    Object.assign(source.textures[0], { source: 0 });
    source.images[0].url = './image.png';
    Object.assign(source.components[1], { video: { id: 'video' } });
    Object.assign(source, { videos: [{ id: 'video', url: './clip.mp4' }] });
    const imported = convertGEToIR(source, { frameRate: 30, resourceBaseUrl: 'https://example.com/assets/scene.json' });
    const output = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    expect(output.compositions[0].children).toEqual([{ id: 'effect' }]);
    expect(output.items.find(item => item.id === 'effect')!.children).toEqual([{ id: 'sprite' }]);
    expect(output.items.find(item => item.id === 'sprite')!.parentId).toBe('effect');
    expect(output.textures).toContainEqual({ id: 'texture', source: { id: 'image' } });
    expect(output.images).toContainEqual({ id: 'image', url: 'https://example.com/assets/image.png' });
    expect(output).toHaveProperty('videos', [{ id: 'video', url: 'https://example.com/assets/clip.mp4' }]);
  });

  it('keeps the depth of editable transform parents in a 3D hierarchy', () => {
    const source = createScene();

    source.items[0].type = '3';
    source.items[0].components = [];
    Object.assign(source.items[1], { parentId: 'effect' });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const output = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    const position = output.items.find(item => item.id === 'effect')!.transform!.position;

    expect(position.x).toBeCloseTo(1);
    expect(position.y).toBeCloseTo(2);
    expect(position.z).toBe(3);
  });

  it.each([-4, 4, 12])('keeps scaled off-center sprites in place at depth %s', z => {
    const source = createScene();
    const position = { x: 1, y: -2, z };

    Object.assign(source.items[1].transform, { position, scale: { x: 0.7, y: 0.6, z: 1 } });
    source.components[2].renderer = { anchor: [0.9, 0.8] };
    const imported = convertGEToIR(source, { frameRate: 30 });
    const output = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;
    const actual = output.items.find(item => item.id === 'sprite')!.transform!.position;

    expect(actual.x).toBeCloseTo(position.x);
    expect(actual.y).toBeCloseTo(position.y);
    expect(actual.z).toBe(position.z);
  });

  it('retains additive linear motion without a position path and invalidates it after a position edit', () => {
    const source = createScene();
    const positionOverLifetime = { linearX: [0, 1.5], linearY: [0, -2], asMovement: true };

    source.miscs[3].children!.push({ id: 'transform-track' });
    source.miscs.push({ id: 'transform-track', dataType: 'TransformTrack', children: [],
      clips: [{ start: 0, duration: 2, asset: { id: 'transform-asset' } }] });
    source.miscs.push({ id: 'transform-asset', dataType: 'TransformPlayableAsset', children: [] });
    Object.assign(source.miscs.at(-1)!, { positionOverLifetime });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const output = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    expect(output.miscs).toContainEqual(expect.objectContaining({
      dataType: 'TransformPlayableAsset', positionOverLifetime,
    }));

    const edited = structuredClone(imported.scene);

    edited.compositions[0].layers[0].transform = { position: { type: 'static', value: [200, 100, 0] } };
    const preservedData = updateGEToIRPreservedData(imported.scene, edited, imported.preservedData);
    const updated = convertIRToGE(edited, { preservedData }).scene;

    expect(updated.miscs).not.toContainEqual(expect.objectContaining({ positionOverLifetime }));
  });

  it('does not attach FFD after changing the editable layer type', () => {
    const imported = convertGEToIR(createScene(), { frameRate: 30 });
    const edited = structuredClone(imported.scene);
    const original = edited.compositions[0].layers[0];

    edited.compositions[0].layers[0] = { id: original.id, type: 'null', time: original.time, visible: true };
    const preservedData = updateGEToIRPreservedData(imported.scene, edited, imported.preservedData);
    const output = convertIRToGE(edited, { preservedData }).scene;

    expect(output.components.some(component => component.id === 'ffd')).toBe(false);
  });

  it('remaps GE-only graphs independently for generated composition variants', () => {
    const source = createScene();

    source.compositionId = 'root';
    source.compositions.push({ id: 'root', duration: 2, previewSize: [640, 480], components: [{ id: 'root-runtime' }] });
    source.components.push({ id: 'root-runtime', dataType: 'CompositionComponent', item: { id: 'root' },
      items: [{ id: 'first-instance' }, { id: 'second-instance' }] });
    for (const id of ['first-instance', 'second-instance']) {
      const item = { ...source.items[0], id, type: '7', components: [] };

      Object.assign(item, { content: { options: { refId: 'scene' } } });
      source.items.push(item);
    }
    const imported = convertGEToIR(source, { frameRate: 30 });
    const root = imported.scene.compositions.find(composition => composition.id === imported.scene.entryCompositionId)!;

    root.layers.forEach(layer => {
      layer.transform = { opacity: { type: 'static', value: 0.5 } };
    });
    const output = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;
    const effects = output.components.filter(component => component.dataType === DataType.EffectComponent);
    const ffds = output.components.filter(component => component.dataType === DataType.FFDComponent);

    expect(effects).toHaveLength(2);
    expect(ffds).toHaveLength(2);
    expect(output.materials).toEqual(source.materials);
    for (const effect of effects) {
      expect(effect).toMatchObject({ materials: [{ id: 'material' }] });
    }
    expect(new Set(output.items.map(item => item.id)).size).toBe(output.items.length);
    for (const component of [...effects, ...ffds]) {
      const owner = output.items.find(item => item.id === component.item.id)!;

      expect(owner.components).toContainEqual({ id: component.id });
    }
  });

  it('does not restore an unreachable composition after its IR binding is removed', () => {
    const source = createScene();

    source.compositions.push({ id: 'unused', duration: 2, previewSize: [640, 480], components: [{ id: 'unused-runtime' }] });
    source.components.push({ ...source.components[0], id: 'unused-runtime', item: { id: 'unused' },
      items: [{ id: 'unused-effect' }], sceneBindings: [] });
    source.items.push({ ...source.items[0], id: 'unused-effect', components: [{ id: 'unused-component' }] });
    source.components.push({ ...source.components[1], id: 'unused-component', item: { id: 'unused-effect' } });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const edited = structuredClone(imported.scene);

    edited.compositions = edited.compositions.filter(composition => composition.id === edited.entryCompositionId);
    const preservedData = updateGEToIRPreservedData(imported.scene, edited, imported.preservedData);
    const output = convertIRToGE(edited, { preservedData }).scene;

    expect(output.compositions).toHaveLength(1);
    expect(output.items.some(item => item.id === 'unused-effect')).toBe(false);
    expect(output.components.some(component => component.id === 'unused-component')).toBe(false);
  });

  it('keeps a GE precomp as the transform parent of its original children', () => {
    const source = createScene();

    source.items[0].type = '7';
    source.items[0].components = [];
    Object.assign(source.items[0], { content: { options: { refId: 'nested' } } });
    Object.assign(source.items[1], { parentId: 'effect' });
    source.compositions.push({ id: 'nested', duration: 2, previewSize: [640, 480], components: [] });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const output = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    expect(output.items.find(item => item.id === 'sprite')!.parentId).toBe('effect');
    expect(output.items.find(item => item.id === 'effect')!.type).toBe('7');
    expect(output.items).toHaveLength(2);
  });

  it('keeps a GE visual parent ending before its longer-lived child', () => {
    const source = createScene();
    const child = { ...source.items[1], id: 'child', components: [{ id: 'child-component' }] };

    Object.assign(child, { parentId: 'sprite' });
    source.items.push(child);
    source.items[1].duration = 1;
    source.components.push({ ...source.components[2], id: 'child-component', item: { id: 'child' } });
    (source.components[0].items as unknown[]).push({ id: 'child' });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const output = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    expect(output.items.find(item => item.id === 'sprite')!.duration).toBe(1);
    expect(output.items.find(item => item.id === 'child')!.duration).toBe(2);
  });

  it.each(['MeshComponent', 'SkyboxComponent', 'LightComponent', 'CameraController', 'PostProcessVolume',
    'VideoComponent', 'InteractComponent'])('retains %s with its resources', dataType => {
    const source = createScene();

    source.components[1].dataType = dataType;
    Object.assign(source.components[1], { video: { id: 'video' } });
    Object.assign(source, { videos: [{ id: 'video', url: 'https://example.com/video.mp4' }] });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const output = convertIRToGE(imported.scene, { preservedData: imported.preservedData }).scene;

    expect(output.components).toContainEqual(source.components[1]);
    expect(output).toHaveProperty('videos', [{ id: 'video', url: 'https://example.com/video.mp4' }]);
  });
});
