import type {
  IRColor, IRImageLayer, IRLayer, IRLayerType, IRParticleLayer,
  IRShapeLayer, IRSolidLayer, IRTextLayer, IRTransform, IRVec3,
} from '@galacean/animation-ir';
import { isIRId } from '@galacean/animation-ir/validator';
import { ItemType, type EndBehavior } from '@galacean/effects-specification';
import { DEFAULT_CAMERA_Z, TEXT_WORLD_UNITS_PER_PIXEL } from '../../common/coordinate-mapping';
import { rotateAnchorOffsetForParentedVisual } from '../../common/anchor-mapping';
import { createId } from '../../common/id';
import { resolveDataPathId } from '../../common/data-path';
import { isRecord, normalizeJSONValue } from '../../common/json-normalization';
import { mapEndBehaviorToIR, mapLayerTimingToIR } from '../mapping';
import type { GESceneContext } from '../types';
import { parseOpacityAnimation, parseTransformAnimation } from './animation';
import { parseComponent } from './component';
import { parseComponentTimeline, parseTimeline } from './timeline';
import { parseStaticTransform } from './transform';
import type { EffectsLayerPreservedData } from '../../preserved-data';

export interface ParsedItemLayer {
  layer: IRLayer;
  preservedData: EffectsLayerPreservedData;
}

