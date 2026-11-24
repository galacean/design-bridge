import type { IRScene, IRFontAsset, IRLayer } from '@galacean/animation-ir';
import {
  getIRResourceSourceUrl, type ConversionDiagnostic,
} from '@galacean/animation-ir/adapter';
import { assertIRScene } from '@galacean/animation-ir/validator';
import type { DataPath } from '@galacean/effects-specification';
import { get2dTo3dRatio } from '../common/coordinate-mapping';
import { assembleSourcePreservedData } from './assemble-source-preserved-data';
import { assembleGEScene } from './assemble';
import { buildCompositionGenerationPlan, collectPrecompExportDiagnostics } from './converter/precomp';
import { appendNullLayer, appendParentLayer, appendPrecompLayer, appendVisualLayer } from './generator/append-layer-items';
import { applyPostProcess } from './post-process/pipeline';
import { applyCrossCompositionMasks } from './post-process/cross-composition-mask';
import { adaptParticleSources } from './post-process/adapt-particle-sources';
import { createRuntimeMaskState } from './post-process/mask';
import type { ECSCollector, GeneratedCompositionData, GeneratedItemBinding, LayerGenerationContext } from './types';
import type { IRToGEOptions, IRToGEResult } from '../conversion';
import { assertGEToIRPreservedDataMatchesScene, type GEToIRPreservedData } from '../preserved-data';

/**
 * Convert the entry Composition of an IR Scene to a GE JSONScene.
 *
 * `options.preservedData` restores compatible GE-owned data; reconcile it after IR edits before exporting.
 * Particle Layers require retained GE data for renderer and resource bindings. Inspect diagnostics for fidelity limits.
 * `options.duration` overrides the entry duration in seconds, otherwise derived from the IR frame bounds.
 *
 * @throws IRValidationError when the input Scene fails Animation IR validation.
 * @throws TypeError when preserved data is invalid or incompatible with its Scene, or a particle layer lacks
 * trusted GE data.
 */
export function convertIRToGE(irScene: IRScene, options: IRToGEOptions = {}): IRToGEResult {
  if (options == null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('[ge-ir:ir2ge] options must be an object.');
  }

  assertIRScene(irScene);

  if (options.preservedData != null) {
    assertGEToIRPreservedDataMatchesScene(irScene, options.preservedData);
  }

  const preservedData = (options.sources?.length ?? 0) > 0
    ? assembleSourcePreservedData(irScene, options)
    : options.preservedData;

  const result = convertIRToGEInternal(irScene, options.duration, preservedData);

  adaptParticleSources(irScene, result, options);

  return result;
}

