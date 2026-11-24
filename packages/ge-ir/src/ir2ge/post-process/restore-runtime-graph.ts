import { resolveDataPathId, visitDataPathReferences } from '../../common/data-path';
import { createId } from '../../common/id';
import { isRecord, normalizeJSONValue } from '../../common/json-normalization';
import type { GEToIRPreservedData } from '../../preserved-data';
import type { GeneratedCompositionData } from '../types';

/** Reconnect GE-only objects without replacing entities regenerated from editable IR. */
export function restoreRuntimeGraph(
  generated: Record<string, unknown>,
  compositions: GeneratedCompositionData[],
  preservedData?: GEToIRPreservedData,
): void {
  const source = preservedData?.sourceScene;

  if (source == null || preservedData == null) {
    return;
  }
  const sourceById = new Map<string, { collection: string; object: Record<string, unknown> }>();

  for (const [collection, values] of Object.entries(source)) {
    if (collection === 'bins') {
      continue;
    }
    for (const object of records(values)) {
      if (typeof object['id'] === 'string') {
        sourceById.set(object['id'], { collection, object });
      }
    }
  }
  const usedIds = new Set(Object.values(generated).flatMap(values => records(values).map(object => object['id'])));
  const generatedCompositions = records(generated['compositions']);
  const sharedResourceIds = new Map<string, string>();

  for (const { id, ir, itemBindings } of compositions) {
    const binding = preservedData.compositionBindings[ir.id];
    const composition = generatedCompositions.find(object => object['id'] === id);

    if (binding == null || composition == null) {
      continue;
    }
    const runtimeItems = new Set(binding.runtimeItemIds ?? []);
    const roots = new Set([...Array.from(runtimeItems), ...(binding.runtimeComponentIds ?? [])]);
    const ids = new Map<string, string>([[binding.sourceCompositionId, id]]);
    const generatedComponents = records(generated['components']);
    const runtime = generatedComponents.find(object => object['dataType'] === 'CompositionComponent' &&
      resolveDataPathId(object['item']) === id);
    const sourceRuntime = records(source['components']).find(object => object['dataType'] === 'CompositionComponent' &&
      resolveDataPathId(object['item']) === binding.sourceCompositionId);

    if (runtime == null || sourceRuntime == null) {
      continue;
    }
    const sourceBindings = records(sourceRuntime['sceneBindings']);
    const sourceTrackByTarget = new Map(sourceBindings.flatMap(value => {
      const target = resolveDataPathId(value['value']);
      const track = resolveDataPathId(value['key']);

      return target != null && track != null ? [[target, track] as const] : [];
    }));
    const generatedBindings = records(runtime['sceneBindings']);
    const generatedTrackByTarget = new Map(generatedBindings.flatMap(value => {
      const target = resolveDataPathId(value['value']);
      const track = resolveDataPathId(value['key']);

      return target != null && track != null ? [[target, track] as const] : [];
    }));

    for (const itemBinding of itemBindings) {
      const data = itemBinding.layerId == null ? undefined : binding.layerDataById[itemBinding.layerId];
      const sourceItems = data?.sourceItemIds ?? [];
      const sourceItemId = sourceItems.includes(itemBinding.itemId) ? itemBinding.itemId : sourceItems.at(-1);

      if (sourceItemId == null) {
        continue;
      }
      ids.set(sourceItemId, itemBinding.itemId);
      const sourceTrack = sourceTrackByTarget.get(sourceItemId);

      if (sourceTrack != null && itemBinding.objectBindingTrackId != null) {
        ids.set(sourceTrack, itemBinding.objectBindingTrackId);
      }
      for (const componentId of data?.additionalComponentIds ?? []) {
        roots.add(componentId);
      }
      const primaryId = data?.sourceComponentId;
      const primaryType = primaryId == null ? undefined : sourceById.get(primaryId)?.object['dataType'];
      const primary = generatedComponents.find(object => resolveDataPathId(object['item']) === itemBinding.itemId &&
        object['dataType'] === primaryType);

      if (primaryId != null && primary != null && typeof primary['id'] === 'string') {
        ids.set(primaryId, primary['id']);
        const originalTrack = sourceTrackByTarget.get(primaryId);
        const generatedTrack = generatedTrackByTarget.get(primary['id']);

        if (originalTrack != null && generatedTrack != null) {
          ids.set(originalTrack, generatedTrack);
        }
      }
    }
    const copied = new Map<string, { collection: string; object: Record<string, unknown> }>();
    const collect = (sourceId: string): void => {
      if (ids.has(sourceId) || copied.has(sourceId)) {
        return;
      }
      const entry = sourceById.get(sourceId);

      if (entry == null || entry.collection === 'compositions' ||
        (entry.collection === 'items' && !runtimeItems.has(sourceId))) {
        return;
      }
      const sharedId = sharedResourceIds.get(sourceId);

      if (sharedId != null) {
        ids.set(sourceId, sharedId);

        return;
      }
      if (entry.collection === 'components') {
        const owner = resolveDataPathId(entry.object['item']);

        if (entry.object['dataType'] === 'CompositionComponent' ||
          (owner != null && !ids.has(owner) && !runtimeItems.has(owner))) {
          return;
        }
      }
      const mappedId = usedIds.has(sourceId) ? createId() : sourceId;

      usedIds.add(mappedId);
      ids.set(sourceId, mappedId);
      // Resources are shared across GE compositions; cloning them disconnects cross-composition material animation.
      if (!['items', 'components', 'miscs'].includes(entry.collection)) {
        sharedResourceIds.set(sourceId, mappedId);
      }
      copied.set(sourceId, { collection: entry.collection, object: normalizeJSONValue(entry.object) });
      visitDataPathReferences(entry.object, collect);
      if (entry.collection === 'textures' && typeof entry.object['source'] === 'number') {
        const imageId = records(source['images'])[entry.object['source']]?.['id'];

        if (typeof imageId === 'string') {
          copied.get(sourceId)!.object['source'] = { id: imageId };
          collect(imageId);
        }
      }
    };

    for (const root of roots) {
      collect(root);
    }
    const extraBindings = sourceBindings.filter(value => {
      const target = resolveDataPathId(value['value']);

      return target != null && (copied.has(target) || (ids.has(target) && sharedResourceIds.has(target)));
    });

    for (const value of extraBindings) {
      const track = resolveDataPathId(value['key']);

      if (track != null) {
        collect(track);
      }
    }
    for (const { object } of copied.values()) {
      remapReferences(object, ids);
    }
    for (const { collection, object } of copied.values()) {
      const values: unknown[] = Array.isArray(generated[collection]) ? generated[collection] : [];

      values.push(object);
      generated[collection] = values;
    }
    const allItems = records(generated['items']);
    const allMiscs = records(generated['miscs']);
    const localItemIds = new Set(itemBindings.map(value => value.itemId));

    for (const itemId of runtimeItems) {
      const mappedId = ids.get(itemId);

      if (mappedId != null) {
        localItemIds.add(mappedId);
      }
    }
    const localItems = allItems.filter(object => localItemIds.has(String(object['id'])));

    for (const item of localItems) {
      const sourceId = [...ids].find(([, target]) => target === item['id'])?.[0];
      const original = sourceId == null ? undefined : sourceById.get(sourceId)?.object;
      const data = Object.values(binding.layerDataById).find(value => value.sourceItemIds?.includes(sourceId ?? '') === true);
      const originalParent = data?.runtimeParentId ?? original?.['parentId'] ?? records(source['items']).find(parent =>
        records(parent['children']).some(child => resolveDataPathId(child) === sourceId),
      )?.['id'];

      if (typeof originalParent === 'string' && (runtimeItems.has(sourceId ?? '') ||
        data?.runtimeParentId === originalParent)) {
        const parent = ids.get(originalParent);

        if (parent != null) {
          item['parentId'] = parent;
        } else {
          delete item['parentId'];
        }
      }
      const additional = records(original?.['components']).flatMap(reference => {
        const sourceComponentId = resolveDataPathId(reference);
        const mapped = sourceComponentId == null ? undefined : ids.get(sourceComponentId);

        return mapped != null && copied.has(sourceComponentId!) ? [{ id: mapped }] : [];
      });

      const componentOrder = new Map(records(original?.['components']).map((reference, index) => {
        const sourceId = resolveDataPathId(reference) ?? '';

        return [ids.get(sourceId) ?? sourceId, index];
      }));

      item['components'] = uniqueReferences([...records(item['components']), ...additional]).sort((left, right) =>
        (componentOrder.get(String(left['id'])) ?? componentOrder.size) -
        (componentOrder.get(String(right['id'])) ?? componentOrder.size),
      );
    }
    const order = new Map(binding.sourceItemOrder.map((sourceId, index) => [ids.get(sourceId) ?? sourceId, index]));

    localItems.sort((left, right) => (order.get(String(left['id'])) ?? order.size) -
      (order.get(String(right['id'])) ?? order.size));
    const generatedOrder = new Map(itemBindings.map((item, index) => [item.itemId, index]));
    const orderedGeneratedItems = localItems.filter(item => generatedOrder.has(String(item['id']))).sort((left, right) =>
      generatedOrder.get(String(left['id']))! - generatedOrder.get(String(right['id']))!,
    );
    let generatedIndex = 0;

    // Keep GE-only slots while retaining the authored order of regenerated and newly inserted Items.
    for (let index = 0; index < localItems.length; index++) {
      if (generatedOrder.has(String(localItems[index]['id']))) {
        localItems[index] = orderedGeneratedItems[generatedIndex++];
      }
    }
    composition['children'] = [];
    for (const item of localItems) {
      item['children'] = [];
    }
    const localById = new Map(localItems.map(item => [item['id'], item]));

    for (const item of localItems) {
      const parent = localById.get(item['parentId']);
      const owner = parent ?? composition;

      (owner['children'] as unknown[]).push({ id: item['id'] });
    }
    composition['components'] = uniqueReferences([
      ...records(composition['components']),
      ...(binding.runtimeComponentIds ?? []).map(sourceId => ({ id: ids.get(sourceId) ?? sourceId })),
    ]);
    runtime['sceneBindings'] = [...generatedBindings, ...extraBindings.map(value => remapReferences(
      normalizeJSONValue(value), ids,
    ))];
    const timeline = allMiscs.find(object => object['id'] === resolveDataPathId(runtime['timelineAsset']));

    for (const value of extraBindings) {
      const track = resolveDataPathId(value['key']);
      const mapped = track == null ? undefined : ids.get(track);

      if (track == null || mapped == null) {
        continue;
      }
      const parent = records(source['miscs']).find(object => records(object['children']).some(child =>
        resolveDataPathId(child) === track,
      ));
      const mappedParent = typeof parent?.['id'] === 'string' ? ids.get(parent['id']) : undefined;
      const owner = allMiscs.find(object => object['id'] === mappedParent);

      if (owner != null) {
        owner['children'] = uniqueReferences([...records(owner['children']), { id: mapped }]);
      } else if (timeline != null) {
        timeline['tracks'] = uniqueReferences([...records(timeline['tracks']), { id: mapped }]);
      }
    }
    if (timeline != null) {
      const sourceTimelineId = resolveDataPathId(sourceRuntime['timelineAsset']);
      const sourceTimeline = sourceTimelineId == null ? undefined : sourceById.get(sourceTimelineId)?.object;
      const order = new Map(records(sourceTimeline?.['tracks']).map((reference, index) => {
        const sourceId = resolveDataPathId(reference) ?? '';

        return [ids.get(sourceId) ?? sourceId, index];
      }));

      timeline['tracks'] = records(timeline['tracks']).sort((left, right) =>
        (order.get(String(left['id'])) ?? order.size) - (order.get(String(right['id'])) ?? order.size),
      );
      const itemOrder = new Map(localItems.map((item, index) => [item['id'], index]));
      const itemTrackOrder = new Map(records(runtime['sceneBindings']).flatMap(value => {
        const index = itemOrder.get(resolveDataPathId(value['value']));
        const track = resolveDataPathId(value['key']);

        return index != null && track != null ? [[track, index] as const] : [];
      }));
      const tracks = records(timeline['tracks']);
      const itemTracks = tracks.filter(track => itemTrackOrder.has(String(track['id']))).sort((left, right) =>
        itemTrackOrder.get(String(left['id']))! - itemTrackOrder.get(String(right['id']))!,
      );
      let itemTrackIndex = 0;

      timeline['tracks'] = tracks.map(track => itemTrackOrder.has(String(track['id']))
        ? itemTracks[itemTrackIndex++] : track);
    }
  }
  if (source['renderSettings'] != null) {
    generated['renderSettings'] = normalizeJSONValue(source['renderSettings']);
  }
}

function remapReferences(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) {
    value.forEach(entry => remapReferences(entry, ids));
  } else if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string' && (key === 'id' || key === 'parentId' || key === 'refId')) {
        value[key] = ids.get(entry) ?? entry;
      } else {
        remapReferences(entry, ids);
      }
    }
  }

  return value;
}

function uniqueReferences(values: Record<string, unknown>[]): Record<string, unknown>[] {
  // Materialize iterators explicitly for the shared loose-mode build.
  return Array.from(new Map(values.map(value => [value['id'], value])).values());
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
