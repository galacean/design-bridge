import type { IRScene } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import { DataType, ItemType } from '@galacean/effects-specification';
import { buildSceneCollectionIndex, resolveDataPathId } from '../common/data-path';
import { isRecord } from '../common/json-normalization';
import type { GEParticleSourceData, GEParticleSourceLayerData, GEToIRPreservedData } from '../preserved-data';
import type { GEToIROptions } from './types';

/** Extract source bindings and layout metadata needed to place restored ParticleSystems in a host scene. */
export function extractGEParticleSourceData(
  scene: IRScene,
  preservedData: GEToIRPreservedData,
  diagnostics: ConversionDiagnostic[],
  authoringRegions: GEToIROptions['particleAuthoringBounds'] = {},
): GEParticleSourceData {
  const sourceScene = preservedData.sourceScene;

  if (sourceScene == null) {
    if (!scene.compositions.some(composition => composition.layers.some(layer => layer.type === 'particle'))) {
      return { particleEffectGroups: [], layers: [] };
    }
    throw new TypeError('[ge-ir:particle-source] GE sourceScene is required.');
  }

  const itemById = buildSceneCollectionIndex(readRecordArray(sourceScene['items']));
  const componentById = buildSceneCollectionIndex(readRecordArray(sourceScene['components']));
  const compositionById = buildSceneCollectionIndex(readRecordArray(sourceScene['compositions']));
  const particleComponentIds = collectReferencedParticleComponentIds(
    preservedData,
    itemById,
    componentById,
  );
  const representedComponentIds = new Set<string>();
  const particleEffectGroups: GEParticleSourceData['particleEffectGroups'] = [];
  const layers: GEParticleSourceLayerData[] = [];

  for (const composition of scene.compositions) {
    const particleLayers = composition.layers.filter(layer => layer.type === 'particle');

    if (particleLayers.length === 0) {
      continue;
    }
    const binding = preservedData.compositionBindings[composition.id];

    if (binding == null) {
      throw new TypeError(`[ge-ir:particle-source] ${composition.id}: source Composition binding is missing.`);
    }
    const sourceComposition = compositionById.get(binding.sourceCompositionId);
    const previewSize = readPreviewSize(sourceComposition);

    if (previewSize == null) {
      for (const layer of particleLayers) {
        const source = resolveParticleLayerSource(
          composition.id,
          layer.id,
          binding,
          itemById,
          componentById,
          representedComponentIds,
        );

        representedComponentIds.add(source.componentId);
      }
      diagnostics.push({
        code: 'GE_PARTICLE_SOURCE_LAYOUT_UNAVAILABLE',
        severity: 'warning',
        action: 'unsupported',
        path: `$.compositions[id=${JSON.stringify(binding.sourceCompositionId)}].previewSize`,
        sourceId: binding.sourceCompositionId,
        feature: 'particle-layout',
        message: 'Particle source layout was not prepared because the source Composition previewSize is missing or invalid.',
      });

      continue;
    }
    const effectGroupId = binding.sourceCompositionId;
    const region = authoringRegions[effectGroupId];
    const bounds = region?.bounds ?? [0, 0, previewSize.width, previewSize.height];

    if (bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[0] < 0 || bounds[1] < 0 ||
      bounds[2] <= 0 || bounds[3] <= 0 || bounds[0] + bounds[2] > previewSize.width ||
      bounds[1] + bounds[3] > previewSize.height ||
      (region != null && region.source !== 'authored' && region.source !== 'reviewed_multiframe_playback')) {
      throw new TypeError('[ge-ir:particle-source] Authoring bounds must be a reviewed rectangle inside source preview.');
    }

    particleEffectGroups.push({
      id: effectGroupId,
      irCompositionId: composition.id,
      sourcePreviewSize: [previewSize.width, previewSize.height],
      authoringBounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
      authoringBoundsSource: region?.source ?? 'source_preview',
    });

    for (const layer of particleLayers) {
      const source = resolveParticleLayerSource(
        composition.id,
        layer.id,
        binding,
        itemById,
        componentById,
        representedComponentIds,
      );

      representedComponentIds.add(source.componentId);

      layers.push({
        effectGroupId,
        irCompositionId: composition.id,
        irLayerId: layer.id,
        sourceOrder: source.order,
      });
    }
  }

  const unboundComponentIds = Array.from(particleComponentIds)
    .filter(componentId => !representedComponentIds.has(componentId));

  if (Object.keys(authoringRegions).some(id => !particleEffectGroups.some(group => group.id === id))) {
    throw new TypeError('[ge-ir:particle-source] Authoring bounds reference an unavailable particle composition.');
  }

  if (unboundComponentIds.length > 0) {
    throw new TypeError(
      `[ge-ir:particle-source] ParticleSystem components were not represented in Animation IR: ` +
        unboundComponentIds.map(componentId => `'${componentId}'`).join(', '),
    );
  }

  return { particleEffectGroups, layers };
}

