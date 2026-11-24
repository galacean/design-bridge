import type { DataPath, TimelineClipData, VFXItemData } from '@galacean/effects-specification';
import { DataType } from '@galacean/effects-specification';
import type { GeneratedMiscData } from '../types';

type ActivationItem = Pick<VFXItemData, 'id' | 'delay' | 'duration' | 'parentId'>;

interface GeneratedItemBindingRef {
  itemId: string;
  objectBindingTrackId?: string;
}

interface NormalizeHierarchyActivationOptions {
  items: ActivationItem[];
  miscs: GeneratedMiscData[];
  itemBindings: GeneratedItemBindingRef[];
  /** Generated item IDs corresponding to IR Layers with a Transform Parent. */
  transformParentChildItemIds?: Set<string>;
  roundNumber: (value: number, precision: number) => number;
}

/**
 * Keep IR Transform Parents active across every descendant's interval, then
 * normalize internal generated child items in parent-first order. Parent
 * activation changes do not alter Transform keyframe time domains.
 */
export function normalizeHierarchyActivationIntervals({
  items,
  miscs,
  itemBindings,
  transformParentChildItemIds = new Set<string>(),
  roundNumber,
}: NormalizeHierarchyActivationOptions): void {
  const itemById = new Map<string, ActivationItem>();

  for (const item of items) {
    itemById.set(item.id, item);
  }

  const bindingByItemId = new Map<string, GeneratedItemBindingRef>();

  for (const binding of itemBindings) {
    bindingByItemId.set(binding.itemId, binding);
  }

  const miscById = new Map<string, GeneratedMiscData>();

  for (const misc of miscs) {
    miscById.set(misc.id, misc);
  }

  extendTransformParentActivations(
    items,
    itemById,
    bindingByItemId,
    miscById,
    transformParentChildItemIds,
    roundNumber,
  );

  const effectiveDelayCache = new Map<string, number>();

  function getEffectiveDelay(itemId: string, visited = new Set<string>()): number {
    if (effectiveDelayCache.has(itemId)) {
      return effectiveDelayCache.get(itemId) as number;
    }
    if (visited.has(itemId)) {
      return 0;
    }

    visited.add(itemId);

    const item = itemById.get(itemId);

    if (item == null) {
      return 0;
    }

    let delay = item.delay ?? 0;
    const parentId = item.parentId;

    if (parentId != null && parentId !== '') {
      delay = Math.max(delay, getEffectiveDelay(parentId, visited));
    }

    effectiveDelayCache.set(itemId, delay);

    return delay;
  }

  const sortedItems = topologicalSort(items, itemById);

  for (const item of sortedItems) {
    const itemId = item.id;
    const originalDelay = item.delay ?? 0;
    const originalDuration = item.duration;
    const effectiveDelay = getEffectiveDelay(itemId);

    if (effectiveDelay <= originalDelay) {
      continue;
    }

    const parentId = item.parentId;
    const parentItem = parentId != null && parentId !== '' ? itemById.get(parentId) : undefined;
    const parentDuration = parentItem?.duration ?? 0;

    // Precomposition children use parent-local time; transform-linked children
    // use composition time.
    const isPrecompChild = parentItem != null && originalDelay + originalDuration <= parentDuration + 0.001;

    let newDuration: number;

    if (isPrecompChild) {
      newDuration = Math.min(originalDuration, parentDuration - originalDelay);
    } else {
      const timeDiff = effectiveDelay - originalDelay;

      newDuration = originalDuration - timeDiff;
    }

    if (newDuration <= 0) {
      newDuration = 0.0001;
    }

    item.delay = roundNumber(effectiveDelay, 4);
    item.duration = roundNumber(newDuration, 4);

    syncTimelineClips(itemId, effectiveDelay, newDuration, bindingByItemId, miscById, roundNumber);
  }
}

interface ActivationInterval {
  start: number;
  end: number;
}