/** Parse one GE item and its referenced component data into an IR layer. */
export function parseItemToLayer(
  item: Record<string, unknown>,
  itemId: string,
  ctx: GESceneContext,
): ParsedItemLayer | undefined {
  const name = typeof item['name'] === 'string' ? item['name'] : undefined;
  const GEType = item['type'] as ItemType;
  const visible = (item['visible'] as boolean) ?? true;
  let rawTransformPreservedData: EffectsLayerPreservedData | undefined;

  const timeline = parseTimeline(itemId, ctx);
  const delay = timeline?.delay ?? (item['delay'] as number) ?? 0;
  const duration = timeline?.duration ?? (item['duration'] as number) ?? 0;

  const time = mapLayerTimingToIR(delay, duration, ctx.frameRate, ctx.inPoint);

  const componentData = parseComponent(item, ctx);
  let type: IRLayerType | undefined;

  if (GEType === ItemType.null) {
    type = 'null';
  } else if (componentData?.type === 'text' || GEType === ItemType.text) {
    type = 'text';
  } else if (componentData?.type === 'shape' || GEType === ItemType.shape) {
    type = 'shape';
  } else if (componentData?.type === 'particle' || GEType === ItemType.particle) {
    type = 'particle';
  } else if (componentData?.type === 'image') {
    type = 'image';
  } else if (GEType === ItemType.composition) {
    type = 'precomp';
  } else if (componentData?.spriteStartColor != null) {
    type = 'solid';
  } else if (GEType === ItemType.sprite) {
    type = 'solid';
  }

  if (type == null) {
    return undefined;
  }
  if (type === 'particle' && componentData?.particle == null) {
    return undefined;
  }
  const layerEndBehavior = type === 'precomp'
    ? undefined
    : mapEndBehaviorToIR(item['endBehavior'] as EndBehavior | undefined);

  const itemTransform = item['transform'] as Record<string, unknown> | undefined;
  const itemAnchor = readItemAnchor(itemTransform);
  const itemEulerHint = readItemEulerHint(itemTransform);
  const itemSize = readItemSize(itemTransform);
  const sizeRatio = type === 'text' && ctx.textScaleIncludesSize === false ? TEXT_WORLD_UNITS_PER_PIXEL : ctx.ratio;
  const textBounds = type === 'text' ? componentData?.textBounds : undefined;
  const localBounds: IRLayer['localBounds'] =
    type === 'text' && ctx.textScaleIncludesSize !== false && textBounds != null
      ? textBounds
      : itemSize != null
      ? {
          x: 0,
          y: 0,
          width: Math.abs(itemSize.x) / sizeRatio,
          height: Math.abs(itemSize.y) / sizeRatio,
        }
      : textBounds ?? (type === 'particle'
        ? { x: 0, y: 0, width: ctx.width, height: ctx.height }
        : undefined);

  if (type === 'particle' && itemSize == null) {
    ctx.diagnostics.push({
      code: 'GE_PARTICLE_BOUNDS_DEFAULTED',
      severity: 'info',
      action: 'approximated',
      path: `$.items[id=${JSON.stringify(itemId)}].transform.size`,
      sourceId: itemId,
      feature: 'localBounds',
      message: 'Particle item has no display size; Composition bounds were used as source-neutral authoring bounds.',
    });
  }
  let transform: IRTransform | undefined;

  if (itemTransform != null) {
    const staticChannels = parseStaticTransform(itemTransform, ctx);

    transform = { ...staticChannels };

    if (type === 'text') {
      if (ctx.textScaleIncludesSize !== false) {
        // GE 3.6 migration derives uniform glyph scale from world width / layout width.
        const sourceScale = itemTransform['scale'];
        const worldWidth = isRecord(sourceScale) && typeof sourceScale['x'] === 'number' ? sourceScale['x'] : 1;
        const scale = worldWidth / (textBounds?.width ?? 1) / ctx.ratio;

        transform.scale = { type: 'static', value: [scale, scale, scale] };
      } else {
        const scale = transform.scale?.type === 'static' ? transform.scale.value : [1, 1, 1];
        const ratio = TEXT_WORLD_UNITS_PER_PIXEL / ctx.ratio;

        const value: [number, number, number] = [scale[0] * ratio, scale[1] * ratio, scale[2] * ratio];

        if (value.every(axis => Math.abs(axis - 1) < 1e-6)) {
          delete transform.scale;
        } else {
          transform.scale = { type: 'static', value };
        }
      }
    }
  }

  // Normalize supported channels and preserve raw GE payloads for unsupported encodings.
  if (timeline?.transformAsset != null) {
    const transformAsset = timeline.transformAsset;
    const rawPositionOverLifetime = transformAsset['positionOverLifetime'] as Record<string, unknown> | undefined;
    const animationChannels = parseTransformAnimation(transformAsset, time.inFrame, time.outFrame, ctx);

    if (transform == null) {
      transform = {};
    }

    if (animationChannels.rotation != null) {
      transform.rotation = animationChannels.rotation;
    }
    // GE position paths are additive contributions on top of the item transform. Keep
    // the item base as normalized Position while the raw path is retained; treating
    // both values as an absolute Position loses that base when generating GE again.
    if (animationChannels.position != null && rawPositionOverLifetime?.['path'] == null) {
      transform.position = animationChannels.position;
    }
    const baseScale: IRVec3 = transform.scale?.type === 'static' ? transform.scale.value : [1, 1, 1];

    if (animationChannels.scale != null) {
      const scale = animationChannels.scale;
      // GE's Transform mixer uses base scale X for its depth channel.
      const multiply = (value: IRVec3): IRVec3 =>
        [value[0] * baseScale[0], value[1] * baseScale[1], value[2] * baseScale[0]];

      transform.scale = scale.type === 'static'
        ? { ...scale, value: multiply(scale.value) }
        : { ...scale, keyframes: scale.keyframes.map(keyframe => ({
            ...keyframe, value: multiply(keyframe.value),
            ...(keyframe.endValue != null && { endValue: multiply(keyframe.endValue) }),
          })) };
    }

    const preservedTransformData: EffectsLayerPreservedData = {};
    const rawRotationOverLifetime = transformAsset['rotationOverLifetime'] as Record<string, unknown> | undefined;
    const rawSizeOverLifetime = transformAsset['sizeOverLifetime'] as Record<string, unknown> | undefined;

    if (rawPositionOverLifetime != null && Object.keys(rawPositionOverLifetime).length > 0) {
      preservedTransformData.positionOverLifetime = rawPositionOverLifetime;
    }
    if (rawRotationOverLifetime != null && Object.keys(rawRotationOverLifetime).length > 0) {
      preservedTransformData.rotationOverLifetime = rawRotationOverLifetime;
    }
    if (rawSizeOverLifetime != null && Object.keys(rawSizeOverLifetime).length > 0) {
      preservedTransformData.sizeOverLifetime = rawSizeOverLifetime;
      preservedTransformData.transformBaseScale = [...baseScale];
    }

    if (Object.keys(preservedTransformData).length > 0) {
      rawTransformPreservedData = preservedTransformData;
    }
  }

  if (itemSize != null && (itemSize.x < 0 || itemSize.y < 0)) {
    const signs = [Math.sign(itemSize.x), Math.sign(itemSize.y), 1];
    const scale = transform?.scale ?? { type: 'static' as const, value: [1, 1, 1] as [number, number, number] };
    const reflect = (value: [number, number, number]): [number, number, number] =>
      [value[0] * signs[0], value[1] * signs[1], value[2]];

    if (rawTransformPreservedData?.transformBaseScale != null) {
      rawTransformPreservedData.transformBaseScale = reflect(rawTransformPreservedData.transformBaseScale);
    }
    transform = {
      ...transform,
      scale: scale.type === 'static'
        ? { ...scale, value: reflect(scale.value) }
        : { ...scale, keyframes: scale.keyframes.map(keyframe => ({
            ...keyframe, value: reflect(keyframe.value),
            ...(keyframe.endValue != null && { endValue: reflect(keyframe.endValue) }),
          })) },
    };
  }

  let rawColorOverLifetime: Record<string, unknown> | undefined;

  if (type !== 'particle' && timeline?.spriteColorAsset != null) {
    const opacity = parseOpacityAnimation(timeline.spriteColorAsset, time.inFrame, time.outFrame);

    if (opacity != null) {
      if (transform == null) {
        transform = {};
      }
      transform.opacity = opacity;
    }

    const rawColor = timeline.spriteColorAsset['colorOverLifetime'] as Record<string, unknown> | undefined;

    if (rawColor != null && Object.keys(rawColor).length > 0) {
      rawColorOverLifetime = rawColor;
    }
  }

  // Renderer anchor metadata preserves the IR anchor relative to normalized local bounds.
  // Item position carries GE's bounds-center compensation for every visual layer, including Text.
  if (type !== 'null' && localBounds != null) {
    const layerWidth = localBounds.width;
    const layerHeight = localBounds.height;
    const anchorScale = componentData?.anchorScale ?? [0.5, 0.5];
    const anchorInfo = deriveAnchorFromScale(anchorScale, localBounds);
    const { anchorX, anchorY } = anchorInfo;
    const [anchorOffsetX, anchorOffsetY] = rotateAnchorOffsetForParentedVisual(
      type,
      typeof item['parentId'] === 'string',
      transform,
      anchorInfo.anchorOffsetX,
      anchorInfo.anchorOffsetY,
    );

    if (transform == null) {
      transform = {};
    }

    transform.anchor = {
      type: 'static',
      value: [anchorX, anchorY, 0],
    };

    // Undo the anchor and static-scale position compensation applied during GE generation.
    const position = transform.position;

    if (position != null && position.type === 'static') {
      const scale =
        transform.scale?.type === 'static' && Array.isArray(transform.scale.value)
          ? transform.scale.value
          : [1, 1, 1];
      const scaleX = scale[0] ?? 1;
      const scaleY = scale[1] ?? 1;
      const anchorDiffX = anchorX - (localBounds.x + layerWidth / 2);
      const anchorDiffY = anchorY - (localBounds.y + layerHeight / 2);
      const anchorOffCenter = Math.abs(anchorDiffX) > 0.5 || Math.abs(anchorDiffY) > 0.5;
      const hasStaticScale = !(scaleX === 1 && scaleY === 1);

      let scaleAdjustX = 0;
      let scaleAdjustY = 0;

      if (hasStaticScale && anchorOffCenter && layerWidth > 0 && layerHeight > 0) {
        scaleAdjustX = anchorDiffX * (1 - scaleX);
        scaleAdjustY = anchorDiffY * (1 - scaleY);
      }

      // Scale compensation is a world-space offset, outside perspective projection.
      const depthScale = (DEFAULT_CAMERA_Z - position.value[2]) / DEFAULT_CAMERA_Z;
      const effectiveDepthScale = Math.abs(depthScale) > 1e-10 ? depthScale : 1;
      const totalX = anchorOffsetX + scaleAdjustX / effectiveDepthScale;
      const totalY = anchorOffsetY + scaleAdjustY / effectiveDepthScale;

      if (Math.abs(totalX) > 1e-6 || Math.abs(totalY) > 1e-6) {
        transform.position = subtractStaticPositionOffset(position, totalX, totalY);
      }
    }
  }

  const text = componentData?.text;
  const solidLayerColor: IRColor | undefined =
    type === 'solid' ? (componentData?.spriteStartColor ?? [1, 1, 1, 1]) : undefined;

  const layer = {
    id: isIRId(itemId) ? itemId : createId(),
    ...(name != null && { name }),
    type,
    time,
    ...(layerEndBehavior != null && { endBehavior: layerEndBehavior }),
    visible,
    transform,
    localBounds,
  } as IRLayer;

  if (type === 'image' && componentData?.imageAssetId != null) {
    (layer as IRImageLayer).content = { assetId: componentData.imageAssetId };
  }
  if (solidLayerColor != null) {
    (layer as IRSolidLayer).content = { color: solidLayerColor };
  }
  if (type === 'text' && text != null) {
    (layer as IRTextLayer).content = text;
  }
  if (type === 'shape') {
    (layer as IRShapeLayer).content = { shapes: componentData?.shapes ?? [] };
  }
  if (type === 'particle' && componentData?.particle != null) {
    (layer as IRParticleLayer).content = componentData.particle;
  }
  if (componentData?.blendMode != null) {
    layer.blendMode = componentData.blendMode;
  }
  const GEComponentId = componentData?.GEComponentId;
  const rawMask = componentData?.rawMask;
  const sourceComponent = GEComponentId == null ? undefined : ctx.componentById.get(GEComponentId);
  const sourceRenderer = sourceComponent?.['renderer'];
  const renderer = isRecord(sourceRenderer) ? normalizeJSONValue(sourceRenderer) : undefined;

  if (renderer != null) {
    delete renderer['anchor'];
    delete renderer['blending'];
    delete renderer['texture'];
  }
  const geometry = sourceComponent?.['geometry'];
  const additionalComponentIds = Array.isArray(item['components']) ? item['components'].flatMap(reference => {
    const id = resolveDataPathId(reference);

    return id != null && id !== GEComponentId && ctx.componentById.has(id) ? [id] : [];
  }) : [];
  const componentTimeline = GEComponentId == null ? undefined : parseComponentTimeline(GEComponentId, ctx);
  const precompContent =
    GEType === ItemType.composition ? (item['content'] as Record<string, unknown> | undefined) : undefined;
  const precompReferenceId = isRecord(precompContent?.['options']) ? precompContent['options']['refId'] : undefined;
  const precompCompositionId = typeof precompReferenceId === 'string'
    ? ctx.compositionIdBySourceId.get(precompReferenceId)
    : undefined;

  if (type === 'precomp' && precompCompositionId == null) {
    return undefined;
  }

  if (type === 'precomp' && precompCompositionId != null) {
    const sourceStartFrame = typeof precompReferenceId === 'string'
      ? ctx.compositionStartFrameBySourceId.get(precompReferenceId)
      : undefined;

    const precompEndBehavior = mapEndBehaviorToIR(item['endBehavior'] as EndBehavior | undefined);

    (layer as Extract<IRLayer, { type: 'precomp' }>).content = {
      compositionId: precompCompositionId,
      clipToBounds: false,
      ...(precompEndBehavior != null && { endBehavior: precompEndBehavior }),
    };
    if (sourceStartFrame != null && sourceStartFrame !== 0) {
      (layer as Extract<IRLayer, { type: 'precomp' }>).time.sourceStartFrame = sourceStartFrame;
    }
  }

  const preservedData: EffectsLayerPreservedData = {
    sourceHierarchy: 'single-item',
    ...(additionalComponentIds.length > 0 && { additionalComponentIds }),
    ...(typeof item['duration'] === 'number' && Number.isFinite(item['duration']) && (
      item['duration'] !== duration || (typeof item['delay'] === 'number' && item['delay'] !== delay)
    ) && { itemTiming: { duration: item['duration'], delay: typeof item['delay'] === 'number' ? item['delay'] : 0 } }),
    ...(renderer != null && { renderer }),
    ...(isRecord(geometry) && { geometry: normalizeJSONValue(geometry) }),
    ...(componentTimeline != null && { componentTimeline }),
    sourceItemIds: [itemId],
    ...(itemAnchor != null && { itemAnchorById: { [itemId]: itemAnchor } }),
    ...(itemEulerHint != null && rawTransformPreservedData?.rotationOverLifetime != null && {
      itemEulerHintById: { [itemId]: itemEulerHint },
    }),
    ...(rawTransformPreservedData ?? {}),
    ...(rawColorOverLifetime != null && { colorOverLifetime: rawColorOverLifetime }),
    ...(type !== 'solid' && componentData?.spriteStartColor != null && {
      spriteStartColor: componentData.spriteStartColor,
    }),
    ...(componentData?.spriteTexture != null && { spriteTexture: componentData.spriteTexture }),
    ...(componentData?.spriteSplits != null && { spriteSplits: componentData.spriteSplits }),
    ...(componentData?.textureSheetAnimation != null && {
      textureSheetAnimation: componentData.textureSheetAnimation,
    }),
    ...(componentData?.textSizeMode != null && componentData.textSizeMode !== 'fixed' && {
      textSizeMode: componentData.textSizeMode,
    }),
    ...(GEComponentId != null && { sourceComponentId: GEComponentId }),
    ...(rawMask != null && { mask: rawMask }),
    ...(precompContent != null && { precompContent: normalizeJSONValue(precompContent) }),
    ...(componentData?.rawParticleContent != null && {
      particleContent: componentData.rawParticleContent,
    }),
    ...(timeline?.activationEndBehavior != null && {
      timelineEndBehavior: timeline.activationEndBehavior,
    }),
  };

  return { layer, preservedData };
}

