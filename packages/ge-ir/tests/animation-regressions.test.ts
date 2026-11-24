import { describe, expect, it } from 'vitest';
import { BezierCurve, BezierCurvePath } from '@galacean/effects';
import {
  DataType, ValueType, type JSONScene, type TransformPlayableAssetData, type SpriteColorPlayableAssetData,
} from '@galacean/effects-specification';
import { IREndBehavior, type IRLayer, type IRScene, type IRTransform, type IRVec3 } from '@galacean/animation-ir';
import { convertGEToIR, convertIRToGE, updateGEToIRPreservedData } from '../src';

function solid(id: string, transform: IRTransform = {}): IRLayer {
  return {
    id, name: id, type: 'solid', visible: true, time: { inFrame: 0, outFrame: 60 },
    content: { color: [1, 0, 0, 1] }, localBounds: { x: 0, y: 0, width: 20, height: 20 },
    transform: { anchor: { type: 'static', value: [10, 10, 0] }, ...transform },
  };
}

function scene(layers: IRLayer[]): IRScene {
  return {
    format: 'animation-ir', schemaVersion: '1.0.0', entryCompositionId: 'root', assets: [],
    compositions: [{
      id: 'root', width: 100, height: 100, frameRate: 30, inPoint: 0, outPoint: 60,
      endBehavior: IREndBehavior.Freeze, layers,
    }],
  };
}

function importGE(source: JSONScene) {
  return convertGEToIR({ ...source }, { frameRate: 30 });
}

function positionCurve(source: JSONScene): BezierCurvePath {
  const asset = source.miscs.find((value): value is TransformPlayableAssetData =>
    value.dataType === DataType.TransformPlayableAsset,
  );
  const path = asset?.positionOverLifetime?.path;

  if (path?.[0] !== ValueType.BEZIER_CURVE_PATH) {
    throw new Error('Expected a Bezier position path');
  }

  return new BezierCurvePath(path[1]);
}

function opacityCurve(source: JSONScene): BezierCurve {
  const asset = source.miscs.find((value): value is SpriteColorPlayableAssetData =>
    value.dataType === DataType.SpriteColorPlayableAsset,
  );
  const opacity = asset?.colorOverLifetime?.opacity;

  if (opacity?.[0] !== ValueType.BEZIER_CURVE) {
    throw new Error('Expected a Bezier opacity curve');
  }

  return new BezierCurve(opacity[1]);
}

