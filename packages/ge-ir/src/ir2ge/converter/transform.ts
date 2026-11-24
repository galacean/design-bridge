import type { IRLayer, IRLocalBounds } from '@galacean/animation-ir';
import type { IRToGETimeContext } from './bezier';
import { rotateAnchorOffsetForParentedVisual } from '../../common/anchor-mapping';
import { convert2dTo3dPoint } from '../../common/coordinate-mapping';
import type { LayerGenerationContext } from '../types';

const DEFAULT_LOCAL_BOUNDS: IRLocalBounds = { x: 0, y: 0, width: 1, height: 1 };

export function getLayerLocalBounds(layer: IRLayer, fallback: IRLocalBounds = DEFAULT_LOCAL_BOUNDS): IRLocalBounds {
  if (layer.localBounds != null) {
    return layer.localBounds;
  }
  if (layer.type === 'text') {
    const text = layer.content;
    const estimatedWidth = estimateTextWidth(text.text, text.fontSize, text.letterSpacing);

    return {
      x: 0,
      y: 0,
      width: Math.max(estimatedWidth, 1),
      height: Math.max(text.lineHeight, text.fontSize * 1.2),
    };
  }

  return fallback;
}

function estimateTextWidth(text: string, fontSize: number, letterSpacing: number): number {
  if (text.length === 0) {
    return 0;
  }
  const averageCharacterWidth = fontSize * 0.6;

  return text.length * averageCharacterWidth + letterSpacing * (text.length - 1);
}

export function computeStaticPosition(
  layer: IRLayer,
  ctx: LayerGenerationContext,
  anchorOffsetX = 0,
  anchorOffsetY = 0,
): [number, number, number] {
  const transform = layer.transform;

  if (transform?.position?.type === 'keyframed' && transform.position.keyframes.length !== 1) {
    return convert2dTo3dPoint(ctx.width / 2 + anchorOffsetX, ctx.height / 2 + anchorOffsetY, 0, ctx.width, ctx.height);
  }

  const positionValue =
    transform?.position?.type === 'keyframed' ? transform.position.keyframes[0]?.value : transform?.position?.value;

  if (Array.isArray(positionValue)) {
    return convert2dTo3dPoint(
      (positionValue[0] ?? 0) + anchorOffsetX,
      (positionValue[1] ?? 0) + anchorOffsetY,
      positionValue[2] ?? 0,
      ctx.width,
      ctx.height,
    );
  }

  return convert2dTo3dPoint(anchorOffsetX, anchorOffsetY, 0, ctx.width, ctx.height);
}

export function getStaticAnchor(layer: IRLayer): [number, number] {
  const value = layer.transform?.anchor?.value;

  if (Array.isArray(value) && value.length >= 2) {
    return [value[0], value[1]];
  }

  return [0, 0];
}

function getStaticScaleFromIR(layer: IRLayer): [number, number] {
  const scale = layer.transform?.scale;

  if (scale == null) {
    return [1, 1];
  }
  if (scale.type === 'keyframed' && scale.keyframes.length !== 1) {
    return [1, 1];
  }
  const value = scale.type === 'keyframed' ? scale.keyframes[0]?.value : scale.value;

  if (!Array.isArray(value)) {
    return [1, 1];
  }

  return [value[0] ?? 1, value[1] ?? 1];
}

export function applyScalePositionAdjust(
  position: [number, number, number],
  layer: IRLayer,
  bounds: IRLocalBounds,
  ratio: number,
): [number, number, number] {
  const [offsetX, offsetY] = computeScalePositionOffset(layer, bounds);

  return [position[0] + offsetX * ratio, position[1] - offsetY * ratio, position[2]];
}

function computeScalePositionOffset(layer: IRLayer, bounds: IRLocalBounds): [number, number] {
  const staticScale = getStaticScaleFromIR(layer);
  const { x, y, width, height } = bounds;

  if ((staticScale[0] === 1 && staticScale[1] === 1) || width <= 0 || height <= 0) {
    return [0, 0];
  }

  const anchor = getStaticAnchor(layer);
  const anchorDiffX = anchor[0] - (x + width / 2);
  const anchorDiffY = anchor[1] - (y + height / 2);

  if (Math.abs(anchorDiffX) <= 0.5 && Math.abs(anchorDiffY) <= 0.5) {
    return [0, 0];
  }

  return [
    anchorDiffX * (1 - staticScale[0]),
    anchorDiffY * (1 - staticScale[1]),
  ];
}

export function computeAnchorInfo(
  layer: IRLayer,
  bounds: IRLocalBounds,
): { anchorScaleX: number; anchorScaleY: number; anchorOffsetX: number; anchorOffsetY: number } {
  const anchor = getStaticAnchor(layer);
  const { x, y, width, height } = bounds;
  const localAnchorX = anchor[0] - x;
  const localAnchorY = anchor[1] - y;
  let anchorScaleX = 0.5;
  let anchorScaleY = 0.5;
  let anchorOffsetX = 0;
  let anchorOffsetY = 0;

  if (width > 0 && height > 0) {
    anchorScaleX = localAnchorX / width;
    anchorScaleY = localAnchorY / height;
    anchorOffsetX = -(localAnchorX - width / 2);
    anchorOffsetY = -(localAnchorY - height / 2);
  }

  [anchorOffsetX, anchorOffsetY] = rotateAnchorOffsetForParentedVisual(
    layer.type,
    layer.parentId != null,
    layer.transform,
    anchorOffsetX,
    anchorOffsetY,
  );

  return { anchorScaleX, anchorScaleY, anchorOffsetX, anchorOffsetY };
}

export function getTimeContext(layer: IRLayer): IRToGETimeContext {
  return {
    inFrame: layer.time.inFrame,
    outFrame: layer.time.outFrame,
  };
}
