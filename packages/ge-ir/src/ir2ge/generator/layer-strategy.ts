import type { IRAnimatedProperty, IRLayer, IRLocalBounds } from '@galacean/animation-ir';
import type { EffectsLayerPreservedData } from '../../preserved-data';
import { computeAnchorInfo, getLayerLocalBounds, getStaticAnchor } from '../converter/transform';

/**
 * Anchor encoding strategy.
 *
 * - `inline-anchor` encodes the renderer anchor and compensates item position.
 * - `split-null-visual` places transforms on a null parent and visual content
 *   on an anchor-offset child.
 * Effects passthrough data may request the source hierarchy.
 */
type LayerGenerationStrategy =
  | {
      kind: 'inline-anchor';
      anchorScale: [number, number];
      anchorOffset: [number, number];
    }
  | { kind: 'split-null-visual' };

export function resolveLayerGenerationStrategy(
  layer: IRLayer,
  preservedData?: EffectsLayerPreservedData,
): LayerGenerationStrategy {
  const sourceHierarchy = preservedData?.sourceHierarchy;

  if (sourceHierarchy === 'null-sprite-pair') {
    return { kind: 'split-null-visual' };
  }

  const bounds = getLayerLocalBounds(layer);

  if (sourceHierarchy !== 'single-item' && needsPivotContainer(layer, bounds)) {
    return { kind: 'split-null-visual' };
  }

  const info = computeAnchorInfo(layer, bounds);

  return {
    kind: 'inline-anchor',
    anchorScale: [info.anchorScaleX, info.anchorScaleY],
    anchorOffset: [info.anchorOffsetX, info.anchorOffsetY],
  };
}

function needsPivotContainer(layer: IRLayer, bounds: IRLocalBounds): boolean {
  if (layer.type !== 'image' && layer.type !== 'solid' && layer.type !== 'text') {
    return false;
  }
  const { x, y, width, height } = bounds;

  if (width <= 0 || height <= 0) {
    return false;
  }
  const anchor = getStaticAnchor(layer);
  const anchorOffCenter = Math.abs(anchor[0] - (x + width / 2)) > 0.5 || Math.abs(anchor[1] - (y + height / 2)) > 0.5;

  if (!anchorOffCenter) {
    return false;
  }
  const transform = layer.transform;
  const rotation = transform?.rotation;
  const hasRotationAnimation =
    layer.type === 'text'
      ? hasMultipleKeyframes(rotation?.x) || hasMultipleKeyframes(rotation?.y) || hasMultipleKeyframes(rotation?.z)
      : rotation?.x?.type === 'keyframed' || rotation?.y?.type === 'keyframed' || rotation?.z?.type === 'keyframed';
  const hasScaleAnimation =
    layer.type === 'text' ? hasMultipleKeyframes(transform?.scale) : transform?.scale?.type === 'keyframed';
  const hasStaticTextRotation =
    layer.type === 'text' &&
    (hasNonZeroStaticValue(rotation?.x) ||
      hasNonZeroStaticValue(rotation?.y) ||
      hasNonZeroStaticValue(rotation?.z));

  return hasRotationAnimation || hasScaleAnimation || hasStaticTextRotation;
}

function hasMultipleKeyframes(property: IRAnimatedProperty | undefined): boolean {
  return property?.type === 'keyframed' && property.keyframes.length > 1;
}

function hasNonZeroStaticValue(property: IRAnimatedProperty<number> | undefined): boolean {
  if (property == null) {
    return false;
  }
  let value: number | undefined;

  if (property.type === 'keyframed') {
    value = property.keyframes?.length === 1 ? property.keyframes[0]?.value : undefined;
  } else {
    value = property.value;
  }

  return value != null && Math.abs(value) > 1e-6;
}
