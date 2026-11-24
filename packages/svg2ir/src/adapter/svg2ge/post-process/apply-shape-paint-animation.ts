import type {
  IRAnimatedProperty, IRPropertyValue, IRScene,
} from '@galacean/animation-ir';
import { IRLayerType } from '@galacean/animation-ir';
import { DataType, ValueType, type EffectsObjectData, type JSONScene } from '@galacean/effects-specification';
import type { SVGPreservedPaintAnimation } from '../../../svg-preserved-data';
import { convertIRScalarKeyframesToGE, type IRToGETimeContext } from '../converter/animation';
import { createId, toDataPath } from '../converter/data-path';
import { get2dTo3dRatio } from '@galacean/ge-ir';
import { sampleColorProperty, sampleScalarProperty, sampleVectorProperty } from './paint-animation-sampling';

type SceneRecord = Record<string, unknown>;

/** 记录 paint 动画轨道的场景资源和绑定关系。 */
interface PaintTrackSink {
  appendMisc (...entries: Array<SceneRecord & { id: string; dataType: string }>): void;
  pushTrack (bindingTrackId: string, componentId: string): void;
  readonly frameRate: number;
}

function isRecord (value: unknown): value is SceneRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asRecordArray (value: unknown): SceneRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asUnknownArray (value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 创建写入 scene.miscs 和 timeline 绑定的 paint 轨道写入器。 */
function createPaintTrackSink (
  scene: JSONScene,
  timelineTracks: unknown[],
  sceneBindings: unknown[],
  frameRate: number,
): PaintTrackSink {
  return {
    frameRate,
    appendMisc (...entries) {
      for (const entry of entries) {
        const misc: EffectsObjectData & SceneRecord = { id: entry.id, dataType: DataType.TrackAsset };

        Object.assign(misc, entry);
        scene.miscs.push(misc);
      }
    },
    pushTrack (bindingTrackId, componentId) {
      timelineTracks.push(toDataPath(bindingTrackId));
      sceneBindings.push({ key: toDataPath(bindingTrackId), value: toDataPath(componentId) });
    },
  };
}

/** 将颜色动画拆分为四个通道。 */
function colorChannelCurves (property: Extract<IRAnimatedProperty<[number, number, number, number]>, { type: 'keyframed' }>, timeContext: IRToGETimeContext) {
  const colorKeyframes = property.keyframes;
  const makeColorCurve = (channel: number) => convertIRScalarKeyframesToGE({
    type: 'keyframed',
    keyframes: colorKeyframes.map(({ value, endValue, ...keyframe }) => ({
      ...keyframe,
      value: value[channel] ?? 0,
      ...(endValue != null && { endValue: endValue[channel] ?? 0 }),
    })),
  }, timeContext)?.[0];

  return [0, 1, 2, 3].map(makeColorCurve);
}

type KeyframedProperty<T extends IRPropertyValue> = Extract<IRAnimatedProperty<T>, { type: 'keyframed' }>;

function mapKeyframedProperty<T extends IRPropertyValue, U extends IRPropertyValue> (
  property: KeyframedProperty<T>,
  mapValue: (value: T) => U,
): KeyframedProperty<U> {
  return {
    type: 'keyframed',
    keyframes: property.keyframes.map(({ value, endValue, ...keyframe }) => ({
      ...keyframe,
      value: mapValue(value),
      ...(endValue != null && { endValue: mapValue(endValue) }),
    })),
  };
}

/** 逐帧时间区间(秒):delay=图层起点/帧率,duration=可见时长/帧率。 */
function clipTimeRange (timeContext: IRToGETimeContext, frameRate: number) {
  return {
    delay: timeContext.startFrame / frameRate,
    duration: (timeContext.endFrame - timeContext.startFrame) / frameRate,
  };
}

/** 把图层可见帧区间内的整数帧加入采样集合(paint 动画按 composition 帧逐帧采样,保留 SMIL 缓动中间值)。 */
function addFramesInRange (frames: Set<number>, timeContext: IRToGETimeContext): void {
  for (let frame = Math.ceil(timeContext.startFrame); frame <= Math.floor(timeContext.endFrame); frame++) {
    frames.add(frame);
  }
}

/** 把采样集合压缩成图层可见区间内升序去重的帧序列,供逐帧采样逐帧建 keyframes。 */
function sortFramesInRange (frames: Set<number>, timeContext: IRToGETimeContext): number[] {
  return Array.from(frames)
    .filter(frame => frame >= timeContext.startFrame && frame <= timeContext.endFrame)
    .sort((a, b) => a - b);
}

/** 写一条直接挂在组件上的颜色轨道(沿 path 寻址,如渐变 stop color),不含 MaterialTrack。 */
function appendDirectColorTrack (
  sink: PaintTrackSink, componentId: string, timeContext: IRToGETimeContext,
  path: string, property: IRAnimatedProperty<[number, number, number, number]>,
): void {
  if (property.type !== 'keyframed' || property.keyframes.length < 2) { return; }
  const curves = colorChannelCurves(property, timeContext);

  if (curves.some(curve => curve == null)) { return; }
  const { delay, duration } = clipTimeRange(timeContext, sink.frameRate);
  const bindingTrackId = createId();
  const colorTrackId = createId();
  const colorAssetId = createId();

  sink.appendMisc(
    {
      id: colorAssetId,
      dataType: 'ColorPropertyPlayableAsset',
      curveData: [ValueType.COLOR_CURVE, curves.map(curve => [ValueType.BEZIER_CURVE, curve])],
    },
    {
      id: colorTrackId,
      dataType: 'ColorPropertyTrack',
      path,
      children: [],
      clips: [{ start: delay, duration, endBehavior: 0, asset: toDataPath(colorAssetId) }],
    },
    {
      id: bindingTrackId,
      dataType: 'ObjectBindingTrack',
      children: [toDataPath(colorTrackId)],
      clips: [],
    },
  );
  sink.pushTrack(bindingTrackId, componentId);
}

/** 写入材质颜色轨道。 */
function appendMaterialColorTrack (
  sink: PaintTrackSink, componentId: string, timeContext: IRToGETimeContext,
  materialIndex: number, property: IRAnimatedProperty<[number, number, number, number]>,
): void {
  if (property.type !== 'keyframed' || property.keyframes.length < 2) { return; }
  const curves = colorChannelCurves(property, timeContext);

  if (curves.some(curve => curve == null)) { return; }
  const { delay, duration } = clipTimeRange(timeContext, sink.frameRate);
  const bindingTrackId = createId();
  const materialTrackId = createId();
  const colorTrackId = createId();
  const colorAssetId = createId();

  sink.appendMisc(
    {
      id: colorAssetId,
      dataType: 'ColorPropertyPlayableAsset',
      curveData: [ValueType.COLOR_CURVE, curves.map(curve => [ValueType.BEZIER_CURVE, curve])],
    },
    {
      id: colorTrackId,
      dataType: 'ColorPropertyTrack',
      path: 'colors._Color',
      children: [],
      clips: [{ start: delay, duration, endBehavior: 0, asset: toDataPath(colorAssetId) }],
    },
    {
      id: materialTrackId,
      dataType: 'MaterialTrack',
      index: materialIndex,
      children: [toDataPath(colorTrackId)],
      clips: [],
    },
    {
      id: bindingTrackId,
      dataType: 'ObjectBindingTrack',
      children: [toDataPath(materialTrackId)],
      clips: [],
    },
  );
  sink.pushTrack(bindingTrackId, componentId);
}

/** 写一条 stroke-width 浮点轨道(path='strokeWidth')。供 geometry scale × stroke-width 补偿分支调用。 */
function appendFloatPropertyTrack (
  sink: PaintTrackSink, componentId: string, timeContext: IRToGETimeContext,
  property: IRAnimatedProperty<number>,
): void {
  if (property.type !== 'keyframed' || property.keyframes.length < 2) { return; }
  const curve = convertIRScalarKeyframesToGE(property, timeContext)?.[0];

  if (curve == null) { return; }
  const { delay, duration } = clipTimeRange(timeContext, sink.frameRate);
  const bindingTrackId = createId();
  const propertyTrackId = createId();
  const propertyAssetId = createId();

  sink.appendMisc(
    {
      id: propertyAssetId,
      dataType: 'FloatPropertyPlayableAsset',
      curveData: [ValueType.BEZIER_CURVE, curve],
    },
    {
      id: propertyTrackId,
      dataType: 'FloatPropertyTrack',
      path: 'strokeWidth',
      children: [],
      clips: [{ start: delay, duration, endBehavior: 0, asset: toDataPath(propertyAssetId) }],
    },
    {
      id: bindingTrackId,
      dataType: 'ObjectBindingTrack',
      children: [toDataPath(propertyTrackId)],
      clips: [],
    },
  );
  sink.pushTrack(bindingTrackId, componentId);
}

export function applyShapePaintAnimation (
  scene: JSONScene,
  ir: IRScene,
  paintAnimationByLayerIndex: ReadonlyMap<string, readonly SVGPreservedPaintAnimation[]>,
): void {
  const miscs = asRecordArray(scene.miscs);
  const itemRecords = asRecordArray(scene.items);
  const componentRecords = asRecordArray(scene.components);
  const timelineAsset = miscs.find(misc => misc['dataType'] === 'TimelineAsset');
  const compositionComponent = componentRecords.find(component => component['dataType'] === 'CompositionComponent');
  const timelineTracks = timelineAsset?.['tracks'];
  const sceneBindings = compositionComponent?.['sceneBindings'];

  if (!Array.isArray(timelineTracks) || !Array.isArray(sceneBindings)) { return; }
  const composition = ir.compositions[0];

  if (composition == null) { return; }
  const paintTrackSink = createPaintTrackSink(scene, timelineTracks, sceneBindings, composition.frameRate);
  const exactShapeItemIndexes = new Map<string, number[]>();

  itemRecords.forEach((item, index) => {
    if (item['type'] !== 'shape') { return; }
    const name = String(item['name'] ?? '');
    const indexes = exactShapeItemIndexes.get(name) ?? [];

    indexes.push(index);
    exactShapeItemIndexes.set(name, indexes);
  });

  for (const layer of composition.layers) {
    if (layer.type !== IRLayerType.Shape) { continue; }
    // 按 layer→item 绑定顺序消费每个 shape，避免同名元素错配。
    const exactIndexes = exactShapeItemIndexes.get(layer.name ?? '');
    const baseItemIndex = exactIndexes?.shift();
    const opacity = layer.transform?.opacity;
    const paintEntries = paintAnimationByLayerIndex.get(layer.id) ?? [];
    const paintContext = paintEntries.find(
      (entry): entry is Extract<SVGPreservedPaintAnimation, { kind: 'context' }> => entry.kind === 'context',
    );
    const paintAnimations = paintEntries.filter(
      (entry): entry is Exclude<SVGPreservedPaintAnimation, { kind: 'context' }> => entry.kind !== 'context',
    );
    const animatedLayerOpacity = opacity?.type === 'keyframed' && opacity.keyframes.length >= 2 ? opacity : undefined;

    if (animatedLayerOpacity == null && paintAnimations.length === 0 && paintContext?.geometryScale == null) { continue; }
    const timeContext = { startFrame: layer.time.inFrame, endFrame: layer.time.outFrame };
    // 按 IR 与 Effects 的 bottom-first 顺序匹配同名 Shape item。

    if (baseItemIndex == null) { continue; }
    const layerItems = [itemRecords[baseItemIndex]];

    for (let index = baseItemIndex - 1; index >= 0; index--) {
      const candidate = itemRecords[index];
      const candidateName = String(candidate['name'] ?? '');

      if (candidate['type'] !== 'shape' || !candidateName.startsWith(`${layer.name}_shape_`)) { break; }
      layerItems.push(candidate);
    }

    for (const item of layerItems) {
      const componentRefs = asRecordArray(item['components']);

      for (const componentRef of componentRefs) {
        const componentId = componentRef['id'];

        if (typeof componentId !== 'string') { continue; }
        const component = componentRecords.find(candidate => candidate['id'] === componentId);

        if (component?.['dataType'] !== 'ShapeComponent') { continue; }
        const fills = asRecordArray(component['fills']);
        const strokes = asRecordArray(component['strokes']);
        const paints = fills.concat(strokes);
        const materialCount = Math.max(1, paints.length);

        for (let materialIndex = 0; materialIndex < materialCount; materialIndex++) {
          const paintTarget = materialIndex < fills.length ? 'fill' : 'stroke';
          const paintIndex = materialIndex < fills.length ? materialIndex : materialIndex - fills.length;
          const paint = paints[materialIndex];
          const paintAnimation = paintAnimations.findLast(
            (animation): animation is Extract<SVGPreservedPaintAnimation, { kind: 'opacity' }> => (
              animation.kind === 'opacity' && animation.target === paintTarget
            ),
          );
          const solidColorAnimation = paintAnimations.findLast(
            (animation): animation is Extract<SVGPreservedPaintAnimation, { kind: 'solid-color' }> => (
              animation.kind === 'solid-color' && animation.target === paintTarget
            ),
          );

          if (solidColorAnimation?.color.type === 'keyframed' && solidColorAnimation.color.keyframes.length >= 2) {
            const colorAnimation = solidColorAnimation.color;
            const alphaProperty = paintAnimation?.opacity ?? animatedLayerOpacity;
            const staticAlphaMultiplier = paintContext == null
              ? 1
              : alphaProperty == null
                ? paintContext.paintOpacity[paintTarget] * paintContext.staticElementOpacity
                : paintAnimation != null
                  ? paintContext.staticElementOpacity
                  : paintContext.paintOpacity[paintTarget] * paintContext.layerOpacityMultiplier;
            const frames = new Set(colorAnimation.keyframes.map(keyframe => keyframe.frame));

            if (alphaProperty?.type === 'keyframed') {
              for (const keyframe of alphaProperty.keyframes) { frames.add(keyframe.frame); }
            }
            // 在 composition 帧上采样 SMIL 缓动值。
            addFramesInRange(frames, timeContext);
            const colorProperty: IRAnimatedProperty<[number, number, number, number]> = {
              type: 'keyframed',
              keyframes: sortFramesInRange(frames, timeContext).map(frame => {
                  const color = sampleColorProperty(colorAnimation, frame);
                  const opacity = alphaProperty == null ? 1 : sampleScalarProperty(alphaProperty, frame);

                  return {
                    frame,
                    value: [color[0], color[1], color[2], color[3] * opacity * staticAlphaMultiplier],
                  };
                }),
            };

            appendMaterialColorTrack(paintTrackSink, componentId, timeContext, materialIndex, colorProperty);
            continue;
          }
          const alphaProperty = paintAnimation?.opacity ?? animatedLayerOpacity;

          if (alphaProperty == null || alphaProperty.type !== 'keyframed' || alphaProperty.keyframes.length < 2) { continue; }
          const gradientStops = paint?.['gradientStops'];

          if (Array.isArray(gradientStops) && Array.isArray(gradientStops[1]) && paintContext != null) {
            const collectionPath = paintTarget === 'fill' ? 'fills' : 'strokes';
            const stopColorAlpha = paintContext.gradientStopColorAlpha[paintTarget];
            const alphaMultiplier = paintAnimation != null
              ? paintContext.staticElementOpacity
              : paintContext.paintOpacity[paintTarget] * paintContext.layerOpacityMultiplier;
            const stops = asUnknownArray(gradientStops[1]);

            for (let stopIndex = 0; stopIndex < stops.length; stopIndex++) {
              const stop: unknown = stops[stopIndex];

              if (!Array.isArray(stop) || stop.length < 5) { continue; }
              const alphaScale = (stopColorAlpha[stopIndex] ?? Number(stop[4] ?? 1)) * alphaMultiplier;
              const colorProperty = mapKeyframedProperty(alphaProperty, value => [
                Number(stop[1]), Number(stop[2]), Number(stop[3]), value * alphaScale,
              ] as [number, number, number, number]);

              appendDirectColorTrack(
                paintTrackSink, componentId, timeContext,
                `${collectionPath}.${paintIndex}.gradientStops.stops.${stopIndex}.color`,
                colorProperty,
              );
            }
            continue;
          }
          const color = isRecord(paint?.['color']) ? paint['color'] : undefined;
          const baseColor = [
            Number(color?.['r'] ?? 1),
            Number(color?.['g'] ?? 1),
            Number(color?.['b'] ?? 1),
            Number(color?.['a'] ?? 1),
          ];
          const alphaBase = paintContext != null
            ? (paintAnimation != null
                ? paintContext.solidColorAlpha[paintTarget] * paintContext.staticElementOpacity
                : paintContext.solidColorAlpha[paintTarget]
                  * paintContext.paintOpacity[paintTarget]
                  * paintContext.layerOpacityMultiplier)
            : paintAnimation?.alphaBase ?? baseColor[3];
          // alpha 动画也通过 MaterialTrack 写入。
          const colorProperty = mapKeyframedProperty(alphaProperty, value => [
            baseColor[0], baseColor[1], baseColor[2], value * alphaBase,
          ] as [number, number, number, number]);

          appendMaterialColorTrack(paintTrackSink, componentId, timeContext, materialIndex, colorProperty);
        }

        for (const paintAnimation of paintAnimations) {
          if (paintAnimation.kind !== 'gradient-stop-color') { continue; }
          const paintCollection = paintAnimation.target === 'fill' ? fills : strokes;
          const paint = paintCollection[paintAnimation.paintIndex];
          const gradientStops = paint?.['gradientStops'];

          if (!Array.isArray(gradientStops) || !Array.isArray(gradientStops[1])) { continue; }
          const stops = asUnknownArray(gradientStops[1]);
          const stop: unknown = stops[paintAnimation.stopIndex];

          const colorProperty = paintAnimation.color;

          if (!Array.isArray(stop) || stop.length < 5 || colorProperty.type !== 'keyframed' || colorProperty.keyframes.length < 2) {
            continue;
          }
          const collectionPath = paintAnimation.target === 'fill' ? 'fills' : 'strokes';

          appendDirectColorTrack(
            paintTrackSink, componentId, timeContext,
            `${collectionPath}.${paintAnimation.paintIndex}.gradientStops.stops.${paintAnimation.stopIndex}.color`,
            colorProperty,
          );
        }

        const strokeWidthAnimation = paintAnimations.findLast(
          (animation): animation is Extract<SVGPreservedPaintAnimation, { kind: 'stroke-width' }> => animation.kind === 'stroke-width',
        );
        const geometryScale = paintContext?.geometryScale;
        const hasAnimatedGeometryScale = geometryScale?.type === 'keyframed' && geometryScale.keyframes.length >= 2;
        const hasAnimatedStrokeWidth = strokeWidthAnimation?.width.type === 'keyframed' && strokeWidthAnimation.width.keyframes.length >= 2;
        const shape = layer.content?.shapes?.[0];
        const baseStrokeWidth = shape?.strokes[0]?.width;

        if (strokes.length > 0 && baseStrokeWidth != null && (hasAnimatedGeometryScale || hasAnimatedStrokeWidth)) {
          const ratio = get2dTo3dRatio(composition.width, composition.height);
          const frames = new Set<number>();

          addFramesInRange(frames, timeContext);
          for (const keyframe of (geometryScale?.type === 'keyframed' ? geometryScale.keyframes : [])) { frames.add(keyframe.frame); }
          for (const keyframe of (strokeWidthAnimation?.width.type === 'keyframed' ? strokeWidthAnimation.width.keyframes : [])) { frames.add(keyframe.frame); }

          const property: IRAnimatedProperty<number> = {
            type: 'keyframed',
            keyframes: sortFramesInRange(frames, timeContext).map(frame => {
                const authoredWidth = strokeWidthAnimation == null
                  ? baseStrokeWidth
                  : sampleScalarProperty(strokeWidthAnimation.width, frame);
                const geometryValue = geometryScale?.type === 'keyframed'
                  ? sampleVectorProperty(geometryScale, frame)
                  : [1, 1, 1];
                const geometryFactor = Math.sqrt(Math.abs(geometryValue[0] * geometryValue[1]));
                const compensatedWidth = geometryFactor > 1e-9 ? authoredWidth / geometryFactor : 0;

                return { frame, value: compensatedWidth * ratio };
              }),
          };

          appendFloatPropertyTrack(paintTrackSink, componentId, timeContext, property);
        }
      }
    }
  }
}
