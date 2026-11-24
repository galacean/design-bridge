import type {
  IRAnimatedProperty, IRAsset, IRComposition, IRFontAsset, IRImageAsset, IRKeyframe,
  IRLayer, IRPropertyValue, IRTextLayer, IRVec3,
} from '@galacean/animation-ir';
import { getIRResourceSourceUrl, type ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import type { AnimatedProperty, AnimationCurve, Asset, Layer, TextProperties } from '../dsl/schema';
import { isDSLCompatibleParticleExpression } from '../common/particle-expression';
import { colorToHex, EPSILON } from '../common/utils';
import { TRANSFORM_FALLBACK, translateDSLPosition, withPositionZ } from '../common/transform';
import { getIRTextOrigin } from '../common/text-layout';
import type { IRToDSLLayerMapping } from './types';
import { convertIRParticleToDSL } from './convert-particle';

const LINEAR_EASING: [number, number, number, number] = [0, 0, 1, 1];

export interface IRLayerConversionResult {
  dslLayerByIRId: Map<string, Layer>;
  layerMapping: IRToDSLLayerMapping;
  diagnostics: ConversionDiagnostic[];
}

export function convertIRLayersToDSL(
  baselineComposition: IRComposition,
  assets: IRAsset[],
  frameRate: number,
): IRLayerConversionResult {
  const layerMapping: IRToDSLLayerMapping = { layers: {} };
  const diagnostics: ConversionDiagnostic[] = [];
  const dslLayerByIRId = new Map<string, Layer>();
  const layerById = new Map(baselineComposition.layers.map(layer => [layer.id, layer]));
  const imageAssetById = new Map(
    assets.filter((asset): asset is IRImageAsset => asset.type === 'image').map(asset => [asset.id, asset] as const),
  );
  const fontAssetById = new Map(
    assets.filter((asset): asset is IRFontAsset => asset.type === 'font').map(asset => [asset.id, asset] as const),
  );

  for (const [layerIndex, layer] of baselineComposition.layers.entries()) {
    const layerId = layer.id;
    const layerPath = `$.compositions[id=${JSON.stringify(baselineComposition.id)}].layers[${layerIndex}]`;
    const convertedLayer = convertIRLayerToDSL(
      layer,
      layerId,
      imageAssetById,
      fontAssetById,
      frameRate,
      layerPath,
      diagnostics,
    );

    const parent = layer.parentId == null ? undefined : layerById.get(layer.parentId);

    if (parent?.type === 'text') {
      const [originX, originY] = getIRTextOrigin(parent);

      convertedLayer.position = translateDSLPosition(convertedLayer.position, [-originX, -originY]);
    }
    convertedLayer.position = withPositionZ(convertedLayer.position, layerIndex);

    // Define an own data property even for IDs such as __proto__.
    Object.defineProperty(layerMapping.layers, layerId, {
      value: { irCompositionId: baselineComposition.id, irLayerId: layer.id },
      enumerable: true, writable: true, configurable: true,
    });
    dslLayerByIRId.set(layer.id, convertedLayer);
    collectDiagnostics(layer, layerId, layerPath, diagnostics);
    if (convertedLayer.type === 'null' && isVisualLayerWithoutAsset(layer, convertedLayer.asset)) {
      diagnostics.push({
        code: 'LAYER_ASSET_NOT_MATERIALIZED',
        severity: 'warning',
        action: 'approximated',
        path: `${layerPath}.content.assetId`,
        sourceId: layerId,
        feature: 'asset',
        message: `Visual layer type '${layer.type}' has no materialized URL asset and was projected to DSL type=null; the baseline scene preserves the original visual data.`,
      });
    }
  }

  return {
    dslLayerByIRId,
    layerMapping,
    diagnostics,
  };
}

function convertIRLayerToDSL(
  layer: IRLayer,
  layerId: string,
  imageAssetById: ReadonlyMap<string, IRImageAsset>,
  fontAssetById: ReadonlyMap<string, IRFontAsset>,
  frameRate: number,
  layerPath: string,
  diagnostics: ConversionDiagnostic[],
): Layer {
  const size = resolveLayerSize(layer);
  const asset = convertIRAssetToDSL(layer, imageAssetById);
  const layerType = mapLayerType(layer, asset);
  const parentId = layer.parentId ?? null;
  const [originX, originY] = getIRTextOrigin(layer);
  const anchor = layer.transform?.anchor?.value ?? TRANSFORM_FALLBACK.anchor;
  const convertedLayer: Omit<Layer, 'type'> = {
    id: layerId,
    name: layer.name ?? layer.id,
    width: size.width,
    height: size.height,
    description: {
      self: layer.name ?? layer.id,
      composite: '',
    },
    parent: parentId,
    time_range: [layer.time.inFrame / frameRate, layer.time.outFrame / frameRate],
    position: convertIRVec3PropertyToDSL(layer.transform?.position, TRANSFORM_FALLBACK.position, frameRate, true),
    rotation: convertIRLayerRotationToDSL(layer, frameRate, layerPath, diagnostics),
    scale: convertIRVec3PropertyToDSL(layer.transform?.scale, TRANSFORM_FALLBACK.scale, frameRate, false),
    anchor: { a: false, value: [anchor[0] - originX, anchor[1] - originY, anchor[2]] },
    opacity: convertIRNumberPropertyToDSL(layer.transform?.opacity, TRANSFORM_FALLBACK.opacity, frameRate),
    children: [],
  };

  if (layerType === 'layer' && asset != null) {
    return { ...convertedLayer, type: 'layer', asset };
  }
  if (layer.type === 'text') {
    return { ...convertedLayer, type: 'text', text: convertIRTextToDSL(layer, fontAssetById) };
  }
  if (layer.type === 'particle') {
    return { ...convertedLayer, type: 'particle',
      particle: convertIRParticleToDSL(layer, frameRate, layerPath, diagnostics) };
  }

  return { ...convertedLayer, type: 'null' };
}

function mapLayerType(layer: IRLayer, asset: Asset | undefined): Layer['type'] {
  if (layer.type === 'particle') {
    return 'particle';
  }
  if (layer.type === 'text') {
    return 'text';
  }

  if (layer.type === 'null' || layer.type === 'precomp') {
    return 'null';
  }

  return asset != null ? 'layer' : 'null';
}

function isVisualLayerWithoutAsset(layer: IRLayer, asset: Asset | undefined): boolean {
  return layer.type !== 'null' && layer.type !== 'precomp' && layer.type !== 'text' &&
    layer.type !== 'particle' && asset == null;
}

function resolveLayerSize(layer: IRLayer): { width: number; height: number } {
  if (layer.localBounds != null) {
    const { width, height } = layer.localBounds;

    return { width, height };
  }

  return { width: 0, height: 0 };
}

function convertIRAssetToDSL(
  layer: IRLayer,
  imageAssetById: ReadonlyMap<string, IRImageAsset>,
): Asset | undefined {
  if (layer.type !== 'image') {
    return undefined;
  }

  const imageAsset = imageAssetById.get(layer.content.assetId);

  if (imageAsset == null) {
    return undefined;
  }

  return {
    url: getIRResourceSourceUrl(imageAsset.source),
    source: 'user',
    prompt: '',
  };
}

function convertIRTextToDSL(
  layer: IRTextLayer,
  fontAssetById: ReadonlyMap<string, IRFontAsset>,
): TextProperties {
  const text = layer.content;
  const fontAsset = fontAssetById.get(text.fontAssetId);

  if (fontAsset == null) {
    throw new TypeError(`[dsl-ir] Text layer '${layer.id}' references a missing Font Asset: ${text.fontAssetId}`);
  }

  return {
    content: text.text,
    font: fontAsset.family,
    size: text.fontSize,
    color: colorToHex(text.color),
    ...(text.textAlign != null && { align: text.textAlign }),
    line_height: text.lineHeight,
    ...(text.letterSpacing != null && { letter_spacing: text.letterSpacing }),
  };
}

function convertIRLayerRotationToDSL(
  layer: IRLayer,
  frameRate: number,
  path: string,
  diagnostics: ConversionDiagnostic[],
): AnimatedProperty<IRVec3> {
  const rotation = layer.transform?.rotation;

  if (rotation == null) {
    return convertIRVec3PropertyToDSL(undefined, TRANSFORM_FALLBACK.rotation, frameRate, false);
  }

  return convertIRRotationToDSL(rotation, frameRate, path, layer.id, diagnostics);
}

/**
 * Merge per-axis rotation into the DSL's 3D vector track.
 *
 * Aligned channels retain their shared easing. Independent axes fall back to
 * a union-of-keyframe-times projection.
 */
function convertIRRotationToDSL(
  rotation: NonNullable<NonNullable<IRLayer['transform']>['rotation']>,
  frameRate: number,
  path: string,
  layerId: string,
  diagnostics: ConversionDiagnostic[],
): AnimatedProperty<IRVec3> {
  const rotationChannels = [rotation.x, rotation.y, rotation.z] as const;
  const animatedChannels = rotationChannels.filter(
    (channel): channel is ScalarKeyframedProperty => channel?.type === 'keyframed',
  );

  if (animatedChannels.length === 0) {
    return {
      a: false,
      value: [readNumberStatic(rotation.x, 0), readNumberStatic(rotation.y, 0), readNumberStatic(rotation.z, 0)],
    };
  }

  if (isRotationChannelSetAligned(animatedChannels)) {
    const templateChannel = animatedChannels[0];
    const keyframes: IRKeyframe<IRVec3>[] = templateChannel.keyframes.map((keyframe, index) => {
      const hasEndValue = animatedChannels.some(channel => channel.keyframes[index]?.endValue != null);

      return {
        frame: keyframe.frame,
        value: readAlignedRotationValue(rotation, index),
        ...(hasEndValue && { endValue: readAlignedRotationEndValue(rotation, index) }),
        ...(keyframe.hold != null && { hold: keyframe.hold }),
        ...(keyframe.inTangent != null && { inTangent: keyframe.inTangent }),
        ...(keyframe.outTangent != null && { outTangent: keyframe.outTangent }),
      };
    });

    return convertIRKeyframesToDSLProperty(keyframes, TRANSFORM_FALLBACK.rotation, frameRate, false);
  }

  diagnostics.push({
    code: 'ROTATION_CHANNELS_APPROXIMATED', severity: 'warning', action: 'approximated',
    path: `${path}.transform.rotation`, sourceId: layerId,
    message: 'Independent rotation channels are sampled at their combined keyframe times with linear interpolation; ' +
      'the original curves remain in preserved data until rotation is edited.',
  });
  const keyframeFrameSet = new Set<number>();

  for (const channel of rotationChannels) {
    if (channel?.type === 'keyframed' && channel.keyframes != null) {
      for (const keyframe of channel.keyframes) {
        keyframeFrameSet.add(keyframe.frame);
      }
    }
  }

  // Keep Array.from: loose SWC array-spread lowering does not expand Set in dist.
  const sortedFrames = Array.from(keyframeFrameSet).sort((leftFrame, rightFrame) => leftFrame - rightFrame);
  const keyframes = sortedFrames.map((frame, index): IRKeyframe<IRVec3> => ({
    frame,
    value: [
      readNumberAtFrame(rotation.x, frame, 0),
      readNumberAtFrame(rotation.y, frame, 0),
      readNumberAtFrame(rotation.z, frame, 0),
    ],
    ...(index + 1 < sortedFrames.length && { endValue: [
      readNumberAtFrame(rotation.x, sortedFrames[index + 1], 0, true),
      readNumberAtFrame(rotation.y, sortedFrames[index + 1], 0, true),
      readNumberAtFrame(rotation.z, sortedFrames[index + 1], 0, true),
    ] }),
  }));

  return convertIRKeyframesToDSLProperty(keyframes, TRANSFORM_FALLBACK.rotation, frameRate, false);
}

type ScalarKeyframedProperty = Extract<IRAnimatedProperty<number>, { type: 'keyframed' }>;

function isRotationChannelSetAligned(rotationChannels: ScalarKeyframedProperty[]): boolean {
  const templateChannel = rotationChannels[0];

  return rotationChannels.every(
    channel =>
      channel.keyframes.length === templateChannel.keyframes.length &&
      channel.keyframes.every((keyframe, index) =>
        isRotationKeyframeAligned(keyframe, templateChannel.keyframes[index]),
      ),
  );
}

function isRotationKeyframeAligned(left: IRKeyframe<number>, right: IRKeyframe<number>): boolean {
  return (
    Math.abs(left.frame - right.frame) < EPSILON &&
    left.hold === right.hold &&
    isBezierHandleEqual(left.inTangent, right.inTangent) &&
    isBezierHandleEqual(left.outTangent, right.outTangent)
  );
}

function isBezierHandleEqual(left: IRKeyframe<number>['inTangent'], right: IRKeyframe<number>['inTangent']): boolean {
  if (left == null || right == null) {
    return left === right;
  }

  return Math.abs(left.x - right.x) < EPSILON && Math.abs(left.y - right.y) < EPSILON;
}

function readAlignedRotationValue(
  rotation: NonNullable<NonNullable<IRLayer['transform']>['rotation']>,
  index: number,
): IRVec3 {
  return [
    readAlignedAxisValue(rotation.x, index),
    readAlignedAxisValue(rotation.y, index),
    readAlignedAxisValue(rotation.z, index),
  ];
}

function readAlignedRotationEndValue(
  rotation: NonNullable<NonNullable<IRLayer['transform']>['rotation']>,
  index: number,
): IRVec3 {
  return [
    readAlignedAxisEndValue(rotation.x, index),
    readAlignedAxisEndValue(rotation.y, index),
    readAlignedAxisEndValue(rotation.z, index),
  ];
}

function readAlignedAxisValue(channel: IRAnimatedProperty<number> | undefined, index: number): number {
  return channel?.type === 'keyframed' ? (channel.keyframes[index]?.value ?? 0) : (channel?.value ?? 0);
}

function readAlignedAxisEndValue(channel: IRAnimatedProperty<number> | undefined, index: number): number {
  if (channel?.type !== 'keyframed') {
    return channel?.value ?? 0;
  }

  return (
    channel.keyframes[index]?.endValue ?? channel.keyframes[index + 1]?.value ?? channel.keyframes[index]?.value ?? 0
  );
}

function convertIRVec3PropertyToDSL(
  property: IRAnimatedProperty<IRVec3> | undefined,
  fallback: IRVec3,
  frameRate: number,
  includeSpatialTangents: boolean,
): AnimatedProperty<IRVec3> {
  if (property?.type === 'keyframed') {
    return convertIRKeyframesToDSLProperty(property.keyframes, fallback, frameRate, includeSpatialTangents);
  }

  return { a: false, value: property?.value != null ? [...property.value] : [...fallback] };
}

function convertIRNumberPropertyToDSL(
  property: IRAnimatedProperty<number> | undefined,
  fallback: number,
  frameRate: number,
): AnimatedProperty<number> {
  if (property?.type === 'keyframed') {
    return convertIRKeyframesToDSLProperty(property.keyframes, fallback, frameRate, false);
  }

  return { a: false, value: property?.value ?? fallback };
}

function convertIRKeyframesToDSLProperty(
  keyframes: IRKeyframe<IRVec3>[], fallback: IRVec3, frameRate: number, includeSpatialTangents: boolean,
): AnimatedProperty<IRVec3>;
function convertIRKeyframesToDSLProperty(
  keyframes: IRKeyframe<number>[], fallback: number, frameRate: number, includeSpatialTangents: boolean,
): AnimatedProperty<number>;
function convertIRKeyframesToDSLProperty(
  keyframes: IRKeyframe<number | IRVec3>[],
  fallback: number | IRVec3,
  frameRate: number,
  includeSpatialTangents: boolean,
): AnimatedProperty {
  if (keyframes.length < 2) {
    return {
      a: false,
      value: structuredClone(keyframes[0]?.value ?? fallback),
    };
  }

  const animation: AnimationCurve[] = [];

  for (let keyframeIndex = 0; keyframeIndex < keyframes.length - 1; keyframeIndex++) {
    const currentKeyframe = keyframes[keyframeIndex];
    const nextKeyframe = keyframes[keyframeIndex + 1];
    const endValue = currentKeyframe.endValue ?? nextKeyframe.value;
    const easing: [number, number, number, number] = [
      currentKeyframe.outTangent?.x ?? LINEAR_EASING[0],
      currentKeyframe.outTangent?.y ?? LINEAR_EASING[1],
      nextKeyframe.inTangent?.x ?? LINEAR_EASING[2],
      nextKeyframe.inTangent?.y ?? LINEAR_EASING[3],
    ];

    animation.push({
      t: [currentKeyframe.frame / frameRate, nextKeyframe.frame / frameRate],
      start: convertIRPropertyValueToArray(currentKeyframe.value),
      end: convertIRPropertyValueToArray(currentKeyframe.hold === true ? currentKeyframe.value : endValue),
      easing,
      ...(includeSpatialTangents &&
        currentKeyframe.spatialOut != null && {
          out: convertIRSpatialTangentToDSL(currentKeyframe.spatialOut),
        }),
      ...(includeSpatialTangents &&
        nextKeyframe.spatialIn != null && {
          in: convertIRSpatialTangentToDSL(nextKeyframe.spatialIn),
        }),
    });
  }

  return { a: true, animation };
}

function convertIRSpatialTangentToDSL(value: readonly number[]): [number, number, number] {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
}

function convertIRPropertyValueToArray(value: IRPropertyValue): number[] {
  return Array.isArray(value) ? [...value] : [value];
}

function readNumberStatic(property: IRAnimatedProperty<number> | undefined, fallback: number): number {
  if (property == null || property.type === 'keyframed') {
    return fallback;
  }

  return property.value ?? fallback;
}

function readNumberAtFrame(
  property: IRAnimatedProperty<number> | undefined,
  frame: number,
  fallback: number,
  beforeFrame = false,
): number {
  if (property == null) {
    return fallback;
  }
  if (property.type === 'static') {
    return property.value;
  }
  const keyframes = property.keyframes;
  const first = keyframes[0];

  if (frame <= first.frame) {
    return first.value;
  }
  for (let index = 0; index < keyframes.length - 1; index++) {
    const left = keyframes[index];
    const right = keyframes[index + 1];

    if (frame > right.frame || (frame === right.frame && !beforeFrame)) {
      continue;
    }
    if (left.hold === true) {
      return left.value;
    }
    const progress = (frame - left.frame) / (right.frame - left.frame);
    const out = left.outTangent ?? { x: 0, y: 0 };
    const incoming = right.inTangent ?? { x: 1, y: 1 };
    // Temporal Bezier X is time, so invert it before evaluating the value curve.
    let low = 0;
    let high = 1;

    for (let iteration = 0; iteration < 40; iteration++) {
      const mid = (low + high) / 2;

      if (cubicBezier(mid, out.x, incoming.x) < progress) {
        low = mid;
      } else {
        high = mid;
      }
    }
    const eased = out.x === out.y && incoming.x === incoming.y
      ? progress
      : cubicBezier((low + high) / 2, out.y, incoming.y);

    return left.value + ((left.endValue ?? right.value) - left.value) * eased;
  }

  return keyframes[keyframes.length - 1].value;
}

function cubicBezier(time: number, first: number, second: number): number {
  const inverse = 1 - time;

  return 3 * inverse * inverse * time * first + 3 * inverse * time * time * second + time * time * time;
}

function collectDiagnostics(
  layer: IRLayer,
  layerId: string,
  layerPath: string,
  diagnostics: ConversionDiagnostic[],
): void {
  const preservedFields: string[] = [];
  const unsupportedFeatures: string[] = [];

  collectPreservedField(preservedFields, layer.visible === false ? layer.visible : undefined, 'visible');
  collectPreservedField(
    preservedFields,
    layer.endBehavior != null && layer.endBehavior !== 'destroy' ? layer.endBehavior : undefined,
    'endBehavior',
  );
  collectPreservedField(preservedFields, layer.blendMode, 'blendMode');
  collectPreservedField(preservedFields, layer.masks, 'masks');
  collectPreservedField(preservedFields, layer.matte, 'matte');
  collectPreservedField(
    preservedFields,
    layer.localBounds != null && layer.localBounds.x !== 0 ? layer.localBounds.x : undefined,
    'localBounds.x',
  );
  collectPreservedField(
    preservedFields,
    layer.localBounds != null && layer.localBounds.y !== 0 ? layer.localBounds.y : undefined,
    'localBounds.y',
  );
  collectPreservedField(preservedFields, layer.type === 'shape' ? layer.content?.shapes : undefined, 'shapes');
  collectPreservedField(
    preservedFields,
    layer.type === 'solid' ? layer.content.color : undefined,
    'content.color',
  );
  if (layer.type === 'particle') {
    collectPreservedField(
      preservedFields,
      isDSLCompatibleParticleExpression(layer.content.startLifetime)
        ? undefined
        : layer.content.startLifetime,
      'content.startLifetime',
    );
    collectPreservedField(
      preservedFields,
      isDSLCompatibleParticleExpression(layer.content.emission.rateOverTime)
        ? undefined
        : layer.content.emission.rateOverTime,
      'content.emission.rateOverTime',
    );
  }

  if (layer.type === 'shape') {
    unsupportedFeatures.push('shape');
  }
  if (layer.type === 'solid') {
    unsupportedFeatures.push('solid');
  }
  if (layer.type === 'precomp') {
    unsupportedFeatures.push(layer.type);
  }
  if ((layer.masks?.length ?? 0) > 0 || layer.matte != null) {
    unsupportedFeatures.push('mask');
  }

  const uniquePreservedFields = Array.from(new Set(preservedFields));
  const uniqueUnsupportedFeatures = Array.from(new Set(unsupportedFeatures));

  if (uniqueUnsupportedFeatures.length > 0) {
    diagnostics.push({
      code: 'LAYER_HAS_UNSUPPORTED_FEATURES',
      severity: 'warning',
      action: 'unsupported',
      path: layerPath,
      sourceId: layerId,
      feature: uniqueUnsupportedFeatures.join(','),
      message: `Layer contains features outside the editable DSL surface: ${uniqueUnsupportedFeatures.join(', ')}`,
    });
  }

  if (uniquePreservedFields.length > 0) {
    diagnostics.push({
      code: 'LAYER_FIELDS_PRESERVED_IN_BASE_IR',
      severity: 'info',
      action: 'normalized',
      path: layerPath,
      sourceId: layerId,
      feature: uniquePreservedFields.join(','),
      message: `Fields preserved in baseline scene: ${uniquePreservedFields.join(', ')}`,
    });
  }
}

function collectPreservedField(preservedFields: string[], value: unknown, fieldName: string): void {
  if (value == null) {
    return;
  }

  if (Array.isArray(value) && value.length === 0) {
    return;
  }

  preservedFields.push(fieldName);
}
