import {
  IREndBehavior, type IRComposition, type IRColor, type IRScene,
} from '@galacean/animation-ir';
import type {
  CompositionComponentData,
  CompositionData,
  DataPath,
  JSONScene,
  RGBAColorValue,
  TimelineAssetData,
  VFXItemData,
} from '@galacean/effects-specification';
import { DataType, EndBehavior, JSONSceneVersion } from '@galacean/effects-specification';
import { DEFAULT_CAMERA_FOV, DEFAULT_CAMERA_Z, DEFAULT_CLIP_MODE } from '../common/coordinate-mapping';
import { toDataPath } from '../common/data-path';
import { createId } from '../common/id';
import { normalizeJSONValue } from '../common/json-normalization';
import { roundNumber } from '../common/math';
import { restoreComponentTimelines } from './generator/append-timeline-tracks';
import { mergePreservedResources } from './post-process/merge-preserved-resources';
import { restoreRuntimeGraph } from './post-process/restore-runtime-graph';
import type { GEToIRPreservedData } from '../preserved-data';
import type { ECSCollector, GeneratedComponentData, GeneratedCompositionData, GeneratedMiscData } from './types';

const DEFAULT_PLAYER_VERSION = {
  web: '2.11.0-alpha.1',
  native: '0.0.1.202311221223',
};

/**
 * Assemble a GE JSONScene from generated pools and preserved source resources.
 * `duration` overrides the value derived from the IR frame bounds.
 */
export function assembleGEScene(
  irScene: IRScene,
  collector: ECSCollector,
  generatedCompositions: GeneratedCompositionData[],
  duration?: number,
  preservedData?: GEToIRPreservedData,
): JSONScene {
  const compositions: Array<CompositionData & Record<string, unknown>> = [];

  for (const { id, ir, itemBindings, items } of generatedCompositions) {
    const itemById = new Map(items.map(item => [item.id, item]));
    const children: DataPath[] = [];

    for (const binding of itemBindings) {
      const item = itemById.get(binding.itemId);
      const timing = binding.layerId == null ? undefined
        : preservedData?.compositionBindings[ir.id]?.layerDataById[binding.layerId]?.itemTiming;

      if (item != null && timing != null) {
        item.duration = timing.duration;
        item.delay = timing.delay;
      }
    }

    for (const item of items) {
      item.children = [];
    }
    for (const item of items) {
      const parent = item.parentId == null ? undefined : itemById.get(item.parentId);

      if (parent != null) {
        parent.children!.push(toDataPath(item.id));
      } else {
        children.push(toDataPath(item.id));
      }
    }
    const timelineAssetId = createId();
    const timelineBindings = itemBindings.filter(
      (binding): binding is typeof binding & { objectBindingTrackId: string } => binding.objectBindingTrackId != null,
    );
    const objectBindingTrackRefs: DataPath[] = timelineBindings.map(binding => toDataPath(binding.objectBindingTrackId));
    const timelineAsset: TimelineAssetData & GeneratedMiscData = {
      id: timelineAssetId,
      dataType: DataType.TimelineAsset,
      tracks: objectBindingTrackRefs,
    };

    collector.miscs.push(timelineAsset);

    const compositionComponentId = createId();
    const sceneBindings = timelineBindings.map(binding => ({
      key: toDataPath(binding.objectBindingTrackId),
      value: toDataPath(binding.itemId),
    }));

    sceneBindings.push(...restoreComponentTimelines(
      collector, ir, itemBindings, preservedData?.compositionBindings[ir.id]?.layerDataById ?? {},
    ));
    // Specification 2.8.1 still declares the item list removed by the 3.7 runtime migration.
    const compositionComponent: Omit<CompositionComponentData, 'items'> & GeneratedComponentData = {
      id: compositionComponentId,
      dataType: DataType.CompositionComponent,
      item: toDataPath(id),
      timelineAsset: toDataPath(timelineAssetId),
      sceneBindings,
    };

    collector.components.push(compositionComponent);

    const composition: CompositionData & Record<string, unknown> = {
      id,
      name: ir.name ?? ir.id,
      duration: id === irScene.entryCompositionId && duration != null ? duration : deriveDuration(ir),
      startTime: ir.inPoint / ir.frameRate,
      endBehavior: mapCompositionEndBehavior(ir.endBehavior),
      previewSize: [ir.width, ir.height],
      camera: {
        fov: DEFAULT_CAMERA_FOV,
        far: 40,
        near: 0.1,
        clipMode: DEFAULT_CLIP_MODE,
        position: [0, 0, DEFAULT_CAMERA_Z],
        rotation: [0, 0, 0],
        ...preservedData?.compositionBindings[ir.id]?.camera,
      },
      components: [toDataPath(compositionComponentId)],
      children,
    };

    if (ir.backgroundColor != null) {
      composition['background'] = { color: colorToRoundedRgba(ir.backgroundColor) };
    }
    compositions.push(composition);
  }

  const generatedScene: JSONScene = {
    version: JSONSceneVersion['3_7'],
    playerVersion: DEFAULT_PLAYER_VERSION,
    images: collector.images,
    fonts: collector.fonts,
    plugins: [],
    type: 'ge',
    compositionId: irScene.entryCompositionId,
    compositions,
    components: collector.components,
    geometries: [],
    materials: [],
    // The specification still requires deprecated VFXItemData.content;
    // generated component-backed items intentionally omit it.
    items: collector.items as VFXItemData[],
    shaders: [],
    bins: [],
    textures: collector.textures,
    animations: [],
    miscs: collector.miscs,
  };

  restoreRuntimeGraph(generatedScene as unknown as Record<string, unknown>, generatedCompositions, preservedData);

  return normalizeJSONValue(
    mergePreservedResources(generatedScene as unknown as Record<string, unknown>, preservedData),
  ) as unknown as JSONScene;
}

function deriveDuration(ir: IRComposition): number {
  return (ir.outPoint - ir.inPoint) / ir.frameRate;
}

/** Map the required IR composition end behavior to GE. */
function mapCompositionEndBehavior(endBehavior: IREndBehavior): EndBehavior {
  switch (endBehavior) {
    case IREndBehavior.Loop:
      return EndBehavior.restart;
    case IREndBehavior.Continue:
      return EndBehavior.forward;
    case IREndBehavior.Freeze:
      return EndBehavior.freeze;
    case IREndBehavior.Destroy:
      return EndBehavior.destroy;
  }
}

function colorToRoundedRgba(color: IRColor): RGBAColorValue {
  return [roundNumber(color[0]), roundNumber(color[1]), roundNumber(color[2]), roundNumber(color[3], 4)];
}
