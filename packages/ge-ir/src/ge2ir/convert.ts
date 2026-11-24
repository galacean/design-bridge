import {
  ANIMATION_IR_SCHEMA_VERSION, type IRComposition, type IRAsset, type IRScene,
  type IRFontAsset, type IRImageAsset,
} from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import { assertIRScene, isIRId } from '@galacean/animation-ir/validator';
import { DataType, ItemType } from '@galacean/effects-specification';
import { assembleIRComposition } from './assemble';
import { extractGEParticleSourceData } from './extract-particle-source-data';
import { preserveSourceScene } from './preserve-scene';
import { resolveDataPathId } from '../common/data-path';
import { createId } from '../common/id';
import { buildSceneContext, getCompositionItemIds } from './parser/build-scene-context';
import { parseItemToLayer } from './parser/parse-item-layer';
import { mergeNullVisualPairs, resolveHierarchy, type RawLayerDescriptor } from './post-process';
import { normalizeGEMasks, type GEMaskNormalizationComposition } from './post-process/mask';
import type { GEAssetRegistry, GEToIROptions } from './types';
import type { GEToIRResult } from '../conversion';
import {
  GE_PRESERVED_DATA_VERSION, type GECompositionSourceBinding, type GEToIRPreservedData,
} from '../preserved-data';

/**
 * Convert a parsed GE scene to validated Animation IR and paired GE-owned preserved data.
 * Inspect diagnostics for unsupported or approximated content, and retain the sidecar for later GE export.
 */
