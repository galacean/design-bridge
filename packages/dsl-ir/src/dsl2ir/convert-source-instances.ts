import { IREndBehavior, type IRComposition, type IRLayer, type IRScene } from '@galacean/animation-ir';
import { createIRScene, getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import { assertIRScene } from '@galacean/animation-ir/validator';
import { getLayerStackingOrder } from '../common/transform';
import { createId } from '../common/utils';
import type { Composition, Layer } from '../dsl/schema';
import { convertIRToDSL } from '../ir2dsl/convert';
import { assembleIRComposition } from './assemble';
import { convertDSLLayersToIR } from './convert-layers';
import { convertDSLToIRWithPreservedData } from './recombine/convert';
import type { DSLToIROptions, DSLToIRResult } from './types';

/** Source bindings distinguish target layout from edits to source-local emitter transforms. */
export function convertDSLWithParticleSources(
  document: Composition,
  options: DSLToIROptions,
): DSLToIRResult {
  const sources = options.particleSources ?? [];
  const claimedIds = new Set<string>();
  const targetById = new Map(document.layers.map(layer => [layer.id, layer]));

  for (const source of sources) {
    if (Object.keys(source.layers).length === 0) {
      throw new TypeError('[dsl-ir:sources] A particle source must bind at least one target layer.');
    }
    for (const id of Object.keys(source.layers)) {
      const layer = targetById.get(id);

      if (claimedIds.has(id) || layer?.type !== 'particle' || layer.parent != null ||
        (layer.children?.length ?? 0) !== 0 || layer.position.a) {
        throw new TypeError(`[dsl-ir:sources] '${id}' must bind one root particle leaf with a static position.`);
      }
      claimedIds.add(id);
    }
  }
  if (flattenLayers(document.layers).some(layer => layer.parent != null && claimedIds.has(layer.parent))) {
    throw new TypeError('[dsl-ir:sources] A bound target must remain a root particle leaf.');
  }
  const ordinaryDSL = { ...document, layers: document.layers.filter(layer => !claimedIds.has(layer.id)) };
  const imageAssets: Parameters<typeof convertDSLLayersToIR>[1] = [];
  const fontAssets: Parameters<typeof convertDSLLayersToIR>[2] = [];
  const result: DSLToIRResult = options.preservedData != null
    ? convertDSLToIRWithPreservedData(ordinaryDSL, options.preservedData, options)
    : { scene: createIRScene(assembleIRComposition(ordinaryDSL,
      convertDSLLayersToIR(ordinaryDSL, imageAssets, fontAssets))), diagnostics: [] };

  result.scene.assets.push(...imageAssets, ...fontAssets);
  const host = getIRSceneEntryComposition(result.scene);
  const ordinaryMapping = options.preservedData?.layerMapping.layers;
  const ordinaryRoots = ordinaryDSL.layers.filter(layer => layer.parent == null).sort(compareLayers);
  const hostRoots = host.layers.filter(layer => layer.parentId == null);
  const ranks = new Map<string, { rank: number; tie: string }>();

  ordinaryRoots.forEach((layer, index) => {
    const id = ordinaryMapping != null ? ordinaryMapping[layer.id]?.irLayerId : hostRoots[index]?.id;

    if (id != null) {
      ranks.set(id, { rank: getLayerStackingOrder(layer), tie: layer.id });
    }
  });
  result.sourceInstances = [];

  for (const [sourceIndex, source] of sources.entries()) {
    assertIRScene(source.preservedData.baselineScene);
    const sourceDSL = convertIRToDSL(source.preservedData.baselineScene).dsl;
    const sourceLayerById = new Map(flattenLayers(sourceDSL.layers).map(layer => [layer.id, layer]));
    const targets = Object.keys(source.layers).map(id => {
      const layer = targetById.get(id);

      if (layer == null) {
        throw new TypeError(`[dsl-ir:sources] Missing target layer '${id}'.`);
      }

      return layer;
    });
    const target = targets[0];

    const placement = readPlacementTransform(target);

    if (targets.some(layer => layer.width !== target.width || layer.height !== target.height ||
      JSON.stringify(layer.position) !== JSON.stringify(target.position) ||
      JSON.stringify(readPlacementTransform(layer)) !== JSON.stringify(placement))) {
      throw new TypeError('[dsl-ir:sources] A shared source instance requires one target region and transform.');
    }
    const selectedIds = new Set<string>();
    let sourceCompositionId: string | undefined;

    for (const edited of targets) {
      const sourceId = source.layers[edited.id];
      const baselineLayer = sourceLayerById.get(sourceId);
      const mapping = source.preservedData.layerMapping.layers[sourceId];

      if (edited.type !== 'particle' || baselineLayer?.type !== 'particle' || mapping == null ||
        mapping.expandedSource != null ||
        selectedIds.has(mapping.irLayerId) ||
        (sourceCompositionId != null && sourceCompositionId !== mapping.irCompositionId)) {
        throw new TypeError(`[dsl-ir:sources] '${sourceId}' must identify a distinct source particle layer.`);
      }
      sourceCompositionId = mapping.irCompositionId;
      selectedIds.add(mapping.irLayerId);
      if (typeof edited.name === 'string') { baselineLayer.name = edited.name; }
      baselineLayer.particle = structuredClone(edited.particle);
      for (const field of ['opacity', 'time_range'] as const) {
        if (edited[field] !== undefined) {
          Object.assign(baselineLayer, { [field]: structuredClone(edited[field]) });
        }
      }
      if (edited.time_range == null) {
        let current: Layer | undefined = baselineLayer;

        while (current != null) {
          if (current.time_range != null) {
            current.time_range[1] = Math.max(current.time_range[1], document.meta.duration);
          }
          current = current.parent == null ? undefined : sourceLayerById.get(current.parent);
        }
      }
    }
    const converted = convertDSLToIRWithPreservedData(sourceDSL, source.preservedData, options);
    const composition = converted.scene.compositions.find(value => value.id === sourceCompositionId);

    if (composition == null || composition.layers.some(layer => layer.type === 'precomp')) {
      throw new TypeError('[dsl-ir:sources] Particle sources must have a self-contained composition.');
    }
    const originalParticles = composition.layers.filter(layer => layer.type === 'particle');

    if (selectedIds.size !== 1 && selectedIds.size !== originalParticles.length) {
      throw new TypeError('[dsl-ir:sources] Bind either one particle system or the complete source group.');
    }
    composition.layers = selectSourceLayers(composition, selectedIds);
    const duration = Math.max(document.meta.duration,
      (composition.outPoint - composition.inPoint) / composition.frameRate);

    composition.outPoint = composition.inPoint + duration * composition.frameRate;
    const instanceScene = { ...converted.scene, entryCompositionId: composition.id, compositions: [composition] };
    const idMap = namespaceSourceScene(instanceScene, source.preservedData.baselineScene);
    const wrapper = buildSourceInstance(target, host, composition, source.authoringBounds);

    ranks.set(wrapper.id, { rank: getLayerStackingOrder(target), tie: target.id });
    host.layers.push(wrapper);
    result.scene.compositions.push(composition);
    result.scene.assets.push(...instanceScene.assets);
    result.diagnostics.push(...converted.diagnostics);
    result.sourceInstances.push({ sourceIndex, idMap });
  }
  const children = new Map<string, IRLayer[]>();

  for (const layer of host.layers) {
    if (layer.parentId != null) {
      const group = children.get(layer.parentId) ?? [];

      group.push(layer);
      children.set(layer.parentId, group);
    }
  }
  const ordered: IRLayer[] = [];
  const append = (layer: IRLayer): void => {
    ordered.push(layer);
    children.get(layer.id)?.forEach(append);
  };

  host.layers.filter(layer => layer.parentId == null).sort((leftLayer, rightLayer) => {
    const left = ranks.get(leftLayer.id);
    const right = ranks.get(rightLayer.id);

    return (left?.rank ?? 0) - (right?.rank ?? 0) || (options.preservedData != null ? 0 :
      (left?.tie ?? leftLayer.id).localeCompare(right?.tie ?? rightLayer.id));
  }).forEach(append);
  host.layers = ordered;
  assertIRScene(result.scene);

  return result;
}

function compareLayers(left: Layer, right: Layer): number {
  return getLayerStackingOrder(left) - getLayerStackingOrder(right) || left.id.localeCompare(right.id);
}

function flattenLayers(layers: Layer[]): Layer[] {
  return layers.flatMap(layer => [layer, ...flattenLayers(layer.children ?? [])]);
}

function selectSourceLayers(composition: IRComposition, selected: ReadonlySet<string>): IRLayer[] {
  const byId = new Map(composition.layers.map(layer => [layer.id, layer]));
  const firstParticleId = composition.layers.find(layer => layer.type === 'particle')?.id;
  const owned = new Set<string>();
  const retained = new Set<string>();

  for (const layer of composition.layers) {
    const ancestors: IRLayer[] = [];
    let current: IRLayer | undefined = layer;

    while (current != null) {
      ancestors.push(current);
      current = current.parentId == null ? undefined : byId.get(current.parentId);
    }
    const owner = ancestors.find(value => value.type === 'particle')?.id ?? firstParticleId;

    if (owner != null && selected.has(owner)) {
      owned.add(layer.id);
      ancestors.forEach(value => retained.add(value.id));
    }
  }

  return composition.layers.filter(layer => retained.has(layer.id)).map(layer => owned.has(layer.id) ? layer : {
    id: layer.id, name: layer.name, type: 'null', time: layer.time, visible: layer.visible,
    parentId: layer.parentId, transform: layer.transform,
  });
}

function namespaceSourceScene(scene: IRScene, baseline: IRScene): Record<string, string> {
  const ids = [...baseline.assets.map(asset => asset.id),
    ...baseline.compositions.flatMap(composition => [composition.id, ...composition.layers.map(layer => layer.id)]),
    ...scene.assets.map(asset => asset.id)];
  const idMap = Object.fromEntries(ids.map(id => [id, createId()]));
  const fields = new Set(['id', 'entryCompositionId', 'compositionId', 'parentId', 'assetId', 'fontAssetId', 'sourceLayerId']);
  const remap = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(remap);
    } else if (value != null && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        if (fields.has(key) && typeof entry === 'string' && idMap[entry] != null) {
          Object.assign(value, { [key]: idMap[entry] });
        } else {
          remap(entry);
        }
      }
    }
  };

  remap(scene);

  return idMap;
}

