import type { IRLayer, IRPrecompLayer, IRShapeLayer, IRVec3 } from '@galacean/animation-ir';
import {
  DataType,
  EndBehavior,
  ItemType,
  RenderLevel,
  RenderMode,
  type TransformData,
} from '@galacean/effects-specification';
import { get2dTo3dRatio, TEXT_WORLD_UNITS_PER_PIXEL } from '../../common/coordinate-mapping';
import { toDataPath } from '../../common/data-path';
import { createId } from '../../common/id';
import { isRecord, normalizeJSONValue } from '../../common/json-normalization';
import { roundNumber } from '../../common/math';
import { appendTimelineTracks } from './append-timeline-tracks';
import { computeLayerTiming } from '../converter/timing';
import { buildColorAnimation, buildTransformAnimation } from '../converter/animation';
import {
  appendComponent, buildShapeOptions, buildShapeRenderStyles,
} from './append-component';
import { copyPreservedMaskToComponent, restoreComponentRenderData } from './component-preservation';
import {
  mapBlendModeToGE, mapEndBehaviorToGE, mapLayerTypeToGETimelineItemType, mapLayerTypeToGEVFXItemType,
} from '../mapping';
import {
  applyScalePositionAdjust,
  computeAnchorInfo,
  computeStaticPosition,
  getLayerLocalBounds,
  getStaticAnchor,
} from '../converter/transform';
import { resolveLayerGenerationStrategy } from './layer-strategy';
import type {
  GeneratedComponentData,
  GeneratedVFXItemData,
  LayerGenerationContext,
  TransformAnimation,
} from '../types';

function buildGETransform(
  position: [number, number, number],
  eulerHint: [number, number, number],
  scale: [number, number, number],
): TransformData {
  return {
    position: { x: position[0], y: position[1], z: position[2] },
    eulerHint: { x: eulerHint[0], y: eulerHint[1], z: eulerHint[2] },
    scale: { x: scale[0], y: scale[1], z: scale[2] },
  };
}

function resolveTransformBaseScale(layer: IRLayer, ctx: LayerGenerationContext, fallback: IRVec3): IRVec3 {
  const layerData = ctx.layerDataById[layer.id];
  const base = layerData?.sizeOverLifetime != null ? layerData.transformBaseScale : undefined;

  return base == null ? fallback : [base[0] * fallback[0], base[1] * fallback[1], base[2] * fallback[2]];
}

function resolveLayerEndBehavior(layer: IRLayer): EndBehavior {
  return layer.endBehavior == null ? EndBehavior.destroy : mapEndBehaviorToGE(layer.endBehavior);
}

function resolveTimelineEndBehavior(
  layer: IRLayer,
  ctx: LayerGenerationContext,
  itemEndBehavior: EndBehavior,
): EndBehavior {
  return ctx.layerDataById[layer.id]?.timelineEndBehavior ?? itemEndBehavior;
}

function createItemId(layer: IRLayer, ctx: LayerGenerationContext, sourceIndex = -1): string {
  const sourceItemIds = ctx.layerDataById[layer.id]?.sourceItemIds ?? [];
  const resolvedIndex = sourceIndex < 0 ? sourceItemIds.length + sourceIndex : sourceIndex;
  const sourceItemId = sourceItemIds[resolvedIndex];

  if (sourceItemId != null && !ctx.collector.items.some(item => item.id === sourceItemId)) {
    return sourceItemId;
  }

  return createId();
}

function resolvePreservedItemAnchor(
  layer: IRLayer,
  itemId: string,
  ctx: LayerGenerationContext,
): { x: number; y: number } | undefined {
  const anchor = ctx.layerDataById[layer.id]?.itemAnchorById?.[itemId];

  return anchor == null ? undefined : { x: anchor[0], y: anchor[1] };
}

function resolvePreservedItemEulerHint(
  layer: IRLayer,
  itemId: string,
  ctx: LayerGenerationContext,
): [number, number, number] {
  return ctx.layerDataById[layer.id]?.itemEulerHintById?.[itemId] ?? [0, 0, 0];
}

