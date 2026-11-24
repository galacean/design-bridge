import { describe, expect, it } from 'vitest';
import { IREndBehavior, type IRScene } from '@galacean/animation-ir';
import { type GEToIRPreservedData, updateGEToIRPreservedData } from '../src';
import { GE_PRESERVED_DATA_VERSION } from '../src/preserved-data';

function createScene(): IRScene {
  return {
    format: 'animation-ir',
    schemaVersion: '1.0.0',
    entryCompositionId: 'root',
    compositions: [{
      id: 'root',
      width: 100,
      height: 100,
      frameRate: 30,
      inPoint: 0,
      outPoint: 30,
      endBehavior: IREndBehavior.Freeze,
      layers: [{
        id: 'image-layer',
        type: 'image',
        time: { inFrame: 0, outFrame: 30 },
        visible: true,
        localBounds: { x: 0, y: 0, width: 10, height: 10 },
        transform: {
          rotation: { z: { type: 'static', value: 0 } },
          opacity: { type: 'static', value: 1 },
        },
        content: { assetId: 'image-asset' },
      }, {
        id: 'deleted-layer',
        type: 'null',
        time: { inFrame: 0, outFrame: 30 },
        visible: true,
      }],
    }],
    assets: [{
      id: 'image-asset',
      type: 'image',
      source: { kind: 'url', url: 'https://example.com/image.png' },
    }],
  };
}

function createPreservedData(): GEToIRPreservedData {
  return {
    version: GE_PRESERVED_DATA_VERSION,
    sourceScene: { version: '3.0' },
    particleSourceData: { particleEffectGroups: [], layers: [] },
    compositionBindings: {
      root: {
        sourceCompositionId: 'source-root',
        sourceItemOrder: ['source-image', 'source-null'],
        layerDataById: {
          'image-layer': {
            rotationOverLifetime: { z: [] },
            colorOverLifetime: { opacity: [] },
            spriteSplits: [[0, 0, 1, 1, 0]],
            textureSheetAnimation: { row: 1, col: 1, animate: false },
            sourceHierarchy: 'single-item',
            sourceItemIds: ['source-image'],
          },
          'deleted-layer': { sourceItemIds: ['source-null'] },
        },
      },
    },
  };
}

function addParticleSourceData(scene: IRScene, preservedData: GEToIRPreservedData): void {
  scene.compositions[0].layers.push({
    id: 'particle-layer',
    type: 'particle',
    time: { inFrame: 0, outFrame: 30 },
    visible: true,
    localBounds: { x: 0, y: 0, width: 100, height: 100 },
    content: {
      maxParticles: 10,
      startLifetime: { type: 'constant', value: 30 },
      emission: { rateOverTime: { type: 'constant', value: 5 } },
    },
  });
  preservedData.compositionBindings['root'].sourceItemOrder.push('source-particle');
  preservedData.compositionBindings['root'].layerDataById['particle-layer'] = {
    sourceItemIds: ['source-particle'],
    sourceComponentId: 'source-particle-component',
    particleContent: { shape: { type: 0 } },
  };
  preservedData.particleSourceData = {
    particleEffectGroups: [{
      id: 'source-root',
      irCompositionId: 'root',
      sourcePreviewSize: [100, 100],
      authoringBounds: [0, 0, 100, 100],
    }],
    layers: [{
      effectGroupId: 'source-root',
      irCompositionId: 'root',
      irLayerId: 'particle-layer',
      sourceOrder: 2,
    }],
  };
}

