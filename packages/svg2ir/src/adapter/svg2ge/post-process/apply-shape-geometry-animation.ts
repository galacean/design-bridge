import type { IRAnimatedProperty, IRKeyframe, IRScene } from '@galacean/animation-ir';
import { DataType, ShapePrimitiveType, type JSONScene, ValueType } from '@galacean/effects-specification';
import type { SVGPreservedShapeAnimation } from '../../../svg-preserved-data';
import { convertIRScalarKeyframesToGE, type IRToGETimeContext } from '../converter/animation';
import { createId, toDataPath } from '../converter/data-path';
import { get2dTo3dRatio } from '@galacean/ge-ir';
import { normalizeShapeAnimationForGE } from '../normalize-shape-animation';

interface SceneRecord {
  id?: string;
  dataType?: string;
  [key: string]: unknown;
}

export function applyShapeGeometryAnimations (
  scene: JSONScene,
  ir: IRScene,
  animationsByLayerId: ReadonlyMap<string, SVGPreservedShapeAnimation> | undefined,
): void {
  const composition = ir.compositions[0];
  const timelineAsset = asRecordArray(scene.miscs).find(misc => misc.dataType === DataType.TimelineAsset);
  const compositionComponent = asRecordArray(scene.components).find(component => component.dataType === DataType.CompositionComponent);
  const timelineTracks = timelineAsset?.['tracks'];
  const sceneBindings = compositionComponent?.['sceneBindings'];

  if (composition == null || animationsByLayerId == null || !Array.isArray(timelineTracks) || !Array.isArray(sceneBindings)) { return; }
  const itemRecords = asRecordArray(scene.items);
  const componentRecords = asRecordArray(scene.components);
  const shapeItemsByName = new Map<string, SceneRecord[]>();

  for (const item of itemRecords) {
    const name = typeof item['name'] === 'string' ? item['name'] : '';
    const items = shapeItemsByName.get(name) ?? [];

    items.push(item);
    shapeItemsByName.set(name, items);
  }
  const ratio = get2dTo3dRatio(composition.width, composition.height);

  for (const layer of composition.layers) {
    const item = takeLayerItem(layer.name ?? '', layer.type === 'shape', shapeItemsByName, componentRecords);

    if (layer.type !== 'shape') { continue; }
    const animation = animationsByLayerId.get(layer.id);
    const normalizedAnimation = animation == null ? undefined : normalizeShapeAnimationForGE(animation);

    if (normalizedAnimation == null || normalizedAnimation.keyframes.length < 2) { continue; }
    if (item == null || typeof item.id !== 'string') { continue; }
    const componentMatch = findShapeComponent(item, componentRecords);

    if (componentMatch == null || typeof componentMatch.component.id !== 'string') { continue; }
    const { component, componentIndex } = componentMatch;

    if (component['type'] !== ShapePrimitiveType.Custom) { continue; }
    const basePoints = readPointArray(component['points']);
    const baseInTangents = readPointArray(component['easingIns']);
    const baseOutTangents = readPointArray(component['easingOuts']);
    const animatedPoints = normalizedAnimation.keyframes.map(keyframe => flattenPaths(keyframe.paths));

    if (!hasPointTopology(animatedPoints, basePoints.length)
      || !hasPointTopology(animatedPoints.map(value => value.map(point => point.inTangent)), baseInTangents.length)
      || !hasPointTopology(animatedPoints.map(value => value.map(point => point.outTangent)), baseOutTangents.length)) {
      continue;
    }
    const timeContext: IRToGETimeContext = {
      startFrame: layer.time.inFrame,
      endFrame: layer.time.outFrame,
    };
    const prefix = `components.${componentIndex}.shape`;

    for (let pointIndex = 0; pointIndex < basePoints.length; pointIndex++) {
      appendCoordinateTrack(
        scene,
        timelineTracks,
        sceneBindings,
        item.id,
        `${prefix}.points.${pointIndex}.x`,
        normalizedAnimation.keyframes.map(keyframe => ({
          frame: keyframe.time * composition.frameRate,
          value: keyframe.paths.flatMap(path => path.points)[pointIndex].x * ratio,
        })),
        timeContext,
        composition.frameRate,
      );
      appendCoordinateTrack(
        scene,
        timelineTracks,
        sceneBindings,
        item.id,
        `${prefix}.points.${pointIndex}.y`,
        normalizedAnimation.keyframes.map(keyframe => ({
          frame: keyframe.time * composition.frameRate,
          value: -keyframe.paths.flatMap(path => path.points)[pointIndex].y * ratio,
        })),
        timeContext,
        composition.frameRate,
      );
      appendCoordinateTrack(
        scene,
        timelineTracks,
        sceneBindings,
        item.id,
        `${prefix}.easingIns.${pointIndex}.x`,
        normalizedAnimation.keyframes.map(keyframe => ({
          frame: keyframe.time * composition.frameRate,
          value: keyframe.paths.flatMap(path => path.inTangents)[pointIndex].x * ratio,
        })),
        timeContext,
        composition.frameRate,
      );
      appendCoordinateTrack(
        scene,
        timelineTracks,
        sceneBindings,
        item.id,
        `${prefix}.easingIns.${pointIndex}.y`,
        normalizedAnimation.keyframes.map(keyframe => ({
          frame: keyframe.time * composition.frameRate,
          value: -keyframe.paths.flatMap(path => path.inTangents)[pointIndex].y * ratio,
        })),
        timeContext,
        composition.frameRate,
      );
      appendCoordinateTrack(
        scene,
        timelineTracks,
        sceneBindings,
        item.id,
        `${prefix}.easingOuts.${pointIndex}.x`,
        normalizedAnimation.keyframes.map(keyframe => ({
          frame: keyframe.time * composition.frameRate,
          value: keyframe.paths.flatMap(path => path.outTangents)[pointIndex].x * ratio,
        })),
        timeContext,
        composition.frameRate,
      );
      appendCoordinateTrack(
        scene,
        timelineTracks,
        sceneBindings,
        item.id,
        `${prefix}.easingOuts.${pointIndex}.y`,
        normalizedAnimation.keyframes.map(keyframe => ({
          frame: keyframe.time * composition.frameRate,
          value: -keyframe.paths.flatMap(path => path.outTangents)[pointIndex].y * ratio,
        })),
        timeContext,
        composition.frameRate,
      );
    }
    appendCoordinateTrack(
      scene,
      timelineTracks,
      sceneBindings,
      item.id,
      `components.${componentIndex}.shapeDirty`,
      [
        { frame: layer.time.inFrame, value: 1 },
        { frame: layer.time.outFrame, value: 1 },
      ],
      timeContext,
      composition.frameRate,
    );
  }
}

