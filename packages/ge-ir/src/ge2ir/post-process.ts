// Restore cross-item layer structures after individual GE items are parsed.
import type { IRLayer } from '@galacean/animation-ir';
import { DataType, EndBehavior, ItemType } from '@galacean/effects-specification';
import type { GESceneContext } from './types';
import type { EffectsLayerPreservedData } from '../preserved-data';
import { DEFAULT_CAMERA_Z, TEXT_WORLD_UNITS_PER_PIXEL } from '../common/coordinate-mapping';
import { resolveDataPathId } from '../common/data-path';
import { isRecord } from '../common/json-normalization';
import { readItemSize } from './parser/parse-item-layer';
import { parseTimeline } from './parser/timeline';

export interface RawLayerDescriptor {
  itemId: string;
  item: Record<string, unknown>;
  layer: IRLayer;
  preservedData: EffectsLayerPreservedData;
}

export function mergeNullVisualPairs(descriptors: RawLayerDescriptor[], ctx: GESceneContext): RawLayerDescriptor[] {
  const childByParentId = new Map<string, RawLayerDescriptor[]>();

  for (const descriptor of descriptors) {
    const parentId = descriptor.item['parentId'] as string | undefined;

    if (parentId != null) {
      if (!childByParentId.has(parentId)) {
        childByParentId.set(parentId, []);
      }
      childByParentId.get(parentId)!.push(descriptor);
    }
  }

  const mergedChildIds = new Set<string>();
  const mergedDescriptorByParentId = new Map<string, RawLayerDescriptor>();

  for (const descriptor of descriptors) {
    const isNullItem = (descriptor.item['type'] as ItemType) === ItemType.null;

    if (!isNullItem) {
      continue;
    }

    const children = childByParentId.get(descriptor.itemId);

    if (children == null || children.length === 0) {
      continue;
    }

    if (!hasNoComponents(descriptor.item) || !hasParentTransformSignal(descriptor, ctx)) {
      continue;
    }

    const pivotChildren = children.filter(child => {
      const childType = child.item['type'] as ItemType;
      const isVisual =
        childType === ItemType.sprite ||
        childType === ItemType.text ||
        childType === ItemType.shape ||
        childType === ItemType.particle;
      const sameName = (child.item['name'] as string) === (descriptor.item['name'] as string);
      const childTransform = isRecord(child.item['transform']) ? child.item['transform'] : undefined;

      return (
        isVisual &&
        sameName &&
        readItemSize(childTransform) != null &&
        hasVisualComponent(child, ctx) &&
        hasSplitPairTiming(descriptor, child, ctx) &&
        hasNoIndependentChildTransform(child, ctx)
      );
    });

    // Generated pivot children always have a positive display size. Authored Shape
    // hierarchies may use a zero-size same-name child and must remain separate.
    if (pivotChildren.length !== 1) {
      continue;
    }

    const sameNameChild = pivotChildren[0];

    mergedChildIds.add(sameNameChild.itemId);
    mergedDescriptorByParentId.set(descriptor.itemId, mergeNullAndVisual(descriptor, sameNameChild, ctx));
  }

  const result: RawLayerDescriptor[] = [];

  for (const descriptor of descriptors) {
    if (mergedChildIds.has(descriptor.itemId)) {
      continue;
    }

    const merged = mergedDescriptorByParentId.get(descriptor.itemId);

    if (merged != null) {
      result.push(merged);
    } else {
      result.push(descriptor);
    }
  }

  return result;
}

function hasNoComponents(item: Record<string, unknown>): boolean {
  const components = item['components'];

  return !Array.isArray(components) || components.length === 0;
}

function hasVisualComponent(descriptor: RawLayerDescriptor, ctx: GESceneContext): boolean {
  const components = descriptor.item['components'];

  if (!Array.isArray(components) || components.length === 0) {
    return false;
  }

  return components.some(componentReference => {
    const componentId = resolveDataPathId(componentReference);
    const component = componentId != null ? ctx.componentById.get(componentId) : undefined;
    const dataType = component?.['dataType'];

    return (
      dataType === DataType.SpriteComponent ||
      dataType === DataType.TextComponent ||
      dataType === DataType.ShapeComponent ||
      dataType === DataType.ParticleSystem
    );
  });
}

