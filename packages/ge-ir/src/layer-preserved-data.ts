import type { EffectsLayerPreservedData, GEToIRPreservedData } from './preserved-data';

/** Normalized field whose conflicting GE-owned Layer data should be removed. */
export type EffectsLayerPreservedDataInvalidationTarget =
  'position' | 'rotation' | 'scale' | 'color' | 'opacity' | 'anchor' | 'asset' | 'mask' | 'precomp' | 'particle';

/** Resolve GE-owned data by its scoped IR Composition and Layer identities. */
export function getEffectsLayerPreservedData(
  preservedData: GEToIRPreservedData | undefined,
  compositionId: string,
  layerId: string,
): EffectsLayerPreservedData | undefined {
  return preservedData?.compositionBindings[compositionId]?.layerDataById[layerId];
}

const EFFECTS_ANIMATION_DATA_KEYS = [
  'positionOverLifetime',
  'rotationOverLifetime',
  'sizeOverLifetime',
  'colorOverLifetime',
  'textureSheetAnimation',
] as const satisfies readonly (keyof EffectsLayerPreservedData)[];

const KEYS_BY_INVALIDATION_TARGET: Record<
  EffectsLayerPreservedDataInvalidationTarget,
  readonly (keyof EffectsLayerPreservedData)[]
> = {
  position: ['positionOverLifetime'],
  rotation: ['rotationOverLifetime', 'itemEulerHintById', 'sourceHierarchy'],
  scale: ['sizeOverLifetime', 'transformBaseScale', 'sourceHierarchy'],
  color: ['colorOverLifetime', 'spriteStartColor'],
  opacity: ['colorOverLifetime'],
  anchor: ['sourceHierarchy', 'itemAnchorById'],
  asset: ['spriteSplits', 'textureSheetAnimation', 'spriteTexture'],
  mask: ['mask'],
  precomp: ['precompContent'],
  particle: ['particleContent'],
};

/** Remove raw GE values that would otherwise shadow an edited normalized field. */
export function invalidateEffectsLayerPreservedData(
  preservedData: GEToIRPreservedData | undefined,
  compositionId: string,
  layerId: string,
  target: EffectsLayerPreservedDataInvalidationTarget,
): (keyof EffectsLayerPreservedData)[] {
  const layerDataById = preservedData?.compositionBindings[compositionId]?.layerDataById;
  const layerData = layerDataById?.[layerId];

  if (layerData == null) {
    return [];
  }

  const removed: (keyof EffectsLayerPreservedData)[] = [];

  for (const key of KEYS_BY_INVALIDATION_TARGET[target]) {
    if (key in layerData) {
      delete layerData[key];
      removed.push(key);
    }
  }

  if (Object.keys(layerData).length === 0 && layerDataById != null) {
    delete layerDataById[layerId];
  }

  return removed;
}

/** Whether invalidating opacity would also discard a preserved GE color animation. */
export function hasEffectsColorAnimationPreservedData(layerData: EffectsLayerPreservedData | undefined): boolean {
  const color = layerData?.colorOverLifetime;

  return color != null && Object.keys(color).some(channelKey => channelKey !== 'opacity');
}

/** Whether the Layer retains any raw GE animation payload. */
export function hasEffectsAnimationPreservedData(layerData: EffectsLayerPreservedData | undefined): boolean {
  return layerData != null && EFFECTS_ANIMATION_DATA_KEYS.some(key => layerData[key] != null);
}
