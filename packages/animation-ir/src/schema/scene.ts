import type { IRAsset } from './asset.js';
import type { IRLayer } from './layer.js';
import type { IRColor, IREndBehavior } from './value-types.js';

/** Schema revision accepted by the validator and stored in IRScene.schemaVersion. */
export const ANIMATION_IR_SCHEMA_VERSION = '1.0.0' as const;

/** Independent timeline and canvas. Playback t seconds from the start samples inPoint + t * frameRate. */
export interface IRComposition {
  /** Non-empty opaque identity, unique within the Scene. */
  id: string;
  name?: string;
  /** Canvas width in pixels; finite and greater than zero. */
  width: number;
  /** Canvas height in pixels; finite and greater than zero. */
  height: number;
  /** Frames per second; finite and greater than zero. */
  frameRate: number;
  /** Inclusive start in Composition frames; finite subframes are allowed. */
  inPoint: number;
  /** Exclusive end in Composition frames; must be greater than inPoint. */
  outPoint: number;
  backgroundColor?: IRColor;
  endBehavior: IREndBehavior;
  /** Back-to-front painter order: first is bottommost, last is topmost. */
  layers: IRLayer[];
}

/**
 * Source-neutral 2D animation scene shared by format adapters.
 * All compositions share the scene's image and font assets. Playback starts in the composition
 * identified by `entryCompositionId`, regardless of its position in `compositions`.
 */
export interface IRScene {
  format: 'animation-ir';
  schemaVersion: typeof ANIMATION_IR_SCHEMA_VERSION;
  /** Must resolve to exactly one entry in compositions. */
  entryCompositionId: string;
  compositions: IRComposition[];
  /** Shared resources with IDs unique across this Scene. */
  assets: IRAsset[];
}