export function appendNullLayer(layer: IRLayer, ctx: LayerGenerationContext): void {
  const itemId = createItemId(layer, ctx);
  const layerId = layer.id;
  const itemAnchor = resolvePreservedItemAnchor(layer, itemId, ctx);

  ctx.layerToItemId[layerId] = itemId;
  ctx.layerToMaskParentItemId[layerId] = itemId;
  ctx.layerToMaskCoordinateOrigin[layerId] = getStaticAnchor(layer);

  const { delay, layerDuration } = computeLayerTiming(layer, ctx.frameRate, ctx.ir.inPoint);
  const animation = buildTransformAnimation(layer, ctx);
  const position = computeStaticPosition(layer, ctx);
  const endBehavior = layer.endBehavior == null ? EndBehavior.freeze : mapEndBehaviorToGE(layer.endBehavior);

  const objectBindingTrackId = appendTimelineTracks(
    ctx.collector,
    delay,
    layerDuration,
    resolveTimelineEndBehavior(layer, ctx, endBehavior),
    animation,
    ItemType.null,
  );

  const item: GeneratedVFXItemData = {
    id: itemId,
    dataType: DataType.VFXItemData,
    name: layer.name ?? layer.id,
    duration: layerDuration,
    type: ItemType.null,
    visible: layer.visible,
    endBehavior,
    delay,
    renderLevel: RenderLevel.BPlus,
    content: { options: { startColor: [1, 1, 1, 1] } },
    components: [],
    transform: {
      ...buildGETransform(
        position, resolvePreservedItemEulerHint(layer, itemId, ctx), resolveTransformBaseScale(layer, ctx, [1, 1, 1]),
      ),
      ...(itemAnchor != null && { anchor: itemAnchor }),
    },
  };

  ctx.collector.items.push(item);
  ctx.itemBindings.push({ itemId, objectBindingTrackId, layerId });
}

