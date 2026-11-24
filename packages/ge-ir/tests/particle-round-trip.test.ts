import { describe, expect, it } from 'vitest';
import type { IRComposition, IRParticleLayer } from '@galacean/animation-ir';
import { IRBlendMode } from '@galacean/animation-ir';
import { createIRScene, getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import { assertIRScene } from '@galacean/animation-ir/validator';
import {
  BezierKeyframeType, BlendingMode, DataType, EndBehavior, ItemType, ValueType,
} from '@galacean/effects-specification';
import { convertGEToIR, convertIRToGE, updateGEToIRPreservedData } from '../src';

function createParticleGEScene(): Record<string, unknown> {
  return {
    version: '3.6',
    type: 'ge',
    compositionId: 'composition',
    compositions: [{
      id: 'composition',
      name: 'Particle test',
      duration: 2,
      startTime: 0,
      endBehavior: 5,
      previewSize: [400, 300],
      components: [{ id: 'composition-component' }],
    }],
    items: [{
      id: 'particle-item',
      name: 'Particle',
      type: ItemType.particle,
      duration: 2,
      delay: 0,
      visible: true,
      endBehavior: 0,
      components: [{ id: 'particle-component' }],
      transform: { position: { x: 0, y: 0, z: 0 } },
    }],
    components: [
      {
        id: 'composition-component',
        dataType: DataType.CompositionComponent,
        item: { id: 'composition' },
        items: [{ id: 'particle-item' }],
        sceneBindings: [{ key: { id: 'particle-object-track' }, value: { id: 'particle-item' } }],
      },
      {
        id: 'particle-component',
        dataType: DataType.ParticleSystem,
        item: { id: 'particle-item' },
        options: {
          maxCount: 100,
          startLifetime: [ValueType.LINE, [[0, 1], [1, 2]]],
          startSize: [ValueType.CONSTANT, 0.5],
        },
        renderer: {
          renderMode: 1,
          texture: { id: 'particle-texture' },
        },
        shape: { type: 1, radius: 0.5, arc: 360 },
        emission: {
          rateOverTime: [
            ValueType.BEZIER_CURVE,
            [
              [BezierKeyframeType.EASE_OUT, [0, 10, 0.3, 15]],
              [BezierKeyframeType.EASE_IN, [0.7, 15, 1, 20]],
            ],
          ],
          bursts: [{ time: '0.5', count: '20', cycles: '2', interval: '0.2' }],
          burstOffsets: [{ index: 0, x: 1, y: 2, z: 3 }],
        },
        positionOverLifetime: { startSpeed: [ValueType.CONSTANT, 2] },
      },
    ],
    images: [{ id: 'particle-image', url: 'https://example.com/particle.png' }],
    textures: [{
      id: 'particle-texture',
      dataType: DataType.Texture,
      source: { id: 'particle-image' },
      flipY: true,
    }],
    fonts: [],
    plugins: [],
    geometries: [],
    materials: [],
    shaders: [],
    bins: [],
    animations: [],
    miscs: [
      {
        id: 'particle-object-track',
        dataType: DataType.ObjectBindingTrack,
        children: [{ id: 'particle-activation-track' }],
      },
      {
        id: 'particle-activation-track',
        dataType: DataType.ActivationTrack,
        clips: [{ start: 0, duration: 2, endBehavior: EndBehavior.restart }],
      },
    ],
  };
}

function findParticleComponent(scene: Record<string, unknown>): Record<string, unknown> {
  const components = scene['components'] as Array<Record<string, unknown>>;
  const component = components.find(candidate => candidate['dataType'] === DataType.ParticleSystem);

  if (component == null) {
    throw new Error('Expected a generated ParticleSystem component.');
  }

  return component;
}

describe('particle GE preservation', () => {
  it.each([
    ['deletion', (bursts: IRParticleLayer['content']['emission']['bursts']) => bursts?.slice(1)],
    ['insertion', (bursts: IRParticleLayer['content']['emission']['bursts']) => [
      ...(bursts ?? []),
      { frameOffset: 45, count: 5, cycleCount: 1, repeatIntervalFrames: 0 },
    ]],
    ['reordering', (bursts: IRParticleLayer['content']['emission']['bursts']) => [...(bursts ?? [])].reverse()],
  ])('removes GE burstOffsets after Burst %s', (_operation, editBursts) => {
    const sourceScene = createParticleGEScene();
    const sourceComponent = findParticleComponent(sourceScene);
    const sourceEmission = sourceComponent['emission'] as Record<string, unknown>;

    sourceEmission['bursts'] = [
      { time: 0.25, count: 10, cycles: 1, interval: 0 },
      { time: 1, count: 20, cycles: 1, interval: 0 },
    ];
    sourceEmission['burstOffsets'] = [
      { index: 0, x: 1, y: 2, z: 3 },
      { index: 1, x: 4, y: 5, z: 6 },
    ];

    const imported = convertGEToIR(sourceScene, { frameRate: 30 });
    const updatedScene = structuredClone(imported.scene);
    const particle = getIRSceneEntryComposition(updatedScene).layers[0];

    if (particle.type !== 'particle') {
      throw new Error('Expected a particle IR layer.');
    }
    particle.content.emission.bursts = editBursts(particle.content.emission.bursts);

    const invalidations: string[] = [];
    const updatedPreservedData = updateGEToIRPreservedData(
      imported.scene,
      updatedScene,
      imported.preservedData,
      { onChange: change => invalidations.push(change.field) },
    );
    const exported = convertIRToGE(updatedScene, { preservedData: updatedPreservedData });
    const emission = findParticleComponent(exported.scene as unknown as Record<string, unknown>)['emission'] as
      Record<string, unknown>;

    expect(emission['burstOffsets']).toBeUndefined();
    expect(invalidations).toContain('particleContent.emission.burstOffsets');
  });

  it('keeps GE burstOffsets when Burst values change at the same array indices', () => {
    const imported = convertGEToIR(createParticleGEScene(), { frameRate: 30 });
    const updatedScene = structuredClone(imported.scene);
    const particle = getIRSceneEntryComposition(updatedScene).layers[0];

    if (particle.type !== 'particle') {
      throw new Error('Expected a particle IR layer.');
    }
    particle.content.emission.bursts = [{
      frameOffset: 30,
      count: 12,
      cycleCount: 1,
      repeatIntervalFrames: 0,
    }];

    const updatedPreservedData = updateGEToIRPreservedData(
      imported.scene,
      updatedScene,
      imported.preservedData,
    );
    const exported = convertIRToGE(updatedScene, { preservedData: updatedPreservedData });
    const emission = findParticleComponent(exported.scene as unknown as Record<string, unknown>)['emission'] as
      Record<string, unknown>;

    expect(emission['burstOffsets']).toEqual([{ index: 0, x: 1, y: 2, z: 3 }]);
  });

  it('does not export out-of-range GE burstOffsets when the preserved sidecar was not reconciled', () => {
    const imported = convertGEToIR(createParticleGEScene(), { frameRate: 30 });
    const particle = getIRSceneEntryComposition(imported.scene).layers[0];

    if (particle.type !== 'particle') {
      throw new Error('Expected a particle IR layer.');
    }
    delete particle.content.emission.bursts;

    const exported = convertIRToGE(imported.scene, { preservedData: imported.preservedData });
    const emission = findParticleComponent(exported.scene as unknown as Record<string, unknown>)['emission'] as
      Record<string, unknown>;

    expect(emission['bursts']).toBeUndefined();
    expect(emission['burstOffsets']).toBeUndefined();
  });

  it('normalizes editable fields, including legacy numeric burst strings, and preserves trusted payload', () => {
    const imported = convertGEToIR(createParticleGEScene(), { frameRate: 30 });

    assertIRScene(imported.scene);
    expect(imported.preservedData.sourceScene).toBeDefined();

    const particle = getIRSceneEntryComposition(imported.scene).layers[0];

    expect(particle).toMatchObject({
      id: 'particle-item',
      type: 'particle',
      endBehavior: 'destroy',
      localBounds: { x: 0, y: 0, width: 400, height: 300 },
      content: {
        maxParticles: 100,
        startLifetime: {
          type: 'curve',
          keyframes: [{ progress: 0, value: 30 }, { progress: 1, value: 60 }],
        },
        emission: {
          rateOverTime: { type: 'curve' },
          bursts: [{ frameOffset: 15, count: 20, cycleCount: 2, repeatIntervalFrames: 6 }],
        },
      },
    });

    if (particle.type !== 'particle') {
      throw new Error('Expected a particle IR layer.');
    }
    particle.content.maxParticles = 120;
    particle.content.emission.rateOverTime = { type: 'constant', value: 42 };
    particle.content.emission.bursts = [{
      frameOffset: 30,
      count: 12,
      cycleCount: 1,
      repeatIntervalFrames: 0,
    }];

    const exported = convertIRToGE(imported.scene, { preservedData: imported.preservedData })
      .scene as unknown as Record<string, unknown>;
    const component = findParticleComponent(exported);
    const options = component['options'] as Record<string, unknown>;
    const emission = component['emission'] as Record<string, unknown>;

    expect(component['shape']).toEqual({ type: 1, radius: 0.5, arc: 360 });
    expect(component['renderer']).toEqual({
      renderMode: 1,
      texture: { id: 'particle-texture' },
      anchor: [0, 0],
    });
    expect(component['positionOverLifetime']).toEqual({ startSpeed: [ValueType.CONSTANT, 2] });
    expect(options['startSize']).toEqual([ValueType.CONSTANT, 0.5]);
    expect(options['maxCount']).toBe(120);
    expect(options['startLifetime']).toEqual([ValueType.LINE, [[0, 1], [1, 2]]]);
    expect(emission['rateOverTime']).toEqual([ValueType.CONSTANT, 42]);
    expect(emission['bursts']).toEqual([{ time: 1, count: 12, cycles: 1, interval: 0 }]);
    expect(emission['burstOffsets']).toEqual([{ index: 0, x: 1, y: 2, z: 3 }]);
    expect(exported['images']).toContainEqual({
      id: 'particle-image',
      url: 'https://example.com/particle.png',
    });
    expect(exported['textures']).toContainEqual(expect.objectContaining({ id: 'particle-texture' }));
    expect((exported['items'] as Array<Record<string, unknown>>).find(item => item['id'] === 'particle-item'))
      .toMatchObject({ endBehavior: EndBehavior.destroy });
    const activationTrack = (exported['miscs'] as Array<Record<string, unknown>>).find(
      misc => misc['dataType'] === DataType.ActivationTrack,
    );
    const spriteColorTracks = (exported['miscs'] as Array<Record<string, unknown>>).filter(
      misc => misc['dataType'] === DataType.SpriteColorTrack,
    );
    const activationClip = (activationTrack?.['clips'] as Array<Record<string, unknown>> | undefined)?.[0];

    expect(activationClip).toMatchObject({ endBehavior: EndBehavior.restart });
    expect(spriteColorTracks).toEqual([]);
  });

  it('applies normalized blend mode, anchor, and static opacity to the preserved Particle renderer', () => {
    const imported = convertGEToIR(createParticleGEScene(), { frameRate: 30 });
    const particle = getIRSceneEntryComposition(imported.scene).layers[0];

    if (particle.type !== 'particle') {
      throw new Error('Expected a particle IR layer.');
    }

    particle.blendMode = IRBlendMode.Multiply;
    particle.transform = {
      ...particle.transform,
      anchor: { type: 'static', value: [100, 225, 0] },
      opacity: { type: 'static', value: 0.25 },
    };

    const exported = convertIRToGE(imported.scene, { preservedData: imported.preservedData });
    const component = findParticleComponent(exported.scene as unknown as Record<string, unknown>);
    const options = component['options'] as Record<string, unknown>;
    const renderer = component['renderer'] as Record<string, unknown>;

    expect(exported.diagnostics).toEqual([]);
    expect(renderer['blending']).toBe(BlendingMode.MULTIPLY);
    expect(renderer['anchor']).toEqual([0.25, 0.75]);
    expect(options['startColor']).toEqual([ValueType.RGBA_COLOR, [1, 1, 1, 0.25]]);
    expect((exported.scene.miscs as unknown as Array<Record<string, unknown>>).filter(
      misc => misc['dataType'] === DataType.SpriteColorTrack,
    )).toEqual([]);
  });

  it('imports Particle renderer blend mode and anchor into the common Layer contract', () => {
    const scene = createParticleGEScene();
    const component = findParticleComponent(scene);

    component['renderer'] = {
      ...(component['renderer'] as Record<string, unknown>),
      blending: BlendingMode.MULTIPLY,
      anchor: [0.25, 0.75],
    };

    const imported = convertGEToIR(scene, { frameRate: 30 });
    const particle = getIRSceneEntryComposition(imported.scene).layers[0];

    expect(particle).toMatchObject({
      type: 'particle',
      blendMode: IRBlendMode.Multiply,
      transform: { anchor: { type: 'static', value: [100, 225, 0] } },
    });
  });

  it('round-trips a Particle layer used as a Transform parent', () => {
    const imported = convertGEToIR(createParticleGEScene(), { frameRate: 30 });
    const composition = getIRSceneEntryComposition(imported.scene);
    const particle = composition.layers[0];

    if (particle.type !== 'particle') {
      throw new Error('Expected a particle IR layer.');
    }
    particle.transform = {
      ...particle.transform,
      rotation: { z: { type: 'static', value: 15 } },
    };
    composition.layers.push({
      id: 'particle-child',
      name: 'Particle child',
      type: 'null',
      time: { inFrame: 0, outFrame: 60 },
      visible: true,
      parentId: particle.id,
    });

    const exported = convertIRToGE(imported.scene, { preservedData: imported.preservedData });
    const roundTripped = convertGEToIR(exported.scene as unknown as Record<string, unknown>, { frameRate: 30 });
    const roundTrippedComposition = getIRSceneEntryComposition(roundTripped.scene);
    const roundTrippedParticle = roundTrippedComposition.layers.find(layer => layer.name === 'Particle');
    const roundTrippedChild = roundTrippedComposition.layers.find(layer => layer.name === 'Particle child');

    expect(roundTrippedComposition.layers).toHaveLength(2);
    expect(roundTrippedParticle).toMatchObject({
      type: 'particle',
      content: particle.content,
    });
    expect(roundTrippedChild?.parentId).toBe(roundTrippedParticle?.id);
  });

  it('reports animated Particle layer opacity instead of emitting an ineffective SpriteColorTrack', () => {
    const imported = convertGEToIR(createParticleGEScene(), { frameRate: 30 });
    const particle = getIRSceneEntryComposition(imported.scene).layers[0];

    if (particle.type !== 'particle') {
      throw new Error('Expected a particle IR layer.');
    }

    particle.transform = {
      ...particle.transform,
      opacity: {
        type: 'keyframed',
        keyframes: [{ frame: 0, value: 0 }, { frame: 60, value: 1 }],
      },
    };

    const exported = convertIRToGE(imported.scene, { preservedData: imported.preservedData });

    expect(exported.diagnostics).toContainEqual(expect.objectContaining({
      code: 'GE_PARTICLE_OPACITY_ANIMATION_UNSUPPORTED',
      severity: 'warning',
      action: 'unsupported',
      sourceId: 'particle-item',
    }));
    expect((exported.scene.miscs as unknown as Array<Record<string, unknown>>).filter(
      misc => misc['dataType'] === DataType.SpriteColorTrack,
    )).toEqual([]);
  });

  it('does not import an ineffective Particle SpriteColorTrack as Layer opacity', () => {
    const scene = createParticleGEScene();
    const miscs = scene['miscs'] as Array<Record<string, unknown>>;
    const objectTrack = miscs.find(misc => misc['dataType'] === DataType.ObjectBindingTrack);

    if (objectTrack == null) {
      throw new Error('Expected a Particle ObjectBindingTrack.');
    }

    objectTrack['children'] = [
      ...(objectTrack['children'] as Array<Record<string, unknown>>),
      { id: 'particle-color-track' },
    ];
    miscs.push(
      {
        id: 'particle-color-track',
        dataType: DataType.SpriteColorTrack,
        clips: [{
          start: 0,
          duration: 2,
          endBehavior: EndBehavior.restart,
          asset: { id: 'particle-color-asset' },
        }],
      },
      {
        id: 'particle-color-asset',
        dataType: DataType.SpriteColorPlayableAsset,
        colorOverLifetime: { opacity: [ValueType.CONSTANT, 0.25] },
      },
    );

    const imported = convertGEToIR(scene, { frameRate: 30 });
    const particle = getIRSceneEntryComposition(imported.scene).layers[0];

    expect(particle.type === 'particle' ? particle.transform?.opacity : undefined).toBeUndefined();
  });

  it('normalizes omitted GE burst fields to their effective runtime semantics', () => {
    const scene = createParticleGEScene();
    const component = findParticleComponent(scene);
    const emission = component['emission'] as Record<string, unknown>;

    emission['bursts'] = [{ time: 0.5, count: 20 }];

    const imported = convertGEToIR(scene, { frameRate: 30 });
    const layer = getIRSceneEntryComposition(imported.scene).layers[0];

    expect(layer.type === 'particle' ? layer.content.emission.bursts : undefined).toEqual([{
      frameOffset: 15,
      count: 20,
      cycleCount: 'infinite',
      repeatIntervalFrames: 30,
    }]);
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({
      code: 'GE_PARTICLE_BURST_RUNTIME_DEFAULTS_NORMALIZED',
      severity: 'info',
      action: 'normalized',
      sourceId: 'particle-component',
    }));

    const exported = convertIRToGE(imported.scene, { preservedData: imported.preservedData })
      .scene as unknown as Record<string, unknown>;
    const exportedEmission = findParticleComponent(exported)['emission'] as Record<string, unknown>;

    expect(exportedEmission['bursts']).toEqual([{ time: 0.5, count: 20, cycles: 0, interval: 1 }]);
  });

  it('reports explicit zero GE burst fields that select runtime defaults', () => {
    const scene = createParticleGEScene();
    const component = findParticleComponent(scene);
    const emission = component['emission'] as Record<string, unknown>;

    emission['bursts'] = [{ time: 0.5, count: 20, cycles: 0, interval: 0 }];

    const imported = convertGEToIR(scene, { frameRate: 30 });

    expect(imported.diagnostics).toContainEqual(expect.objectContaining({
      code: 'GE_PARTICLE_BURST_RUNTIME_DEFAULTS_NORMALIZED',
      action: 'normalized',
    }));
  });

  it('preserves reversed random endpoints and out-of-domain curves until edited', () => {
    const source = createParticleGEScene();
    const component = findParticleComponent(source);
    const options = component['options'] as Record<string, unknown>;
    const emission = component['emission'] as Record<string, unknown>;

    options['startLifetime'] = [ValueType.RANDOM, [2.3, 0.7]];
    emission['rateOverTime'] = [ValueType.LINE, [[0, 10], [2, 20]]];
    const imported = convertGEToIR(source, { frameRate: 24 });
    const composition = getIRSceneEntryComposition(imported.scene);
    const particle = composition.layers[0];

    if (particle.type !== 'particle' || particle.content.startLifetime.type !== 'randomBetweenConstants') {
      throw new Error('Expected a particle with a random lifetime.');
    }
    const lifetime = particle.content.startLifetime;

    composition.frameRate = 60;
    lifetime.min = lifetime.min / 24 * 60;
    lifetime.max = lifetime.max / 24 * 60;
    const restored = findParticleComponent(convertIRToGE(imported.scene, {
      preservedData: imported.preservedData,
    }).scene as unknown as Record<string, unknown>);

    expect(restored['options']).toMatchObject({ startLifetime: [ValueType.RANDOM, [2.3, 0.7]] });
    expect(restored['emission']).toMatchObject({ rateOverTime: [ValueType.LINE, [[0, 10], [2, 20]]] });
    particle.content.startLifetime = { type: 'constant', value: 15 };
    const edited = findParticleComponent(convertIRToGE(imported.scene, {
      preservedData: imported.preservedData,
    }).scene as unknown as Record<string, unknown>);

    expect(edited['options']).toMatchObject({ startLifetime: [ValueType.CONSTANT, 0.25] });
  });

  it.each([
    {
      name: 'non-positive lifetime',
      mutate: (component: Record<string, unknown>) => {
        (component['options'] as Record<string, unknown>)['startLifetime'] = [ValueType.CONSTANT, -1];
      },
      error: /IR_PARTICLE_EXPRESSION_INVALID/,
    },
    {
      name: 'negative emission rate',
      mutate: (component: Record<string, unknown>) => {
        (component['emission'] as Record<string, unknown>)['rateOverTime'] = [ValueType.CONSTANT, -1];
      },
      error: /IR_PARTICLE_EXPRESSION_INVALID/,
    },
    {
      name: 'finite burst cycles outside the Layer duration',
      mutate: (component: Record<string, unknown>) => {
        (component['emission'] as Record<string, unknown>)['bursts'] = [{
          time: 0.5,
          count: 20,
          cycles: 4,
          interval: 1,
        }];
      },
      error: /IR_PARTICLE_BURST_INVALID/,
    },
  ])('rejects GE particle values with $name', ({ mutate, error }) => {
    const scene = createParticleGEScene();

    mutate(findParticleComponent(scene));

    expect(() => convertGEToIR(scene, { frameRate: 30 })).toThrow(error);
  });

  it('refuses to fabricate a visually incomplete GE particle without trusted data', () => {
    const layer: IRParticleLayer = {
      id: 'particle',
      type: 'particle',
      time: { inFrame: 0, outFrame: 60 },
      visible: true,
      localBounds: { x: 0, y: 0, width: 400, height: 300 },
      content: {
        maxParticles: 100,
        startLifetime: { type: 'constant', value: 60 },
        emission: { rateOverTime: { type: 'constant', value: 10 } },
      },
    };
    const composition: IRComposition = {
      id: 'composition',
      width: 400,
      height: 300,
      frameRate: 30,
      inPoint: 0,
      outPoint: 60,
      endBehavior: 'loop',
      layers: [layer],
    };

    expect(() => convertIRToGE(createIRScene(composition))).toThrow(/trusted GE particle data/);
  });
});