function extendTransformParentActivations(
  items: ActivationItem[],
  itemById: Map<string, ActivationItem>,
  bindingByItemId: Map<string, GeneratedItemBindingRef>,
  miscById: Map<string, GeneratedMiscData>,
  transformParentChildItemIds: Set<string>,
  roundNumber: (value: number, precision: number) => number,
): void {
  if (transformParentChildItemIds.size === 0) {
    return;
  }

  const activationIntervalByItemId = new Map<string, ActivationInterval>();

  for (const item of items) {
    const start = item.delay ?? 0;

    activationIntervalByItemId.set(item.id, { start, end: start + item.duration });
  }

  for (const childItemId of transformParentChildItemIds) {
    const childInterval = activationIntervalByItemId.get(childItemId);

    if (childInterval == null) {
      continue;
    }

    const visited = new Set<string>();
    let currentChildItemId: string | undefined = childItemId;

    while (currentChildItemId != null && transformParentChildItemIds.has(currentChildItemId)) {
      if (visited.has(currentChildItemId)) {
        break;
      }
      visited.add(currentChildItemId);

      const currentChildItem = itemById.get(currentChildItemId);
      const parentItemId = currentChildItem?.parentId;

      if (parentItemId == null || parentItemId === '') {
        break;
      }

      const parentInterval = activationIntervalByItemId.get(parentItemId);

      if (parentInterval == null) {
        break;
      }

      parentInterval.start = Math.min(parentInterval.start, childInterval.start);
      parentInterval.end = Math.max(parentInterval.end, childInterval.end);
      currentChildItemId = parentItemId;
    }
  }

  for (const [itemId, interval] of activationIntervalByItemId) {
    const item = itemById.get(itemId);

    if (item == null) {
      continue;
    }

    const originalStart = item.delay ?? 0;
    const originalEnd = originalStart + item.duration;

    if (interval.start === originalStart && interval.end === originalEnd) {
      continue;
    }

    const newDelay = roundNumber(interval.start, 4);
    const newDuration = roundNumber(interval.end - interval.start, 4);

    item.delay = newDelay;
    item.duration = newDuration;
    syncActivationClips(itemId, newDelay, newDuration, bindingByItemId, miscById);
  }
}

function syncActivationClips(
  itemId: string,
  delay: number,
  duration: number,
  bindingByItemId: Map<string, GeneratedItemBindingRef>,
  miscById: Map<string, GeneratedMiscData>,
): void {
  const binding = bindingByItemId.get(itemId);

  if (binding?.objectBindingTrackId == null) {
    return;
  }

  const objectBindingTrack = miscById.get(binding.objectBindingTrackId);

  if (objectBindingTrack == null || !Array.isArray(objectBindingTrack['children'])) {
    return;
  }

  for (const childRef of objectBindingTrack['children'] as DataPath[]) {
    const childTrack = miscById.get(childRef.id);

    if (childTrack?.['dataType'] === DataType.ActivationTrack && Array.isArray(childTrack['clips'])) {
      for (const clip of childTrack['clips'] as TimelineClipData[]) {
        clip.start = delay;
        clip.duration = duration;
      }
    }
  }
}

/** Sort items parent-first while preserving order among unrelated items. */
function topologicalSort(items: ActivationItem[], itemById: Map<string, ActivationItem>): ActivationItem[] {
  const sorted: ActivationItem[] = [];
  const visited = new Set<string>();

  function visit(item: ActivationItem): void {
    const itemId = item.id;

    if (visited.has(itemId)) {
      return;
    }

    visited.add(itemId);

    const parentId = item.parentId;

    if (parentId != null && parentId !== '') {
      const parentItem = itemById.get(parentId);

      if (parentItem != null) {
        visit(parentItem);
      }
    }

    sorted.push(item);
  }

  for (const item of items) {
    visit(item);
  }

  return sorted;
}

function syncTimelineClips(
  itemId: string,
  delay: number,
  duration: number,
  bindingByItemId: Map<string, GeneratedItemBindingRef>,
  miscById: Map<string, GeneratedMiscData>,
  roundNumber: (value: number, precision: number) => number,
): void {
  const binding = bindingByItemId.get(itemId);

  if (binding?.objectBindingTrackId == null) {
    return;
  }

  const objectBindingTrack = miscById.get(binding.objectBindingTrackId);

  if (objectBindingTrack == null || !Array.isArray(objectBindingTrack['children'])) {
    return;
  }

  for (const childRef of objectBindingTrack['children'] as DataPath[]) {
    const childTrack = miscById.get(childRef.id);

    if (childTrack == null || !Array.isArray(childTrack['clips'])) {
      continue;
    }

    const trackType = childTrack.dataType;

    if (
      trackType !== DataType.ActivationTrack &&
      trackType !== DataType.TransformTrack &&
      trackType !== DataType.SpriteColorTrack
    ) {
      continue;
    }

    for (const clip of childTrack['clips'] as TimelineClipData[]) {
      clip.start = roundNumber(delay, 4);
      clip.duration = roundNumber(duration, 4);
    }
  }
}