export function appendPrecompLayer(layer: IRPrecompLayer, ctx: LayerGenerationContext): void {
  const isTransformParent = ctx.parentLayerIdSet.has(layer.id) &&
    ctx.layerDataById[layer.id]?.sourceHierarchy !== 'single-item';
  const itemId = isTransformParent ? createId() : createItemId(layer, ctx);
  const layerId = layer.id;

  ctx.layerToItemId[layerId] = itemId;
  ctx.layerToMaskParentItemId[layerId] = itemId;

  const { delay, layerDuration } = computeLayerTiming(layer, ctx.frameRate, ctx.ir.inPoint);
  const animation = buildTransformAnimation(layer, ctx);
  const referencedComposition = ctx.compositionById.get(layer.content.compositionId);
  const referencedRatio = referencedComposition == null
    ? ctx.ratio
    : get2dTo3dRatio(referencedComposition.width, referencedComposition.height);
  const fallbackBounds = referencedComposition == null
    ? undefined
    : { x: 0, y: 0, width: referencedComposition.width, height: referencedComposition.height };
  const bounds = getLayerLocalBounds(layer, fallbackBounds);
  const hasAnchor = layer.transform?.anchor != null;
  const anchor = getStaticAnchor(layer);
  const localAnchorX = hasAnchor ? referencedRatio * (anchor[0] - (bounds.x + bounds.width / 2)) : 0;
  const localAnchorY = hasAnchor ? -referencedRatio * (anchor[1] - (bounds.y + bounds.height / 2)) : 0;
  const position = computeStaticPosition(layer, ctx);
  // Referenced Composition children already use canvas-centered coordinates. Only
  // compensate an Anchor that is explicitly present in the source-neutral model;
  // an absent channel must not synthesize a corner Anchor for GE-origin Precomps.
  const precompPosition: [number, number, number] = [
    position[0] - localAnchorX,
    position[1] - localAnchorY,
    position[2],
  ];
  const intrinsicScale = ctx.layerDataById[layer.id]?.precompContent != null ? 1 : ctx.ratio / referencedRatio;
  const sourceStartFrame = layer.time.sourceStartFrame ?? referencedComposition?.inPoint ?? 0;
  const referencedInPoint = referencedComposition?.inPoint ?? 0;
  const referencedFrameRate = referencedComposition?.frameRate ?? ctx.frameRate;
  const precompTimeOffset = (sourceStartFrame - referencedInPoint) / referencedFrameRate;
  const endBehavior = mapEndBehaviorToGE(
    layer.content.endBehavior ?? referencedComposition?.endBehavior ?? ctx.ir.endBehavior,
  );
  const layerData = ctx.layerDataById[layer.id];
  const outputCompositionId = ctx.precompOutputIdByLayerId.get(layer.id) ?? layer.content.compositionId;
  const content = buildPrecompContent(layerData?.precompContent, outputCompositionId);

  ctx.layerToMaskCoordinateOrigin[layerId] = [
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  ];

  if (isTransformParent) {
    appendParentPrecompItems({
      layer,
      ctx,
      itemId,
      layerId,
      delay,
      layerDuration,
      animation,
      position,
      localAnchorX,
      localAnchorY,
      intrinsicScale,
      precompTimeOffset,
      endBehavior,
      content,
    });

    return;
  }

  const scale = layer.transform?.scale;

  if (animation.sizeOverLifetime != null && layerData?.sizeOverLifetime == null && scale != null) {
    // GE TransformPlayable uses initial scale.x for Z, including the canvas conversion factor.
    const compensateDepth = (value: IRVec3): IRVec3 => [value[0], value[1], value[2] / intrinsicScale];
    const compensatedScale = scale.type === 'static'
      ? { ...scale, value: compensateDepth(scale.value) }
      : {
        ...scale,
        keyframes: scale.keyframes.map(keyframe => ({
          ...keyframe,
          value: compensateDepth(keyframe.value),
          ...(keyframe.endValue != null && { endValue: compensateDepth(keyframe.endValue) }),
        })),
      };

    animation.sizeOverLifetime = buildTransformAnimation({
      ...layer, transform: { ...layer.transform, scale: compensatedScale },
    }, ctx).sizeOverLifetime;
  }

  const objectBindingTrackId = appendTimelineTracks(
    ctx.collector,
    delay,
    layerDuration,
    endBehavior,
    animation,
    ItemType.composition,
    precompTimeOffset,
  );

  const item: GeneratedVFXItemData = {
    id: itemId,
    dataType: DataType.VFXItemData,
    name: layer.name ?? layer.id,
    duration: layerDuration,
    type: ItemType.composition,
    visible: layer.visible,
    endBehavior,
    delay,
    renderLevel: RenderLevel.BPlus,
    content,
    components: [],
    transform: {
      ...buildGETransform(
        precompPosition,
        resolvePreservedItemEulerHint(layer, itemId, ctx),
        resolveTransformBaseScale(layer, ctx, [intrinsicScale, intrinsicScale, 1]),
      ),
      anchor: resolvePreservedItemAnchor(layer, itemId, ctx) ?? { x: localAnchorX, y: localAnchorY },
    },
  };

  ctx.collector.items.push(item);
  ctx.itemBindings.push({ itemId, objectBindingTrackId, layerId });
}

interface ParentPrecompItemsOptions {
  layer: IRPrecompLayer;
  ctx: LayerGenerationContext;
  itemId: string;
  layerId: string;
  delay: number;
  layerDuration: number;
  animation: TransformAnimation;
  position: [number, number, number];
  localAnchorX: number;
  localAnchorY: number;
  intrinsicScale: number;
  precompTimeOffset: number;
  endBehavior: EndBehavior;
  content: Record<string, unknown>;
}

/**
 * Keep a Precomp's layer transform separate from its internal canvas scale.
 * External Lottie children inherit the former, while referenced Composition
 * content inherits both nodes. The wrapper stays at the authored Position;
 * both content and external children are offset from the authored Anchor.
 */
