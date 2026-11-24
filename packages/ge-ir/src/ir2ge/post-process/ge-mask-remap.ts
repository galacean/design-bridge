import { toDataPath } from '../../common/data-path';
import type { ECSCollector } from '../types';

/**
 * Remap preserved mask targets from source component IDs to regenerated IDs.
 * Source masks have no reference; unresolved target masks are removed.
 */
export function applyGEMaskRemap(collector: ECSCollector, GEComponentIdToNewId: Record<string, string>): void {
  const currentComponentIds = new Set(collector.components.map(component => component.id));

  for (const component of collector.components) {
    const mask = component['mask'] as Record<string, unknown> | undefined;

    if (mask == null) {
      continue;
    }

    if (!Array.isArray(mask['references'])) {
      if (mask['isMask'] !== true) {
        delete component['mask'];
      }

      continue;
    }
    const remappedReferences: Array<Record<string, unknown>> = [];

    for (const reference of mask['references']) {
      if (!isRecord(reference)) {
        continue;
      }
      const oldId = getDataPathId(reference['mask']);
      const newId = resolveCurrentComponentId(oldId, currentComponentIds, GEComponentIdToNewId);

      if (newId != null) {
        remappedReferences.push({
          ...reference,
          mask: toDataPath(newId),
          inverted: reference['inverted'] === true,
        });
      }
    }

    if (remappedReferences.length === 0) {
      delete component['mask'];

      continue;
    }

    mask['references'] = remappedReferences;
    delete mask['reference'];
    delete mask['inverted'];
  }
}

function resolveCurrentComponentId(
  oldId: string | undefined,
  currentComponentIds: ReadonlySet<string>,
  GEComponentIdToNewId: Readonly<Record<string, string>>,
): string | undefined {
  return oldId == null ? undefined : currentComponentIds.has(oldId) ? oldId : GEComponentIdToNewId[oldId];
}

function getDataPathId(value: unknown): string | undefined {
  return isRecord(value) && typeof value['id'] === 'string' ? value['id'] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
