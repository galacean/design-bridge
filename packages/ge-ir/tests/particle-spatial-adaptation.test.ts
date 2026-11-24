import { describe, expect, it, vi } from 'vitest';
import { bakeParticleMotion } from '../src/particle/bake-particle-motion';
import { applyParticleSize, planParticleSize } from '../src/particle/compensate-particle-size';
import { particleItemWorld } from '../src/particle/map-particle-space';
import { lookupParticleTextureFill } from '../src/particle/lookup-particle-texture-fill';
import { scaleParticleValue } from '../src/particle/sample-particle-values';

const identity = particleItemWorld(new Map([['emitter', { id: 'emitter' }]]), 'emitter').matrix;
const camera = { position: [0, 0, 8] };

function particle(shape = 8): Record<string, unknown> {
  return {
    id: 'system', dataType: 'ParticleSystem', item: { id: 'emitter' }, shape: { type: shape, width: 1, height: 1 },
    options: { maxCount: 100, startLifetime: [0, 2], startSize: [4, [0.8, 1.2]] },
    emission: { rateOverTime: [0, 10] },
    positionOverLifetime: { startSpeed: [0, 4], gravity: [0, -2, 0] },
  };
}

describe('particle world-space motion', () => {
  it('scales planar speed, gravity and trail spacing without resizing sprites', () => {
    const source: Record<string, unknown> = { ...particle(), trails: { widthOverTrail: [0, 0.2], minimumVertexDistance: 0.04 } };
    const snapshot = structuredClone(source);
    const result = bakeParticleMotion(source, { scale: 0.5, rotation: 0, position: [0, 0, 0] }, identity, camera);

    expect(result.system).toMatchObject({
      options: snapshot.options,
      positionOverLifetime: { startSpeed: [0, 2], gravity: [0, -1, 0] },
      trails: { widthOverTrail: [0, 0.1], minimumVertexDistance: 0.02 },
    });
    expect(source).toEqual(snapshot);
  });

  it('retains depth speed and makes off-center perspective converge to the placement center', () => {
    const source = particle(6);

    source.positionOverLifetime = { startSpeed: [0, 4] };
    const result = bakeParticleMotion(source, { scale: 0.25, rotation: 0, position: [2, 1, 0] }, identity, camera);

    expect(result.system).toMatchObject({ positionOverLifetime: {
      startSpeed: [0, 4], linearX: [0, -1], linearY: [0, -0.5],
    } });
    expect(result.system.positionOverLifetime).not.toHaveProperty('linearZ');
  });

  it('rotates world motion clockwise and preserves the depth component', () => {
    const result = bakeParticleMotion(particle(), { scale: 0.5, rotation: 90, position: [0, 0, 0] }, identity, camera);
    const motion = result.system.positionOverLifetime as { gravity: number[] };

    expect(motion.gravity[0]).toBeCloseTo(-1);
    expect(motion.gravity[1]).toBeCloseTo(0);
    expect(motion.gravity[2]).toBe(0);
  });

  it('includes parent tilt and rejects local-follow simulation', () => {
    const world = particleItemWorld(new Map([
      ['root', { id: 'root', transform: { eulerHint: { x: 90 } } }],
      ['emitter', { id: 'emitter', parentId: 'root' }],
    ]), 'emitter');
    const source = particle(6);

    source.positionOverLifetime = { startSpeed: [0, 4] };
    const result = bakeParticleMotion(source, { scale: 0.5, rotation: 0, position: [0, 0, 0] }, world.matrix, camera);

    expect(result.system).toMatchObject({ positionOverLifetime: { startSpeed: [0, 2] } });
    source.options = { particleFollowParent: true };
    expect(() => bakeParticleMotion(source, { scale: 0.5, rotation: 0, position: [0, 0, 0] }, identity, camera))
      .toThrow(/particleFollowParent/);
  });

  it('scales curve values and tangents while retaining timing and keyframe metadata', () => {
    expect(scaleParticleValue([6, [[0.2, 3, 4, -2]]], 2)).toEqual([6, [[0.2, 6, 8, -4]]]);
    expect(scaleParticleValue([21, [[1, [0, 2, 0.5, 3, 1, 4], 7]]], 2))
      .toEqual([21, [[1, [0, 4, 0.5, 6, 1, 8], 7]]]);
  });
});

