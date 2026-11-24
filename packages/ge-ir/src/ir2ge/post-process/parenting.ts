import type { IRLayer } from '@galacean/animation-ir';
import { getStaticAnchor } from '../converter/transform';
import type { GeneratedVFXItemData } from '../types';

export function applyParenting(
  layers: IRLayer[],
  items: GeneratedVFXItemData[],
  layerToItemId: Record<string, string>,
  ratio: number,
  width: number,
  height: number,
): void {
  const layerById = new Map<string, IRLayer>();

  for (const layer of layers) {
    layerById.set(layer.id, layer);
  }

  const itemById = new Map<string, GeneratedVFXItemData>();

  for (const item of items) {
    itemById.set(item.id, item);
  }

  for (const layer of layers) {
    if (layer.parentId == null) {
      continue;
    }

    const childItemId = layerToItemId[layer.id];
    const parentLayer = layerById.get(layer.parentId);

    if (parentLayer == null || childItemId == null) {
      continue;
    }

    const parentItemId = layerToItemId[parentLayer.id];

    if (parentItemId == null) {
      continue;
    }

    const childItem = itemById.get(childItemId);

    if (childItem == null) {
      continue;
    }

    childItem.parentId = parentItemId;

    const parentAnchor = getStaticAnchor(parentLayer);
    const adjustX = -ratio * (parentAnchor[0] - width / 2);
    const adjustY = ratio * (parentAnchor[1] - height / 2);

    childItem.transform.position.x += adjustX;
    childItem.transform.position.y += adjustY;
  }
}
