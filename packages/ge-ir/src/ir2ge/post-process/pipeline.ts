import type { IRComposition } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import { roundNumber } from '../../common/math';
import type { ECSCollector, GeneratedItemBinding } from '../types';
import type { EffectsLayerPreservedData } from '../../preserved-data';
import { applyParenting } from './parenting';
import { applyMasks, type MaskLayerLookup, type RuntimeMaskState } from './mask';
import { applyLayerMattes } from './matte';
import { applyGEMaskRemap } from './ge-mask-remap';
import { normalizeHierarchyActivationIntervals } from './normalize-activation-intervals';

/** Complete generation state consumed by the ordered post-processing pipeline. */
interface PostProcessState {
  collector: ECSCollector;
  itemBindings: GeneratedItemBinding[];
  compositionById: ReadonlyMap<string, IRComposition>;
  /** Per-layer lookups used during mask generation. */
  maskLookup: MaskLayerLookup;
  runtimeMaskState: RuntimeMaskState;
  layerToItemId: Record<string, string>;
  layerToComponentId: Record<string, string>;
  ratio: number;
  width: number;
  height: number;
  frameRate: number;
  /** Remaps preserved mask references. */
  geComponentIdToNewId: Record<string, string>;
  layerDataById: Readonly<Record<string, EffectsLayerPreservedData>>;
  diagnostics: ConversionDiagnostic[];
}

/** Run ordered post-generation passes before scene assembly. */
export function applyPostProcess(ir: IRComposition, state: PostProcessState): void {
  const { collector, itemBindings, layerToItemId, ratio, width, height } = state;

  applyParenting(ir.layers, collector.items, layerToItemId, ratio, width, height);
  applyMasks(
    ir,
    collector,
    itemBindings,
    ratio,
    width,
    height,
    state.frameRate,
    state.maskLookup,
    state.compositionById,
    state.runtimeMaskState,
    state.diagnostics,
  );
  applyLayerMattes(ir, collector, state.layerToComponentId, state.runtimeMaskState, state.diagnostics);
  // Generated IR masks already use regenerated IDs; only preserved Effects masks need remapping.
  if (Object.values(state.layerDataById).some(layerData => layerData.mask != null)) {
    applyGEMaskRemap(collector, state.geComponentIdToNewId);
  }
  const transformParentChildItemIds = new Set<string>();

  for (const layer of ir.layers) {
    // Authored GE items keep their activation interval even when a child outlives them.
    if (layer.parentId != null && state.layerDataById[layer.parentId]?.sourceHierarchy !== 'single-item') {
      const itemId = layerToItemId[layer.id];

      if (itemId != null) {
        transformParentChildItemIds.add(itemId);
      }
    }
  }

  normalizeHierarchyActivationIntervals({
    items: collector.items,
    miscs: collector.miscs,
    itemBindings,
    transformParentChildItemIds,
    roundNumber,
  });
}
