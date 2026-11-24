import type { IRAnimatedProperty, IRLayer } from '@galacean/animation-ir';
import type { ColorOverLifetime } from '@galacean/effects-specification';
import { buildNormalizedColorAnimation, buildNormalizedTransformAnimation } from './normalized-animation';
import { multiplyOpacityProperties } from './opacity';
import type { GEAnimationPayload, LayerGenerationContext, TransformAnimation } from '../types';

export function buildTransformAnimation(layer: IRLayer, ctx: LayerGenerationContext): TransformAnimation {
  if (layer.transform == null) {
    return {};
  }

  // Prefer preserved GE payloads; otherwise encode normalized IR channels.
  const layerData = ctx.layerDataById[layer.id];
  const preservedPosition = layerData?.positionOverLifetime;
  const preservedRotation = layerData?.rotationOverLifetime;
  const preservedSize = layerData?.sizeOverLifetime;
  const normalized = buildNormalizedTransformAnimation(layer, ctx);

  const positionOverLifetime = preservedPosition ?? normalized.positionOverLifetime;
  const rotationOverLifetime = preservedRotation ?? normalized.rotationOverLifetime;
  const sizeOverLifetime = preservedSize ?? normalized.sizeOverLifetime;

  return { positionOverLifetime, rotationOverLifetime, sizeOverLifetime };
}

export function buildColorAnimation(
  layer: IRLayer,
  ctx: LayerGenerationContext,
  inheritedOpacity?: IRAnimatedProperty<number>,
): GEAnimationPayload<ColorOverLifetime> | undefined {
  const preservedColor = ctx.layerDataById[layer.id]?.colorOverLifetime;

  if (inheritedOpacity == null) {
    return preservedColor ?? buildNormalizedColorAnimation(layer);
  }

  const opacity = multiplyOpacityProperties(
    inheritedOpacity,
    layer.transform?.opacity,
    layer.time.inFrame,
    layer.time.outFrame,
  );
  const normalizedLayer: IRLayer = {
    ...layer,
    transform: { ...layer.transform, opacity },
  };
  const normalized = buildNormalizedColorAnimation(normalizedLayer);

  if (preservedColor != null && normalized?.opacity != null) {
    return { ...preservedColor, opacity: normalized.opacity };
  }
  if (preservedColor != null) {
    return preservedColor;
  }

  return normalized;
}