function hasSplitPairTiming(parent: RawLayerDescriptor, child: RawLayerDescriptor, ctx: GESceneContext): boolean {
  const parentTimeline = parseTimeline(parent.itemId, ctx);
  const childTimeline = parseTimeline(child.itemId, ctx);
  const parentEndBehavior = parentTimeline?.activationEndBehavior ?? readItemEndBehavior(parent.item);
  const childEndBehavior = childTimeline?.activationEndBehavior ?? readItemEndBehavior(child.item);

  if (parentEndBehavior !== EndBehavior.freeze || !isSupportedEndBehavior(childEndBehavior)) {
    return false;
  }

  if (parentTimeline == null || childTimeline == null) {
    return true;
  }

  return (
    nearlyEqual(parentTimeline.delay ?? Number(parent.item['delay'] ?? 0),
      childTimeline.delay ?? Number(child.item['delay'] ?? 0)) &&
    nearlyEqual(parentTimeline.duration ?? Number(parent.item['duration'] ?? 0),
      childTimeline.duration ?? Number(child.item['duration'] ?? 0))
  );
}

function hasParentTransformSignal(descriptor: RawLayerDescriptor, ctx: GESceneContext): boolean {
  const timeline = parseTimeline(descriptor.itemId, ctx);

  if (hasTransformPayload(timeline?.transformAsset)) {
    return true;
  }

  const transform = descriptor.item['transform'];

  return isRecord(transform) && (hasNonDefaultScale(transform) || hasNonDefaultEulerHint(transform));
}

function hasNoIndependentChildTransform(descriptor: RawLayerDescriptor, ctx: GESceneContext): boolean {
  const timeline = parseTimeline(descriptor.itemId, ctx);

  return timeline?.transformAsset != null && !hasTransformPayload(timeline.transformAsset);
}

function hasTransformPayload(asset: Record<string, unknown> | undefined): boolean {
  if (asset == null) {
    return false;
  }

  return (
    hasNonEmptyRecord(asset['positionOverLifetime']) ||
    hasNonEmptyRecord(asset['rotationOverLifetime']) ||
    hasNonEmptyRecord(asset['sizeOverLifetime'])
  );
}

function hasNonDefaultScale(transform: Record<string, unknown>): boolean {
  const scale = transform['scale'];

  if (!isRecord(scale)) {
    return false;
  }

  const x = typeof scale['x'] === 'number' ? scale['x'] : 1;
  const y = typeof scale['y'] === 'number' ? scale['y'] : 1;
  const z = typeof scale['z'] === 'number' ? scale['z'] : 1;

  return Math.abs(x - 1) > 1e-6 || Math.abs(y - 1) > 1e-6 || Math.abs(z - 1) > 1e-6;
}

function hasNonDefaultEulerHint(transform: Record<string, unknown>): boolean {
  const eulerHint = transform['eulerHint'];

  if (!isRecord(eulerHint)) {
    return false;
  }

  const x = typeof eulerHint['x'] === 'number' ? eulerHint['x'] : 0;
  const y = typeof eulerHint['y'] === 'number' ? eulerHint['y'] : 0;
  const z = typeof eulerHint['z'] === 'number' ? eulerHint['z'] : 0;

  return Math.abs(x) > 1e-6 || Math.abs(y) > 1e-6 || Math.abs(z) > 1e-6;
}

function hasNonEmptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0;
}

function readItemEndBehavior(item: Record<string, unknown>): EndBehavior | undefined {
  const endBehavior = item['endBehavior'];

  return isSupportedEndBehavior(endBehavior) ? endBehavior : undefined;
}