interface ResolvedParticleLayerSource {
  componentId: string;
  order: number;
}

function resolveParticleLayerSource(
  compositionId: string,
  layerId: string,
  binding: GEToIRPreservedData['compositionBindings'][string],
  itemById: ReadonlyMap<string, Record<string, unknown>>,
  componentById: ReadonlyMap<string, Record<string, unknown>>,
  representedComponentIds: ReadonlySet<string>,
): ResolvedParticleLayerSource {
  const layerData = binding.layerDataById[layerId];
  const sourceComponentId = layerData?.sourceComponentId;

  if (sourceComponentId == null || sourceComponentId === '') {
    throwParticleSourceError(compositionId, layerId, 'source ParticleSystem component binding is missing');
  }
  const component = componentById.get(sourceComponentId);

  if (component?.['dataType'] !== DataType.ParticleSystem) {
    throwParticleSourceError(
      compositionId,
      layerId,
      `source component '${sourceComponentId}' is not a ParticleSystem`,
    );
  }
  const sourceItemId = resolveDataPathId(component['item']);
  const sourceItem = sourceItemId != null ? itemById.get(sourceItemId) : undefined;

  if (sourceItemId == null || sourceItem == null) {
    throwParticleSourceError(compositionId, layerId, 'source ParticleSystem Item is missing');
  }
  if (layerData.sourceItemIds?.includes(sourceItemId) !== true) {
    throwParticleSourceError(
      compositionId,
      layerId,
      `source ParticleSystem Item '${sourceItemId}' does not match the preserved Layer binding`,
    );
  }
  const sourceOrder = binding.sourceItemOrder.indexOf(sourceItemId);

  if (sourceOrder < 0) {
    throwParticleSourceError(
      compositionId,
      layerId,
      `source ParticleSystem Item '${sourceItemId}' is missing from source Item order`,
    );
  }
  if (representedComponentIds.has(sourceComponentId)) {
    throwParticleSourceError(
      compositionId,
      layerId,
      `source ParticleSystem component '${sourceComponentId}' is bound more than once`,
    );
  }

  return { componentId: sourceComponentId, order: sourceOrder };
}

function readRecordArray(value: unknown): Record<string, unknown>[] | undefined {
  return Array.isArray(value) ? value.filter(isRecord) : undefined;
}

function collectReferencedParticleComponentIds(
  preservedData: GEToIRPreservedData,
  itemById: ReadonlyMap<string, Record<string, unknown>>,
  componentById: ReadonlyMap<string, Record<string, unknown>>,
): Set<string> {
  const particleComponentIds = new Set<string>();

  for (const binding of Object.values(preservedData.compositionBindings)) {
    for (const itemId of binding.sourceItemOrder) {
      const item = itemById.get(itemId);

      if (item == null) {
        continue;
      }
      const componentIds = Array.isArray(item['components'])
        ? item['components'].map(resolveDataPathId).filter((id): id is string => id != null)
        : [];
      const itemParticleComponentIds = componentIds.filter(
        componentId => componentById.get(componentId)?.['dataType'] === DataType.ParticleSystem,
      );

      if (item['type'] === ItemType.particle && itemParticleComponentIds.length === 0) {
        throw new TypeError(
          `[ge-ir:particle-source] Particle Item '${itemId}' has no valid ParticleSystem component.`,
        );
      }
      for (const componentId of itemParticleComponentIds) {
        particleComponentIds.add(componentId);
      }
    }
  }

  return particleComponentIds;
}

function readPreviewSize(
  composition: Record<string, unknown> | undefined,
): { width: number; height: number } | undefined {
  const previewSize = composition?.['previewSize'];

  return Array.isArray(previewSize) && previewSize.length >= 2 &&
    isPositiveFiniteNumber(previewSize[0]) && isPositiveFiniteNumber(previewSize[1])
    ? { width: previewSize[0], height: previewSize[1] }
    : undefined;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function throwParticleSourceError(compositionId: string, layerId: string, message: string): never {
  throw new TypeError(`[ge-ir:particle-source] ${compositionId}/${layerId}: ${message}.`);
}
