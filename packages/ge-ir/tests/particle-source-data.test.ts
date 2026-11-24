import { describe, expect, it } from 'vitest';
import { DataType, ItemType, ShapeArcMode, ValueType } from '@galacean/effects-specification';
import { getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import { convertGEToIR, convertIRToGE, type GEToIRPreservedData } from '../src';
import { assertGEToIRPreservedDataMatchesScene } from '../src/preserved-data';

function createParticleScene(): Record<string, unknown> {
  return {
    version: '3.6',
    type: 'ge',
    compositionId: 'composition',
    compositions: [{
      id: 'composition',
      name: 'Particle source',
      duration: 2,
      startTime: 0,
      endBehavior: 5,
      previewSize: [640, 480],
      components: [{ id: 'composition-component' }],
    }],
    items: [{
      id: 'particle-item',
      name: 'Coin burst',
      type: ItemType.particle,
      duration: 2,
      delay: 0,
      visible: true,
      components: [{ id: 'particle-component' }],
      transform: {
        position: { x: 0, y: 0, z: 2 },
      },
    }],
    components: [
      {
        id: 'composition-component',
        dataType: DataType.CompositionComponent,
        item: { id: 'composition' },
        items: [{ id: 'particle-item' }],
        sceneBindings: [],
      },
      {
        id: 'particle-component',
        dataType: DataType.ParticleSystem,
        item: { id: 'particle-item' },
        shape: { type: 2, shape: 'Cone', arcMode: ShapeArcMode.RANDOM, angle: 25, radius: 0.1, arc: 360 },
        options: {
          maxCount: 80,
          startLifetime: [ValueType.CONSTANT, 1.2],
        },
        emission: {
          rateOverTime: [ValueType.CONSTANT, 10],
        },
      },
    ],
    images: [],
    textures: [],
    fonts: [],
    plugins: [],
    geometries: [],
    materials: [],
    shaders: [],
    bins: [],
    animations: [],
    miscs: [],
  };
}

function exportParticleSource(source: Record<string, unknown>) {
  const imported = convertGEToIR(source, { frameRate: 30 });
  const ids = imported.scene.compositions.flatMap(composition => [
    composition.id, ...composition.layers.map(layer => layer.id),
  ]).concat(imported.scene.assets.map(asset => asset.id));

  return convertIRToGE(imported.scene, {
    sources: [{ ...imported, idMap: Object.fromEntries(ids.map(id => [id, id])) }],
  });
}

describe('GE particle source data', () => {
  it('retains reviewed activity bounds and rejects bounds outside the preview', () => {
    const source = createParticleScene();
    const imported = convertGEToIR(source, { frameRate: 30, particleAuthoringBounds: {
      composition: { bounds: [10, 20, 300, 200], source: 'reviewed_multiframe_playback' },
    } });

    expect(imported.preservedData.particleSourceData.particleEffectGroups[0]).toMatchObject({
      authoringBounds: [10, 20, 300, 200], authoringBoundsSource: 'reviewed_multiframe_playback',
    });
    expect(() => convertGEToIR(source, { frameRate: 30, particleAuthoringBounds: {
      composition: { bounds: [10, 20, 640, 480], source: 'authored' },
    } })).toThrow(/inside source preview/);
    Object.assign(imported.preservedData.particleSourceData.particleEffectGroups[0], { authoringBoundsSource: 'guessed' });
    expect(() => assertGEToIRPreservedDataMatchesScene(imported.scene, imported.preservedData))
      .toThrow(/authoringBoundsSource/);
  });

  it('retains composition-owned components and their graphs when exporting a particle source', () => {
    const source = createParticleScene();
    const composition = (source['compositions'] as Record<string, unknown>[])[0];
    const components = source['components'] as Record<string, unknown>[];

    composition['components'] = [{ id: 'composition-component' }, { id: 'animator' }];
    components.push({
      id: 'animator', dataType: DataType.Animator, item: { id: 'composition' }, graphAsset: { id: 'graph' },
    });
    source['miscs'] = [{ id: 'graph', dataType: DataType.AnimationGraphAsset, children: [] }];
    const snapshot = structuredClone(source);
    const output = exportParticleSource(source).scene;
    const animator = output.components.find(component => component.dataType === DataType.Animator);
    const graph = output.miscs.find(object => object.dataType === DataType.AnimationGraphAsset);

    expect(graph).toBeDefined();
    expect(animator).toMatchObject({ item: { id: output.compositionId }, graphAsset: { id: graph?.id } });
    expect(output.compositions[0].components).toContainEqual({ id: animator?.id });
    expect(source).toEqual(snapshot);
  });

  it('exports a particle source when its unused animations collection is omitted', () => {
    const source = createParticleScene();

    delete source['animations'];
    const snapshot = structuredClone(source);
    const exported = exportParticleSource(source);

    expect(exported.scene.components.filter(component => component.dataType === DataType.ParticleSystem))
      .toEqual([expect.objectContaining({
        options: expect.objectContaining({ maxCount: 80 }),
        shape: expect.objectContaining({ angle: 25 }),
      })]);
    expect(exported.scene.animations).toEqual([]);
    expect(source).toEqual(snapshot);
  });

  it.each([null, {}])('rejects a present non-array animations collection (%j)', animations => {
    const source = { ...createParticleScene(), animations };

    expect(() => exportParticleSource(source)).toThrow('GE scene animations must be an array.');
  });

  it.each([-8, 2])('preserves a parented particle position at depth %s', z => {
    const source = createParticleScene();
    const items = source['items'] as Record<string, unknown>[];

    items[0]['parentId'] = 'parent';
    items[0]['transform'] = { position: { x: -3, y: 5, z } };
    items.push({ id: 'parent', name: 'Parent', type: ItemType.null, duration: 2,
      components: [], transform: { position: { x: 1, y: 2, z: 0 } } });
    const components = source['components'] as Record<string, unknown>[];

    (components[0]['items'] as { id: string }[]).push({ id: 'parent' });
    const imported = convertGEToIR(source, { frameRate: 30 });
    const output = convertIRToGE(imported.scene, { preservedData: imported.preservedData });
    const position = output.scene.items.find(item => item.id === 'particle-item')!.transform!.position;

    expect(position.x).toBeCloseTo(-3, 8);
    expect(position.y).toBeCloseTo(5, 8);
    expect(position.z).toBe(z);
  });

  it('stores ParticleSystem source bindings and layout metadata in preserved data', () => {
    const imported = convertGEToIR(createParticleScene(), { frameRate: 30 });
    const particleLayer = getIRSceneEntryComposition(imported.scene).layers[0];

    expect(particleLayer).toMatchObject({
      id: 'particle-item',
      type: 'particle',
      localBounds: { x: 0, y: 0, width: 640, height: 480 },
      transform: { position: { type: 'static', value: [0, 0, 2] } },
    });
    expect(imported.preservedData.particleSourceData).toEqual({
      particleEffectGroups: [{
        id: 'composition',
        irCompositionId: 'composition',
        sourcePreviewSize: [640, 480],
        authoringBounds: [0, 0, 640, 480],
        authoringBoundsSource: 'source_preview',
      }],
      layers: [{
        effectGroupId: 'composition',
        irCompositionId: 'composition',
        irLayerId: 'particle-item',
        sourceOrder: 0,
      }],
    });
  });

  it('ignores optional Item size because it is not a ParticleSystem visual bound', () => {
    const source = createParticleScene();
    const item = (source['items'] as Array<Record<string, unknown>>)[0];

    (item['transform'] as Record<string, unknown>)['size'] = { x: 1, y: 1 };
    const imported = convertGEToIR(source, { frameRate: 30 });

    expect(imported.preservedData.particleSourceData.particleEffectGroups[0]).toMatchObject({
      sourcePreviewSize: [640, 480],
      authoringBounds: [0, 0, 640, 480],
    });
  });

  it('keeps multiple ParticleSystems in one effect group with independent source order', () => {
    const source = createParticleScene();
    const items = source['items'] as Array<Record<string, unknown>>;
    const components = source['components'] as Array<Record<string, unknown>>;
    const compositionComponent = components[0];

    items.push({
      ...items[0],
      id: 'particle-item-2',
      components: [{ id: 'particle-component-2' }],
    });
    compositionComponent['items'] = [{ id: 'particle-item' }, { id: 'particle-item-2' }];
    components.push({
      ...components[1],
      id: 'particle-component-2',
      item: { id: 'particle-item-2' },
    });
    const imported = convertGEToIR(source, { frameRate: 30 });

    expect(imported.preservedData.particleSourceData.particleEffectGroups).toHaveLength(1);
    expect(imported.preservedData.particleSourceData.layers).toMatchObject([
      { effectGroupId: 'composition', irLayerId: 'particle-item', sourceOrder: 0 },
      { effectGroupId: 'composition', irLayerId: 'particle-item-2', sourceOrder: 1 },
    ]);
  });

  it('prioritizes a declared Particle Item ParticleSystem over earlier render components', () => {
    const source = createParticleScene();
    const item = (source['items'] as Array<Record<string, unknown>>)[0];
    const components = source['components'] as Array<Record<string, unknown>>;

    components.push({
      id: 'sprite-component',
      dataType: DataType.SpriteComponent,
      item: { id: 'particle-item' },
      options: { startColor: [1, 1, 1, 1] },
    });
    item['components'] = [{ id: 'sprite-component' }, { id: 'particle-component' }];
    const imported = convertGEToIR(source, { frameRate: 30 });

    expect(getIRSceneEntryComposition(imported.scene).layers[0]).toMatchObject({
      id: 'particle-item',
      type: 'particle',
    });
    expect(imported.preservedData.particleSourceData.layers).toHaveLength(1);
  });

  it('keeps GE import usable when source previewSize cannot support particle layout preparation', () => {
    const source = createParticleScene();
    const composition = (source['compositions'] as Array<Record<string, unknown>>)[0];

    delete composition['previewSize'];
    const imported = convertGEToIR(source, { frameRate: 30 });

    expect(getIRSceneEntryComposition(imported.scene).layers[0]?.type).toBe('particle');
    expect(imported.preservedData.particleSourceData).toEqual({ particleEffectGroups: [], layers: [] });
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({
      code: 'GE_PARTICLE_SOURCE_LAYOUT_UNAVAILABLE',
      action: 'unsupported',
      sourceId: 'composition',
    }));
  });

  it('rejects referenced ParticleSystems that are omitted from Animation IR', () => {
    const source = createParticleScene();
    const item = (source['items'] as Array<Record<string, unknown>>)[0];
    const particleComponent = (source['components'] as Array<Record<string, unknown>>)[1];

    item['type'] = 999;
    particleComponent['options'] = {};

    expect(() => convertGEToIR(source, { frameRate: 30 })).toThrow(
      /ParticleSystem components were not represented in Animation IR: 'particle-component'/,
    );
  });

  it('returns an empty source list when the GE scene has no ParticleSystem', () => {
    const source = createParticleScene();
    const compositionComponent = (source['components'] as Array<Record<string, unknown>>)[0];

    source['items'] = [];
    source['components'] = [{ ...compositionComponent, items: [] }];
    const imported = convertGEToIR(source, { frameRate: 30 });

    expect(imported.preservedData.particleSourceData.particleEffectGroups).toEqual([]);
    expect(imported.preservedData.particleSourceData.layers).toEqual([]);
  });

  it('does not conflate scoped particle IDs that contain slashes', () => {
    const imported = convertGEToIR(createParticleScene(), { frameRate: 30 });
    const composition = imported.scene.compositions[0];
    const particleLayer = composition.layers[0];
    const scene = {
      ...imported.scene,
      entryCompositionId: 'a/b',
      compositions: [{
        ...composition,
        id: 'a/b',
        layers: [{ ...particleLayer, id: 'c' }],
      }, {
        ...composition,
        id: 'a',
        layers: [{ ...particleLayer, id: 'b/c' }],
      }],
    };
    const preservedData: GEToIRPreservedData = {
      version: '1.0.0',
      compositionBindings: {
        'a/b': { sourceCompositionId: 'source-1', sourceItemOrder: [], layerDataById: { c: {} } },
        a: { sourceCompositionId: 'source-2', sourceItemOrder: [], layerDataById: { 'b/c': {} } },
      },
      particleSourceData: {
        particleEffectGroups: [{
          id: 'group-1',
          irCompositionId: 'a/b',
          sourcePreviewSize: [100, 100],
          authoringBounds: [0, 0, 100, 100],
        }, {
          id: 'group-2',
          irCompositionId: 'a',
          sourcePreviewSize: [100, 100],
          authoringBounds: [0, 0, 100, 100],
        }],
        layers: [{
          effectGroupId: 'group-1',
          irCompositionId: 'a/b',
          irLayerId: 'c',
          sourceOrder: 0,
        }, {
          effectGroupId: 'group-2',
          irCompositionId: 'a',
          irLayerId: 'b/c',
          sourceOrder: 0,
        }],
      },
    };

    expect(() => assertGEToIRPreservedDataMatchesScene(scene, preservedData)).not.toThrow();
  });

  it('rejects particle source data that no longer references an IR Particle Layer', () => {
    const imported = convertGEToIR(createParticleScene(), { frameRate: 30 });
    const particleLayer = getIRSceneEntryComposition(imported.scene).layers[0];

    getIRSceneEntryComposition(imported.scene).layers[0] = {
      id: particleLayer.id,
      type: 'null',
      time: particleLayer.time,
      visible: particleLayer.visible,
    };

    expect(() => convertIRToGE(imported.scene, { preservedData: imported.preservedData })).toThrow(
      /does not reference an IR Particle Layer/,
    );
  });
});
