import { describe, expect, it, vi } from 'vitest';
import {
  DataType, EndBehavior, ItemType, ShapeArcMode, ValueType,
} from '@galacean/effects-specification';
import type { CompositionComponentData, TrackAssetData, TransformPlayableAssetData } from '@galacean/effects-specification';
import { convertGEToIR, convertIRToGE } from '@galacean/ge-ir';
import { convertDSLToIR, convertIRToDSL, type Composition, type DSLParticleSource } from '@galacean/dsl-ir';
import { convertGEToDSL, convertDSLToGE } from '../src/features/dsl-conversion/ge-dsl-workflow';

function createParticleScene(): Record<string, unknown> {
  return {
    version: '3.6',
    playerVersion: { web: '2.8.11' },
    type: 'ge',
    compositionId: 'particle-composition',
    compositions: [{
      id: 'particle-composition',
      name: 'Particle source',
      duration: 2,
      startTime: 0,
      endBehavior: EndBehavior.restart,
      previewSize: [400, 300],
      camera: { fov: 60, position: [0, 0, 8], rotation: [0, 0, 0] },
      components: [{ id: 'particle-runtime' }],
    }],
    items: [{
      id: 'particle-item',
      name: 'Particle',
      type: ItemType.particle,
      duration: 2,
      delay: 0,
      visible: true,
      endBehavior: EndBehavior.restart,
      components: [{ id: 'particle-component' }],
      transform: { position: { x: 0, y: 0, z: 0 } },
      dataType: DataType.VFXItemData,
    }],
    components: [
      {
        id: 'particle-runtime',
        dataType: DataType.CompositionComponent,
        item: { id: 'particle-composition' },
        items: [{ id: 'particle-item' }],
        sceneBindings: [],
      },
      {
        id: 'particle-component',
        dataType: DataType.ParticleSystem,
        item: { id: 'particle-item' },
        options: {
          maxCount: 10,
          startLifetime: [ValueType.CONSTANT, 1],
          startSize: [ValueType.CONSTANT, 0.5],
        },
        renderer: { renderMode: 1, texture: { id: 'particle-texture' } },
        shape: {
          type: 2,
          shape: 'Cone',
          arcMode: ShapeArcMode.RANDOM,
          angle: 25,
          radius: 0.5,
          arc: 360,
        },
        emission: { rateOverTime: [ValueType.CONSTANT, 5] },
      },
    ],
    images: [{ id: 'particle-image', url: 'https://example.com/particle.png' }],
    textures: [{ id: 'particle-texture', dataType: DataType.Texture, source: { id: 'particle-image' } }],
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

function prepareDSL(raw = createParticleScene(), instances = 1) {
  const imported = convertGEToIR(raw, { frameRate: 24 });
  const editable = convertIRToDSL(imported.scene);
  const dsl: Composition = {
    meta: { ...editable.dsl.meta, width: 640, height: 480, fps: 30, duration: 4 },
    layers: [{
      id: 'background', name: 'Background', type: 'layer', width: 640, height: 480,
      position: { a: false, value: [320, 240, 0] }, description: { self: '', composite: '' },
      asset: { source: 'user', url: 'https://example.com/background.png', prompt: '' },
    }],
  };
  const particleSources: DSLParticleSource[] = [];

  for (let index = 0; index < instances; index++) {
    const layers: Record<string, string> = {};

    for (const original of editable.dsl.layers.filter(layer => layer.type === 'particle')) {
      const target = structuredClone(original);

      target.id = `target-${index}-${original.id}`;
      target.width = 200;
      target.height = 150;
      target.position = { a: false, value: [160 + index * 200, 240, index + 1] };
      target.particle.options.maxCount = 77 + index;
      layers[target.id] = original.id;
      dsl.layers.push(target);
    }
    particleSources.push({ preservedData: editable.preservedData, layers });
  }

  return { imported, dsl, particleSources };
}

function exportDSL(prepared: ReturnType<typeof prepareDSL>) {
  const converted = convertDSLToIR(prepared.dsl, { particleSources: prepared.particleSources });
  const exported = convertIRToGE(converted.scene, {
    sources: converted.sourceInstances!.map(instance => ({ ...prepared.imported, idMap: instance.idMap })),
  });

  return { converted, exported };
}

describe('particle spatial adaptation', () => {
  it.each([undefined, 0.3, -1])('looks up original texture URLs and applies a valid fill override %s', fill => {
    const raw = createParticleScene();
    const url = 'https://mdn.alipayobjects.com/mars/afts/file/A*vns5RYqYHccAAAAAStAAAAgAelB4AQ/original';

    raw.images = [{ id: 'particle-image', url: `${url}?version=1` }];
    (raw.components as Record<string, unknown>[])[1].textureSheetAnimation = { col: 5, row: 3, total: 15 };
    const snapshot = structuredClone(raw);
    const prepared = prepareDSL(raw, 2);
    const converted = convertDSLToIR(prepared.dsl, { particleSources: prepared.particleSources });
    const options = { sources: converted.sourceInstances!.map(instance => ({
      ...prepared.imported, idMap: instance.idMap,
      ...(fill === undefined ? {} : { particleTextureFills: { 'particle-component': fill } }),
      ...(fill === -1 ? { sizeCompensation: 0 } : {}),
    })) };
    const result = convertIRToGE(converted.scene, options);
    const fills = result.diagnostics.filter(value => value.code === 'GE_PARTICLE_TEXTURE_FILL');

    expect(fills).toHaveLength(2);
    const useOverride = fill === 0.3;

    for (const diagnostic of fills) {
      expect(diagnostic.message).toContain(`fill ${(useOverride ? fill : 0.140504).toFixed(6)}`);
      expect(diagnostic.message).toContain(`source: ${useOverride ? 'given' : 'table'}`);
    }
    for (const code of ['GE_PARTICLE_TEXTURE_FILL_INVALID', 'GE_PARTICLE_SIZE_COMPENSATION_INVALID']) {
      expect(result.diagnostics.filter(value => value.code === code && value.severity === 'warning'))
        .toHaveLength(fill === -1 ? 2 : 0);
    }
    expect(result.diagnostics.some(value => value.code === 'GE_PARTICLE_TEXTURE_FILL_MISSING')).toBe(false);
    expect(raw).toEqual(snapshot);

    const disabled = convertIRToGE(converted.scene, { sources: options.sources.map(source => ({
      ...source, sizeCompensation: false,
    })) });

    expect(disabled.diagnostics.some(value => value.code.startsWith('GE_PARTICLE_TEXTURE_FILL'))).toBe(false);
  });

  it.each([['near', 15], ['far', -80]] as const)('exports while warning of estimated %s-plane clipping', (plane, speed) => {
    const raw = createParticleScene();
    const system = (raw.components as Record<string, unknown>[])[1];

    system.shape = { type: 6, shape: 'Rectangle', width: 1, height: 1 };
    system.positionOverLifetime = { startSpeed: [ValueType.CONSTANT, speed] };
    const prepared = prepareDSL(raw);
    const target = prepared.dsl.layers.find(layer => layer.type === 'particle')!;

    Reflect.deleteProperty(target, 'name');
    const { converted, exported } = exportDSL(prepared);

    expect(converted.scene.compositions[0].layers.find(layer => layer.type === 'precomp')?.name).toBe(target.id);
    expect(exported.scene.type).toBe('ge');
    expect(exported.scene.items).toContainEqual(expect.objectContaining({ name: 'Background' }));
    expect(exported.scene.components.find(component => component.dataType === DataType.ParticleSystem))
      .toMatchObject({ positionOverLifetime: { startSpeed: [ValueType.CONSTANT, speed] } });
    expect(exported.diagnostics.filter(value => value.code === 'GE_PARTICLE_DEPTH_CLIPPED'))
      .toEqual([expect.objectContaining({ severity: 'warning',
        message: expect.stringMatching(new RegExp(`${plane} plane from about \\d+\\.\\d{3}s`)) })]);
  });

  it.each([0, 1])('uses source camera clipMode %s, uniform static and track scales, and baked world motion', clipMode => {
    const raw = createParticleScene();
    const components = raw.components as Record<string, unknown>[];

    (raw.compositions as Record<string, unknown>[])[0].camera = {
      fov: 45, position: [0, 0, 6], rotation: [0, 0, 0], clipMode,
    };

    components[1].shape = { type: 8, width: 1 };
    components[1].positionOverLifetime = { startSpeed: [0, 4], gravity: [0, -2, 0] };
    const prepared = prepareDSL(raw);
    const result = exportDSL(prepared);
    const wrapperLayer = result.converted.scene.compositions[0].layers.find(layer => layer.type === 'precomp')!;
    const wrapper = result.exported.scene.items.find(item => result.exported.itemLayerIds[item.id] === wrapperLayer.id)!;
    const system = result.exported.scene.components.find(component => component.dataType === DataType.ParticleSystem);
    const sourceRatio = 2 * 6 * Math.tan(Math.PI / 8) / (clipMode === 1 ? 400 : 300);
    const hostRatio = 2 * 8 * Math.tan(Math.PI / 6) / 640;
    const scale = 200 / 400 * hostRatio / sourceRatio;

    expect(wrapper.transform?.scale?.x).toBeCloseTo(scale);
    expect(wrapper.transform?.scale?.y).toBeCloseTo(scale);
    expect(wrapper.transform?.scale?.z).toBeCloseTo(scale);
    const motion = (system as unknown as { positionOverLifetime: { startSpeed: number[]; gravity: number[] } })
      .positionOverLifetime;

    expect(motion.startSpeed[1]).toBeCloseTo(4 * scale);
    expect(motion.gravity[1]).toBeCloseTo(-2 * scale);
    const runtime = result.exported.scene.components.find(component => component.dataType === DataType.CompositionComponent &&
      component.item.id === result.converted.scene.entryCompositionId) as CompositionComponentData;
    const binding = runtime.sceneBindings.find(value => value.value.id === wrapper.id)!;
    const miscs = result.exported.scene.miscs;
    const root = miscs.find(value => value.id === binding.key.id) as TrackAssetData;
    const track = root.children.map(ref => miscs.find(value => value.id === ref.id))
      .find(value => value?.dataType === DataType.TransformTrack) as TrackAssetData;
    const playable = miscs.find(value => value.id === track.clips[0].asset.id) as TransformPlayableAssetData;

    expect(playable.sizeOverLifetime).toEqual({ separateAxes: true, x: [0, 1], y: [0, 1], z: [0, 1] });
    expect(result.exported.diagnostics).toContainEqual(expect.objectContaining({ code: 'GE_PARTICLE_TEXTURE_FILL_MISSING' }));
  });

  it('reports initial-transform estimates when the source emitter is animated', () => {
    const prepared = prepareDSL();
    const converted = convertDSLToIR(prepared.dsl, { particleSources: prepared.particleSources });
    const sourceLayer = converted.scene.compositions[1].layers.find(layer => layer.type === 'particle')!;

    sourceLayer.transform = { ...sourceLayer.transform, rotation: {
      x: { type: 'keyframed', keyframes: [{ frame: 0, value: 0 }, { frame: 24, value: 90 }] },
    } };
    const result = convertIRToGE(converted.scene, {
      sources: converted.sourceInstances!.map(instance => ({ ...prepared.imported, idMap: instance.idMap })),
    });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'GE_PARTICLE_MOTION_APPROXIMATED', message: expect.stringContaining('initial transform'),
    }));
  });
});

