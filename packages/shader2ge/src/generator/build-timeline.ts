import * as spec from '@galacean/effects-specification';
import { generateId } from './generate-id';

export interface TimelineBuildResult {
  miscs: (spec.EffectsObjectData | spec.TrackAssetData | spec.TimelineAssetData)[];
  timelineAssetId: string;
  objectBindingTrackId: string;
}

export function buildTimeline(duration: number, endBehavior: spec.EndBehavior): TimelineBuildResult {
  const miscs: (spec.EffectsObjectData | spec.TrackAssetData | spec.TimelineAssetData)[] = [];
  const activationPlayableId = generateId();

  miscs.push({
    id: activationPlayableId,
    dataType: spec.DataType.ActivationPlayableAsset,
  });

  const activationTrackId = generateId();

  miscs.push({
    id: activationTrackId,
    dataType: spec.DataType.ActivationTrack,
    children: [],
    clips: [
      {
        start: 0,
        duration,
        endBehavior,
        asset: { id: activationPlayableId },
      },
    ],
  });

  const objectBindingTrackId = generateId();

  miscs.push({
    id: objectBindingTrackId,
    dataType: spec.DataType.ObjectBindingTrack,
    children: [{ id: activationTrackId }],
    clips: [],
  });

  const timelineAssetId = generateId();

  miscs.push({
    id: timelineAssetId,
    dataType: spec.DataType.TimelineAsset,
    tracks: [{ id: objectBindingTrackId }],
  });

  return { miscs, timelineAssetId, objectBindingTrackId };
}
