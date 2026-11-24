import { visitDataPathReferences, resolveDataPathId } from '../../common/data-path';
import { isRecord, normalizeJSONValue } from '../../common/json-normalization';
import type { GEToIRPreservedData } from '../../preserved-data';

/** Merge source GE objects that are outside Composition graphs regenerated from IR. */
export function mergePreservedResources(
  generated: Record<string, unknown>,
  preservedData?: GEToIRPreservedData,
): Record<string, unknown> {
  if (preservedData?.sourceScene == null) {
    return generated;
  }

  const sourceScene = preservedData.sourceScene;
  const result = { ...generated };

  mergeGEPlayerVersion(result, sourceScene);
  const sourceCompositionIds = new Set(
    asRecordArray(sourceScene['compositions']).flatMap(composition =>
      typeof composition['id'] === 'string' ? [composition['id']] : [],
    ),
  );
  const excluded = collectRegeneratedGraphIds(sourceScene, generated, sourceCompositionIds);
  const collectionNames = [
    'images',
    'fonts',
    'plugins',
    'components',
    'geometries',
    'materials',
    'items',
    'shaders',
    'bins',
    'textures',
    'animations',
    'miscs',
  ];

  for (const collectionName of collectionNames) {
    if (collectionName === 'bins') {
      // Binary pointers address array slots, including repeated resources.
      result[collectionName] = [...asArray(generated[collectionName]), ...asArray(sourceScene[collectionName])];

      continue;
    }
    result[collectionName] = mergeCollection(
      asArray(generated[collectionName]),
      asArray(sourceScene[collectionName]).filter(
        entry => !isExcludedCollectionEntry(collectionName, entry, excluded),
      ),
    );
  }

  result['compositions'] = mergeCollection(
    asRecordArray(generated['compositions']),
    asRecordArray(sourceScene['compositions']).filter(
      entry => !isExcludedCollectionEntry('compositions', entry, excluded),
    ),
  );

  return result;
}

interface ResourceIds {
  images: Set<string>;
  textures: Set<string>;
}

interface RegeneratedGraphIds extends ResourceIds {
  compositions: Set<string>;
  components: Set<string>;
  items: Set<string>;
  miscs: Set<string>;
}

type RegeneratedGraphCollection = keyof RegeneratedGraphIds;

interface SourceGraphEntry {
  collection: RegeneratedGraphCollection;
  value: Record<string, unknown>;
}

interface SourceGraphIndex {
  entryById: Map<string, SourceGraphEntry>;
  images: Record<string, unknown>[];
  itemIdsByParentId: Map<string, string[]>;
}

const REGENERATED_GRAPH_COLLECTIONS: RegeneratedGraphCollection[] = [
  'compositions', 'components', 'items', 'miscs', 'textures', 'images',
];
const REFERENCE_OWNER_COLLECTIONS = [
  'compositions', 'components', 'plugins', 'geometries', 'materials', 'items', 'shaders', 'bins', 'animations',
  'miscs',
];

function collectRegeneratedGraphIds(
  sourceScene: Record<string, unknown>,
  generatedScene: Record<string, unknown>,
  sourceCompositionIds: Set<string>,
): RegeneratedGraphIds {
  const index = buildSourceGraphIndex(sourceScene);
  const excluded: RegeneratedGraphIds = {
    compositions: new Set(),
    components: new Set(),
    images: new Set(),
    items: new Set(),
    miscs: new Set(),
    textures: new Set(),
  };

  for (const sourceCompositionId of sourceCompositionIds) {
    collectSourceGraph(sourceCompositionId, index, excluded);
  }

  protectRetainedResourceReferences(sourceScene, generatedScene, index, excluded);

  return excluded;
}

function buildSourceGraphIndex(sourceScene: Record<string, unknown>): SourceGraphIndex {
  const entryById = new Map<string, SourceGraphEntry>();

  for (const collection of REGENERATED_GRAPH_COLLECTIONS) {
    for (const value of asRecordArray(sourceScene[collection])) {
      const id = value['id'];

      if (typeof id === 'string') {
        entryById.set(id, { collection, value });
      }
    }
  }

  const items = asRecordArray(sourceScene['items']);

  return {
    entryById,
    images: asRecordArray(sourceScene['images']),
    itemIdsByParentId: buildItemIdsByParentId(items),
  };
}

function collectSourceGraph(id: string, index: SourceGraphIndex, collected: RegeneratedGraphIds): void {
  const entry = index.entryById.get(id);

  if (entry == null || collected[entry.collection].has(id)) {
    return;
  }

  collected[entry.collection].add(id);
  visitDataPathReferences(entry.value, referenceId => collectSourceGraph(referenceId, index, collected));

  if (entry.collection === 'items') {
    for (const childId of index.itemIdsByParentId.get(id) ?? []) {
      collectSourceGraph(childId, index, collected);
    }
  } else if (entry.collection === 'textures') {
    collectNumericTextureSource(entry.value, index, imageId => collectSourceGraph(imageId, index, collected));
  }
}

