import type { IRComposition } from '@galacean/animation-ir';
import type { EffectsLayerPreservedData } from '../../preserved-data';
import { isRecord } from '../../common/json-normalization';
import type { DataPath, TimelineClipData, TrackAssetData } from '@galacean/effects-specification';
import { DataType, type EndBehavior, ItemType } from '@galacean/effects-specification';
import { toDataPath } from '../../common/data-path';
import { createId } from '../../common/id';
import { roundNumber } from '../../common/math';
import type { ECSCollector, GeneratedItemBinding, GeneratedMiscData, TransformAnimation } from '../types';

interface TimelineTrackCollector {
  miscs: Record<string, unknown>[];
}

/** Append binding, activation, transform, and supported renderer-color tracks for one Item. */
export function appendTimelineTracks(
  collector: TimelineTrackCollector,
  delay: number,
  duration: number,
  endBehavior: EndBehavior,
  animation: TransformAnimation,
  itemType: ItemType,
  precompTimeOffset = 0,
): string {
  const objectBindingTrackId = createId();
  const childTrackIds: DataPath[] = [];

  childTrackIds.push(toDataPath(appendActivationTrack(collector, delay, duration, endBehavior)));
  childTrackIds.push(toDataPath(appendTransformTrack(collector, delay, duration, endBehavior, animation)));

  if (isPrecompItemType(itemType)) {
    const sourceOffset = Math.max(precompTimeOffset, 0);

    childTrackIds.push(toDataPath(appendSubCompositionTrack(
      collector,
      delay - sourceOffset,
      duration + sourceOffset,
      endBehavior,
    )));
    // GE 2.9's SubComposition mixer writes the same Item active state as Activation.
    // When source time starts early, repeat Activation last so it remains the final
    // visibility decision while the nested Composition clock continues advancing.
    if (sourceOffset > 0) {
      childTrackIds.push(toDataPath(appendActivationTrack(collector, delay, duration, endBehavior)));
    }
  }

  if (shouldAppendSpriteColorTrack(itemType)) {
    childTrackIds.push(toDataPath(appendSpriteColorTrack(collector, delay, duration, endBehavior, animation)));
  }

  const objectBindingTrack: TrackAssetData & GeneratedMiscData = {
    id: objectBindingTrackId,
    dataType: DataType.ObjectBindingTrack,
    children: childTrackIds,
    clips: [],
  };

  collector.miscs.push(objectBindingTrack);

  return objectBindingTrackId;
}

function shouldAppendSpriteColorTrack(itemType: ItemType): boolean {
  return itemType === ItemType.sprite || itemType === ItemType.text || itemType === ItemType.shape;
}

function isPrecompItemType(itemType: ItemType): boolean {
  return itemType === ItemType.composition;
}

function appendActivationTrack(
  collector: TimelineTrackCollector,
  delay: number,
  duration: number,
  endBehavior: EndBehavior,
): string {
  return appendPlayableTrack(collector, delay, duration, endBehavior, {
    assetDataType: DataType.ActivationPlayableAsset,
    trackDataType: DataType.ActivationTrack,
  });
}

function appendTransformTrack(
  collector: TimelineTrackCollector,
  delay: number,
  duration: number,
  endBehavior: EndBehavior,
  animation: TransformAnimation,
): string {
  const assetFields: Record<string, unknown> = {
    positionOverLifetime: animation.positionOverLifetime ?? {},
  };

  if (animation.rotationOverLifetime != null) {
    assetFields['rotationOverLifetime'] = animation.rotationOverLifetime;
  }
  if (animation.sizeOverLifetime != null) {
    assetFields['sizeOverLifetime'] = animation.sizeOverLifetime;
  }

  return appendPlayableTrack(collector, delay, duration, endBehavior, {
    assetDataType: DataType.TransformPlayableAsset,
    trackDataType: DataType.TransformTrack,
    assetFields,
  });
}

