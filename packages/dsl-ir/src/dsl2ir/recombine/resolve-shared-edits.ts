import { isRecord, isScalarEqual } from '../../common/utils';
import type { Layer } from '../../dsl/schema';
import type { IRToDSLLayerMapping } from '../../ir2dsl/types';
import type { DSLToIRWarningReporter } from '../types';

interface SharedLayerEdit {
  baseline: Layer;
  edited: Layer | undefined;
  path: string;
}

const SHARED_FIELDS = [
  'name', 'width', 'height', 'time_range', 'position', 'rotation', 'scale', 'anchor', 'opacity',
  'asset', 'text', 'particle',
] as const;

/** Resolve linked edits before mutating IR; conflicting fields retain their baseline values. */
export function resolveSharedPrecompEdits(
  entries: SharedLayerEdit[],
  mapping: IRToDSLLayerMapping,
  reportWarning: DSLToIRWarningReporter,
): void {
  const groups = new Map<string, SharedLayerEdit[]>();

  for (const entry of entries) {
    const source = mapping.layers[entry.baseline.id];

    if (source?.expandedSource == null) {
      continue;
    }
    const key = JSON.stringify([source.irCompositionId, source.irLayerId]);
    const group = groups.get(key) ?? [];

    group.push(entry);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const deleted = group.find(entry => entry.edited == null);

    if (deleted != null) {
      reportWarning({
        code: 'SHARED_PRECOMP_LAYER_DELETED', path: deleted.path, layerId: deleted.baseline.id,
        message: 'Deleting this shared precomposition layer removes it from every instance; deletion takes precedence.',
      });
      continue;
    }

    for (const field of SHARED_FIELDS) {
      const changes = group.filter(entry => entry.edited?.[field] !== undefined &&
        !areSharedValuesEqual(entry.edited[field], entry.baseline[field]));
      const first = changes[0];

      if (first?.edited == null) {
        continue;
      }
      const value = first.edited[field];
      const conflict = changes.some(entry => !areSharedValuesEqual(entry.edited?.[field], value));

      if (conflict) {
        reportWarning({
          code: 'SHARED_PRECOMP_EDIT_CONFLICT', path: `${first.path}.${field}`, layerId: first.baseline.id,
          message: `Conflicting '${field}' edits on shared precomposition instances were ignored; ` +
            'the original field is retained.',
        });
      }
      for (const entry of group) {
        if (entry.edited != null) {
          Object.assign(entry.edited, { [field]: structuredClone(conflict ? entry.baseline[field] : value) });
        }
      }
    }
  }
}

function areSharedValuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    return isScalarEqual(left, right);
  }
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value: unknown, index) => areSharedValuesEqual(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

    return Array.from(keys).every(key => areSharedValuesEqual(left[key], right[key]));
  }

  return false;
}
