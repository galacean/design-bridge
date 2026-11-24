import { describe, expect, it } from 'vitest';
import { DataType, EndBehavior, ItemType, ValueType } from '@galacean/effects-specification';
import { convertGEToIR } from '@galacean/ge-ir';
import { applyIREdits, prepareIREditing, restoreIREditing } from '../src/pages/ir-editing/convert-ir-editing';

function createSource() {
  return {
    version: '3.6', type: 'ge', compositionId: 'root',
    compositions: [{
      id: 'root', name: 'IR editing', duration: 2, startTime: 0,
      endBehavior: EndBehavior.restart, previewSize: [400, 300],
      components: [{ id: 'composition-component' }],
    }],
    items: [{
      id: 'particle', name: 'Particle', type: ItemType.particle,
      duration: 2, delay: 0, visible: true, endBehavior: EndBehavior.restart,
      components: [{ id: 'particle-component' }],
      transform: { position: { x: 0, y: 0, z: 0 } },
    }],
    components: [
      {
        id: 'composition-component', dataType: DataType.CompositionComponent,
        item: { id: 'root' }, items: [{ id: 'particle' }], sceneBindings: [],
      },
      {
        id: 'particle-component', dataType: DataType.ParticleSystem, item: { id: 'particle' },
        options: { maxCount: 17, startLifetime: [ValueType.CONSTANT, 1], startSize: [ValueType.CONSTANT, 0.5] },
        renderer: { renderMode: 1 }, shape: { type: 1, radius: 0.5, arc: 360 },
        emission: { rateOverTime: [ValueType.CONSTANT, 5] },
      },
    ],
    images: [], textures: [], fonts: [], plugins: [], miscs: [],
  };
}

describe('IR editing', () => {
  it('applies edited transforms while retaining GE particle payloads and the original editing baseline', () => {
    const session = prepareIREditing(JSON.stringify(createSource()), 24);
    const snapshot = structuredClone(session);
    const edited = structuredClone(session.baselineScene);

    edited.compositions[0].layers[0].transform = {
      ...edited.compositions[0].layers[0].transform,
      position: { type: 'static', value: [50, 70, 0] },
    };
    const result = applyIREdits(JSON.stringify(edited), session);
    const imported = convertGEToIR(result.scene, { frameRate: 24 });

    expect(session.baselineScene.compositions[0].frameRate).toBe(24);
    expect(imported.scene.compositions[0].layers[0].transform?.position).toEqual({
      type: 'static', value: [expect.closeTo(50, 2), expect.closeTo(70, 2), 0],
    });
    expect(result.scene.components).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dataType: DataType.ParticleSystem,
        options: expect.objectContaining({ maxCount: 17 }),
        shape: expect.objectContaining({ radius: 0.5 }),
      }),
    ]));
    expect(session).toEqual(snapshot);
    const reverted = applyIREdits(JSON.stringify(session.baselineScene), session);

    expect(convertGEToIR(reverted.scene, { frameRate: 24 }).scene.compositions[0].layers[0].transform?.position)
      .toEqual({ type: 'static', value: [expect.closeTo(0, 2), expect.closeTo(0, 2), 0] });
  });

  it('restores a serialized editing bundle and applies edits with its original IDs and preserved data', () => {
    const session = prepareIREditing(JSON.stringify(createSource()), 30);
    const restored = restoreIREditing(JSON.stringify(session));
    const edited = structuredClone(restored.baselineScene);

    edited.compositions[0].layers = [];
    const result = applyIREdits(JSON.stringify(edited), restored);

    expect(restored.source).toEqual(session.source);
    expect(convertGEToIR(result.scene, { frameRate: 30 }).scene.compositions[0].layers).toEqual([]);
    expect(restored.baselineScene.compositions[0].layers).toHaveLength(1);
  });

  it.each(['{', 'null', '{"compositions":[]}'])('rejects invalid IR without changing the session: %s', text => {
    const session = prepareIREditing(JSON.stringify(createSource()), 30);
    const before = structuredClone(session);

    expect(() => applyIREdits(text, session)).toThrow();
    expect(session).toEqual(before);
  });

  it('rejects mismatched preservation bindings when restoring a bundle', () => {
    const session = prepareIREditing(JSON.stringify(createSource()), 30);

    session.baselineScene.compositions[0].id = 'other-composition';
    session.baselineScene.entryCompositionId = 'other-composition';
    expect(() => restoreIREditing(JSON.stringify(session))).toThrow();
  });

  it.each([0, NaN, Infinity])('rejects invalid import frame rates: %s', frameRate => {
    expect(() => prepareIREditing(JSON.stringify(createSource()), frameRate)).toThrow('帧率');
  });

  it.each(['null', '[]', '{"meta":{},"layers":[]}'])('rejects non-GE source input: %s', text => {
    expect(() => prepareIREditing(text, 30)).toThrow('GE');
  });
});
