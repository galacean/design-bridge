import * as spec from '@galacean/effects-specification';
import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../../src/generator/build-timeline';

describe('buildTimeline', () => {
  it('should create TimelineAsset -> ObjectBindingTrack -> ActivationTrack chain', () => {
    const timeline = buildTimeline(5, spec.EndBehavior.restart);
    const timelineAsset = timeline.miscs.find(misc => misc.id === timeline.timelineAssetId);
    const objectBinding = timeline.miscs.find(
      misc => misc.id === timeline.objectBindingTrackId,
    ) as spec.TrackAssetData;

    expect(timelineAsset).toBeDefined();
    expect(timelineAsset!.dataType).toBe('TimelineAsset');
    expect(objectBinding).toBeDefined();
    expect(objectBinding.dataType).toBe('ObjectBindingTrack');

    const childTrackId = (objectBinding.children as Array<{ id: string }>)[0].id;
    const activationTrack = timeline.miscs.find(misc => misc.id === childTrackId) as spec.TrackAssetData;

    expect(activationTrack).toBeDefined();
    expect(activationTrack.dataType).toBe('ActivationTrack');

    const clips = activationTrack.clips as Array<{
      duration: number;
      endBehavior: spec.EndBehavior;
    }>;

    expect(clips).toHaveLength(1);
    expect(clips[0].duration).toBe(5);
    expect(clips[0].endBehavior).toBe(spec.EndBehavior.restart);
  });
});
