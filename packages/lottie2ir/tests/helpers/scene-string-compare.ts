export type JSONValue = null | boolean | number | string | JSONValue[] | { [k: string]: JSONValue };

const GUID_REGEX = /^[0-9a-f]{32}$/i;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isGuidLike(value: string): boolean {
  return GUID_REGEX.test(value) || UUID_REGEX.test(value);
}

function sortKeys(value: JSONValue): JSONValue {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    const result: Record<string, JSONValue> = {};

    for (const [key, child] of entries) {
      result[key] = sortKeys(child);
    }

    return result;
  }

  return value;
}

export function stableStringify(value: JSONValue): string {
  return JSON.stringify(sortKeys(value));
}

export function normalizeSceneIgnoringGuid(scene: JSONValue): JSONValue {
  const idMap = new Map<string, string>();
  let idCounter = 0;

  function mapId(raw: string): string {
    const found = idMap.get(raw);

    if (found !== undefined) {
      return found;
    }

    const mapped = `__ID_${idCounter++}__`;

    idMap.set(raw, mapped);

    return mapped;
  }

  function walk(value: JSONValue, key?: string): JSONValue {
    if (Array.isArray(value)) {
      return value.map(item => walk(item));
    }

    if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, JSONValue>;
      const result: Record<string, JSONValue> = {};

      for (const [k, v] of Object.entries(obj)) {
        result[k] = walk(v, k);
      }

      return result;
    }

    if (typeof value === 'string' && key !== undefined) {
      if (key === 'compositionId' && isGuidLike(value)) {
        return '__COMPOSITION_ID__';
      }

      if ((key === 'id' || key === 'parentId' || key === 'name' || key === 'refId') && isGuidLike(value)) {
        return mapId(value);
      }
    }

    return value;
  }

  return walk(scene);
}