describe('particle size compensation', () => {
  const composition = { previewSize: [750, 1624], duration: 2, camera };
  const items = new Map([['emitter', { id: 'emitter', duration: 2 }]]);
  const textures = new Map([['system', 0.14]]);

  it('lets simple sprites grow to the display, tail or coverage cap', () => {
    const source = particle(0);

    source.options = { maxCount: 1, startLifetime: [0, 2], startSize: [0, 1] };
    source.positionOverLifetime = { startSpeed: [0, 0] };
    source.emission = { rateOverTime: [0, 0], bursts: [{ time: 0, count: 1 }] };
    const result = planParticleSize([source], items, composition, [0, 0, 750, 1624], 0.2, 800,
      textures);

    expect(result).toMatchObject({ factor: 3, limitedBy: 'maximum' });
    expect(result.limits).toEqual({
      display: expect.any(Number), tail: expect.any(Number), coverage: expect.any(Number), maximum: 3,
    });
  });

  it('enables compensation for a shrinking sprite and leaves full-size placement unchanged', () => {
    const source = particle();
    const full = planParticleSize([source], items, composition, [0, 0, 750, 1624], 1, 750, textures);
    const small = planParticleSize([source], items, composition, [0, 0, 750, 1624], 0.2, 800, textures);

    expect(full.factor).toBe(1);
    expect(small.factor).toBeGreaterThan(1);
    expect(small.factor).toBeLessThanOrEqual(3);
    expect(planParticleSize([source], items, composition, [0, 0, 750, 1624], 0.2, 800, textures, false).factor).toBe(1);
  });

  it('changes only initial size and independent trail width', () => {
    const source = particle();
    const original = structuredClone(source);

    source.trails = { widthOverTrail: [0, 0.1], sizeAffectsWidth: true };
    applyParticleSize(source, 2);
    expect(source).toEqual({ ...original,
      options: { ...original.options as object, startSize: [4, [1.6, 2.4]] },
      trails: { widthOverTrail: [0, 0.1], sizeAffectsWidth: true },
    });
  });

  it.each(['startLifetime', 'startSpeed'])('samples %s at emission time for depth checks', key => {
    const source = particle(6);

    source.options = { maxCount: 1, startLifetime: [0, 1.005], startSize: [0, 0.1] };
    source.positionOverLifetime = { startSpeed: [0, 20] };
    source.emission = { rateOverTime: [0, 0], bursts: [{ time: 1, count: 1 }] };
    if (key === 'startLifetime') {
      (source.options as Record<string, unknown>).startLifetime = [5, [[0, 0.01], [1, 2]]];
    } else {
      (source.positionOverLifetime as Record<string, unknown>).startSpeed = [5, [[0, 0], [1, 40]]];
    }

    const onClipping = vi.fn();

    planParticleSize([source], items, composition, [0, 0, 750, 1624], 1, 750,
      textures, false, { scale: 1, camera, onClipping });
    expect(onClipping.mock.calls).toEqual([[source, 'near', 1.4]]);
  });

  it('samples initial size at the delayed emitter progress', () => {
    const source = particle(0);
    const delayedItems = new Map([['emitter', { id: 'emitter', delay: 0.5, duration: 2 }]]);
    const canvas = { previewSize: [100, 100], duration: 4, camera };

    source.options = { maxCount: 1, startLifetime: [0, 1], startSize: [5, [[0, 0.1], [1, 1.9]]] };
    source.positionOverLifetime = { startSpeed: [0, 0] };
    source.emission = { rateOverTime: [0, 0], bursts: [{ time: 1, count: 1 }] };
    const measure = () => planParticleSize([source], delayedItems, canvas, [0, 0, 100, 100], 0.1, 100, new Map());
    const curved = measure();

    source.options = { maxCount: 1, startLifetime: [0, 1], startSize: [0, 1] };
    const constant = measure();

    expect(constant.factor).toBeGreaterThan(1);
    expect(constant.factor).toBeLessThan(3);
    expect(curved.factor).toBeCloseTo(constant.factor);
  });

  it('includes emitter and parent scale in projected sprite size', () => {
    const source = particle(0);
    const canvas = { previewSize: [100, 100], duration: 2, camera };
    const scaledItems = new Map<string, Record<string, unknown>>([
      ['parent', { id: 'parent', transform: { scale: { x: 2, y: 2, z: 2 }, eulerHint: { z: 30 } } }],
      ['emitter', { id: 'emitter', parentId: 'parent', duration: 2,
        transform: { scale: { x: 5, y: 5, z: 5 }, eulerHint: { z: 45 } } }],
    ]);

    source.options = { maxCount: 1, startLifetime: [0, 2], startSize: [0, 0.1] };
    source.positionOverLifetime = { startSpeed: [0, 0] };
    source.emission = { rateOverTime: [0, 0], bursts: [{ time: 0, count: 1 }] };
    const scaled = planParticleSize([source], scaledItems, canvas, [0, 0, 100, 100], 0.1, 100, new Map());

    source.options = { maxCount: 1, startLifetime: [0, 2], startSize: [0, 1] };
    const sized = planParticleSize([source], items, canvas, [0, 0, 100, 100], 0.1, 100, new Map());

    expect(sized.factor).toBeGreaterThan(1);
    expect(sized.factor).toBeLessThan(3);
    expect(scaled.factor).toBeCloseTo(sized.factor);
  });

  it('defaults omitted gravity modulation to zero without disabling explicit gravity', () => {
    const source = particle(0);
    const motion: Record<string, unknown> = { startSpeed: [0, 0], gravity: [0, 0, 20] };

    source.options = { maxCount: 1, startLifetime: [0, 2], startSize: [0, 0.1] };
    source.emission = { rateOverTime: [0, 0], bursts: [{ time: 0, count: 1 }] };
    source.positionOverLifetime = motion;
    const onClipping = vi.fn();
    const measure = () => planParticleSize([source], items, composition, [0, 0, 750, 1624], 1, 750,
      textures, false, { scale: 1, camera, onClipping });
    const omitted = measure();

    motion.gravityOverLifetime = [0, 0];
    expect(measure()).toEqual(omitted);
    expect(onClipping).not.toHaveBeenCalled();
    motion.gravityOverLifetime = [0, 1];
    measure();
    expect(onClipping.mock.calls).toEqual([[source, 'near', expect.any(Number)]]);
  });

  it.each([false, true, 2])('checks depth after shrinking even with size compensation %s', mode => {
    const source = particle(6);
    const depthItems = new Map([['emitter', { id: 'emitter', duration: 2,
      transform: { position: { z: -8 } } }]]);

    source.options = { maxCount: 1, startLifetime: [0, 2], startSize: [0, 0.2] };
    source.emission = { rateOverTime: [0, 0], bursts: [{ time: 0, count: 1 }] };
    source.positionOverLifetime = { startSpeed: [0, 6] };
    const onClipping = vi.fn();
    const measure = (scale: number) => planParticleSize([source], depthItems, composition,
      [0, 0, 750, 1624], 0.25, 750, textures, mode, { scale, camera, onClipping });

    measure(1);
    expect(onClipping).not.toHaveBeenCalled();
    measure(0.25);
    expect(onClipping.mock.calls).toEqual([[source, 'near', expect.any(Number)]]);
  });

  it('still rejects an invalid host clipping interval', () => {
    expect(() => planParticleSize([], items, composition, [0, 0, 750, 1624], 1, 750,
      textures, false, { scale: 1, camera: { ...camera, near: 4, far: 2 }, onClipping: vi.fn() }))
      .toThrow(/0 < near < far/);
  });
});