function buildSourceInstance(
  target: Layer,
  host: IRComposition,
  source: IRComposition,
  authoringBounds?: readonly [number, number, number, number],
): IRLayer {
  const [left, top, width, height] = authoringBounds ?? [0, 0, source.width, source.height];
  const position = target.position.a ? undefined : target.position.value;

  if (!Array.isArray(position) || position.length !== 3 || target.width <= 0 || target.height <= 0 ||
    ![left, top, width, height].every(Number.isFinite) || left < 0 || top < 0 || width <= 0 || height <= 0 ||
    left + width > source.width || top + height > source.height) {
    throw new TypeError('[dsl-ir:sources] Invalid source bounds or target region.');
  }
  const placement = readPlacementTransform(target);
  const scale = Math.min(target.width / width, target.height / height) * placement.scale;
  const radians = placement.rotation * Math.PI / 180;
  const offsetX = (left + width / 2 - source.width / 2) * scale;
  const offsetY = (top + height / 2 - source.height / 2) * scale;

  return {
    id: createId(),
    name: typeof target.name === 'string' ? target.name : target.id,
    type: 'precomp',
    visible: true,
    time: { inFrame: host.inPoint, outFrame: host.outPoint, sourceStartFrame: source.inPoint },
    content: { compositionId: source.id, clipToBounds: false, endBehavior: IREndBehavior.Freeze },
    transform: {
      position: { type: 'static', value: [
        position[0] - Math.cos(radians) * offsetX + Math.sin(radians) * offsetY,
        position[1] - Math.sin(radians) * offsetX - Math.cos(radians) * offsetY, 0,
      ] },
      scale: { type: 'static', value: [scale, scale, scale] },
      rotation: { z: { type: 'static', value: placement.rotation } },
    },
  };
}

function readPlacementTransform(layer: Layer): { scale: number; rotation: number } {
  const scale = layer.scale == null ? [1, 1, 1] : layer.scale.a ? undefined : layer.scale.value;
  const rotation = layer.rotation == null ? [0, 0, 0] : layer.rotation.a ? undefined : layer.rotation.value;

  if (scale == null || rotation == null || ![...scale, ...rotation].every(Number.isFinite) ||
    scale[0] <= 0 || Math.abs(scale[0] - scale[1]) > 1e-9 || Math.abs(scale[2] - 1) > 1e-9 ||
    Math.abs(rotation[0]) > 1e-9 || Math.abs(rotation[1]) > 1e-9) {
    throw new TypeError('[dsl-ir:sources] Particle placement requires static uniform XY scale and Z-only rotation.');
  }

  return { scale: scale[0], rotation: rotation[2] };
}
