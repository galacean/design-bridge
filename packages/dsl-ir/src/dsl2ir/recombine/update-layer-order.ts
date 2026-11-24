import { getLayerStackingOrder } from '../../common/transform';
import type { IRComposition, IRLayer } from '@galacean/animation-ir';
import type { Layer } from '../../dsl/schema';
import type { DSLToIRChangeReporter } from '../types';

interface LayerOrderContext {
  updatedIR: IRComposition;
  irLayerIdByEditedLayer: Map<Layer, string>;
  irLayerById: Map<string, IRLayer>;
  childIRLayerIdsByParentIRLayerId: Map<string, string[]>;
  reportChange: DSLToIRChangeReporter;
  rootDSLParentId?: string;
}

interface IRSibling {
  layer: Layer;
  subtreeLayerIdSet: Set<string>;
}

/** Apply edited sibling order without changing parent relationships. */
export function updateLayerOrder(
  updatedIR: IRComposition,
  editedLayers: Layer[],
  irLayerIdByEditedLayer: Map<Layer, string>,
  reportChange: DSLToIRChangeReporter,
  rootDSLParentId?: string,
): void {
  const irLayerById = new Map(updatedIR.layers.map(layer => [layer.id, layer] as const));
  const childIRLayerIdsByParentIRLayerId = new Map<string, string[]>();

  for (const layer of updatedIR.layers) {
    const parentLayerId = layer.parentId;

    if (parentLayerId != null) {
      const childLayerIds = childIRLayerIdsByParentIRLayerId.get(parentLayerId) ?? [];

      childLayerIds.push(layer.id);
      childIRLayerIdsByParentIRLayerId.set(parentLayerId, childLayerIds);
    }
  }

  updateSiblingGroups(editedLayers, undefined, {
    updatedIR,
    irLayerIdByEditedLayer,
    irLayerById,
    childIRLayerIdsByParentIRLayerId,
    reportChange,
    rootDSLParentId,
  });
}

function updateSiblingGroups(siblingLayers: Layer[], parentLayer: Layer | undefined, context: LayerOrderContext): void {
  updateIRSiblingOrder(siblingLayers, parentLayer, context);

  for (const sibling of siblingLayers) {
    updateSiblingGroups(sibling.children ?? [], sibling, context);
  }
}

function updateIRSiblingOrder(
  siblingLayers: Layer[],
  parentLayer: Layer | undefined,
  context: LayerOrderContext,
): void {
  const parentIRLayerId = parentLayer != null ? context.irLayerIdByEditedLayer.get(parentLayer) : undefined;

  if (parentLayer != null && parentIRLayerId == null) {
    return;
  }

  const expectedParentId = parentLayer?.id ?? context.rootDSLParentId ?? null;
  const orderedSiblings: IRSibling[] = [];

  for (const layer of siblingLayers) {
    const irLayerId = context.irLayerIdByEditedLayer.get(layer);

    if (irLayerId == null) {
      continue;
    }

    const irLayer = context.irLayerById.get(irLayerId);

    if (irLayer == null || (layer.parent ?? null) !== expectedParentId || irLayer.parentId !== parentIRLayerId) {
      continue;
    }

    orderedSiblings.push({
      layer,
      subtreeLayerIdSet: collectIRSubtreeLayerIds(irLayerId, context.childIRLayerIdsByParentIRLayerId),
    });
  }

  if (orderedSiblings.length < 2) {
    return;
  }

  const ownerByIRLayerId = new Map<string, IRSibling>();

  for (const sibling of orderedSiblings) {
    for (const irLayerId of sibling.subtreeLayerIdSet) {
      ownerByIRLayerId.set(irLayerId, sibling);
    }
  }

  const currentIROrder = collectOwnerOrder(context.updatedIR.layers, layer => {
    const sibling = ownerByIRLayerId.get(layer.id);

    return sibling != null && context.irLayerIdByEditedLayer.get(sibling.layer) === layer.id ? sibling : undefined;
  });
  const currentDSLOrder = [...currentIROrder].reverse();

  orderedSiblings.sort((left, right) =>
    getLayerStackingOrder(right.layer) - getLayerStackingOrder(left.layer) ||
    currentDSLOrder.indexOf(left) - currentDSLOrder.indexOf(right),
  );

  if (currentDSLOrder.length !== orderedSiblings.length || isOwnerOrderEqual(currentDSLOrder, orderedSiblings)) {
    return;
  }

  const reorderedLayers = reorderOwnedEntries(
    context.updatedIR.layers,
    [...orderedSiblings].reverse(),
    layer => ownerByIRLayerId.get(layer.id),
  );

  if (reorderedLayers == null) {
    return;
  }

  context.updatedIR.layers = reorderedLayers;
  const changedParentLayerId = parentLayer?.id ?? context.rootDSLParentId;

  context.reportChange({
    kind: 'layer',
    op: 'set',
    field: 'order',
    ...(changedParentLayerId != null && { layerId: changedParentLayerId }),
    oldValue: currentDSLOrder.map(sibling => sibling.layer.id),
    newValue: orderedSiblings.map(sibling => sibling.layer.id),
  });
}

function collectIRSubtreeLayerIds(
  rootLayerId: string,
  childIRLayerIdsByParentIRLayerId: ReadonlyMap<string, string[]>,
  subtreeLayerIdSet = new Set<string>(),
): Set<string> {
  if (subtreeLayerIdSet.has(rootLayerId)) {
    return subtreeLayerIdSet;
  }

  subtreeLayerIdSet.add(rootLayerId);

  for (const childLayerId of childIRLayerIdsByParentIRLayerId.get(rootLayerId) ?? []) {
    collectIRSubtreeLayerIds(childLayerId, childIRLayerIdsByParentIRLayerId, subtreeLayerIdSet);
  }

  return subtreeLayerIdSet;
}

function collectOwnerOrder<TEntry, TOwner>(
  entries: TEntry[],
  resolveOwner: (entry: TEntry) => TOwner | undefined,
): TOwner[] {
  const owners: TOwner[] = [];

  for (const entry of entries) {
    const owner = resolveOwner(entry);

    if (owner != null && !owners.includes(owner)) {
      owners.push(owner);
    }
  }

  return owners;
}

function isOwnerOrderEqual<TOwner>(left: TOwner[], right: TOwner[]): boolean {
  return left.length === right.length && left.every((owner, index) => owner === right[index]);
}

function reorderOwnedEntries<TEntry, TOwner>(
  entries: TEntry[],
  orderedOwners: TOwner[],
  resolveOwner: (entry: TEntry) => TOwner | undefined,
): TEntry[] | undefined {
  const entriesByOwner = new Map<TOwner, TEntry[]>();

  for (const owner of orderedOwners) {
    entriesByOwner.set(owner, []);
  }
  for (const entry of entries) {
    const owner = resolveOwner(entry);

    if (owner != null) {
      entriesByOwner.get(owner)?.push(entry);
    }
  }
  if (orderedOwners.some(owner => (entriesByOwner.get(owner)?.length ?? 0) === 0)) {
    return undefined;
  }

  const reorderedOwnedEntries = orderedOwners.flatMap(owner => entriesByOwner.get(owner) ?? []);
  let reorderedIndex = 0;

  return entries.map(entry => {
    if (resolveOwner(entry) == null) {
      return entry;
    }

    return reorderedOwnedEntries[reorderedIndex++];
  });
}
