import { DataType, type DataPath, EndBehavior, type TimelineClipData } from '@galacean/effects-specification';
import { resolveDataPath, resolveDataPathId, visitDataPathReferences } from '../../common/data-path';
import type { GESceneContext } from '../types';
import type { EffectsLayerPreservedData } from '../../preserved-data';
import { normalizeJSONValue } from '../../common/json-normalization';

interface ParsedTimelineData {
  delay?: number;
  duration?: number;
  activationEndBehavior?: EndBehavior;
  transformAsset?: Record<string, unknown>;
  spriteColorAsset?: Record<string, unknown>;
}

export function parseTimeline(itemId: string, ctx: GESceneContext): ParsedTimelineData | undefined {
  const trackId = ctx.itemIdToTrackId.get(itemId);

  if (trackId == null) {
    return undefined;
  }

  const objectBindingTrack = ctx.miscById.get(trackId);

  if (objectBindingTrack == null) {
    return undefined;
  }

  const childReferences = objectBindingTrack['children'] as DataPath[] | undefined;

  if (childReferences == null) {
    return undefined;
  }

  let delay: number | undefined;
  let duration: number | undefined;
  let activationEndBehavior: EndBehavior | undefined;
  let transformAsset: Record<string, unknown> | undefined;
  let spriteColorAsset: Record<string, unknown> | undefined;

  for (const childReference of childReferences) {
    const childTrackId = resolveDataPathId(childReference);

    if (childTrackId == null) {
      continue;
    }

    const childTrack = ctx.miscById.get(childTrackId);

    if (childTrack == null) {
      continue;
    }

    const dataType = childTrack['dataType'];
    const clips = childTrack['clips'] as TimelineClipData[] | undefined;

    if (clips == null || clips.length === 0) {
      continue;
    }

    const clip = clips[0];

    if (dataType === DataType.ActivationTrack) {
      delay = clip.start ?? 0;
      duration = clip.duration ?? 0;
      activationEndBehavior = clip.endBehavior ?? EndBehavior.destroy;
    } else if (dataType === DataType.TransformTrack) {
      const assetReference = clip.asset;

      if (assetReference != null) {
        transformAsset = resolveDataPath(ctx.miscById, assetReference);
      }
    } else if (dataType === DataType.SpriteColorTrack) {
      const assetReference = clip.asset;

      if (assetReference != null) {
        spriteColorAsset = resolveDataPath(ctx.miscById, assetReference);
      }
    }
  }

  return { delay, duration, activationEndBehavior, transformAsset, spriteColorAsset };
}

export function parseComponentTimeline(
  componentId: string,
  ctx: GESceneContext,
): EffectsLayerPreservedData['componentTimeline'] {
  const rootId = ctx.itemIdToTrackId.get(componentId);

  if (rootId == null || !ctx.miscById.has(rootId)) {
    return undefined;
  }
  const objects: Record<string, unknown>[] = [];
  const visited = new Set<string>();
  const collect = (id: string): void => {
    const object = ctx.miscById.get(id);

    if (object == null || visited.has(id)) {
      return;
    }
    visited.add(id);
    objects.push(normalizeJSONValue(object));
    visitDataPathReferences(object, collect);
  };

  collect(rootId);
  const unsupported = objects.find(object => !Object.values(DataType).some(type => type === object['dataType']));

  if (unsupported != null) {
    ctx.diagnostics.push({
      code: 'GE_COMPONENT_TRACK_UNSUPPORTED', severity: 'warning', action: 'unsupported',
      path: `$.miscs[id=${JSON.stringify(unsupported['id'])}]`, sourceId: componentId,
      feature: String(unsupported['dataType']),
      message: 'The component timeline contains an unsupported runtime object and was not retained.',
    });

    return undefined;
  }

  return { root: { id: rootId }, objects };
}
