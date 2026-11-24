import type { IRAnimatedProperty, IRAsset, IRComposition, IRLayer, IRScene } from '@galacean/animation-ir';
import { ValueType } from '@galacean/effects-specification';
import { visitDataPathReferences } from './common/data-path';
import {
  invalidateEffectsLayerPreservedData,
  type EffectsLayerPreservedDataInvalidationTarget,
} from './layer-preserved-data';
import {
  assertGEToIRPreservedDataMatchesScene,
  type GEToIRPreservedData, type EffectsLayerPreservedData,
} from './preserved-data';

/** A retained GE field invalidated by an IR edit; IDs refer to the baseline IR Composition and Layer. */
export interface GEToIRPreservedDataChange {
  compositionId: string;
  layerId: string;
  field: string;
}

/** Optional reporting of GE fields invalidated during preserved-data reconciliation. */
export interface UpdateGEToIRPreservedDataOptions {
  /** Reports field invalidations synchronously; callback errors propagate to the caller. */
  onChange?: (change: GEToIRPreservedDataChange) => void;
}

/**
 * Reconcile paired GE data against IR edits, returning a cloned sidecar without mutating any input.
 * Conflicting GE fields and deleted bindings are removed so retained values do not override the edits on export.
 *
 * @param baselineScene - Original IR paired with preservedData.
 * @param updatedScene - Edited IR with retained identities for existing Compositions and Layers.
 * @param preservedData - Sidecar returned by the original convertGEToIR call.
 * @returns Reconciled sidecar to pass to convertIRToGE with updatedScene.
 */
export function updateGEToIRPreservedData(
  baselineScene: IRScene,
  updatedScene: IRScene,
  preservedData: GEToIRPreservedData,
  options: UpdateGEToIRPreservedDataOptions = {},
): GEToIRPreservedData {
  assertGEToIRPreservedDataMatchesScene(baselineScene, preservedData);

  const updatedPreservedData = structuredClone(preservedData);
  const updatedCompositionById = new Map(
    updatedScene.compositions.map(composition => [composition.id, composition] as const),
  );

  for (const baselineComposition of baselineScene.compositions) {
    const updatedComposition = updatedCompositionById.get(baselineComposition.id);
    const binding = updatedPreservedData.compositionBindings[baselineComposition.id];

    if (updatedComposition == null) {
      delete updatedPreservedData.compositionBindings[baselineComposition.id];

      continue;
    }
    if (binding == null) {
      continue;
    }

    const retainedIds = new Set(updatedComposition.layers.map(layer => layer.id));
    const baselineIds = baselineComposition.layers.map(layer => layer.id).filter(id => retainedIds.has(id));
    const baselineIdSet = new Set(baselineIds);
    const updatedIds = updatedComposition.layers.map(layer => layer.id).filter(id => baselineIdSet.has(id));

    if (baselineIds.some((id, index) => id !== updatedIds[index])) {
      const ownerByItemId = new Map<string, string>();

      for (const id of updatedIds) {
        for (const itemId of binding.layerDataById[id]?.sourceItemIds ?? []) {
          ownerByItemId.set(itemId, id);
        }
      }
      const itemsByLayer = new Map<string, string[]>();

      for (const itemId of binding.sourceItemOrder) {
        const owner = ownerByItemId.get(itemId);

        if (owner != null) {
          const items = itemsByLayer.get(owner) ?? [];

          items.push(itemId);
          itemsByLayer.set(owner, items);
        }
      }
      const orderedItems = updatedIds.flatMap(id => itemsByLayer.get(id) ?? []);
      let index = 0;

      binding.sourceItemOrder = binding.sourceItemOrder.map(id => ownerByItemId.has(id) ? orderedItems[index++] : id);
    }

    const updatedLayerById = new Map(updatedComposition.layers.map(layer => [layer.id, layer] as const));

    for (const baselineLayer of baselineComposition.layers) {
      const updatedLayer = updatedLayerById.get(baselineLayer.id);

      if (updatedLayer == null) {
        delete binding.layerDataById[baselineLayer.id];

        continue;
      }

      invalidateChangedLayerData(
        baselineScene,
        updatedScene,
        baselineComposition,
        updatedComposition,
        baselineLayer,
        updatedLayer,
        updatedPreservedData,
        options,
      );
    }
  }

  reconcileParticleSourceData(updatedScene, updatedPreservedData);
  assertGEToIRPreservedDataMatchesScene(updatedScene, updatedPreservedData);

  return updatedPreservedData;
}

