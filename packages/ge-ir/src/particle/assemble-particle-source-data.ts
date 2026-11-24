import type { IRScene } from '@galacean/animation-ir';
import { ValueType } from '@galacean/effects-specification';
import { createId } from '../common/id';
import { isRecord } from '../common/json-normalization';
import type { GEToIRPreservedData } from '../preserved-data';
import { mergeGEPlayerVersion } from '../ir2ge/post-process/merge-preserved-resources';

const SOURCE_COLLECTIONS = [
  'compositions', 'items', 'components', 'images', 'textures', 'fonts', 'plugins',
  'geometries', 'materials', 'shaders', 'bins', 'animations', 'miscs', 'videos', 'audios',
];
const ID_FIELDS = new Set([
  'id', 'parentId', 'compositionId', 'entryCompositionId', 'assetId', 'fontAssetId', 'sourceLayerId',
  'sourceCompositionId', 'sourceComponentId', 'irCompositionId', 'irLayerId', 'effectGroupId', 'runtimeParentId',
]);
const ID_MAP_FIELDS = new Set(['compositionBindings', 'layerDataById', 'itemAnchorById', 'itemEulerHintById']);

/** Each placed instance owns its identities, including references inside opaque GE payloads. */
export function namespaceParticleSource(
  input: { scene: IRScene; preservedData: GEToIRPreservedData },
  idMap: Readonly<Record<string, string>>,
): typeof input & { ids: ReadonlyMap<string, string> } {
  const result = structuredClone(input);
  const ids = collectSourceObjectIds(result);
  const mappedIds = new Map(Array.from(ids, id => [id, idMap[id] ?? createId()]));

  remapIds(result, mappedIds);

  return { ...result, ids: mappedIds };
}

function remapIds(value: unknown, ids: ReadonlyMap<string, string>): void {
  if (Array.isArray(value)) {
    value.forEach(entry => remapIds(entry, ids));

    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (ID_FIELDS.has(key) && typeof entry === 'string') {
      value[key] = ids.get(entry) ?? entry;
    } else if (['sourceItemIds', 'sourceItemOrder', 'runtimeItemIds', 'runtimeComponentIds', 'additionalComponentIds']
      .includes(key) && Array.isArray(entry)) {
      value[key] = entry.map((id: unknown) => typeof id === 'string' ? ids.get(id) ?? id : id);
    } else if (ID_MAP_FIELDS.has(key) && isRecord(entry)) {
      remapIds(entry, ids);
      value[key] = Object.fromEntries(Object.entries(entry).map(([id, data]) => [ids.get(id) ?? id, data]));
    } else {
      remapIds(entry, ids);
    }
  }
}

/** Combine only source pools; generated Items and Timelines are assembled by the regular exporter. */
export function appendParticleSourceResources(target: GEToIRPreservedData, source: GEToIRPreservedData): void {
  const sourceScene = source.sourceScene;

  if (sourceScene == null) {
    throw new TypeError('[ge-ir:particle-assemble] Source GE resources are missing.');
  }
  const targetScene = target.sourceScene ?? {
    version: sourceScene['version'], type: 'ge', compositionId: sourceScene['compositionId'],
  };
  const bins = targetScene['bins'];
  const binOffset = Array.isArray(bins) ? bins.length : 0;

  normalizeTextureSources(targetScene);
  normalizeTextureSources(sourceScene);
  rebaseBinaryPointers(source, binOffset);
  for (const name of SOURCE_COLLECTIONS) {
    const existing: unknown[] = Array.isArray(targetScene[name]) ? targetScene[name] : [];
    const additions: unknown[] = Array.isArray(sourceScene[name]) ? sourceScene[name] : [];

    targetScene[name] = [...existing, ...additions];
  }
  mergeGEPlayerVersion(targetScene, sourceScene);
  target.sourceScene = targetScene;
}

function normalizeTextureSources(scene: Record<string, unknown>): void {
  const images = scene['images'];
  const textures = scene['textures'];

  if (!Array.isArray(images) || !Array.isArray(textures)) {
    return;
  }
  for (const texture of textures) {
    if (!isRecord(texture) || typeof texture['source'] !== 'number') {
      continue;
    }
    const image: unknown = images[texture['source']];

    if (!isRecord(image) || typeof image['id'] !== 'string') {
      throw new TypeError('[ge-ir:particle-assemble] Numeric texture source does not resolve to an Image ID.');
    }
    texture['source'] = { id: image['id'] };
  }
}

function rebaseBinaryPointers(value: unknown, offset: number, visited = new WeakSet<object>()): void {
  if (value == null || typeof value !== 'object' || visited.has(value)) {
    return;
  }
  visited.add(value);
  if (Array.isArray(value)) {
    if (value.length === 2 && value[0] === ValueType.BINARY && Array.isArray(value[1])) {
      const pointer: unknown[] = value[1];

      if (typeof pointer[0] === 'number' && Number.isInteger(pointer[0]) && pointer[0] >= 0) {
        pointer[0] += offset;

        return;
      }
    }
    value.forEach(entry => rebaseBinaryPointers(entry, offset, visited));
  } else if (isRecord(value)) {
    Object.values(value).forEach(entry => rebaseBinaryPointers(entry, offset, visited));
  }
}

function collectSourceObjectIds(value: unknown, ids = new Set<string>(), visited = new WeakSet<object>()): Set<string> {
  if (value == null || typeof value !== 'object' || visited.has(value)) {
    return ids;
  }
  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach(entry => collectSourceObjectIds(entry, ids, visited));

    return ids;
  }

  const id = (value as Record<string, unknown>)['id'];

  if (typeof id === 'string' && id !== '') {
    ids.add(id);
  }
  Object.values(value).forEach(entry => collectSourceObjectIds(entry, ids, visited));

  return ids;
}