interface DerivedAnchorInfo {
  anchorX: number;
  anchorY: number;
  anchorOffsetX: number;
  anchorOffsetY: number;
}

export function readItemSize(itemTransform: Record<string, unknown> | undefined): { x: number; y: number } | undefined {
  const size = itemTransform?.['size'];

  if (!isRecord(size)) {
    return undefined;
  }

  const x = size['x'];
  const y = size['y'];

  return typeof x === 'number' && Number.isFinite(x) && x !== 0 && typeof y === 'number' && Number.isFinite(y) && y !== 0
    ? { x, y }
    : undefined;
}

function readItemAnchor(itemTransform: Record<string, unknown> | undefined): [number, number] | undefined {
  const anchor = itemTransform?.['anchor'];

  if (!isRecord(anchor)) {
    return undefined;
  }

  const x = anchor['x'];
  const y = anchor['y'];

  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    return undefined;
  }

  return Math.abs(x) > 1e-6 || Math.abs(y) > 1e-6 ? [x, y] : undefined;
}

function readItemEulerHint(itemTransform: Record<string, unknown> | undefined): [number, number, number] | undefined {
  const eulerHint = itemTransform?.['eulerHint'];

  if (!isRecord(eulerHint)) {
    return undefined;
  }

  const x = eulerHint['x'];
  const y = eulerHint['y'];
  const z = eulerHint['z'];

  if (
    typeof x !== 'number' || !Number.isFinite(x) ||
    typeof y !== 'number' || !Number.isFinite(y) ||
    typeof z !== 'number' || !Number.isFinite(z)
  ) {
    return undefined;
  }

  return Math.abs(x) > 1e-6 || Math.abs(y) > 1e-6 || Math.abs(z) > 1e-6 ? [x, y, z] : undefined;
}

function deriveAnchorFromScale(
  anchorScale: [number, number],
  bounds: NonNullable<IRLayer['localBounds']>,
): DerivedAnchorInfo {
  const { x, y, width, height } = bounds;
  const localAnchorX = anchorScale[0] * width;
  const localAnchorY = anchorScale[1] * height;

  return {
    anchorX: x + localAnchorX,
    anchorY: y + localAnchorY,
    anchorOffsetX: -(localAnchorX - width / 2),
    anchorOffsetY: -(localAnchorY - height / 2),
  };
}

function subtractStaticPositionOffset(
  position: Extract<NonNullable<IRTransform['position']>, { type: 'static' }>,
  offsetX: number,
  offsetY: number,
): Extract<NonNullable<IRTransform['position']>, { type: 'static' }> {
  return {
    type: 'static',
    value: [position.value[0] - offsetX, position.value[1] - offsetY, position.value[2] ?? 0],
  };
}