function protectRetainedResourceReferences(
  sourceScene: Record<string, unknown>,
  generatedScene: Record<string, unknown>,
  index: SourceGraphIndex,
  excluded: RegeneratedGraphIds,
): void {
  const protectedResources: ResourceIds = { images: new Set(), textures: new Set() };

  for (const collectionName of REFERENCE_OWNER_COLLECTIONS) {
    for (const entry of asArray(sourceScene[collectionName])) {
      if (!isExcludedCollectionEntry(collectionName, entry, excluded)) {
        collectReferencedResources(entry, index, protectedResources);
      }
    }
    for (const entry of asArray(generatedScene[collectionName])) {
      collectReferencedResources(entry, index, protectedResources);
    }
  }

  for (const textureId of protectedResources.textures) {
    excluded.textures.delete(textureId);
  }
  for (const imageId of protectedResources.images) {
    excluded.images.delete(imageId);
  }
}

function collectReferencedResources(value: unknown, index: SourceGraphIndex, resources: ResourceIds): void {
  visitDataPathReferences(value, id => {
    const entry = index.entryById.get(id);

    if (entry?.collection === 'images') {
      resources.images.add(id);
    } else if (entry?.collection === 'textures' && !resources.textures.has(id)) {
      resources.textures.add(id);
      collectReferencedResources(entry.value, index, resources);
      collectNumericTextureSource(entry.value, index, imageId => resources.images.add(imageId));
    }
  });
}

function collectNumericTextureSource(
  texture: Record<string, unknown>,
  index: SourceGraphIndex,
  collect: (imageId: string) => void,
): void {
  const source = texture['source'];

  if (typeof source !== 'number' || !Number.isSafeInteger(source) || source < 0) {
    return;
  }

  const imageId = index.images[source]?.['id'];

  if (typeof imageId === 'string') {
    collect(imageId);
  }
}

function buildItemIdsByParentId(items: Record<string, unknown>[]): Map<string, string[]> {
  const itemIdsByParentId = new Map<string, string[]>();

  for (const item of items) {
    const itemId = item['id'];
    const parentId = typeof item['parentId'] === 'string'
      ? item['parentId']
      : resolveDataPathId(item['parentId']);

    if (typeof itemId !== 'string' || parentId == null) {
      continue;
    }

    const childIds = itemIdsByParentId.get(parentId) ?? [];

    childIds.push(itemId);
    itemIdsByParentId.set(parentId, childIds);
  }

  return itemIdsByParentId;
}

function isExcludedCollectionEntry(
  collectionName: string,
  entry: unknown,
  excluded: RegeneratedGraphIds,
): boolean {
  if (!isRecord(entry)) {
    return false;
  }

  const id = entry['id'];

  if (typeof id !== 'string') {
    return false;
  }

  if (collectionName === 'compositions') {
    return excluded.compositions.has(id);
  }
  if (collectionName === 'components') {
    return excluded.components.has(id);
  }
  if (collectionName === 'images') {
    return excluded.images.has(id);
  }
  if (collectionName === 'items') {
    return excluded.items.has(id);
  }
  if (collectionName === 'miscs') {
    return excluded.miscs.has(id);
  }
  if (collectionName === 'textures') {
    return excluded.textures.has(id);
  }

  return false;
}

function mergeCollection(generated: unknown[], preserved: unknown[]): unknown[] {
  const result = [...generated];
  const seen = new Set<string>();

  for (const entry of result) {
    const key = collectionEntryKey(entry);

    if (key != null) {
      seen.add(key);
    }
  }

  for (const entry of preserved) {
    const key = collectionEntryKey(entry);

    if (key != null) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }

    result.push(normalizeJSONValue(entry));
  }

  return result;
}

function collectionEntryKey(entry: unknown): string | undefined {
  const id = isRecord(entry) ? entry['id'] : undefined;

  if (typeof id === 'string') {
    return `id:${id}`;
  }

  return `json:${JSON.stringify(entry)}`;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          entry != null && typeof entry === 'object' && !Array.isArray(entry),
      )
    : [];
}

export function mergeGEPlayerVersion(
  hostScene: Record<string, unknown>,
  sourceScene: Record<string, unknown>,
): void {
  const hostPlayer = isRecord(hostScene['playerVersion']) ? hostScene['playerVersion'] : {};
  const sourcePlayer = isRecord(sourceScene['playerVersion']) ? sourceScene['playerVersion'] : {};
  const hostWeb = typeof hostPlayer['web'] === 'string' ? hostPlayer['web'] : '';
  const sourceWeb = typeof sourcePlayer['web'] === 'string' ? sourcePlayer['web'] : '';

  hostScene['playerVersion'] = {
    ...sourcePlayer,
    ...hostPlayer,
    ...(sourceWeb !== '' && compareNumericVersions(sourceWeb, hostWeb) > 0 && { web: sourceWeb }),
  };
}

function compareNumericVersions(left: string, right: string): number {
  const leftParts = left.split(/\D+/).filter(Boolean).map(Number);
  const rightParts = right.split(/\D+/).filter(Boolean).map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}