function appendParentPrecompItems(options: ParentPrecompItemsOptions): void {
  const {
    layer, ctx, itemId, layerId, delay,
    layerDuration, animation, position, localAnchorX, localAnchorY,
    intrinsicScale, precompTimeOffset, endBehavior, content,
  } = options;
  const layerTrackId = appendTimelineTracks(
    ctx.collector,
    delay,
    layerDuration,
    endBehavior,
    animation,
    ItemType.null,
  );
  const layerItem: GeneratedVFXItemData = {
    id: itemId,
    dataType: DataType.VFXItemData,
    name: layer.name ?? layer.id,
    duration: layerDuration,
    type: ItemType.null,
    visible: layer.visible,
    endBehavior,
    delay,
    renderLevel: RenderLevel.BPlus,
    content: { options: { startColor: [1, 1, 1, 1] } },
    components: [],
    transform: {
      ...buildGETransform(
        position, resolvePreservedItemEulerHint(layer, itemId, ctx), resolveTransformBaseScale(layer, ctx, [1, 1, 1]),
      ),
      anchor: resolvePreservedItemAnchor(layer, itemId, ctx) ?? { x: 0, y: 0 },
    },
  };

  const compositionItemId = createItemId(layer, ctx);

  ctx.layerToMaskParentItemId[layerId] = compositionItemId;
  const compositionTrackId = appendTimelineTracks(
    ctx.collector,
    delay,
    layerDuration,
    endBehavior,
    {},
    ItemType.composition,
    precompTimeOffset,
  );
  const compositionItem: GeneratedVFXItemData = {
    id: compositionItemId,
    dataType: DataType.VFXItemData,
    name: `${layer.name ?? layer.id} content`,
    duration: layerDuration,
    type: ItemType.composition,
    visible: true,
    endBehavior,
    delay,
    renderLevel: RenderLevel.BPlus,
    content,
    components: [],
    transform: {
      ...buildGETransform(
        [-intrinsicScale * localAnchorX, -intrinsicScale * localAnchorY, 0],
        resolvePreservedItemEulerHint(layer, compositionItemId, ctx),
        [intrinsicScale, intrinsicScale, 1],
      ),
      anchor: resolvePreservedItemAnchor(layer, compositionItemId, ctx) ?? { x: 0, y: 0 },
    },
    parentId: itemId,
  };

  ctx.collector.items.push(layerItem, compositionItem);
  ctx.itemBindings.push(
    { itemId, objectBindingTrackId: layerTrackId, layerId },
    { itemId: compositionItemId, objectBindingTrackId: compositionTrackId },
  );
}

function buildPrecompContent(
  rawContent: Record<string, unknown> | undefined,
  refId: string | undefined,
): Record<string, unknown> {
  const content = rawContent != null ? normalizeJSONValue(rawContent) : {};
  const rawOptions = content['options'];
  const options = isRecord(rawOptions) ? { ...rawOptions } : {};

  if (refId != null) {
    options['refId'] = refId;
  }

  content['options'] = options;

  return content;
}

/**
 * Append a null/visual pair. The null owns the layer transform; the child owns
 * anchor-offset visual content.
 */