function reconcileParticleSourceData(scene: IRScene, preservedData: GEToIRPreservedData): void {
  const particleLayerIdsByComposition = new Map<string, Set<string>>();

  for (const composition of scene.compositions) {
    particleLayerIdsByComposition.set(
      composition.id,
      new Set(composition.layers.filter(layer => layer.type === 'particle').map(layer => layer.id)),
    );
  }

  preservedData.particleSourceData.layers = preservedData.particleSourceData.layers.filter(layer =>
    particleLayerIdsByComposition.get(layer.irCompositionId)?.has(layer.irLayerId) === true,
  );
  const referencedGroupIds = new Set(
    preservedData.particleSourceData.layers.map(layer => layer.effectGroupId),
  );

  preservedData.particleSourceData.particleEffectGroups =
    preservedData.particleSourceData.particleEffectGroups.filter(group => referencedGroupIds.has(group.id));
}

function invalidateChangedLayerData(
  baselineScene: IRScene,
  updatedScene: IRScene,
  baselineComposition: IRComposition,
  updatedComposition: IRComposition,
  baselineLayer: IRLayer,
  updatedLayer: IRLayer,
  preservedData: GEToIRPreservedData,
  options: UpdateGEToIRPreservedDataOptions,
): void {
  const compositionId = baselineComposition.id;
  const targets = new Set<EffectsLayerPreservedDataInvalidationTarget>();

  if (baselineLayer.type !== updatedLayer.type) {
    targets.add('position');
    targets.add('rotation');
    targets.add('scale');
    targets.add('color');
    targets.add('opacity');
    targets.add('anchor');
    targets.add('asset');
    targets.add('mask');
    targets.add('precomp');
    targets.add('particle');
  } else {
    collectChangedTransformTargets(baselineLayer, updatedLayer, targets);

    if (!isValueEqual(baselineLayer.masks, updatedLayer.masks) || !isValueEqual(baselineLayer.matte, updatedLayer.matte)) {
      targets.add('mask');
    }
    if (baselineLayer.type === 'solid' && updatedLayer.type === 'solid' &&
      !isValueEqual(baselineLayer.content.color, updatedLayer.content.color)) {
      targets.add('color');
    }
    if (baselineLayer.type === 'image' && updatedLayer.type === 'image' &&
      hasImageAssetChanged(baselineScene.assets, updatedScene.assets, baselineLayer, updatedLayer)) {
      targets.add('asset');
    }
    if (baselineLayer.type === 'precomp' && updatedLayer.type === 'precomp' &&
      !isValueEqual(baselineLayer.content, updatedLayer.content)) {
      targets.add('precomp');
    }
    if (baselineLayer.type === 'particle' && updatedLayer.type === 'particle' &&
      hasParticleBurstStructureChanged(baselineLayer, updatedLayer)) {
      removeParticleBurstOffsets(preservedData, compositionId, baselineLayer.id, options);
    }
  }

  const layerData = preservedData.compositionBindings[compositionId]?.layerDataById[baselineLayer.id];

  if (layerData?.runtimeParentId != null && baselineLayer.parentId !== updatedLayer.parentId) {
    delete layerData.runtimeParentId;
    options.onChange?.({ compositionId, layerId: baselineLayer.id, field: 'runtimeParentId' });
  }
  if (layerData?.additionalComponentIds != null && baselineLayer.type !== updatedLayer.type) {
    delete layerData.additionalComponentIds;
    options.onChange?.({ compositionId, layerId: baselineLayer.id, field: 'additionalComponentIds' });
  }

  if (layerData?.itemTiming != null && !isValueEqual(baselineLayer.time, updatedLayer.time)) {
    delete layerData.itemTiming;
    options.onChange?.({ compositionId, layerId: baselineLayer.id, field: 'itemTiming' });
  }
  const timeline = layerData?.componentTimeline;

  if (timeline != null) {
    const changedType = baselineLayer.type !== updatedLayer.type;
    const changedContent = !isValueEqual(
      baselineLayer.type === 'null' ? undefined : baselineLayer.content,
      updatedLayer.type === 'null' ? undefined : updatedLayer.content,
    );
    const changedBounds = !isValueEqual(baselineLayer.localBounds, updatedLayer.localBounds);
    const changedTime = !isValueEqual(baselineLayer.time, updatedLayer.time);
    const removedIds = new Set(timeline.objects.filter(object => {
      const path = object['path'];

      return changedType || changedTime || (typeof path === 'string' &&
        (changedContent || changedBounds || (targets.has('opacity') && /(^|\.)color(\.|$)/.test(path))));
    }).map(object => object['id']));

    if (removedIds.size > 0) {
      timeline.objects = timeline.objects.filter(object => !removedIds.has(object['id']));
      for (const object of timeline.objects) {
        if (Array.isArray(object['children'])) {
          object['children'] = object['children'].filter(reference =>
            !isRecord(reference) || !removedIds.has(reference['id']),
          );
        }
      }
      if (removedIds.has(timeline.root.id)) {
        delete layerData.componentTimeline;
      } else {
        const objectById = new Map(timeline.objects.map(object => [object['id'], object]));
        const reachable = new Set<string>();
        const visit = (id: string): void => {
          const object = objectById.get(id);

          if (object == null || reachable.has(id)) {
            return;
          }
          reachable.add(id);
          visitDataPathReferences(object, visit);
        };

        visit(timeline.root.id);
        timeline.objects = timeline.objects.filter(object => reachable.has(String(object['id'])));
      }
      options.onChange?.({ compositionId, layerId: baselineLayer.id, field: 'componentTimeline' });
    }
  }
  if (layerData?.geometry != null && (baselineLayer.type !== updatedLayer.type ||
    !isValueEqual(baselineLayer.localBounds, updatedLayer.localBounds))) {
    delete layerData.geometry;
    options.onChange?.({ compositionId, layerId: baselineLayer.id, field: 'geometry' });
  }
  if (layerData?.renderer != null && baselineLayer.type !== updatedLayer.type) {
    delete layerData.renderer;
    options.onChange?.({ compositionId, layerId: baselineLayer.id, field: 'renderer' });
  }

  for (const target of targets) {
    const removedFields = invalidateEffectsLayerPreservedData(
      preservedData,
      compositionId,
      baselineLayer.id,
      target,
    );

    for (const field of removedFields) {
      options.onChange?.({ compositionId, layerId: baselineLayer.id, field });
    }
  }

  if (layerData != null) {
    reframePreservedAnimation(
      layerData, baselineLayer, updatedLayer, baselineComposition.frameRate, updatedComposition.frameRate,
    );
  }
}