function convertIRToGEInternal(
  irScene: IRScene,
  duration?: number,
  preservedData?: GEToIRPreservedData,
): IRToGEResult {
  const itemLayerIds = new Map<string, string>();
  const fontAssets = irScene.assets.filter((asset): asset is IRFontAsset => asset.type === 'font');

  const collector: ECSCollector = {
    images: [],
    fonts: fontAssets.flatMap(asset =>
      asset.source.kind !== 'system'
        ? [{ fontFamily: asset.family, fontURL: getIRResourceSourceUrl(asset.source) }]
        : [],
    ),
    components: [],
    items: [],
    textures: [],
    miscs: [],
  };
  const textureCache = new Map<string, DataPath>();
  const imageAssetById = new Map(
    irScene.assets.filter(asset => asset.type === 'image').map(asset => [asset.id, asset] as const),
  );
  const fontAssetById = new Map(fontAssets.map(asset => [asset.id, asset] as const));
  const diagnostics: ConversionDiagnostic[] = [];
  const runtimeMaskState = createRuntimeMaskState();
  const { compositionById, requests: generationRequests } = buildCompositionGenerationPlan(irScene, diagnostics);
  const generatedCompositions: GeneratedCompositionData[] = [];
  const diagnosedCompositionIds = new Set<string>();

  for (const request of generationRequests) {
    const { ir } = request;
    const { width, height } = ir;
    const frameRate = ir.frameRate;
    const ratio = get2dTo3dRatio(width, height);
    const itemBindings: GeneratedItemBinding[] = [];
    const layerToItemId: Record<string, string> = {};
    const layerToComponentId: Record<string, string> = {};
    const layerToMaskParentItemId: Record<string, string> = {};
    const layerToMaskCoordinateOrigin: Record<string, [number, number]> = {};
    const parentLayerIdSet = new Set<string>();
    const itemStartIndex = collector.items.length;

    for (const layer of ir.layers) {
      if (layer.parentId != null) {
        parentLayerIdSet.add(layer.parentId);
      }
    }

    const ctx: LayerGenerationContext = {
      ir,
      layerDataById: preservedData?.compositionBindings[ir.id]?.layerDataById ?? {},
      compositionById,
      inheritedOpacity: request.inheritedOpacity,
      precompOutputIdByLayerId: request.precompOutputIdByLayerId,
      collector,
      itemBindings,
      layerToItemId,
      layerToComponentId,
      layerToMaskParentItemId,
      layerToMaskCoordinateOrigin,
      textureCache,
      imageAssetById,
      fontAssetById,
      parentLayerIdSet,
      ratio,
      width,
      height,
      frameRate,
      diagnostics,
    };
    const layersInLoweringOrder = [...ir.layers].reverse();
    const collectDiagnostics = !diagnosedCompositionIds.has(ir.id);

    diagnosedCompositionIds.add(ir.id);

    for (const layer of layersInLoweringOrder) {
      appendLayer(layer, ctx);
      if (collectDiagnostics && layer.type === 'precomp') {
        collectPrecompExportDiagnostics(layer, compositionById, ir, diagnostics);
      }
    }

    const geComponentIdToNewId: Record<string, string> = {};

    for (const layer of ir.layers) {
      const GEComponentId = ctx.layerDataById[layer.id]?.sourceComponentId;
      const newId = layerToComponentId[layer.id];

      if (GEComponentId != null && newId != null) {
        geComponentIdToNewId[GEComponentId] = newId;
      }
    }

    applyPostProcess(ir, {
      collector,
      itemBindings,
      compositionById,
      layerToItemId,
      layerToComponentId,
      ratio,
      width,
      height,
      frameRate,
      geComponentIdToNewId,
      layerDataById: ctx.layerDataById,
      runtimeMaskState,
      diagnostics,
      maskLookup: {
        getItemId: layerId => layerToItemId[layerId],
        getMaskParentItemId: layerId => layerToMaskParentItemId[layerId],
        getMaskCoordinateOrigin: layerId => layerToMaskCoordinateOrigin[layerId],
        getComponentId: layerId => layerToComponentId[layerId],
        isParentLayer: layerId => parentLayerIdSet.has(layerId),
      },
    });

    const generatedItems = collector.items.splice(itemStartIndex);

    generatedItems.reverse();
    itemBindings.reverse();
    restorePreservedItemOrder(
      ir.layers,
      generatedItems,
      itemBindings,
      preservedData?.compositionBindings[ir.id]?.sourceItemOrder,
    );
    for (const binding of itemBindings) {
      if (binding.layerId != null) {
        itemLayerIds.set(binding.itemId, binding.layerId);
      }
    }
    collector.items.push(...generatedItems);
    generatedCompositions.push({
      id: request.id,
      ir,
      itemBindings,
      items: generatedItems,
      precompOutputIdByLayerId: request.precompOutputIdByLayerId,
    });
  }

  applyCrossCompositionMasks(generatedCompositions, collector, runtimeMaskState);

  return {
    itemLayerIds: Object.fromEntries(itemLayerIds),
    scene: assembleGEScene(irScene, collector, generatedCompositions, duration, preservedData),
    diagnostics,
  };
}

function restorePreservedItemOrder(
  layers: readonly IRLayer[],
  items: GeneratedCompositionData['items'],
  bindings: GeneratedItemBinding[],
  sourceItemOrder: readonly string[] | undefined,
): void {
  if (sourceItemOrder == null) {
    return;
  }
  const orderByItemId = new Map(sourceItemOrder.map((itemId, index) => [itemId, index]));
  const fallbackOrder = sourceItemOrder.length;
  const orderByLayerId = new Map<string, number>();
  const firstOrderByLayerId = new Map<string, number>();

  for (const binding of bindings) {
    const order = orderByItemId.get(binding.itemId);

    if (binding.layerId != null && order != null) {
      orderByLayerId.set(binding.layerId, Math.max(orderByLayerId.get(binding.layerId) ?? order, order));
      firstOrderByLayerId.set(binding.layerId, Math.min(firstOrderByLayerId.get(binding.layerId) ?? order, order));
    }
  }
  // New layer groups precede the next retained group; equal ranks keep their authored order.
  let nextOrder = fallbackOrder + 0.5;

  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index];
    const firstOrder = firstOrderByLayerId.get(layer.id);

    if (firstOrder != null) {
      nextOrder = firstOrder;
    } else {
      orderByLayerId.set(layer.id, nextOrder - 0.5);
    }
  }
  // Split visuals share their source layer's painter slot, including Timeline bindings.
  for (const binding of bindings) {
    const order = binding.layerId != null ? orderByLayerId.get(binding.layerId) : undefined;

    if (!orderByItemId.has(binding.itemId) && order != null) {
      orderByItemId.set(binding.itemId, order);
    }
  }

  items.sort((left, right) =>
    (orderByItemId.get(left.id) ?? fallbackOrder) - (orderByItemId.get(right.id) ?? fallbackOrder),
  );
  bindings.sort((left, right) =>
    (orderByItemId.get(left.itemId) ?? fallbackOrder) - (orderByItemId.get(right.itemId) ?? fallbackOrder),
  );
}

function appendLayer(layer: IRLayer, ctx: LayerGenerationContext): void {
  if (layer.type === 'precomp') {
    appendPrecompLayer(layer, ctx);
  } else if (layer.type === 'null') {
    appendNullLayer(layer, ctx);
  } else if (ctx.parentLayerIdSet.has(layer.id) && ctx.layerDataById[layer.id]?.sourceHierarchy !== 'single-item') {
    appendParentLayer(layer, ctx);
  } else {
    appendVisualLayer(layer, ctx);
  }
}
