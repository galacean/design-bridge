import type { IRAnimatedProperty, IRComposition, IRFontAsset, IRImageAsset } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import type {
  ColorOverLifetime,
  ComponentData,
  DataPath,
  EffectsObjectData,
  JSONScene,
  PositionOverLifetime,
  RotationOverLifetime,
  SizeOverLifetime,
  VFXItemData,
} from '@galacean/effects-specification';
import type { EffectsLayerPreservedData } from '../preserved-data';

/** Generated item with a required transform and optional deprecated content. */
export type GeneratedVFXItemData = Omit<VFXItemData, 'content' | 'transform'> &
  Partial<Pick<VFXItemData, 'content'>> &
  Required<Pick<VFXItemData, 'transform'>>;

/** Generated component with specification fields and preserved extension data. */
export type GeneratedComponentData = ComponentData & Record<string, unknown>;

/** Multi-mask wire format consumed by the updated GE Runtime but not yet exposed by specification 2.8.1. */
export interface GeneratedMaskReference {
  mask: DataPath;
  inverted?: boolean;
}

export interface GeneratedMaskOptions {
  isMask?: boolean;
  alphaMaskEnabled?: boolean;
  references?: GeneratedMaskReference[];
}

/** Generated misc object with specification fields and timeline payloads. */
export type GeneratedMiscData = EffectsObjectData & Record<string, unknown>;

/** Pools collected while building a GE JSONScene. */
export interface ECSCollector {
  images: JSONScene['images'];
  fonts: NonNullable<JSONScene['fonts']>;
  components: GeneratedComponentData[];
  items: GeneratedVFXItemData[];
  textures: NonNullable<JSONScene['textures']>;
  miscs: GeneratedMiscData[];
}

/** Generated pools and bindings owned by one IR Composition. */
export interface GeneratedCompositionData {
  id: string;
  ir: IRComposition;
  itemBindings: GeneratedItemBinding[];
  items: GeneratedVFXItemData[];
  precompOutputIdByLayerId: ReadonlyMap<string, string>;
}

/** Links a generated item and its binding track to the originating IR layer. */
export interface GeneratedItemBinding {
  itemId: string;
  objectBindingTrackId?: string;
  layerId?: string;
}

/** Specification-defined GE animation data or an opaque preserved payload. */
export type GEAnimationPayload<T> = T | Record<string, unknown>;

/** Per-channel animation payload consumed by the timeline tracks. */
export interface TransformAnimation {
  positionOverLifetime?: GEAnimationPayload<PositionOverLifetime>;
  rotationOverLifetime?: GEAnimationPayload<RotationOverLifetime>;
  sizeOverLifetime?: GEAnimationPayload<SizeOverLifetime>;
  colorOverLifetime?: GEAnimationPayload<ColorOverLifetime>;
}

/** Shared context for layer generation. */
export interface LayerGenerationContext {
  /** IR Composition used for normalized semantics. */
  ir: IRComposition;
  layerDataById: Readonly<Record<string, EffectsLayerPreservedData>>;
  compositionById: ReadonlyMap<string, IRComposition>;
  inheritedOpacity?: IRAnimatedProperty<number>;
  precompOutputIdByLayerId: ReadonlyMap<string, string>;
  collector: ECSCollector;
  itemBindings: GeneratedItemBinding[];
  layerToItemId: Record<string, string>;
  layerToComponentId: Record<string, string>;
  textureCache: Map<string, DataPath>;
  imageAssetById: ReadonlyMap<string, IRImageAsset>;
  fontAssetById: ReadonlyMap<string, IRFontAsset>;
  parentLayerIdSet: Set<string>;
  ratio: number;
  width: number;
  height: number;
  frameRate: number;
  diagnostics: ConversionDiagnostic[];
  /** Visual item that owns a layer-local mask source. */
  layerToMaskParentItemId: Record<string, string>;
  /** Layer-local point represented by the generated mask parent's origin. */
  layerToMaskCoordinateOrigin: Record<string, [number, number]>;
}