function appendNullVisualPair(layer: IRLayer, ctx: LayerGenerationContext): void {
  const layerId = layer.id;
  const { delay, layerDuration } = computeLayerTiming(layer, ctx.frameRate, ctx.ir.inPoint);
  const bounds = getLayerLocalBounds(layer);
  const { x, y, width: layerWidth, height: layerHeight } = bounds;

  const nullItemId = createItemId(layer, ctx, 0);
  const nullItemAnchor = resolvePreservedItemAnchor(layer, nullItemId, ctx);

  ctx.layerToItemId[layerId] = nullItemId;

  const nullAnimation = buildTransformAnimation(layer, ctx);
  const nullPosition = computeStaticPosition(layer, ctx);

  const nullTrackId = appendTimelineTracks(
    ctx.collector,
    delay,
    layerDuration,
    EndBehavior.freeze,
    nullAnimation,
    ItemType.null,
  );

  const nullItem: GeneratedVFXItemData = {
    id: nullItemId,
    dataType: DataType.VFXItemData,
    name: layer.name ?? layer.id,
    duration: layerDuration,
    type: ItemType.null,
    visible: true,
    endBehavior: EndBehavior.freeze,
    delay,
    renderLevel: RenderLevel.BPlus,
    content: { options: { startColor: [1, 1, 1, 1] } },
    components: [],
    transform: {
      ...buildGETransform(
        nullPosition, resolvePreservedItemEulerHint(layer, nullItemId, ctx),
        resolveTransformBaseScale(layer, ctx, [1, 1, 1]),
      ),
      ...(nullItemAnchor != null && { anchor: nullItemAnchor }),
    },
  };

  ctx.collector.items.push(nullItem);
  ctx.itemBindings.push({ itemId: nullItemId, objectBindingTrackId: nullTrackId, layerId });

  const childItemId = createItemId(layer, ctx);

  const anchor = getStaticAnchor(layer);
  const centerX = x + layerWidth / 2;
  const centerY = y + layerHeight / 2;
  const childPosition: [number, number, number] = [
    -ctx.ratio * (anchor[0] - centerX),
    ctx.ratio * (anchor[1] - centerY),
    0,
  ];

  ctx.layerToMaskCoordinateOrigin[layerId] = anchor;

  const childColorAnimation = buildColorAnimation(layer, ctx, ctx.inheritedOpacity);
  const itemEndBehavior = resolveLayerEndBehavior(layer);
  const timelineEndBehavior = resolveTimelineEndBehavior(layer, ctx, itemEndBehavior);
  const childTrackId = appendTimelineTracks(
    ctx.collector,
    delay,
    layerDuration,
    timelineEndBehavior,
    { colorOverLifetime: childColorAnimation },
    mapLayerTypeToGETimelineItemType(layer.type),
  );

  const componentId = appendComponent(layer, childItemId, 0.5, 0.5, ctx);

  if (componentId != null) {
    ctx.layerToComponentId[layerId] = componentId;
  }

  const sizeRatio = layer.type === 'text' ? TEXT_WORLD_UNITS_PER_PIXEL : ctx.ratio;
  // Preserve the visual child's world-width precision when separating size from scale.
  const textScale = layerWidth > 0
    ? roundNumber(ctx.ratio * layerWidth, 4) / (layerWidth * TEXT_WORLD_UNITS_PER_PIXEL)
    : ctx.ratio / TEXT_WORLD_UNITS_PER_PIXEL;
  const childScale: [number, number, number] = layer.type === 'text' ? [textScale, textScale, textScale] : [1, 1, 1];

  const childItem: GeneratedVFXItemData = {
    id: childItemId,
    dataType: DataType.VFXItemData,
    name: layer.name ?? layer.id,
    duration: layerDuration,
    type: mapLayerTypeToGEVFXItemType(layer.type),
    visible: layer.visible,
    endBehavior: itemEndBehavior,
    delay,
    renderLevel: RenderLevel.BPlus,
    components: componentId != null ? [toDataPath(componentId)] : [],
    transform: {
      ...buildGETransform(childPosition, resolvePreservedItemEulerHint(layer, childItemId, ctx), childScale),
      anchor: resolvePreservedItemAnchor(layer, childItemId, ctx) ?? { x: 0, y: 0 },
      ...(layer.type !== 'text' || ctx.layerDataById[layer.id]?.textSizeMode !== 'auto-width'
        ? { size: { x: roundNumber(sizeRatio * layerWidth, 4), y: roundNumber(sizeRatio * layerHeight, 4) } }
        : {}),
    },
    parentId: nullItemId,
  };

  ctx.collector.items.push(childItem);
  ctx.itemBindings.push({ itemId: childItemId, objectBindingTrackId: childTrackId, layerId });
}

export function appendParentLayer(layer: IRLayer, ctx: LayerGenerationContext): void {
  appendNullVisualPair(layer, ctx);
}