describe('updateGEToIRPreservedData', () => {
  it('invalidates preserved mask references when an authored stack entry changes', () => {
    const baseline = createScene();

    baseline.compositions[0].layers[0].masks = [{
      mode: 'add',
      path: {
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
        inTangents: Array.from({ length: 3 }, () => ({ x: 0, y: 0 })),
        outTangents: Array.from({ length: 3 }, () => ({ x: 0, y: 0 })),
        closed: true,
      },
    }];
    const edited = structuredClone(baseline);
    const preserved = createPreservedData();
    const sourceData = preserved.compositionBindings['root'].layerDataById['image-layer'];

    sourceData.mask = { references: [{ mask: { id: 'mask-source' } }] };
    expect(updateGEToIRPreservedData(baseline, edited, preserved)
      .compositionBindings['root'].layerDataById['image-layer'].mask).toEqual(sourceData.mask);
    edited.compositions[0].layers[0].masks![0].inverted = true;
    const updated = updateGEToIRPreservedData(baseline, edited, preserved);

    expect(updated.compositionBindings['root'].layerDataById['image-layer'].mask).toBeUndefined();
    expect(sourceData.mask).toEqual({ references: [{ mask: { id: 'mask-source' } }] });
  });

  it('moves source item groups with edited IR order while retaining their internal order and unowned slots', () => {
    const baseline = createScene();
    const edited = structuredClone(baseline);
    const preserved = createPreservedData();
    const binding = preserved.compositionBindings['root'];

    binding.layerDataById['image-layer'].sourceItemIds = ['source-image', 'image-helper'];
    binding.sourceItemOrder = ['source-image', 'unowned', 'image-helper', 'source-null'];
    edited.compositions[0].layers.reverse();
    const result = updateGEToIRPreservedData(baseline, edited, preserved);

    expect(result.compositionBindings['root'].sourceItemOrder).toEqual([
      'source-null', 'unowned', 'source-image', 'image-helper',
    ]);
    expect(binding.sourceItemOrder).toEqual(['source-image', 'unowned', 'image-helper', 'source-null']);
  });

  it('invalidates GE-owned values that would shadow normalized IR edits', () => {
    const baselineScene = createScene();
    const updatedScene = structuredClone(baselineScene);
    const updatedLayer = updatedScene.compositions[0].layers[0];
    const invalidations: string[] = [];

    if (updatedLayer.type !== 'image') {
      throw new Error('expected image Layer');
    }

    updatedLayer.transform = {
      ...updatedLayer.transform,
      rotation: { z: { type: 'static', value: 45 } },
      opacity: { type: 'static', value: 0.5 },
    };
    updatedScene.assets[0] = {
      ...updatedScene.assets[0],
      source: { kind: 'url', url: 'https://example.com/edited.png' },
    };

    const originalPreservedData = createPreservedData();
    const updatedPreservedData = updateGEToIRPreservedData(baselineScene, updatedScene, originalPreservedData, {
      onChange: change => invalidations.push(change.field),
    });
    const updatedLayerData = updatedPreservedData.compositionBindings['root'].layerDataById['image-layer'];

    expect(updatedLayerData).toEqual({ sourceItemIds: ['source-image'] });
    expect(invalidations).toEqual([
      'rotationOverLifetime',
      'sourceHierarchy',
      'colorOverLifetime',
      'spriteSplits',
      'textureSheetAnimation',
    ]);
    expect(originalPreservedData.compositionBindings['root'].layerDataById['image-layer']).toHaveProperty(
      'rotationOverLifetime',
    );
  });

  it('removes bindings for deleted IR Layers and Compositions', () => {
    const baselineScene = createScene();

    baselineScene.compositions.push({
      id: 'deleted-composition',
      width: 10,
      height: 10,
      frameRate: 30,
      inPoint: 0,
      outPoint: 1,
      endBehavior: IREndBehavior.Freeze,
      layers: [],
    });
    const preservedData = createPreservedData();

    preservedData.compositionBindings['deleted-composition'] = {
      sourceCompositionId: 'source-deleted-composition',
      sourceItemOrder: [],
      layerDataById: {},
    };

    const updatedScene = structuredClone(baselineScene);

    updatedScene.compositions = [updatedScene.compositions[0]];
    updatedScene.compositions[0].layers = updatedScene.compositions[0].layers.filter(
      layer => layer.id !== 'deleted-layer',
    );

    const updatedPreservedData = updateGEToIRPreservedData(baselineScene, updatedScene, preservedData);

    expect(updatedPreservedData.compositionBindings['deleted-composition']).toBeUndefined();
    expect(updatedPreservedData.compositionBindings['root'].layerDataById['deleted-layer']).toBeUndefined();
    expect(preservedData.compositionBindings['deleted-composition']).toBeDefined();
  });

  it('removes particle projection source data when its IR Particle Layer is deleted', () => {
    const baselineScene = createScene();
    const preservedData = createPreservedData();

    addParticleSourceData(baselineScene, preservedData);
    const updatedScene = structuredClone(baselineScene);

    updatedScene.compositions[0].layers = updatedScene.compositions[0].layers.filter(
      layer => layer.id !== 'particle-layer',
    );

    const updatedPreservedData = updateGEToIRPreservedData(baselineScene, updatedScene, preservedData);

    expect(updatedPreservedData.particleSourceData).toEqual({ particleEffectGroups: [], layers: [] });
    expect(preservedData.particleSourceData.layers).toHaveLength(1);
  });
});
