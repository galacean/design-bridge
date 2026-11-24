import { spec, generateGUID } from '@galacean/effects';

interface TimelineResult {
  miscs: spec.EffectsObjectData[];
  timelineAssetId: string;
  sceneBindings: Array<{ key: { id: string }; value: { id: string } }>;
}

/**
 * Build the full Timeline object graph required by GE runtime.
 *
 * For each item generates:
 *   ObjectBindingTrack → [ActivationTrack, TransformTrack, SpriteColorTrack?]
 *
 * Returns the miscs pool entries, timeline asset id, and scene bindings
 * needed by CompositionComponent.
 */
export function buildTimeline(
  items: spec.VFXItemData[],
  components: spec.ComponentData[],
  compositionDuration: number,
): TimelineResult {
  const miscs: spec.EffectsObjectData[] = [];
  const objectBindingTrackIds: string[] = [];
  const sceneBindings: TimelineResult['sceneBindings'] = [];

  // Build a component lookup: itemId → component[]
  const componentsByItem = new Map<string, spec.ComponentData[]>();

  for (const comp of components) {
    if (comp.dataType === spec.DataType.CompositionComponent) {
      continue;
    }
    const list = componentsByItem.get(comp.item.id) ?? [];

    list.push(comp);
    componentsByItem.set(comp.item.id, list);
  }

  for (const item of items) {
    const childTrackIds: string[] = [];

    // --- ActivationTrack + ActivationPlayableAsset ---
    const activationAssetId = generateGUID();

    miscs.push({
      id: activationAssetId,
      dataType: spec.DataType.ActivationPlayableAsset,
    });

    const activationTrackId = generateGUID();

    miscs.push({
      id: activationTrackId,
      dataType: spec.DataType.ActivationTrack,
      children: [],
      clips: [
        {
          start: 0,
          duration: compositionDuration,
          endBehavior: spec.EndBehavior.freeze,
          asset: { id: activationAssetId },
        },
      ],
    } as unknown as spec.EffectsObjectData);
    childTrackIds.push(activationTrackId);

    // --- TransformTrack + TransformPlayableAsset ---
    const transformAssetId = generateGUID();

    miscs.push({
      id: transformAssetId,
      dataType: spec.DataType.TransformPlayableAsset,
    });

    const transformTrackId = generateGUID();

    miscs.push({
      id: transformTrackId,
      dataType: spec.DataType.TransformTrack,
      children: [],
      clips: [
        {
          start: 0,
          duration: compositionDuration,
          endBehavior: spec.EndBehavior.freeze,
          asset: { id: transformAssetId },
        },
      ],
    } as unknown as spec.EffectsObjectData);
    childTrackIds.push(transformTrackId);

    // --- SpriteColorTrack (for sprite / text items) ---
    const itemComponents = componentsByItem.get(item.id) ?? [];
    const hasSpriteOrText = itemComponents.some(
      c => c.dataType === spec.DataType.SpriteComponent || c.dataType === spec.DataType.TextComponent,
    );

    if (hasSpriteOrText) {
      const spriteColorAssetId = generateGUID();
      const spriteComp = itemComponents.find(c => c.dataType === spec.DataType.SpriteComponent) as
        spec.SpriteComponentData | undefined;
      const startColor = (spriteComp?.options as Record<string, unknown> | undefined)?.startColor as
        [number, number, number, number] | undefined;

      miscs.push({
        id: spriteColorAssetId,
        dataType: spec.DataType.SpriteColorPlayableAsset,
        ...(startColor ? { startColor } : {}),
      });

      const spriteColorTrackId = generateGUID();

      miscs.push({
        id: spriteColorTrackId,
        dataType: spec.DataType.SpriteColorTrack,
        children: [],
        clips: [
          {
            start: 0,
            duration: compositionDuration,
            endBehavior: spec.EndBehavior.freeze,
            asset: { id: spriteColorAssetId },
          },
        ],
      } as unknown as spec.EffectsObjectData);
      childTrackIds.push(spriteColorTrackId);
    }

    // --- ObjectBindingTrack ---
    const objBindingTrackId = generateGUID();

    miscs.push({
      id: objBindingTrackId,
      dataType: spec.DataType.ObjectBindingTrack,
      children: childTrackIds.map(id => ({ id })),
      clips: [],
    } as unknown as spec.EffectsObjectData);
    objectBindingTrackIds.push(objBindingTrackId);

    sceneBindings.push({
      key: { id: objBindingTrackId },
      value: { id: item.id },
    });
  }

  // --- TimelineAsset ---
  const timelineAssetId = generateGUID();

  miscs.push({
    id: timelineAssetId,
    dataType: spec.DataType.TimelineAsset,
    tracks: objectBindingTrackIds.map(id => ({ id })),
  } as unknown as spec.EffectsObjectData);

  return { miscs, timelineAssetId, sceneBindings };
}
