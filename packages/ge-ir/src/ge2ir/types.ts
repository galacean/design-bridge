import type {
  IRColor, IREndBehavior, IRFontAsset,
  IRImageAsset,
} from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import type { GESceneCollectionIndex } from '../common/data-path';

/** Options for converting a GE scene to IR. */
export interface GEToIROptions {
  /** Positive finite frames per second used to convert GE timing in seconds to IR frames. */
  frameRate: number;
  /** Absolute base URL for resolving relative image and font URLs; resources are not fetched. */
  resourceBaseUrl?: string;
  /** Reviewed activity regions keyed by source GE Composition ID, in source-preview pixels. */
  particleAuthoringBounds?: Readonly<Record<string, {
    bounds: readonly [x: number, y: number, width: number, height: number];
    source: 'authored' | 'reviewed_multiframe_playback';
  }>>;
}

export interface GEAssetRegistry {
  imageAssetById: Map<string, IRImageAsset>;
  imageAssetIdBySourceId: Map<string, string>;
  fontAssetById: Map<string, IRFontAsset>;
  fontAssetIdByIdentity: Map<string, string>;
}

export interface GESceneContext {
  diagnostics: ConversionDiagnostic[];
  compositionId: string;
  irCompositionId: string;
  compositionIdBySourceId: ReadonlyMap<string, string>;
  compositionStartFrameBySourceId: ReadonlyMap<string, number>;
  compositionStartTime: number;
  resourceBaseUrl?: string;
  width: number;
  height: number;
  frameRate: number;
  ratio: number;
  textScaleIncludesSize?: boolean;
  duration: number;
  inPoint: number;
  outPoint: number;
  compositionName?: string;
  camera?: Record<string, unknown>;
  endBehavior: IREndBehavior;
  backgroundColor?: IRColor;
  itemById: GESceneCollectionIndex;
  componentById: GESceneCollectionIndex;
  miscById: GESceneCollectionIndex;
  imageById: GESceneCollectionIndex;
  textureById: GESceneCollectionIndex;
  imageAssetById: Map<string, IRImageAsset>;
  imageAssetIdBySourceId: Map<string, string>;
  fontDefinitionByFamily: Map<string, Record<string, unknown>>;
  fontAssetById: Map<string, IRFontAsset>;
  fontAssetIdByIdentity: Map<string, string>;
  itemIdToTrackId: Map<string, string>;
}
