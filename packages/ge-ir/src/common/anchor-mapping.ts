import type { IRLayerType, IRTransform } from '@galacean/animation-ir';

/** Apply GE's parented visual rotation convention to an anchor position offset. */
export function rotateAnchorOffsetForParentedVisual(
  layerType: IRLayerType,
  hasParent: boolean,
  transform: IRTransform | undefined,
  offsetX: number,
  offsetY: number,
): [number, number] {
  if ((layerType !== 'image' && layerType !== 'solid') || !hasParent) {
    return [offsetX, offsetY];
  }
  const rotationZ = transform?.rotation?.z;

  if (rotationZ == null || rotationZ.type === 'keyframed' || rotationZ.value === 0) {
    return [offsetX, offsetY];
  }
  const radians = (rotationZ.value * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  return [offsetX * cosine - offsetY * sine, offsetX * sine + offsetY * cosine];
}