export function appendVisualLayer(layer: IRLayer, ctx: LayerGenerationContext): void {
  const strategy = resolveLayerGenerationStrategy(layer, ctx.layerDataById[layer.id]);

  if (strategy.kind === 'split-null-visual') {
    appendNullVisualPair(layer, ctx);

    return;
  }

  if (layer.type === 'shape' && (layer.content?.shapes.length ?? 0) > 0) {
    appendShapeLayerItems(layer, ctx);

    return;
  }

  const itemId = createItemId(layer, ctx);
  const layerId = layer.id;

  ctx.layerToItemId[layerId] = itemId;

  const { delay, layerDuration } = computeLayerTiming(layer, ctx.frameRate, ctx.ir.inPoint);
  const bounds = getLayerLocalBounds(layer);
  const { width: layerWidth, height: layerHeight } = bounds;
  const sizeRatio = layer.type === 'text' ? TEXT_WORLD_UNITS_PER_PIXEL : ctx.ratio;

  const [anchorScaleX, anchorScaleY] = strategy.anchorScale;
  const [anchorOffsetX, anchorOffsetY] = strategy.anchorOffset;
  const animation = buildTransformAnimation(layer, ctx);
  const colorAnimation = buildColorAnimation(layer, ctx, ctx.inheritedOpacity);
  const fullAnimation: TransformAnimation = {
    ...animation,
    colorOverLifetime: colorAnimation,
  };

  const rawPosition = computeStaticPosition(layer, ctx, anchorOffsetX, anchorOffsetY);
  // Particle bounds describe the effect region; scaling the emitter must not translate it like a sprite rectangle.
  const position = layer.type === 'particle' ? rawPosition : applyScalePositionAdjust(rawPosition, layer, bounds, ctx.ratio);

  const timelineItemType = mapLayerTypeToGETimelineItemType(layer.type);
  const itemEndBehavior = resolveLayerEndBehavior(layer);
  const timelineEndBehavior = resolveTimelineEndBehavior(layer, ctx, itemEndBehavior);
  const objectBindingTrackId = appendTimelineTracks(
    ctx.collector,
    delay,
    layerDuration,
    timelineEndBehavior,
    fullAnimation,
    timelineItemType,
  );

  const componentId = appendComponent(layer, itemId, anchorScaleX, anchorScaleY, ctx);

  ctx.layerToMaskCoordinateOrigin[layerId] = [
    bounds.x + layerWidth / 2,
    bounds.y + layerHeight / 2,
  ];

  if (componentId != null) {
    ctx.layerToComponentId[layerId] = componentId;
  }

  const textScale = ctx.ratio / TEXT_WORLD_UNITS_PER_PIXEL;
  const itemScale: [number, number, number] = layer.type === 'text' ? [textScale, textScale, textScale] : [1, 1, 1];

  const item: GeneratedVFXItemData = {
    id: itemId,
    dataType: DataType.VFXItemData,
    name: layer.name ?? layer.id,
    duration: layerDuration,
    type: mapLayerTypeToGEVFXItemType(layer.type),
    visible: layer.visible,
    endBehavior: itemEndBehavior,
    delay,
    renderLevel: RenderLevel.BPlus,
    components: componentId != null ? [toDataPath(componentId)] : [],
    transform: {
      ...buildGETransform(
        position, resolvePreservedItemEulerHint(layer, itemId, ctx), resolveTransformBaseScale(layer, ctx, itemScale),
      ),
      anchor: resolvePreservedItemAnchor(layer, itemId, ctx) ?? { x: 0, y: 0 },
      ...(layer.type !== 'text' || ctx.layerDataById[layer.id]?.textSizeMode !== 'auto-width'
        ? { size: { x: roundNumber(sizeRatio * layerWidth, 4), y: roundNumber(sizeRatio * layerHeight, 4) } }
        : {}),
    },
  };

  ctx.collector.items.push(item);
  ctx.itemBindings.push({ itemId, objectBindingTrackId, layerId });
}