function withSecondParticle(linked = false): Record<string, unknown> {
  const raw = createParticleScene();
  const items = raw['items'] as Record<string, unknown>[];
  const components = raw['components'] as Record<string, unknown>[];
  const secondItem = structuredClone(items[0]);
  const secondComponent = structuredClone(components[1]);

  secondItem['id'] = 'second-item';
  secondItem['name'] = 'Second particle';
  secondItem['components'] = [{ id: 'second-component' }];
  secondComponent['id'] = 'second-component';
  secondComponent['item'] = { id: 'second-item' };
  items.push(secondItem);
  components.push(secondComponent);
  (components[0]['items'] as unknown[]).push({ id: 'second-item' });
  if (linked) {
    components[1]['linkedEmitter'] = { id: 'second-component' };
  }

  return raw;
}

describe('complete DSL to IR to GE', () => {
  it.each(['omitted', 'explicit'])('keeps DSL duration with a longer particle source and %s timing', timing => {
    const raw = createParticleScene();

    (raw.compositions as Record<string, unknown>[])[0].duration = 5;
    (raw.items as Record<string, unknown>[])[0].duration = 10;
    const prepared = prepareDSL(raw);
    const particle = prepared.dsl.layers.find(layer => layer.type === 'particle')!;

    if (timing === 'omitted') {
      delete particle.time_range;
    } else {
      particle.time_range = [0, 4];
    }
    const { converted, exported } = exportDSL(prepared);
    const host = converted.scene.compositions.find(value => value.id === converted.scene.entryCompositionId)!;
    const wrapper = host.layers.find(layer => layer.type === 'precomp')!;
    const source = converted.scene.compositions.find(value => value.id === wrapper.content.compositionId)!;

    expect(host.outPoint - host.inPoint).toBe(4 * host.frameRate);
    expect(wrapper.time.outFrame - wrapper.time.inFrame).toBe(4 * host.frameRate);
    expect(source.outPoint - source.inPoint).toBe(5 * source.frameRate);
    expect(exported.scene.compositions.find(value => value.id === exported.scene.compositionId)?.duration).toBe(4);
    expect(exported.scene.items.find(item => item.type === ItemType.composition)?.duration).toBe(4);
    expect(exported.scene.items.find(item => item.type === ItemType.particle)?.duration)
      .toBe(timing === 'omitted' ? 10 : 4);
  });

  it('exports authored image and restored particle layers with the standard GE result', () => {
    const prepared = prepareDSL();
    const snapshot = structuredClone(prepared);
    const { converted, exported } = exportDSL(prepared);

    expect(converted.scene.compositions[0].layers.map(layer => layer.type)).toEqual(['image', 'precomp']);
    expect(exported.scene.components.filter(component => component.dataType === DataType.ParticleSystem))
      .toEqual([expect.objectContaining({
        options: expect.objectContaining({ maxCount: 77 }),
        shape: expect.objectContaining({ angle: 25 }),
      })]);
    expect(exported.scene.images.some(image => image.url === 'https://example.com/background.png')).toBe(true);
    expect(exported.scene.playerVersion.web).toBe('2.11.0-alpha.1');
    expect(() => convertGEToIR(exported.scene as unknown as Record<string, unknown>, { frameRate: 30 })).not.toThrow();
    expect(prepared).toEqual(snapshot);
    expect(Object.keys(exported).sort()).toEqual(['diagnostics', 'itemLayerIds', 'scene']);
  });

  it('isolates duplicate sources, numeric textures and binary array offsets', () => {
    const raw = createParticleScene();

    (raw['textures'] as Record<string, unknown>[])[0]['source'] = 0;
    raw['bins'] = [{ url: 'https://example.com/particle.bin' }];
    (raw['components'] as Record<string, unknown>[])[1]['customBuffer'] = [ValueType.BINARY, [0, 12, 24]];
    const { exported } = exportDSL(prepareDSL(raw, 2));
    const particles = exported.scene.components.filter(component => component.dataType === DataType.ParticleSystem) as
      unknown as Array<{ customBuffer: unknown; renderer: { texture: { id: string } } }>;

    expect(exported.scene.bins).toHaveLength(2);
    expect(particles.map(particle => particle.customBuffer)).toEqual(expect.arrayContaining([
      [ValueType.BINARY, [0, 12, 24]], [ValueType.BINARY, [1, 12, 24]],
    ]));
    for (const particle of particles) {
      const texture = exported.scene.textures?.find(value => value.id === particle.renderer.texture.id);

      if (texture == null || !('source' in texture)) {
        throw new Error('Expected a texture with an image source.');
      }
      expect(texture.source).toEqual({ id: expect.any(String) });
      expect(exported.scene.images.some(image => image.id === (texture.source as { id: string }).id)).toBe(true);
    }
    const ids = [...exported.scene.items, ...exported.scene.components, ...exported.scene.compositions]
      .map(value => value.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places independent systems and preserves group references only for shared placement', () => {
    const grouped = prepareDSL(withSecondParticle(true));
    const { exported } = exportDSL(grouped);
    const particles = exported.scene.components.filter(component => component.dataType === DataType.ParticleSystem) as
      unknown as Array<{ id: string; linkedEmitter?: { id: string } }>;

    expect(particles.some(value => value.id === particles.find(particle => particle.linkedEmitter)?.linkedEmitter?.id))
      .toBe(true);
    const independent = prepareDSL(withSecondParticle());
    const source = independent.particleSources[0];

    independent.particleSources = Object.entries(source.layers).map(([id, sourceId]) => ({
      preservedData: source.preservedData, layers: { [id]: sourceId },
    }));
    const { converted, exported: separate } = exportDSL(independent);

    expect(converted.scene.compositions.slice(1).map(value => value.layers.filter(layer => layer.type === 'particle').length))
      .toEqual([1, 1]);
    expect(separate.scene.components.filter(component => component.dataType === DataType.ParticleSystem)).toHaveLength(2);
    grouped.particleSources = Object.entries(grouped.particleSources[0].layers).map(([id, sourceId]) => ({
      preservedData: grouped.particleSources[0].preservedData, layers: { [id]: sourceId },
    }));

    expect(() => exportDSL(grouped)).toThrow(/shared group placement/);
  });
  it.each([false, true])('retains an auxiliary renderer and its timeline once (independent=%s)', independent => {
    const raw = withSecondParticle();
    const items = raw['items'] as Record<string, unknown>[];
    const components = raw['components'] as Record<string, unknown>[];

    items.push({
      ...structuredClone(items[0]), id: 'sparkle-item', name: 'Sparkle', type: ItemType.sprite,
      components: [{ id: 'sparkle-component' }],
      transform: { position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1 } },
    });
    components.push({
      id: 'sparkle-component', dataType: DataType.SpriteComponent, item: { id: 'sparkle-item' },
      options: { startColor: [1, 1, 1, 1] },
      renderer: { renderMode: 1, texture: { id: 'particle-texture' } },
      splits: [[0, 0, 1, 1, 0]],
    });
    (components[0]['items'] as unknown[]).push({ id: 'sparkle-item' });
    components[0]['timelineAsset'] = { id: 'source-timeline' };
    components[0]['sceneBindings'] = [{ key: { id: 'sparkle-track' }, value: { id: 'sparkle-item' } }];
    raw['miscs'] = [
      { id: 'source-timeline', dataType: DataType.TimelineAsset, tracks: [{ id: 'sparkle-track' }] },
      { id: 'sparkle-track', dataType: DataType.ObjectBindingTrack, children: [{ id: 'sparkle-activation' }] },
      {
        id: 'sparkle-activation', dataType: DataType.ActivationTrack,
        clips: [{ start: 0.25, duration: 1, endBehavior: EndBehavior.destroy }],
      },
    ];
    const prepared = prepareDSL(raw);
    const source = prepared.particleSources[0];

    if (independent) {
      prepared.particleSources = Object.entries(source.layers).map(([id, sourceId]) => ({
        preservedData: source.preservedData, layers: { [id]: sourceId },
      }));
    }
    const { exported } = exportDSL(prepared);
    const restored = convertGEToIR(exported.scene as unknown as Record<string, unknown>, { frameRate: 24 });
    const sparkles = restored.scene.compositions.flatMap(composition => composition.layers)
      .filter(layer => layer.name === 'Sparkle');

    expect(sparkles).toHaveLength(1);
    expect(sparkles[0].type).toBe('image');
    expect(sparkles[0].time.inFrame).toBe(6);
    expect(sparkles[0].time.outFrame).toBe(30);
    expect(exported.scene.components.filter(component => component.dataType === DataType.ParticleSystem)).toHaveLength(2);
  });

  it.each(['nested composition', 'unbound system'])('rejects a source containing an %s', invalidSource => {
    const prepared = prepareDSL();
    const raw = prepared.imported.preservedData.sourceScene!;
    const components = raw['components'] as Record<string, unknown>[];
    let expected: RegExp;

    if (invalidSource === 'nested composition') {
      const items = raw['items'] as Record<string, unknown>[];

      items.push({
        ...structuredClone(items[0]), id: 'nested-item', type: ItemType.composition, components: [],
        content: { options: { refId: 'nested-composition' } },
      });
      (components[0]['items'] as unknown[]).push({ id: 'nested-item' });
      expected = /must be self-contained/;
    } else {
      components.push({ ...structuredClone(components[1]), id: 'unbound-component' });
      expected = /must cover every source ParticleSystem exactly once/;
    }

    expect(() => exportDSL(prepared)).toThrow(expected);
  });

  it('restores ancestors without duplicating their particle systems', () => {
    const raw = withSecondParticle();
    const items = raw['items'] as Record<string, unknown>[];

    items[1]['parentId'] = 'particle-item';
    const prepared = prepareDSL(raw);
    const sourceDSL = convertIRToDSL(prepared.imported.scene);
    const flatten = (layers: Composition['layers']): Composition['layers'] =>
      layers.flatMap(layer => [layer, ...flatten(layer.children ?? [])]);
    const sources = flatten(sourceDSL.dsl.layers).filter(layer => layer.type === 'particle');

    prepared.dsl.layers = sources.map((layer, index) => ({
      ...structuredClone(layer), id: `target-${index}`, parent: null, children: [],
      width: 200, height: 150, position: { a: false, value: [160 + index * 250, 200, 1] },
    }));
    prepared.particleSources = sources.map((layer, index) => ({
      preservedData: sourceDSL.preservedData, layers: { [`target-${index}`]: layer.id },
    }));
    const { converted, exported } = exportDSL(prepared);
    const instances = converted.scene.compositions.slice(1);

    expect(instances.map(value => value.layers.filter(layer => layer.type === 'particle').length)).toEqual([1, 1]);
    expect(instances[1].layers.some(layer => layer.type === 'null')).toBe(true);
    expect(exported.scene.components.filter(component => component.dataType === DataType.ParticleSystem)).toHaveLength(2);
    expect(() => convertGEToIR(exported.scene as unknown as Record<string, unknown>, { frameRate: 30 })).not.toThrow();
  });
});