function isSupportedEndBehavior(endBehavior: unknown): endBehavior is EndBehavior {
  return endBehavior === EndBehavior.destroy ||
    endBehavior === EndBehavior.forward ||
    endBehavior === EndBehavior.freeze ||
    endBehavior === EndBehavior.restart;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

function mergeNullAndVisual(
  nullDescriptor: RawLayerDescriptor,
  childDescriptor: RawLayerDescriptor,
  ctx: GESceneContext,
): RawLayerDescriptor {
  const childLayer = childDescriptor.layer;
  const merged = {
    ...nullDescriptor.layer,
    type: childLayer.type,
    ...(childLayer.type === 'image' && { content: childLayer.content }),
    ...(childLayer.type === 'solid' && { content: childLayer.content }),
    ...(childLayer.type === 'text' && { content: childLayer.content }),
    ...(childLayer.type === 'shape' && { content: childLayer.content }),
    ...(childLayer.type === 'precomp' && { content: childLayer.content }),
    ...(childLayer.type === 'particle' && { content: childLayer.content }),
  } as IRLayer;

  if (childLayer.type === 'image' || childLayer.type === 'solid' || childLayer.type === 'particle') {
    // Display bounds belong to the visual child, never to its pivot Null parent.
    merged.localBounds = childLayer.localBounds;
  }
  merged.blendMode = childDescriptor.layer.blendMode;

  merged.visible = childDescriptor.layer.visible;
  if (childLayer.endBehavior == null) {
    delete merged.endBehavior;
  } else {
    merged.endBehavior = childLayer.endBehavior;
  }

  const childTransform = isRecord(childDescriptor.item['transform'])
    ? childDescriptor.item['transform']
    : undefined;
  const childPosition = childTransform?.['position'] as { x: number; y: number; z: number } | undefined;
  const childSize = readItemSize(childTransform);

  if (childPosition != null && childSize != null) {
    const sizeRatio = childLayer.type === 'text' && ctx.textScaleIncludesSize === false
      ? TEXT_WORLD_UNITS_PER_PIXEL
      : ctx.ratio;
    const layerWidth = childSize.x / sizeRatio;
    const layerHeight = childSize.y / sizeRatio;

    const anchorX = -childPosition.x / ctx.ratio + layerWidth / 2;
    const anchorY = childPosition.y / ctx.ratio + layerHeight / 2;

    if (merged.transform == null) {
      merged.transform = {};
    }

    merged.transform.anchor = { type: 'static', value: [anchorX, anchorY, 0] };
    merged.localBounds = { x: 0, y: 0, width: layerWidth, height: layerHeight };
  }

  if (childDescriptor.layer.transform?.opacity != null) {
    if (merged.transform == null) {
      merged.transform = {};
    }
    merged.transform.opacity = childDescriptor.layer.transform.opacity;
  }

  const preservedData: EffectsLayerPreservedData = {
    ...nullDescriptor.preservedData,
    ...childDescriptor.preservedData,
    sourceItemIds: [
      ...(nullDescriptor.preservedData.sourceItemIds ?? [nullDescriptor.itemId]),
      ...(childDescriptor.preservedData.sourceItemIds ?? [childDescriptor.itemId]),
    ],
    sourceHierarchy: 'null-sprite-pair',
  };

  return {
    itemId: nullDescriptor.itemId,
    item: nullDescriptor.item,
    layer: merged,
    preservedData,
  };
}

export function resolveHierarchy(descriptors: RawLayerDescriptor[], ctx: GESceneContext): void {
  const layerIdByItemId = new Map<string, string>();
  const descriptorByItemId = new Map<string, RawLayerDescriptor>();

  for (const descriptor of descriptors) {
    layerIdByItemId.set(descriptor.itemId, descriptor.layer.id);
    descriptorByItemId.set(descriptor.itemId, descriptor);
  }

  for (const descriptor of descriptors) {
    const parentId = descriptor.item['parentId'] as string | undefined;

    if (parentId == null) {
      continue;
    }

    const parentLayerId = layerIdByItemId.get(parentId);
    const parentDescriptor = descriptorByItemId.get(parentId);

    if (parentLayerId == null || parentDescriptor == null) {
      descriptor.preservedData.runtimeParentId = parentId;
      continue;
    }

    descriptor.layer.parentId = parentLayerId;

    const parentAnchor = getDescriptorAnchor(parentDescriptor);
    const position = descriptor.layer.transform?.position;

    if (position != null && position.type === 'static' && position.value != null) {
      const position2d = position.value;
      // Parenting offsets are world-space translations, outside the child perspective projection.
      const depthScale = (DEFAULT_CAMERA_Z - (position2d[2] ?? 0)) / DEFAULT_CAMERA_Z;
      const effectiveDepthScale = Math.abs(depthScale) > 1e-10 ? depthScale : 1;

      descriptor.layer.transform!.position = {
        type: 'static',
        value: [
          position2d[0] + (parentAnchor[0] - ctx.width / 2) / effectiveDepthScale,
          position2d[1] + (parentAnchor[1] - ctx.height / 2) / effectiveDepthScale,
          position2d[2] ?? 0,
        ],
      };
    }
  }
}

function getDescriptorAnchor(descriptor: RawLayerDescriptor): [number, number] {
  const anchor = descriptor.layer.transform?.anchor;

  if (anchor != null && anchor.type === 'static' && Array.isArray(anchor.value) && anchor.value.length >= 2) {
    return [anchor.value[0], anchor.value[1]];
  }

  return [0, 0];
}
