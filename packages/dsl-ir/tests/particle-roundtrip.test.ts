import { describe, expect, it } from 'vitest';
import type { IRComposition, IRParticleLayer, IRScene } from '@galacean/animation-ir';
import { createIRScene, getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import { convertDSLToIR, convertIRToDSL } from '../src';

function makeParticleScene() {
  const particle: IRParticleLayer = {
    id: 'particle',
    name: 'Particle',
    type: 'particle',
    time: { inFrame: 0, outFrame: 60 },
    visible: true,
    localBounds: { x: -20, y: 10, width: 400, height: 300 },
    content: {
      maxParticles: 100,
      startLifetime: {
        type: 'curve',
        keyframes: [
          { progress: 0, value: 30, outControl: { progress: 0.25, value: 45 } },
          { progress: 1, value: 60, inControl: { progress: 0.75, value: 52.5 } },
        ],
      },
      emission: {
        rateOverTime: {
          type: 'curve',
          keyframes: [
            {
              progress: 0,
              value: 10,
              outControl: { progress: 0.3, value: 15 },
            },
            {
              progress: 1,
              value: 20,
              inControl: { progress: 0.7, value: 15 },
            },
          ],
        },
        bursts: [{ frameOffset: 15, count: 20, cycleCount: 2, repeatIntervalFrames: 6 }],
      },
    },
  };
  const composition: IRComposition = {
    id: 'composition',
    name: 'Particle test',
    width: 400,
    height: 300,
    frameRate: 30,
    inPoint: 0,
    outPoint: 60,
    endBehavior: 'loop',
    layers: [particle],
  };

  return createIRScene(composition);
}

function makeParticlePrecompScene(): IRScene {
  const particleScene = makeParticleScene();
  const particleComposition = particleScene.compositions[0];
  const rootComposition: IRComposition = {
    id: 'root-composition',
    name: 'Root',
    width: 400,
    height: 300,
    frameRate: 30,
    inPoint: 0,
    outPoint: 60,
    endBehavior: 'loop',
    layers: [{
      id: 'particle-precomp',
      name: 'Particle precomp',
      type: 'precomp',
      time: { inFrame: 0, outFrame: 60 },
      visible: true,
      content: { compositionId: particleComposition.id, clipToBounds: false },
    }],
  };

  return {
    ...particleScene,
    entryCompositionId: rootComposition.id,
    compositions: [rootComposition, particleComposition],
  };
}

describe('particle DSL preservation', () => {
  it('accepts emitter shape as read-only context without writing it into Animation IR', () => {
    const baselineScene = makeParticleScene();
    const converted = convertIRToDSL(baselineScene);
    const particle = converted.dsl.layers[0].particle;

    if (particle == null) {
      throw new Error('Expected particle DSL data.');
    }
    particle.shape = { type: 1, shape: 'Sphere', arcMode: 0, radius: 0.05, arc: 360 };

    expect(convertDSLToIR(converted.dsl, { preservedData: converted.preservedData }).scene).toEqual(baselineScene);
  });

  it('preserves and edits particle data inside an expanded Precomp', () => {
    const baselineScene = makeParticlePrecompScene();

    baselineScene.compositions[1].frameRate = 24;
    const converted = convertIRToDSL(baselineScene);
    const expandedParticle = (converted.dsl.layers[0].children ?? [])[0];

    expect(expandedParticle.type).toBe('particle');
    expect(expandedParticle.particle?.options).toEqual({ maxCount: 100, startLifetime: [0, 1.25] });

    const noOpScene = convertDSLToIR(converted.dsl, { preservedData: converted.preservedData }).scene;
    const noOpParticle = noOpScene.compositions[1].layers[0];

    expect(noOpParticle).toEqual(baselineScene.compositions[1].layers[0]);

    const edited = structuredClone(converted.dsl);
    const editedParticle = (edited.layers[0].children ?? [])[0].particle;

    if (editedParticle == null) {
      throw new Error('Expected an expanded particle DSL layer.');
    }
    editedParticle.options.maxCount = 125;
    editedParticle.options.startLifetime = [0, 0.3125];
    editedParticle.emission.rateOverTime = [0, 24];

    const updatedScene = convertDSLToIR(edited, { preservedData: converted.preservedData }).scene;
    const updatedParticle = updatedScene.compositions[1].layers[0];

    expect(updatedParticle).toMatchObject({
      type: 'particle',
      content: {
        maxParticles: 125,
        startLifetime: { type: 'constant', value: 7.5 },
        emission: { rateOverTime: { type: 'constant', value: 24 } },
      },
    });
  });

  it('reframes particle lifetime curves and bursts when the DSL frame rate changes', () => {
    const converted = convertIRToDSL(makeParticleScene());
    const edited = structuredClone(converted.dsl);

    edited.meta.fps = 60;

    const updatedScene = convertDSLToIR(edited, { preservedData: converted.preservedData }).scene;
    const updatedParticle = getIRSceneEntryComposition(updatedScene).layers[0];

    expect(updatedParticle).toMatchObject({ content: { startLifetime: { keyframes: [
      { progress: 0, value: 60, outControl: { progress: 0.25, value: 90 } },
      { progress: 1, value: 120, inControl: { progress: 0.75, value: 105 } },
    ] } } });
    expect(updatedParticle.type === 'particle' ? updatedParticle.content.emission.bursts : undefined).toEqual([{
      frameOffset: 30,
      count: 20,
      cycleCount: 2,
      repeatIntervalFrames: 12,
    }]);
    expect(convertIRToDSL(updatedScene).dsl.layers[0].particle?.emission.bursts).toEqual([{
      time: 0.5,
      count: 20,
      cycles: 2,
      interval: 0.2,
    }]);
  });

  it('projects complex expressions but preserves them when the DSL fields are not edited', () => {
    const baselineScene = makeParticleScene();
    const converted = convertIRToDSL(baselineScene);
    const dslParticle = converted.dsl.layers[0].particle;

    expect(converted.dsl.layers[0]).toMatchObject({
      type: 'particle',
      width: 400,
      height: 300,
    });
    expect(dslParticle).toEqual({
      options: { maxCount: 100, startLifetime: [0, 1] },
      emission: {
        rateOverTime: [0, 10],
        bursts: [{ time: 0.5, count: 20, cycles: 2, interval: 0.2 }],
      },
    });
    expect(converted.diagnostics.filter(diagnostic => diagnostic.code === 'PARTICLE_EXPRESSION_PROJECTED'))
      .toHaveLength(2);

    const roundTripped = convertDSLToIR(converted.dsl, { preservedData: converted.preservedData }).scene;

    expect(getIRSceneEntryComposition(roundTripped).layers[0]).toEqual(
      getIRSceneEntryComposition(baselineScene).layers[0],
    );
  });

  it('replaces only particle fields actually edited through the DSL', () => {
    const converted = convertIRToDSL(makeParticleScene());
    const edited = structuredClone(converted.dsl);
    const particle = edited.layers[0].particle;

    if (particle == null) {
      throw new Error('Expected particle DSL data.');
    }
    particle.options.startLifetime = [4, [3, 4]];
    particle.options.maxCount = 120;

    const updated = getIRSceneEntryComposition(
      convertDSLToIR(edited, { preservedData: converted.preservedData }).scene,
    ).layers[0];

    expect(updated).toMatchObject({
      type: 'particle',
      content: {
        maxParticles: 120,
        startLifetime: { type: 'randomBetweenConstants', min: 90, max: 120 },
      },
    });
    expect(updated.type === 'particle' ? updated.content.emission.rateOverTime.type : undefined).toBe('curve');
  });

  it.each([0, undefined])('preserves unbounded bursts with DSL cycles=%s', cycles => {
    const baselineScene = makeParticleScene();
    const layer = getIRSceneEntryComposition(baselineScene).layers[0];

    if (layer.type !== 'particle') {
      throw new Error('Expected a particle IR layer.');
    }
    layer.content.emission.bursts = [{
      frameOffset: 0,
      count: 10,
      cycleCount: 'infinite',
      repeatIntervalFrames: 15,
    }];

    const converted = convertIRToDSL(baselineScene);

    expect(converted.dsl.layers[0].particle?.emission.bursts).toEqual([{
      time: 0,
      count: 10,
      cycles: 0,
      interval: 0.5,
    }]);
    const burst = converted.dsl.layers[0].particle?.emission.bursts?.[0];

    if (burst == null) {
      throw new Error('Expected a particle burst.');
    }
    if (cycles === undefined) {
      delete burst.cycles;
    }
    expect(getIRSceneEntryComposition(convertDSLToIR(converted.dsl).scene).layers[0]).toMatchObject({
      type: 'particle', content: { emission: { bursts: layer.content.emission.bursts } },
    });
    expect(getIRSceneEntryComposition(
      convertDSLToIR(converted.dsl, { preservedData: converted.preservedData }).scene,
    ).layers[0]).toEqual(layer);
  });
});

describe('complete DSL with particle source instances', () => {
  it('keeps independent source durations inside the DSL playback window', () => {
    const sources = [2, 5].map(duration => {
      const scene = makeParticleScene();

      scene.compositions[0].outPoint = duration * 30;

      return convertIRToDSL(scene);
    });
    const layers = sources.map((source, index) => {
      const layer = structuredClone(source.dsl.layers[0]);

      layer.id = `target-${index}`;
      delete layer.time_range;

      return layer;
    });
    const dsl = { meta: { ...sources[0].dsl.meta, duration: 4, fps: 60 }, layers };
    const converted = convertDSLToIR(dsl, { particleSources: sources.map((source, index) => ({
      preservedData: source.preservedData,
      layers: { [layers[index].id]: source.dsl.layers[0].id },
    })) });
    const [host, ...instances] = converted.scene.compositions;

    expect(host.outPoint).toBe(240);
    expect(host.layers.map(layer => layer.time.outFrame)).toEqual([240, 240]);
    expect(instances.map(instance => instance.outPoint)).toEqual([120, 150]);
  });

  it('creates ordinary layers while preserving source curves, depth and independent instance edits', () => {
    const source = makeParticleScene();

    source.compositions[0].layers[0].transform = { position: { type: 'static', value: [30, 40, 2] } };
    const imported = convertIRToDSL(source);
    const first = structuredClone(imported.dsl.layers[0]);
    const second = structuredClone(first);

    first.id = 'first-instance';
    first.width = 200;
    first.height = 150;
    first.position = { a: false, value: [120, 200, 1] };
    second.id = 'second-instance';
    second.width = 100;
    second.height = 75;
    second.position = { a: false, value: [500, 200, 3] };
    second.particle!.options.maxCount = 222;
    const dsl = {
      ...imported.dsl,
      meta: { ...imported.dsl.meta, width: 640, height: 480, fps: 60, duration: 4 },
      layers: [second, {
        id: 'title', type: 'text' as const, name: 'Title', width: 120, height: 30,
        position: { a: false as const, value: [320, 40, 2] as [number, number, number] },
        description: { self: '', composite: '' },
        text: { content: 'Hello', size: 24, color: '#ffffff' },
      }, first],
    };
    const sources = [first, second].map(layer => ({
      preservedData: imported.preservedData,
      layers: { [layer.id]: imported.dsl.layers[0].id },
    }));
    const snapshot = structuredClone({ dsl, sources });
    const converted = convertDSLToIR(dsl, { particleSources: sources });
    const [host, ...instances] = converted.scene.compositions;

    expect(host.layers.map(layer => layer.type)).toEqual(['precomp', 'text', 'precomp']);
    expect(instances.map(composition => composition.frameRate)).toEqual([30, 30]);
    expect(instances.map(composition => composition.layers[0])).toEqual([
      expect.objectContaining({ content: expect.objectContaining({ maxParticles: 100 }) }),
      expect.objectContaining({ content: expect.objectContaining({ maxParticles: 222 }) }),
    ]);
    for (const instance of instances) {
      expect(instance.layers[0].transform?.position).toEqual(source.compositions[0].layers[0].transform?.position);
      expect((instance.layers[0] as IRParticleLayer).content.startLifetime)
        .toEqual((source.compositions[0].layers[0] as IRParticleLayer).content.startLifetime);
      expect(instance.outPoint).toBe(120);
    }
    expect(converted.sourceInstances?.map(value => value.sourceIndex)).toEqual([0, 1]);
    expect(converted.sourceInstances?.[0].idMap['particle']).toBe(instances[0].layers[0].id);
    expect(instances[0].layers[0].id).not.toBe(instances[1].layers[0].id);
    expect({ dsl, sources }).toEqual(snapshot);
  });

  it('distinguishes source-region placement from ordinary preserved emitter edits', () => {
    const imported = convertIRToDSL(makeParticleScene());
    const dsl = structuredClone(imported.dsl);

    dsl.layers[0].position = { a: false, value: [180, 90, 7] };
    dsl.layers[0].width = 100;
    dsl.layers[0].height = 50;
    const placed = convertDSLToIR(dsl, { particleSources: [{
      preservedData: imported.preservedData,
      layers: { [dsl.layers[0].id]: imported.dsl.layers[0].id },
      authoringBounds: [100, 50, 200, 100],
    }] });
    const edited = convertDSLToIR(dsl, { preservedData: imported.preservedData });

    expect(placed.scene.compositions[0].layers[0].transform?.position)
      .toEqual({ type: 'static', value: [180, 115, 0] });
    expect(placed.scene.compositions[0].layers[0].transform?.scale)
      .toEqual({ type: 'static', value: [0.5, 0.5, 0.5] });
    expect(edited.scene.compositions[0].layers[0].transform?.position)
      .toEqual({ type: 'static', value: [180, 90, 0] });
  });

  it('rotates the source region around its center without changing the tilted emitter', () => {
    const baseline = makeParticleScene();

    baseline.compositions[0].layers[0].transform = {
      rotation: { x: { type: 'static', value: 111 } },
      scale: { type: 'static', value: [2, 2, 2] },
    };
    const imported = convertIRToDSL(baseline);
    const dsl = structuredClone(imported.dsl);

    Object.assign(dsl.layers[0], {
      width: 100, height: 50, position: { a: false, value: [180, 90, 7] },
      rotation: { a: false, value: [0, 0, 90] }, scale: { a: false, value: [1, 1, 1] },
    });
    const result = convertDSLToIR(dsl, { particleSources: [{
      preservedData: imported.preservedData, layers: { [dsl.layers[0].id]: imported.dsl.layers[0].id },
      authoringBounds: [100, 50, 200, 100],
    }] });
    const wrapper = result.scene.compositions[0].layers[0];

    expect(wrapper.transform?.position).toEqual({ type: 'static', value: [155, 90, 0] });
    expect(wrapper.transform?.rotation?.z).toEqual({ type: 'static', value: 90 });
    expect(result.scene.compositions[1].layers[0].transform).toEqual(baseline.compositions[0].layers[0].transform);
  });

  it('rejects missing targets, duplicate bindings and unknown source identities', () => {
    const source = convertIRToDSL(makeParticleScene());
    const binding = { preservedData: source.preservedData, layers: { [source.dsl.layers[0].id]: 'particle' } };

    expect(() => convertDSLToIR(source.dsl, { particleSources: [binding, binding] })).toThrow(/root particle leaf/);
    expect(() => convertDSLToIR(source.dsl, { particleSources: [{ ...binding, layers: { missing: 'particle' } }] }))
      .toThrow(/root particle leaf/);
    expect(() => convertDSLToIR(source.dsl, { particleSources: [{
      ...binding, layers: { [source.dsl.layers[0].id]: 'missing' },
    }] })).toThrow(/source particle layer/);
  });
  it('retains equal-rank ordering in a preserved host and rejects children of placement leaves', () => {
    const source = convertIRToDSL(makeParticleScene());
    const host = makeParticleScene();

    host.compositions[0].layers = ['zz', 'aa'].map(id => ({
      id, name: id, type: 'null', visible: true, time: { inFrame: 0, outFrame: 60 },
    }));
    const editable = convertIRToDSL(host);

    editable.dsl.layers.forEach(layer => { layer.position = { a: false, value: [0, 0, 0] }; });
    const particle = structuredClone(source.dsl.layers[0]);

    particle.id = 'placed';
    particle.position = { a: false, value: [100, 100, 1] };
    editable.dsl.layers.push(particle);
    const options = {
      preservedData: editable.preservedData,
      particleSources: [{ preservedData: source.preservedData, layers: { placed: source.dsl.layers[0].id } }],
    };
    const converted = convertDSLToIR(editable.dsl, options);

    expect(converted.scene.compositions[0].layers.slice(0, 2).map(layer => layer.id)).toEqual(['zz', 'aa']);
    editable.dsl.layers[0].parent = 'placed';

    expect(() => convertDSLToIR(editable.dsl, options)).toThrow(/root particle leaf/);
  });

});