describe('animation export regressions', () => {
  it.each([[-2, -8], [-2, -2]])('preserves animated depth from %s to %s', (startZ, endZ) => {
    const output = convertIRToGE(scene([solid('depth', { position: { type: 'keyframed', keyframes: [
      { frame: 0, value: [50, 50, startZ] }, { frame: 30, value: [50, 50, endZ] },
    ] } })]));
    const curve = positionCurve(output.scene);

    expect(curve.getValue(0).z).toBe(startZ);
    expect(curve.getValue(0.25).z).toBeCloseTo((startZ + endZ) / 2, 2);
    expect(curve.getValue(0.5).z).toBe(endZ);
    expect(output.diagnostics).toEqual([]);
  });

  it('keeps spatial handles when adding a thirteenth position keyframe', () => {
    const make = (count: number) => scene([solid('curve', { position: {
      type: 'keyframed', keyframes: Array.from({ length: count }, (_, index) => ({
        frame: index * 4, value: [10 + index * 5, 50, 0] as IRVec3,
        spatialOut: [0, 20, 0] as IRVec3, spatialIn: [0, 20, 0] as IRVec3,
      })),
    } })]);
    const twelve = positionCurve(convertIRToGE(make(12)).scene).getValue(2 / 60);
    const thirteen = positionCurve(convertIRToGE(make(13)).scene).getValue(2 / 60);

    expect(twelve.y).toBeLessThan(-1);
    expect(thirteen.toArray()).toEqual(twelve.toArray());
  });

  it.each(['hold', 'endValue'] as const)('preserves a final opacity jump after %s', mode => {
    const output = convertIRToGE(scene([solid('jump', { opacity: { type: 'keyframed', keyframes: [
      { frame: 0, value: 0.2, ...(mode === 'hold' ? { hold: true } : { endValue: 0.5 }) },
      { frame: 30, value: 0.8 },
    ] } })]));
    const curve = opacityCurve(output.scene);

    expect(curve.getValue(0.25)).toBeCloseTo(mode === 'hold' ? 0.2 : 0.35, 4);
    expect(curve.getValue(0.75)).toBeCloseTo(0.8, 4);
  });

  it('preserves a final position jump after a held segment', () => {
    const output = convertIRToGE(scene([solid('jump', { position: { type: 'keyframed', keyframes: [
      { frame: 0, value: [50, 50, -2], hold: true, spatialOut: [10, 20, 5] },
      { frame: 30, value: [50, 50, -8], spatialIn: [-10, -20, -5] },
    ] } })]));
    const curve = positionCurve(output.scene);

    expect(curve.getValue(0.25).z).toBe(-2);
    expect(curve.getValue(0.75).z).toBe(-8);
  });

  it.each(['static', 'keyframed'] as const)('preserves depth-only %s scale on a parent', type => {
    const scale: IRVec3 = [1, 1, 2];
    const parent: IRLayer = {
      id: 'parent', name: 'parent', type: 'null', visible: true, time: { inFrame: 0, outFrame: 60 },
      transform: { scale: type === 'static' ? { type, value: scale } : {
        type, keyframes: [{ frame: 0, value: scale }],
      } },
    };
    const child = { ...solid('child', { position: { type: 'static', value: [50, 50, -2] } }), parentId: 'parent' };
    const imported = importGE(convertIRToGE(scene([parent, child])).scene);

    expect(imported.scene.compositions[0].layers.find(layer => layer.name === 'parent')?.transform?.scale)
      .toEqual({ type: 'static', value: scale });
  });

  it.each([[0, 60, 30], [15, 45, 30], [0, 60, 60]])(
    'keeps absolute keyframes after changing visibility to [%s, %s] at %s fps', (inFrame, outFrame, frameRate) => {
      const layer = solid('timing', {
        opacity: { type: 'keyframed', keyframes: [{ frame: 0, value: 0.2 }, { frame: 30, value: 0.8 }] },
        rotation: { z: { type: 'keyframed', keyframes: [{ frame: 0, value: 10 }, { frame: 30, value: 70 }] } },
        scale: { type: 'keyframed', keyframes: [{ frame: 0, value: [1, 1, 1] }, { frame: 30, value: [2, 2, 2] }] },
      });

      layer.time.outFrame = 30;
      const imported = importGE(convertIRToGE(scene([layer])).scene);
      const edited = structuredClone(imported.scene);

      edited.compositions[0].frameRate = frameRate;
      edited.compositions[0].layers[0].time = { inFrame, outFrame };
      const preservedData = updateGEToIRPreservedData(imported.scene, edited, imported.preservedData);
      const output = convertIRToGE(edited, { preservedData });
      const curve = opacityCurve(output.scene);

      expect(curve.getValue((30 - inFrame) / (outFrame - inFrame))).toBeCloseTo(0.8, 4);
      const actual = convertGEToIR({ ...output.scene }, { frameRate }).scene.compositions[0].layers[0].transform;

      for (const property of [actual?.opacity, actual?.rotation?.z, actual?.scale]) {
        expect(property?.type).toBe('keyframed');
        if (property?.type === 'keyframed') {
          expect(property.keyframes.map(keyframe => keyframe.frame)).toEqual([0, 30]);
        }
      }
      expect(imported.scene.compositions[0].layers[0].time.outFrame).toBe(30);
    },
  );

  it.each([30, 60])('retains raw spatial animation when extending a layer at %s fps', frameRate => {
    const layer = solid('path', {
      position: { type: 'keyframed', keyframes: [
        { frame: 0, value: [20, 50, 0] }, { frame: 30, value: [80, 50, 0] },
      ] },
      opacity: { type: 'keyframed', keyframes: [{ frame: 0, value: 0.2 }, { frame: 30, value: 0.8 }] },
    });

    layer.time.outFrame = 30;
    const source = convertIRToGE(scene([layer])).scene;
    const colorAsset = source.miscs.find((value): value is SpriteColorPlayableAssetData =>
      value.dataType === DataType.SpriteColorPlayableAsset,
    );

    if (colorAsset?.colorOverLifetime == null) {
      throw new Error('Expected color animation');
    }
    colorAsset.colorOverLifetime.color = [ValueType.GRADIENT_COLOR, [[0, 255, 0, 0, 1], [1, 0, 0, 255, 1]]];
    const imported = importGE(source);
    const edited = structuredClone(imported.scene);
    const composition = edited.compositions[0];
    const editedLayer = composition.layers[0];

    composition.frameRate = frameRate;
    composition.outPoint = frameRate * 2;
    editedLayer.time.outFrame = frameRate * 2;
    const preservedData = updateGEToIRPreservedData(imported.scene, edited, imported.preservedData);
    const output = convertIRToGE(edited, { preservedData });

    for (const normalizedTime of [0.25, 0.5]) {
      const actual = positionCurve(output.scene).getValue(normalizedTime).toArray();
      const expected = positionCurve(source).getValue(normalizedTime * 2).toArray();

      actual.forEach((value, dimension) => expect(value).toBeCloseTo(expected[dimension], 4));
    }
    expect(opacityCurve(output.scene).getValue(30 / (frameRate * 2))).toBeCloseTo(0.8, 4);
    const outputColor = output.scene.miscs.find((value): value is SpriteColorPlayableAssetData =>
      value.dataType === DataType.SpriteColorPlayableAsset,
    );

    expect(outputColor?.colorOverLifetime?.color).toEqual([
      ValueType.GRADIENT_COLOR, [[0, 255, 0, 0, 1], [0.5, 0, 0, 255, 1]],
    ]);
  });

  it.each([false, true])('keeps inserted painter order with runtime preservation=%s', preserveRuntime => {
    const source = convertIRToGE(scene([solid('back'), solid('front')])).scene;
    const imported = convertGEToIR({ ...source, ...(preserveRuntime && { renderSettings: {} }) }, { frameRate: 30 });
    const edited = structuredClone(imported.scene);

    edited.compositions[0].layers.splice(1, 0, solid('middle'));
    const preservedData = updateGEToIRPreservedData(imported.scene, edited, imported.preservedData);
    const output = convertIRToGE(edited, { preservedData });

    expect(importGE(output.scene).scene.compositions[0].layers.map(layer => layer.name))
      .toEqual(['back', 'middle', 'front']);
  });
});
