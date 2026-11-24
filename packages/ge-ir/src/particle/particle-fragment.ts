import { DataType, ItemType } from '@galacean/effects-specification';
import { buildSceneCollectionIndex, resolveDataPathId, toDataPath, visitDataPathReferences } from '../common/data-path';
import { isRecord } from '../common/json-normalization';
import type { GEToIRPreservedData } from '../preserved-data';

const FRAGMENT_COLLECTIONS = [
  'images', 'fonts', 'plugins', 'components', 'geometries', 'materials',
  'items', 'shaders', 'bins', 'textures', 'animations', 'miscs',
] as const;
const OPTIONAL_FRAGMENT_COLLECTIONS = new Set<string>(['fonts', 'bins', 'textures', 'animations']);

/** Retain one particle system or its complete group with source dependencies. */
export function buildParticleFragment(
  sourceScene: Record<string, unknown>,
  preservedData: GEToIRPreservedData,
  selection: { effectGroupId: string; irCompositionId: string; irLayerId?: string },
): Record<string, unknown> {
  const compositionBinding = preservedData.compositionBindings[selection.irCompositionId];

  if (compositionBinding == null || compositionBinding.sourceCompositionId !== selection.effectGroupId) {
    throw new TypeError(
      `[ge-ir:particle-source] Particle effect group '${selection.effectGroupId}' has no source GE binding.`,
    );
  }

  const sourceComposition = findComposition(sourceScene, compositionBinding.sourceCompositionId);
  const components = readRequiredRecordArray(sourceScene, 'components');
  const items = readRequiredRecordArray(sourceScene, 'items');
  const miscs = readRequiredRecordArray(sourceScene, 'miscs');
  const componentById = buildSceneCollectionIndex(components);
  const itemById = buildSceneCollectionIndex(items);
  const sourceRuntime = resolveCompositionRuntime(sourceComposition, componentById);
  const runtimeItemIds = readDataPathIds(sourceRuntime['items'], 'Source Composition items');
  const runtimeItemIdSet = new Set(runtimeItemIds);

  if (runtimeItemIdSet.size !== runtimeItemIds.length) {
    throw new TypeError('[ge-ir:particle-source] Source Composition contains duplicate Item references.');
  }
  for (const itemId of runtimeItemIds) {
    if (!itemById.has(itemId)) {
      throw new TypeError(`[ge-ir:particle-source] Source Composition references missing Item '${itemId}'.`);
    }
  }
  const particleComponentIds = components
    .filter(component => component['dataType'] === DataType.ParticleSystem)
    .filter(component => {
      const itemId = resolveDataPathId(component['item']);

      return itemId != null && runtimeItemIdSet.has(itemId);
    })
    .map(component => component['id'])
    .filter((id): id is string => typeof id === 'string');
  const boundComponentIds = preservedData.particleSourceData.layers
    .filter(binding => binding.effectGroupId === selection.effectGroupId)
    .map(binding =>
      preservedData.compositionBindings[binding.irCompositionId]?.layerDataById[binding.irLayerId]?.sourceComponentId,
    )
    .filter((id): id is string => id != null);

  if (
    new Set(boundComponentIds).size !== particleComponentIds.length ||
    particleComponentIds.some(id => !boundComponentIds.includes(id))
  ) {
    throw new TypeError(
      '[ge-ir:particle-source] Trusted particle bindings must cover every source ParticleSystem exactly once.',
    );
  }
  const nestedCompositionItem = runtimeItemIds
    .map(itemId => itemById.get(itemId))
    .find(item => item?.['type'] === ItemType.composition);

  if (nestedCompositionItem != null) {
    throw new TypeError(
      `[ge-ir:particle-source] Particle source Composition must be self-contained; Item ` +
        `'${readId(nestedCompositionItem, 'Composition Item')}' references another Composition.`,
    );
  }

  const sourceRuntimeId = sourceRuntime === sourceComposition ? undefined : readId(sourceRuntime, 'CompositionComponent');
  const hasNestedCompositionComponent = components.some(component => {
    const id = typeof component['id'] === 'string' ? component['id'] : undefined;
    const itemId = resolveDataPathId(component['item']);

    return component['dataType'] === DataType.CompositionComponent && id !== sourceRuntimeId &&
      itemId != null && runtimeItemIdSet.has(itemId);
  });

  if (hasNestedCompositionComponent) {
    throw new TypeError(
      '[ge-ir:particle-source] Particle source Composition must not contain nested CompositionComponents.',
    );
  }
  const { retainedItemIds, ownedItemIds } = selectParticleItems(
    runtimeItemIds, itemById, componentById, preservedData, selection.effectGroupId, selection.irLayerId,
  );
  const retainedItemIdSet = new Set(retainedItemIds);
  const includedComponents: Record<string, unknown>[] = [];
  const includedComponentIds = new Set<string>();

  for (const component of components) {
    const id = typeof component['id'] === 'string' ? component['id'] : undefined;
    const itemId = resolveDataPathId(component['item']);
    const include = component['dataType'] === DataType.CompositionComponent
      ? id === sourceRuntimeId
      : itemId != null && (itemId === compositionBinding.sourceCompositionId || ownedItemIds.has(itemId));

    if (include) {
      includedComponents.push(structuredClone(component));
      if (id != null) {
        includedComponentIds.add(id);
      }
    }
  }

  const includedItems = retainedItemIds.map(itemId => {
    const item = itemById.get(itemId);

    if (item == null) {
      throw new TypeError(`[ge-ir:particle-source] Source Composition references missing Item '${itemId}'.`);
    }
    const copy = structuredClone(item);

    if (!ownedItemIds.has(itemId)) {
      copy['type'] = ItemType.null;
      copy['components'] = [];
    }

    if (copy['components'] !== undefined) {
      assertDataPathList(copy['components'], `Particle effect Item '${itemId}' components`);
      const missingComponentIds = copy['components']
        .map(resolveDataPathId)
        .filter((id): id is string => id != null && !includedComponentIds.has(id));

      if (missingComponentIds.length > 0) {
        throw new TypeError(
          `[ge-ir:particle-source] Particle effect Item '${itemId}' references Components outside its group: ` +
            missingComponentIds.map(id => `'${id}'`).join(', '),
        );
      }
    }

    return copy;
  });
  const compositionCopy = structuredClone(sourceComposition);
  const runtimeCopy = sourceRuntimeId == null
    ? compositionCopy
    : includedComponents.find(component => component['id'] === sourceRuntimeId);

  if (runtimeCopy == null) {
    throw new TypeError('[ge-ir:particle-source] Source CompositionComponent was not retained.');
  }

  runtimeCopy['items'] = retainedItemIds.map(toDataPath);
  const sourceSceneBindings = readOptionalRecordArray(
    sourceRuntime['sceneBindings'],
    'Source Composition sceneBindings',
  );

  if (sourceSceneBindings.some(binding =>
    resolveDataPathId(binding['key']) == null || resolveDataPathId(binding['value']) == null)) {
    throw new TypeError(
      '[ge-ir:particle-source] Source Composition sceneBindings must contain DataPath key/value pairs.',
    );
  }

  if (sourceSceneBindings.some(binding => !runtimeItemIdSet.has(resolveDataPathId(binding['value']) ?? ''))) {
    throw new TypeError('[ge-ir:particle-source] Source sceneBindings reference Items outside the effect group.');
  }

  const sceneBindings = sourceSceneBindings.filter(binding => {
    const itemId = resolveDataPathId(binding['value']);

    return itemId != null && retainedItemIdSet.has(itemId);
  }).map(binding => {
    const trackId = resolveDataPathId(binding['key']);
    const itemId = resolveDataPathId(binding['value']);

    if (trackId == null || itemId == null || !runtimeItemIdSet.has(itemId)) {
      throw new TypeError(
        '[ge-ir:particle-source] Source Composition sceneBindings must reference Items inside the effect group.',
      );
    }

    return structuredClone(binding);
  });

  runtimeCopy['sceneBindings'] = sceneBindings;
  const bindingTrackIds = sceneBindings.map(binding => resolveDataPathId(binding['key']));

  if (bindingTrackIds.some(id => id == null)) {
    throw new TypeError('[ge-ir:particle-source] Source sceneBinding contains an invalid Timeline track reference.');
  }

  const timelineId = resolveDataPathId(sourceRuntime['timelineAsset']);
  const retainedMiscs = collectMiscClosure(
    miscs,
    timelineId,
    bindingTrackIds as string[],
    [...includedItems, ...includedComponents],
  );

  if (timelineId != null && bindingTrackIds.length > 0) {
    runtimeCopy['timelineAsset'] = toDataPath(timelineId);
  } else {
    delete runtimeCopy['timelineAsset'];
  }

  const fragmentScene: Record<string, unknown> = {
    ...structuredClone(sourceScene),
    compositionId: compositionCopy['id'],
    compositions: [compositionCopy],
  };

  for (const collectionName of FRAGMENT_COLLECTIONS) {
    fragmentScene[collectionName] = collectionName === 'components'
      ? includedComponents
      : collectionName === 'items'
        ? includedItems
        : collectionName === 'miscs'
          ? retainedMiscs
          : structuredClone(readFragmentCollection(sourceScene, collectionName));
  }

  if (selection.irLayerId != null) {
    visitDataPathReferences([includedItems, includedComponents, retainedMiscs], id => {
      if ((itemById.has(id) && !retainedItemIdSet.has(id)) ||
        (componentById.has(id) && !includedComponentIds.has(id))) {
        throw new TypeError(
          `[ge-ir:particle-source] Independent placement references another system's object '${id}'; ` +
            'use a shared group placement for coupled systems.',
        );
      }
    });
  }

  return fragmentScene;
}

