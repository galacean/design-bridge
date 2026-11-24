const OMIT = Symbol('omit-json-value');

type JSONValue = null | string | boolean | number | JSONValue[] | { [key: string]: JSONValue };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Clone and normalize a value to its JSON-persisted runtime shape. */
export function normalizeJSONValue<T>(value: T): T {
  const normalized = normalize(value, '$', false);

  if (normalized === OMIT) {
    throw new TypeError('[ge-ir] A top-level JSON value cannot be undefined.');
  }

  return normalized as T;
}

function normalize(value: unknown, path: string, inArray: boolean): JSONValue | typeof OMIT {
  if (value === undefined) {
    return inArray ? null : OMIT;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`[ge-ir] Non-finite number at ${path} is not JSON-compatible.`);
    }

    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const normalizedItem = normalize(item, `${path}[${index}]`, true);

      if (normalizedItem === OMIT) {
        throw new TypeError(`[ge-ir] Array item at ${path}[${index}] could not be normalized.`);
      }

      return normalizedItem;
    });
  }
  if (typeof value !== 'object') {
    throw new TypeError(`[ge-ir] ${typeof value} at ${path} is not JSON-compatible.`);
  }

  const prototype = Reflect.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`[ge-ir] Non-plain object at ${path} is not JSON-compatible.`);
  }

  const result: Record<string, JSONValue> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedItem = normalize(item, `${path}.${key}`, false);

    if (normalizedItem !== OMIT) {
      result[key] = normalizedItem;
    }
  }

  return result;
}