describe('GE / DSL application workflow', () => {
  it('pairs both sidecars when restoring an edited DSL and retains source shape and spatial data', () => {
    const source = createParticleScene();
    const imported = convertGEToDSL(source, { frameRate: 24 });
    const edited = structuredClone(imported.dsl);
    const particle = edited.layers.find(layer => layer.type === 'particle');

    if (particle?.particle == null) {
      throw new Error('Expected particle DSL.');
    }
    expect(particle.particle.options.startLifetime).toEqual([0, 1]);
    particle.particle.options.startLifetime = [0, 0.3125];
    particle.particle.options.maxCount = 81;
    const onChange = vi.fn();
    const result = convertDSLToGE(edited, { preservedData: imported.preservedData, onChange });
    const component = result.scene.components.find(entry => entry.dataType === DataType.ParticleSystem);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      field: 'particle.options.startLifetime',
      oldValue: { type: 'constant', value: 24 },
      newValue: { type: 'constant', value: 7.5 },
    }));
    expect(component).toMatchObject({
      options: { maxCount: 81, startLifetime: [ValueType.CONSTANT, 0.3125] },
      shape: { shape: 'Cone', radius: 0.5 },
    });
    const item = result.scene.items.find(item => item.type === ItemType.particle && item.name === 'Particle');

    expect(item?.transform?.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(result.preservedData?.ir).toBe(imported.preservedData.ir);
    expect(source).toEqual(createParticleScene());
  });
});