function selectParticleItems(
  runtimeItemIds: string[],
  itemById: ReadonlyMap<string, Record<string, unknown>>,
  componentById: ReadonlyMap<string, Record<string, unknown>>,
  preservedData: GEToIRPreservedData,
  effectGroupId: string,
  irLayerId?: string,
): { retainedItemIds: string[]; ownedItemIds: Set<string> } {
  if (irLayerId == null) {
    return { retainedItemIds: runtimeItemIds, ownedItemIds: new Set(runtimeItemIds) };
  }
  const bindings = preservedData.particleSourceData.layers
    .filter(layer => layer.effectGroupId === effectGroupId)
    .sort((left, right) => left.sourceOrder - right.sourceOrder);
  const particleItemByLayer = new Map(bindings.map(binding => {
    const componentId = preservedData.compositionBindings[binding.irCompositionId]
      ?.layerDataById[binding.irLayerId]?.sourceComponentId;
    const component = componentId == null ? undefined : componentById.get(componentId);
    const itemId = resolveDataPathId(component?.['item']);

    if (itemId == null) {
      throw new TypeError(`[ge-ir:particle-source] Missing ParticleSystem Item for '${binding.irLayerId}'.`);
    }

    return [binding.irLayerId, itemId] as const;
  }));
  const selectedItemId = particleItemByLayer.get(irLayerId);
  const defaultOwner = particleItemByLayer.values().next().value;
  const particleItemIds = new Set(particleItemByLayer.values());
  const ownedItemIds = new Set<string>();
  const retained = new Set<string>();

  for (const itemId of runtimeItemIds) {
    const ancestors: string[] = [];
    let current: string | undefined = itemId;
    let owner: string | undefined;

    while (current != null) {
      if (ancestors.includes(current) || !itemById.has(current)) {
        throw new TypeError('[ge-ir:particle-source] Particle Item hierarchy contains a cycle or missing parent.');
      }
      ancestors.push(current);
      if (owner == null && particleItemIds.has(current)) {
        owner = current;
      }
      current = readParentId(itemById.get(current)?.['parentId']);
    }
    // Group-level auxiliary renderers follow the first system exactly once.
    if ((owner ?? defaultOwner) === selectedItemId) {
      ownedItemIds.add(itemId);
      ancestors.forEach(id => retained.add(id));
    }
  }

  return { retainedItemIds: runtimeItemIds.filter(id => retained.has(id)), ownedItemIds };
}