function reframePreservedAnimation(
  data: EffectsLayerPreservedData,
  baseline: IRLayer,
  updated: IRLayer,
  beforeFrameRate: number,
  afterFrameRate: number,
): void {
  const beforeStart = baseline.time.inFrame / beforeFrameRate;
  const afterStart = updated.time.inFrame / afterFrameRate;
  const beforeDuration = (baseline.time.outFrame - baseline.time.inFrame) / beforeFrameRate;
  const afterDuration = (updated.time.outFrame - updated.time.inFrame) / afterFrameRate;

  if ((beforeStart === afterStart && beforeDuration === afterDuration && beforeFrameRate === afterFrameRate) ||
    beforeDuration <= 0 || afterDuration <= 0) {
    return;
  }
  const transform = updated.transform;
  const animations: [Record<string, unknown> | undefined, Record<string, IRAnimatedProperty | undefined>][] = [
    [data.positionOverLifetime, { path: transform?.position }],
    [data.rotationOverLifetime, { x: transform?.rotation?.x, y: transform?.rotation?.y, z: transform?.rotation?.z }],
    [data.sizeOverLifetime, {
      size: transform?.scale, x: transform?.scale, y: transform?.scale, z: transform?.scale,
    }],
    [data.colorOverLifetime, { opacity: transform?.opacity }],
  ];

  // IR keyframes retain frame positions; source-only channels retain their times in seconds.
  for (const [animation, properties] of animations) {
    for (const [channel, expression] of Object.entries(animation ?? {})) {
      if (!Array.isArray(expression) || !Array.isArray(expression[1])) {
        continue;
      }
      const type: unknown = expression[0];
      const payload: unknown[] = expression[1];
      const isPath = type === ValueType.BEZIER_CURVE_PATH;
      const isBezier = isPath || type === ValueType.BEZIER_CURVE;
      const curve: unknown = isPath ? payload[0] : payload;

      if (!Array.isArray(curve) || (!isBezier && type !== ValueType.LINE && type !== ValueType.GRADIENT_COLOR)) {
        continue;
      }
      const timeScale = properties[channel]?.type === 'keyframed' ? beforeFrameRate / afterFrameRate : 1;

      for (const keyframe of curve) {
        const coordinates: unknown = isBezier && Array.isArray(keyframe) ? keyframe[1] : keyframe;

        if (!Array.isArray(coordinates)) {
          continue;
        }
        const count = isBezier ? coordinates.length : Math.min(1, coordinates.length);

        for (let index = 0; index < count; index += 2) {
          const time: unknown = coordinates[index];

          if (typeof time === 'number') {
            coordinates[index] = ((beforeStart + time * beforeDuration) * timeScale - afterStart) / afterDuration;
          }
        }
      }
    }
  }
}