function appendSpriteColorTrack(
  collector: TimelineTrackCollector,
  delay: number,
  duration: number,
  endBehavior: EndBehavior,
  animation: TransformAnimation,
): string {
  const assetFields: Record<string, unknown> = {
    startColor: [1, 1, 1, 1],
  };

  if (animation.colorOverLifetime != null) {
    assetFields['colorOverLifetime'] = animation.colorOverLifetime;
  }

  return appendPlayableTrack(collector, delay, duration, endBehavior, {
    assetDataType: DataType.SpriteColorPlayableAsset,
    trackDataType: DataType.SpriteColorTrack,
    assetFields,
  });
}

function appendSubCompositionTrack(
  collector: TimelineTrackCollector,
  delay: number,
  duration: number,
  endBehavior: EndBehavior,
): string {
  return appendPlayableTrack(collector, delay, duration, endBehavior, {
    assetDataType: DataType.SubCompositionPlayableAsset,
    trackDataType: DataType.SubCompositionTrack,
  });
}

interface TimelineTrackSpec {
  assetDataType: DataType;
  trackDataType: DataType;
  assetFields?: Record<string, unknown>;
}

function appendPlayableTrack(
  collector: TimelineTrackCollector,
  delay: number,
  duration: number,
  endBehavior: EndBehavior,
  spec: TimelineTrackSpec,
): string {
  const assetId = createId();

  const playableAsset: GeneratedMiscData = {
    id: assetId,
    dataType: spec.assetDataType,
    ...spec.assetFields,
  };

  collector.miscs.push(playableAsset);

  const trackId = createId();
  const clip: TimelineClipData = {
    start: roundNumber(delay, 4),
    duration: roundNumber(duration, 4),
    endBehavior,
    asset: toDataPath(assetId),
  };

  const track: TrackAssetData & GeneratedMiscData = {
    id: trackId,
    dataType: spec.trackDataType,
    children: [],
    clips: [clip],
  };

  collector.miscs.push(track);

  return trackId;
}

export function restoreComponentTimelines(
  collector: ECSCollector,
  ir: IRComposition,
  itemBindings: GeneratedItemBinding[],
  layerDataById: Readonly<Record<string, EffectsLayerPreservedData>>,
): { key: DataPath; value: DataPath }[] {
  const bindings: { key: DataPath; value: DataPath }[] = [];

  for (const layer of ir.layers) {
    const timeline = layerDataById[layer.id]?.componentTimeline;
    const binding = itemBindings.find(candidate => candidate.layerId === layer.id &&
      collector.components.some(component => component.item.id === candidate.itemId));
    const component = binding == null ? undefined : collector.components.find(value => value.item.id === binding.itemId);
    const itemTrack = collector.miscs.find(value => value.id === binding?.objectBindingTrackId);

    if (timeline == null || component == null || itemTrack == null || !Array.isArray(itemTrack['children'])) {
      continue;
    }
    const ids = new Map<string, string>();

    for (const object of timeline.objects) {
      const id = object['id'];

      if (typeof id === 'string') {
        ids.set(id, collector.miscs.some(misc => misc.id === id) ? createId() : id);
      }
    }
    const remap = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(remap);
      }
      if (!isRecord(value)) {
        return value;
      }

      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
        key === 'id' && typeof entry === 'string' ? ids.get(entry) ?? entry : remap(entry),
      ]));
    };

    for (const object of timeline.objects) {
      const copy = remap(object);

      const dataType = isRecord(copy) ? Object.values(DataType).find(type => type === copy['dataType']) : undefined;

      if (isRecord(copy) && typeof copy['id'] === 'string' && dataType != null) {
        collector.miscs.push({ ...copy, id: copy['id'], dataType });
      }
    }
    const root = toDataPath(ids.get(timeline.root.id) ?? timeline.root.id);

    itemTrack['children'].push(root);
    bindings.push({ key: root, value: toDataPath(component.id) });
  }

  return bindings;
}