describe('particle texture fill lookup', () => {
  const url = 'https://mdn.alipayobjects.com/mars/afts/file/A*vns5RYqYHccAAAAAStAAAAgAelB4AQ/original';
  const system = { ...particle(), renderer: { texture: { id: 'texture' } },
    textureSheetAnimation: { col: 5, row: 3 } };
  const scene = { images: [{ id: 'image', url }], textures: [{ id: 'texture', source: { id: 'image' } }] };

  it.each([{ id: 'image' }, 'image', 0])('resolves source image reference %j without reading pixels', source => {
    const result = lookupParticleTextureFill({
      images: [{ id: 'image', url: `${url}?token=example#frame` }], textures: [{ id: 'texture', source }],
    }, system);

    expect(result).toEqual({ fill: 0.140504, source: 'table' });
    expect(lookupParticleTextureFill(scene, { ...system, textureSheetAnimation: { col: 5, row: 3, total: 99 } }))
      .toEqual(result);
    expect(lookupParticleTextureFill(scene, { ...system, textureSheetAnimation: { col: 5, row: 3, total: 0 } }))
      .toEqual(result);
  });

  it('reports unknown URLs, missing references and mismatched sheet layouts as missing fills', () => {
    const unknown = lookupParticleTextureFill({ ...scene, images: [{ id: 'image', url: 'unknown.png' }] }, system);
    const unresolved = lookupParticleTextureFill({ ...scene, textures: [] }, system);
    const mismatch = lookupParticleTextureFill(scene, { ...system, textureSheetAnimation: { col: 5, row: 3, total: 14 } });

    for (const result of [unknown, unresolved, mismatch]) {
      expect(result).toMatchObject({ fill: Math.PI / 4, source: 'default', missing: expect.any(String) });
    }
    expect(unknown.missing).toContain('unknown.png');
    expect(mismatch.missing).toContain('5x3x14');
    expect(lookupParticleTextureFill(scene, particle())).toEqual({ fill: Math.PI / 4, source: 'untextured' });
  });

  it('prioritizes valid fill overrides and falls back for invalid measurements', () => {
    expect(lookupParticleTextureFill(scene, system, 0.3)).toEqual({ fill: 0.3, source: 'given' });
    for (const value of [0, -1, 1.01, Infinity, NaN]) {
      expect(lookupParticleTextureFill(scene, system, value)).toEqual({ fill: 0.140504, source: 'table' });
    }
  });
});
