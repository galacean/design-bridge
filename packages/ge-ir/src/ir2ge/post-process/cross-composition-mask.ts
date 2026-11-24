import { ItemType } from '@galacean/effects-specification';
import { isRecord } from '../../common/json-normalization';
import type { ECSCollector, GeneratedCompositionData, GeneratedVFXItemData } from '../types';
import { appendRuntimeMaskReference, type RuntimeMaskSourceMeta, type RuntimeMaskState } from './mask';
import { collectAnimatedTransformItemIds, mapMaskGeometryIntoPrecomp } from './mask-geometry';

/** Propagate Precomp mask sources through generated Composition boundaries. */
export function applyCrossCompositionMasks(
  generatedCompositions: GeneratedCompositionData[],
  collector: ECSCollector,
  runtimeMaskState: RuntimeMaskState,
): void {
  const generatedById = new Map(generatedCompositions.map(generated => [generated.id, generated] as const));
  const componentById = new Map(collector.components.map(component => [component.id, component] as const));
  const animatedItemIds = collectAnimatedTransformItemIds(generatedCompositions, collector.miscs);

  for (const generated of generatedCompositions) {
    const itemById = new Map(generated.items.map(item => [item.id, item] as const));

    for (const layer of generated.ir.layers) {
      if (layer.type !== 'precomp' || ((layer.masks?.length ?? 0) === 0 && !layer.content.clipToBounds)) {
        continue;
      }
      const outputCompositionId = generated.precompOutputIdByLayerId.get(layer.id) ?? layer.content.compositionId;
      const referenced = generatedById.get(outputCompositionId);
      const maskComponentIds = findLayerMaskComponentIds(generated.itemBindings, itemById, layer.id);

      if (referenced == null) {
        continue;
      }
      for (const maskComponentId of maskComponentIds) {
        const sourceMeta = runtimeMaskState.sources.get(maskComponentId);

        if (sourceMeta == null) {
          continue;
        }
        applyAncestorMaskThroughNestedCompositions({
          generated: referenced,
          maskComponentId,
          generatedById,
          componentById,
          runtimeMaskState,
          animatedItemIds,
          sourceMeta: { ...sourceMeta, geometrySpaceId: referenced.id },
          ancestorIds: new Set([generated.id, referenced.id]),
        });
      }
    }
  }
}

interface AncestorMaskContext {
  generated: GeneratedCompositionData;
  maskComponentId: string;
  generatedById: ReadonlyMap<string, GeneratedCompositionData>;
  componentById: ReadonlyMap<string, ECSCollector['components'][number]>;
  runtimeMaskState: RuntimeMaskState;
  animatedItemIds: ReadonlySet<string>;
  sourceMeta: RuntimeMaskSourceMeta;
  ancestorIds: ReadonlySet<string>;
}

function applyAncestorMaskThroughNestedCompositions(context: AncestorMaskContext): void {
  const {
    generated, maskComponentId, generatedById, componentById,
    runtimeMaskState, animatedItemIds, sourceMeta, ancestorIds,
  } = context;

  applyMaskToCompositionRenderers(generated, maskComponentId, componentById, runtimeMaskState, sourceMeta);

  for (const precompItem of generated.items) {
    const outputCompositionId = readPrecompReferenceId(precompItem);

    if (outputCompositionId == null || ancestorIds.has(outputCompositionId)) {
      continue;
    }
    const nested = generatedById.get(outputCompositionId);

    if (nested == null) {
      continue;
    }
    applyAncestorMaskThroughNestedCompositions({
      ...context,
      generated: nested,
      sourceMeta: {
        ...sourceMeta,
        geometry: mapMaskGeometryIntoPrecomp(sourceMeta.geometry, precompItem, generated.items, animatedItemIds),
        geometrySpaceId: nested.id,
      },
      ancestorIds: new Set([...ancestorIds, outputCompositionId]),
    });
  }
}

function findLayerMaskComponentIds(
  bindings: GeneratedCompositionData['itemBindings'],
  itemById: ReadonlyMap<string, GeneratedVFXItemData>,
  layerId: string,
): string[] {
  const componentIds: string[] = [];

  for (const binding of bindings) {
    if (binding.layerId !== layerId) {
      continue;
    }
    const item = itemById.get(binding.itemId);

    if (item?.type === ItemType.shape) {
      const componentId = item.components?.[0]?.id;

      if (componentId != null) {
        componentIds.push(componentId);
      }
    }
  }

  return componentIds;
}

function readPrecompReferenceId(item: GeneratedVFXItemData): string | undefined {
  if (item.type !== ItemType.composition || !isRecord(item.content)) {
    return undefined;
  }
  const options = item.content['options'];

  return isRecord(options) && typeof options['refId'] === 'string' ? options['refId'] : undefined;
}

/** Keep a source attached to its hierarchy so Runtime applies every animated ancestor transform. */
function applyMaskToCompositionRenderers(
  generated: GeneratedCompositionData,
  maskComponentId: string,
  componentById: ReadonlyMap<string, ECSCollector['components'][number]>,
  runtimeMaskState: RuntimeMaskState,
  sourceMeta: RuntimeMaskSourceMeta,
): void {
  for (const item of generated.items) {
    for (const componentRef of item.components ?? []) {
      const component = componentById.get(componentRef.id);

      if (component?.['renderer'] != null) {
        appendRuntimeMaskReference(component, maskComponentId, sourceMeta, runtimeMaskState);
      }
    }
  }
}