function appendShapeLayerItems(layer: IRShapeLayer, ctx: LayerGenerationContext): void {
  const layerId = layer.id;
  const { delay, layerDuration } = computeLayerTiming(layer, ctx.frameRate, ctx.ir.inPoint);
  // Shape items may omit transform.size. Empty bounds avoid the half-pixel
  // anchor offset introduced by the generic 1×1 fallback.
  const bounds = getLayerLocalBounds(layer, { x: 0, y: 0, width: 0, height: 0 });
  const anchor = getStaticAnchor(layer);
  const { anchorOffsetX, anchorOffsetY } = computeAnchorInfo(layer, bounds);
  const animation = buildTransformAnimation(layer, ctx);
  const colorAnimation = buildColorAnimation(layer, ctx, ctx.inheritedOpacity);
  const fullAnimation: TransformAnimation = { ...animation, colorOverLifetime: colorAnimation };
  const basePosition = computeStaticPosition(layer, ctx, anchorOffsetX, anchorOffsetY);
  const blending = mapBlendModeToGE(layer.blendMode);
  const itemEndBehavior = resolveLayerEndBehavior(layer);
  const timelineEndBehavior = resolveTimelineEndBehavior(layer, ctx, itemEndBehavior);
  let renderIndex = 0;

  ctx.layerToMaskCoordinateOrigin[layerId] = anchor;

  // Composition assembly reverses generated Items once. Generate the Shape-local
  // stack top-first so the final GE Item order remains IR bottom-first.
  for (let shapeIndex = layer.content.shapes.length - 1; shapeIndex >= 0; shapeIndex -= 1) {
    const shapeData = layer.content.shapes[shapeIndex];
    const renderStyles = buildShapeRenderStyles(shapeData);

    for (let styleIndex = renderStyles.length - 1; styleIndex >= 0; styleIndex -= 1) {
      const renderStyle = renderStyles[styleIndex];
      const currentRenderIndex = renderIndex;
      const shapeItemId = createItemId(layer, ctx, currentRenderIndex);

      renderIndex += 1;
      if (currentRenderIndex === 0) {
        ctx.layerToItemId[layerId] = shapeItemId;
      }

      const shapeOffsetX = ctx.ratio * (shapeData.position[0] - anchor[0]);
      const shapeOffsetY = -ctx.ratio * (shapeData.position[1] - anchor[1]);
      const shapePosition: [number, number, number] = [
        basePosition[0] + shapeOffsetX,
        basePosition[1] + shapeOffsetY,
        basePosition[2],
      ];

      const sourceComponentId = currentRenderIndex === 0
        ? ctx.layerDataById[layer.id]?.sourceComponentId
        : undefined;
      const shapeComponentId = sourceComponentId != null &&
        !ctx.collector.components.some(component => component.id === sourceComponentId)
        ? sourceComponentId
        : createId();

      const component: GeneratedComponentData = {
        id: shapeComponentId,
        dataType: DataType.ShapeComponent,
        item: toDataPath(shapeItemId),
        ...buildShapeOptions(shapeData, ctx.ratio, ctx, renderStyle),
        renderer: {
          renderMode: RenderMode.MESH,
          ...(blending !== undefined && { blending }),
        },
      };

      // Attach a preserved source mask to the first generated shape component.
      if (currentRenderIndex === 0) {
        copyPreservedMaskToComponent(layer, component, ctx);
        restoreComponentRenderData(layer, component, ctx);
      }

      ctx.collector.components.push(component);
      if (currentRenderIndex === 0) {
        ctx.layerToComponentId[layerId] = shapeComponentId;
      }

      const objectBindingTrackId = appendTimelineTracks(
        ctx.collector,
        delay,
        layerDuration,
        timelineEndBehavior,
        fullAnimation,
        ItemType.shape,
      );

      const shapeItem: GeneratedVFXItemData = {
        id: shapeItemId,
        dataType: DataType.VFXItemData,
        name: currentRenderIndex === 0
          ? (layer.name ?? layer.id)
          : `${layer.name ?? layer.id}_shape_${currentRenderIndex}`,
        duration: layerDuration,
        type: ItemType.shape,
        visible: layer.visible,
        endBehavior: itemEndBehavior,
        delay,
        renderLevel: RenderLevel.BPlus,
        components: [toDataPath(shapeComponentId)],
        transform: {
          ...buildGETransform(
            shapePosition,
            resolvePreservedItemEulerHint(layer, shapeItemId, ctx),
            resolveTransformBaseScale(layer, ctx, [1, 1, 1]),
          ),
          anchor: resolvePreservedItemAnchor(layer, shapeItemId, ctx) ?? { x: 0, y: 0 },
        },
      };

      ctx.collector.items.push(shapeItem);
      ctx.itemBindings.push({ itemId: shapeItemId, objectBindingTrackId, layerId });
    }
  }
}