function resolveCompositionRuntime(
  composition: Record<string, unknown>,
  componentById: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown> {
  const componentIds = composition['components'] === undefined
    ? []
    : readDataPathIds(composition['components'], 'Composition components');

  if (componentIds.length === 0) {
    return composition;
  }
  const matches = componentIds
    .map(id => componentById.get(id))
    .filter(component => component?.['dataType'] === DataType.CompositionComponent);

  if (matches.length !== 1 || matches[0] == null) {
    throw new TypeError('[ge-ir:particle-source] Composition must reference exactly one CompositionComponent.');
  }

  return matches[0];
}

function collectMiscClosure(
  miscs: Record<string, unknown>[],
  timelineId: string | undefined,
  bindingTrackIds: string[],
  seeds: Record<string, unknown>[],
): Record<string, unknown>[] {
  const miscById = buildSceneCollectionIndex(miscs);

  if (timelineId != null && !miscById.has(timelineId)) {
    throw new TypeError(`[ge-ir:particle-source] Source TimelineAsset '${timelineId}' is missing.`);
  }

  const pending = [...bindingTrackIds];

  for (const seed of seeds) {
    visitDataPathReferences(seed, id => {
      if (id !== timelineId && miscById.has(id)) {
        pending.push(id);
      }
    });
  }

  const retainedIds = new Set<string>();

  while (pending.length > 0) {
    const id = pending.shift();

    if (id == null || retainedIds.has(id)) {
      continue;
    }
    const misc = miscById.get(id);

    if (misc == null) {
      throw new TypeError(`[ge-ir:particle-source] Source Timeline references missing misc '${id}'.`);
    }
    retainedIds.add(id);
    visitDataPathReferences(misc, referenceId => {
      if (miscById.has(referenceId) && !retainedIds.has(referenceId)) {
        pending.push(referenceId);
      }
    });
  }

  let timelineCopy: Record<string, unknown> | undefined;

  if (timelineId != null) {
    const sourceTimeline = miscById.get(timelineId);

    if (sourceTimeline == null) {
      throw new TypeError(`[ge-ir:particle-source] Source TimelineAsset '${timelineId}' is missing.`);
    }
    timelineCopy = structuredClone(sourceTimeline);
    timelineCopy['tracks'] = bindingTrackIds.map(toDataPath);
    retainedIds.add(timelineId);
  }

  return miscs.flatMap(misc => {
    const id = typeof misc['id'] === 'string' ? misc['id'] : undefined;

    if (id == null || !retainedIds.has(id)) {
      return [];
    }

    return [id === timelineId && timelineCopy != null ? timelineCopy : structuredClone(misc)];
  });
}

function findComposition(scene: Record<string, unknown>, compositionId: string): Record<string, unknown> {
  const composition = readRequiredRecordArray(scene, 'compositions').find(value => value['id'] === compositionId);

  if (composition == null) {
    throw new TypeError(`[ge-ir:particle-source] Source Composition '${compositionId}' is missing.`);
  }

  return composition;
}

function readRequiredRecordArray(scene: Record<string, unknown>, field: string): Record<string, unknown>[] {
  const value = scene[field];

  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new TypeError(`[ge-ir:particle-source] GE scene ${field} must be an array of objects.`);
  }

  return value;
}

function readOptionalRecordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new TypeError(`[ge-ir:particle-source] ${label} must be an array of objects.`);
  }

  return value;
}

function readFragmentCollection(scene: Record<string, unknown>, field: string): unknown[] {
  const value = scene[field];

  if (value === undefined && OPTIONAL_FRAGMENT_COLLECTIONS.has(field)) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`[ge-ir:particle-source] GE scene ${field} must be an array.`);
  }

  return value;
}

function readDataPathIds(value: unknown, label: string): string[] {
  assertDataPathList(value, label);

  return value.map(reference => resolveDataPathId(reference) as string);
}

function assertDataPathList(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.some(reference => resolveDataPathId(reference) == null)) {
    throw new TypeError(`[ge-ir:particle-source] ${label} must contain DataPath references.`);
  }
}

function readParentId(value: unknown): string | undefined {
  return typeof value === 'string' ? value : resolveDataPathId(value);
}

function readId(value: Record<string, unknown>, label: string): string {
  const id = value['id'];

  if (typeof id !== 'string' || id === '') {
    throw new TypeError(`[ge-ir:particle-source] ${label} must have a non-empty ID.`);
  }

  return id;
}