function hasParticleBurstStructureChanged(
  baselineLayer: Extract<IRLayer, { type: 'particle' }>,
  updatedLayer: Extract<IRLayer, { type: 'particle' }>,
): boolean {
  const baselineBursts = baselineLayer.content.emission.bursts ?? [];
  const updatedBursts = updatedLayer.content.emission.bursts ?? [];

  if (baselineBursts.length !== updatedBursts.length) {
    return true;
  }

  const matchedUpdatedIndices = new Set<number>();

  for (let baselineIndex = 0; baselineIndex < baselineBursts.length; baselineIndex++) {
    const matchingUpdatedIndex = updatedBursts.findIndex((updatedBurst, updatedIndex) =>
      !matchedUpdatedIndices.has(updatedIndex) && isValueEqual(baselineBursts[baselineIndex], updatedBurst),
    );

    if (matchingUpdatedIndex === -1) {
      continue;
    }
    if (matchingUpdatedIndex !== baselineIndex) {
      return true;
    }
    matchedUpdatedIndices.add(matchingUpdatedIndex);
  }

  return false;
}

function removeParticleBurstOffsets(
  preservedData: GEToIRPreservedData,
  compositionId: string,
  layerId: string,
  options: UpdateGEToIRPreservedDataOptions,
): void {
  const particleContent = preservedData.compositionBindings[compositionId]?.layerDataById[layerId]?.particleContent;
  const emission = particleContent?.['emission'];

  if (!isRecord(emission) || !Object.hasOwn(emission, 'burstOffsets')) {
    return;
  }

  delete emission['burstOffsets'];
  options.onChange?.({
    compositionId,
    layerId,
    field: 'particleContent.emission.burstOffsets',
  });
}

function collectChangedTransformTargets(
  baselineLayer: IRLayer,
  updatedLayer: IRLayer,
  targets: Set<EffectsLayerPreservedDataInvalidationTarget>,
): void {
  const baselineTransform = baselineLayer.transform;
  const updatedTransform = updatedLayer.transform;

  if (!isValueEqual(baselineTransform?.position, updatedTransform?.position)) {
    targets.add('position');
  }
  if (!isValueEqual(baselineTransform?.rotation, updatedTransform?.rotation)) {
    targets.add('rotation');
  }
  if (!isValueEqual(baselineTransform?.scale, updatedTransform?.scale)) {
    targets.add('scale');
  }
  if (!isValueEqual(baselineTransform?.anchor, updatedTransform?.anchor)) {
    targets.add('anchor');
  }
  if (!isValueEqual(baselineTransform?.opacity, updatedTransform?.opacity)) {
    targets.add('opacity');
  }
}

function hasImageAssetChanged(
  baselineAssets: IRAsset[],
  updatedAssets: IRAsset[],
  baselineLayer: Extract<IRLayer, { type: 'image' }>,
  updatedLayer: Extract<IRLayer, { type: 'image' }>,
): boolean {
  if (baselineLayer.content.assetId !== updatedLayer.content.assetId) {
    return true;
  }

  const baselineAsset = baselineAssets.find(asset => asset.id === baselineLayer.content.assetId);
  const updatedAsset = updatedAssets.find(asset => asset.id === updatedLayer.content.assetId);

  return !isValueEqual(baselineAsset, updatedAsset);
}

function isValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((entry, index) => isValueEqual(entry, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();

  return leftKeys.length === rightKeys.length && leftKeys.every(
    (key, index) => key === rightKeys[index] && isValueEqual(left[key], right[key]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
