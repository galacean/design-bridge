import type { DataPath } from '@galacean/effects-specification';
import { isRecord } from './json-normalization';

type GERecord = Record<string, unknown>;

/** GE scene collection indexed by entity ID. */
export type GESceneCollectionIndex = Map<string, GERecord>;

/** Wrap an ID in a GE DataPath reference. */
export function toDataPath(id: string): DataPath {
  return { id };
}

/** Index GE scene collection entries by string ID. */
export function buildSceneCollectionIndex(collection: GERecord[] | undefined): GESceneCollectionIndex {
  const entryById: GESceneCollectionIndex = new Map();

  if (!Array.isArray(collection)) {
    return entryById;
  }

  for (const entry of collection) {
    const id = entry['id'];

    if (typeof id === 'string') {
      entryById.set(id, entry);
    }
  }

  return entryById;
}

/** Resolve a GE DataPath against an indexed scene collection. */
export function resolveDataPath(collectionIndex: GESceneCollectionIndex, reference: unknown): GERecord | undefined {
  const id = resolveDataPathId(reference);

  return id != null ? collectionIndex.get(id) : undefined;
}

/** Return the string ID stored in a GE DataPath-like value. */
export function resolveDataPathId(reference: unknown): string | undefined {
  return isRecord(reference) && typeof reference['id'] === 'string' ? reference['id'] : undefined;
}

export function visitDataPathReferences(
  value: unknown,
  visit: (id: string) => void,
  visited = new WeakSet<object>(),
): void {
  if (value == null || typeof value !== 'object' || visited.has(value)) {
    return;
  }

  visited.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      visitDataPathReferences(entry, visit, visited);
    }

    return;
  }

  const referenceId = resolveDataPathId(value);

  if (referenceId != null) {
    visit(referenceId);
  }

  for (const entry of Object.values(value)) {
    visitDataPathReferences(entry, visit, visited);
  }
}