function takeLayerItem (
  name: string,
  isShapeLayer: boolean,
  itemsByName: Map<string, SceneRecord[]>,
  components: SceneRecord[],
): SceneRecord | undefined {
  const candidates = itemsByName.get(name);

  if (candidates == null) { return undefined; }
  const candidateIndex = isShapeLayer
    ? candidates.findIndex(item => findShapeComponent(item, components) != null)
    : 0;

  return candidateIndex < 0 ? undefined : candidates.splice(candidateIndex, 1)[0];
}

function appendCoordinateTrack (
  scene: JSONScene,
  timelineTracks: unknown[],
  sceneBindings: unknown[],
  itemId: string,
  path: string,
  keyframes: IRKeyframe<number>[],
  timeContext: IRToGETimeContext,
  frameRate: number,
): void {
  const property: IRAnimatedProperty<number> = { type: 'keyframed', keyframes };
  const curve = convertIRScalarKeyframesToGE(property, timeContext)?.[0];

  if (curve == null) { return; }
  const playableAssetId = createId();
  const propertyTrackId = createId();
  const bindingTrackId = createId();
  const duration = (timeContext.endFrame - timeContext.startFrame) / frameRate;

  appendMisc(
    scene,
    {
      id: playableAssetId,
      dataType: DataType.FloatPropertyPlayableAsset,
      curveData: [ValueType.BEZIER_CURVE, curve],
    },
    {
      id: propertyTrackId,
      dataType: DataType.FloatPropertyTrack,
      path,
      children: [],
      clips: [{
        start: timeContext.startFrame / frameRate,
        duration,
        endBehavior: 0,
        asset: toDataPath(playableAssetId),
      }],
    },
    {
      id: bindingTrackId,
      dataType: DataType.ObjectBindingTrack,
      children: [toDataPath(propertyTrackId)],
      clips: [],
    },
  );
  timelineTracks.push(toDataPath(bindingTrackId));
  sceneBindings.push({ key: toDataPath(bindingTrackId), value: toDataPath(itemId) });
}

function findShapeComponent (item: SceneRecord, components: SceneRecord[]): { component: SceneRecord; componentIndex: number } | undefined {
  const refs = asUnknownArray(item['components']);

  for (let index = 0; index < refs.length; index++) {
    const ref = refs[index];
    const componentId = isRecord(ref) && typeof ref.id === 'string' ? ref.id : undefined;
    const component = componentId == null ? undefined : components.find(candidate => candidate.id === componentId);

    if (component?.dataType === DataType.ShapeComponent) {
      return { component, componentIndex: index };
    }
  }

  return undefined;
}

function flattenPaths (paths: SVGPreservedShapeAnimation['keyframes'][number]['paths']): Array<{
  point: { x: number; y: number };
  inTangent: { x: number; y: number };
  outTangent: { x: number; y: number };
}> {
  return paths.flatMap(path => path.points.map((point, index) => ({
    point,
    inTangent: path.inTangents[index],
    outTangent: path.outTangents[index],
  })));
}

function readPointArray (value: unknown): Array<{ x: number; y: number }> {
  return Array.isArray(value)
    ? value.filter(isRecord).map(point => ({ x: Number(point.x), y: Number(point.y) }))
    : [];
}

function hasPointTopology (values: Array<unknown[]>, length: number): boolean {
  return length > 0 && values.every(value => value.length === length);
}

function appendMisc (scene: JSONScene, ...entries: SceneRecord[]): void {
  for (const entry of entries) {
    scene.miscs.push(entry as unknown as JSONScene['miscs'][number]);
  }
}

function isRecord (value: unknown): value is SceneRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asUnknownArray (value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecordArray (value: unknown): SceneRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
