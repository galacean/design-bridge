import { describe, expect, it } from 'vitest';
import {
  getEffectsLayerPreservedData,
  hasEffectsAnimationPreservedData,
  hasEffectsColorAnimationPreservedData,
  invalidateEffectsLayerPreservedData,
} from '../src/layer-preserved-data';
import {
  GE_PRESERVED_DATA_VERSION, type EffectsLayerPreservedData, type GEToIRPreservedData,
} from '../src/preserved-data';

function makeLayerData(): EffectsLayerPreservedData {
  return {
    rotationOverLifetime: { z: [] },
    colorOverLifetime: { color: [], opacity: [] },
    spriteSplits: [[0, 0, 1, 1, 0]],
    textureSheetAnimation: { col: 6, row: 6, total: 36, animate: true, loop: true },
    sourceHierarchy: 'single-item',
  };
}

function makePreservedData(layerData = makeLayerData()): GEToIRPreservedData {
  return {
    version: GE_PRESERVED_DATA_VERSION,
    particleSourceData: { particleEffectGroups: [], layers: [] },
    compositionBindings: {
      composition: {
        sourceCompositionId: 'source-composition',
        sourceItemOrder: [],
        layerDataById: { layer: layerData },
      },
    },
  };
}

describe('GE Layer preserved data', () => {
  it('resolves data by scoped Composition and Layer identities', () => {
    const preservedData = makePreservedData();

    expect(getEffectsLayerPreservedData(preservedData, 'composition', 'layer')).toBe(
      preservedData.compositionBindings['composition'].layerDataById['layer'],
    );
    expect(getEffectsLayerPreservedData(preservedData, 'other-composition', 'layer')).toBeUndefined();
  });

  it('invalidates shadowing fields and prunes empty Layer data', () => {
    const preservedData = makePreservedData();
    const layerData = getEffectsLayerPreservedData(preservedData, 'composition', 'layer');

    expect(hasEffectsAnimationPreservedData(layerData)).toBe(true);
    expect(hasEffectsColorAnimationPreservedData(layerData)).toBe(true);
    expect(invalidateEffectsLayerPreservedData(preservedData, 'composition', 'layer', 'rotation')).toEqual([
      'rotationOverLifetime',
      'sourceHierarchy',
    ]);
    expect(layerData?.rotationOverLifetime).toBeUndefined();
    expect(layerData?.sourceHierarchy).toBeUndefined();
    expect(invalidateEffectsLayerPreservedData(preservedData, 'composition', 'layer', 'asset')).toEqual([
      'spriteSplits',
      'textureSheetAnimation',
    ]);
    expect(invalidateEffectsLayerPreservedData(preservedData, 'composition', 'layer', 'opacity')).toEqual([
      'colorOverLifetime',
    ]);
    expect(preservedData.compositionBindings['composition'].layerDataById['layer']).toBeUndefined();
  });

  it('detects texture sheet animation as preserved GE animation data', () => {
    const layerData: EffectsLayerPreservedData = {
      textureSheetAnimation: { row: 1, col: 1, animate: false },
    };

    expect(hasEffectsAnimationPreservedData(layerData)).toBe(true);
  });

  it('invalidates the trusted particle payload when a particle layer changes type', () => {
    const preservedData = makePreservedData({
      particleContent: { renderer: { texture: { id: 'texture' } }, shape: { type: 1 } },
    });

    expect(invalidateEffectsLayerPreservedData(preservedData, 'composition', 'layer', 'particle')).toEqual([
      'particleContent',
    ]);
    expect(preservedData.compositionBindings['composition'].layerDataById['layer']).toBeUndefined();
  });

  it('invalidates preserved GE image tint when normalized color changes', () => {
    const preservedData = makePreservedData({
      colorOverLifetime: { opacity: [] },
      spriteStartColor: [0.5, 0.25, 0.75, 0.8],
    });

    expect(invalidateEffectsLayerPreservedData(preservedData, 'composition', 'layer', 'color')).toEqual([
      'colorOverLifetime',
      'spriteStartColor',
    ]);
    expect(preservedData.compositionBindings['composition'].layerDataById['layer']).toBeUndefined();
  });
});