export function convertGEToIR(scene: Record<string, unknown>, options: GEToIROptions): GEToIRResult {
  const sourceCompositions = Array.isArray(scene['compositions'])
    ? scene['compositions'].filter(
        (value): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value),
      )
    : [];
  const compositionIdBySourceId = new Map<string, string>();
  const compositionStartFrameBySourceId = new Map<string, number>();

  for (const [index, composition] of sourceCompositions.entries()) {
    const sourceId = typeof composition['id'] === 'string' ? composition['id'] : `composition-${index}`;
    const compositionId = isIRId(sourceId)
      ? sourceId
      : createId();
    const startTime = typeof composition['startTime'] === 'number' && Number.isFinite(composition['startTime'])
      ? composition['startTime']
      : 0;

    compositionIdBySourceId.set(sourceId, compositionId);
    compositionStartFrameBySourceId.set(sourceId, startTime * options.frameRate);
  }

  const diagnostics: ConversionDiagnostic[] = [];
  const compositions: IRComposition[] = [];
  const compositionBindings: Record<string, GECompositionSourceBinding> = {};
  const parsedCompositions: Array<GEMaskNormalizationComposition & {
    sourceItemOrder: string[]; runtimeItemIds: string[]; runtimeComponentIds: string[];
  }> = [];
  const assetRegistry: GEAssetRegistry = {
    imageAssetById: new Map<string, IRImageAsset>(),
    imageAssetIdBySourceId: new Map(),
    fontAssetById: new Map<string, IRFontAsset>(),
    fontAssetIdByIdentity: new Map(),
  };
  let shouldPreserveSourceScene = scene['renderSettings'] != null;

  for (const sourceComposition of sourceCompositions) {
    const sourceCompositionId = sourceComposition['id'];

    if (typeof sourceCompositionId !== 'string') {
      continue;
    }
    const ctx = buildSceneContext(
      scene,
      options,
      sourceCompositionId,
      compositionIdBySourceId,
      compositionStartFrameBySourceId,
      assetRegistry,
      diagnostics,
    );
    const itemIds = getCompositionItemIds(scene, sourceCompositionId);

    // Source Item types and referenced ParticleSystems cover unsupported items even when parsing yields no descriptor.
    shouldPreserveSourceScene ||= itemIds.some(
      itemId => {
        const item = ctx.itemById.get(itemId);
        const itemType = item?.['type'];

        return itemType === ItemType.composition || itemType === ItemType.particle ||
          referencesParticleSystem(item, ctx.componentById);
      },
    );
    const descriptors: RawLayerDescriptor[] = [];
    const runtimeItemIds: string[] = [];
    const runtimeComponentIds = Array.isArray(sourceComposition['components'])
      ? sourceComposition['components'].flatMap(reference => {
          const id = resolveDataPathId(reference);
          const component = id == null ? undefined : ctx.componentById.get(id);

          return id != null && component != null && component['dataType'] !== DataType.CompositionComponent ? [id] : [];
        })
      : [];

    // Resolved GE Items and IR layers both use back-to-front painter order.
    for (const itemId of itemIds) {
      const item = ctx.itemById.get(itemId);

      if (item == null) {
        continue;
      }
      const parsedLayer = parseItemToLayer(item, itemId, ctx);

      if (parsedLayer == null) {
        runtimeItemIds.push(itemId);
        diagnostics.push({
          code: 'GE_RUNTIME_ITEM_PRESERVED',
          severity: 'warning',
          action: 'unsupported',
          path: `$.items[id=${JSON.stringify(itemId)}]`,
          sourceId: itemId,
          feature: String(item['type'] ?? 'unknown-item-type'),
          message: `GE item '${itemId}' is retained in preservedData; its content is not editable through Animation IR.`,
        });
        continue;
      }
      descriptors.push({ itemId, item, ...parsedLayer });
    }
    // Parsed types catch ParticleSystem components attached to Items whose declared type is not Particle.
    shouldPreserveSourceScene ||= descriptors.some(descriptor =>
      descriptor.layer.type === 'particle' || descriptor.preservedData.geometry != null ||
      (descriptor.preservedData.additionalComponentIds?.length ?? 0) > 0,
    ) || runtimeItemIds.length > 0 || runtimeComponentIds.length > 0;

    const mergedDescriptors = mergeNullVisualPairs(descriptors, ctx);

    parsedCompositions.push({
      sourceCompositionId,
      sourceItemOrder: itemIds,
      runtimeItemIds,
      runtimeComponentIds,
      ctx,
      descriptors: mergedDescriptors,
    });
  }

  normalizeGEMasks(parsedCompositions, diagnostics);

  for (const { sourceCompositionId, sourceItemOrder, runtimeItemIds, runtimeComponentIds, ctx, descriptors }
    of parsedCompositions) {
    const layerDataById = Object.fromEntries(
      descriptors.map(descriptor => [descriptor.layer.id, descriptor.preservedData]),
    );

    resolveHierarchy(descriptors, ctx);
    compositionBindings[ctx.irCompositionId] = {
      sourceCompositionId,
      ...(ctx.camera != null && { camera: ctx.camera }),
      sourceItemOrder,
      ...(runtimeItemIds.length > 0 && { runtimeItemIds }),
      ...(runtimeComponentIds.length > 0 && { runtimeComponentIds }),
      layerDataById,
    };
    compositions.push(assembleIRComposition(descriptors.map(descriptor => descriptor.layer), ctx));
  }

  const sourceEntryCompositionId = scene['compositionId'];
  const entryCompositionId = typeof sourceEntryCompositionId === 'string'
    ? compositionIdBySourceId.get(sourceEntryCompositionId)
    : undefined;

  if (entryCompositionId == null) {
    throw new Error('[ge2ir] entry composition was not found');
  }
  const assets: IRAsset[] = [
    ...Array.from(assetRegistry.imageAssetById.values()),
    ...Array.from(assetRegistry.fontAssetById.values()),
  ];
  const irScene: IRScene = {
    format: 'animation-ir',
    schemaVersion: ANIMATION_IR_SCHEMA_VERSION,
    entryCompositionId,
    compositions,
    assets,
  };
  const preservedData: GEToIRPreservedData = {
    version: GE_PRESERVED_DATA_VERSION,
    ...(shouldPreserveSourceScene && { sourceScene: preserveSourceScene(scene, options.resourceBaseUrl) }),
    compositionBindings,
    particleSourceData: { particleEffectGroups: [], layers: [] },
  };

  assertIRScene(irScene);
  preservedData.particleSourceData = extractGEParticleSourceData(
    irScene, preservedData, diagnostics, options.particleAuthoringBounds,
  );

  return { scene: irScene, preservedData, diagnostics };
}

function referencesParticleSystem(
  item: Record<string, unknown> | undefined,
  componentById: ReadonlyMap<string, Record<string, unknown>>,
): boolean {
  const componentReferences = item?.['components'];

  return Array.isArray(componentReferences) && componentReferences.some(reference => {
    const componentId = resolveDataPathId(reference);

    return componentId != null && componentById.get(componentId)?.['dataType'] === DataType.ParticleSystem;
  });
}
