import { ANIMATION_IR_SCHEMA_VERSION, type IRAsset, type IRComposition, type IRScene } from '../schema/index.js';

/** Create a scene from one entry Composition and its shared resources. */
export function createIRScene(composition: IRComposition, assets: IRAsset[] = []): IRScene {
  return {
    format: 'animation-ir',
    schemaVersion: ANIMATION_IR_SCHEMA_VERSION,
    entryCompositionId: composition.id,
    compositions: [composition],
    assets,
  };
}

/** Resolve the scene entry Composition by ID. */
export function getIRSceneEntryComposition(scene: IRScene): IRComposition {
  const composition = scene.compositions.find(candidate => candidate.id === scene.entryCompositionId);

  if (composition == null) {
    throw new Error(`[animation-ir] Entry Composition '${scene.entryCompositionId}' was not found.`);
  }

  return composition;
}
