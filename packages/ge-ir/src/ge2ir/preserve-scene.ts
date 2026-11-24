import { resolveIRResourceUrl } from '@galacean/animation-ir/adapter';
import { isRecord, normalizeJSONValue } from '../common/json-normalization';

/** Resolve adapter-owned resources against the same base as normalized IR assets. */
export function preserveSourceScene(scene: Record<string, unknown>, resourceBaseUrl?: string): Record<string, unknown> {
  const result = normalizeJSONValue(scene);

  if (resourceBaseUrl == null) {
    return result;
  }
  for (const name of ['images', 'fonts', 'bins', 'videos', 'audios']) {
    const values = result[name];

    if (!Array.isArray(values)) {
      continue;
    }
    result[name] = values.map((value: unknown) => {
      if (typeof value === 'string') {
        return resolveIRResourceUrl(value, resourceBaseUrl);
      }
      if (isRecord(value)) {
        for (const key of ['url', 'fontURL', 'webp', 'avif', 'ktx2']) {
          const url = value[key];

          if (typeof url === 'string' && url !== '') {
            value[key] = resolveIRResourceUrl(url, resourceBaseUrl);
          }
        }
      }

      return value;
    });
  }

  return result;
}
