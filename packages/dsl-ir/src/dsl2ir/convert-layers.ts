import { getLayerStackingOrder } from '../common/transform';
import type {
  IRImageAsset, IRFontAsset, IRLayer, IRLayerType,
  IRTextContent, IRAnimatedProperty, IRVec3,
} from '@galacean/animation-ir';
import { isIRId } from '@galacean/animation-ir/validator';
import type { Composition, Layer, ParticleProperties, TextProperties } from '../dsl/schema';
import { createId, hexToIRColor, resolveFiniteNumber, secondsToFrames } from '../common/utils';
import {
  convertDSLPropertyToIRNumber,
  convertDSLPropertyToIRRotation,
  convertDSLPropertyToIRVec3,
  convertDSLPropertyToStaticIRVec3,
} from './convert-property';
import { ensureSystemFontAsset, normalizeDSLFontFamily, resolveAssetSource, resolveTextStyle } from './content-conversion';
import { convertDSLParticleToIRContent } from './convert-particle';
import { estimateTextBounds, getTextLayoutOrigin } from '../common/text-layout';

interface LayerConversionContext {
  layerId: string;
  parentLayerId?: string;
  compositionDurationSeconds: number;
  frameRate: number;
}

interface FlattenedLayer {
  layer: Layer;
  nestedParentId: string | null;
}

/** Convert authored 2D DSL sibling groups to flat IR layers in bottom-to-top painter order. */
export function convertDSLLayersToIR(
  composition: Composition,
  imageAssets: IRImageAsset[] = [],
  fontAssets: IRFontAsset[] = [],
): IRLayer[] {
  const flattenedLayers = flattenLayersInRenderOrder(composition.layers);
  const irLayerIdByDSLId = new Map<string, string>();

  for (const { layer } of flattenedLayers) {
    if (!irLayerIdByDSLId.has(layer.id)) {
      irLayerIdByDSLId.set(layer.id, convertLayerIdToIR(layer.id));
    }
  }

  return flattenedLayers.map(({ layer, nestedParentId }) => {
    const parentId = layer.parent ?? nestedParentId;

    return convertLayerToIR(layer, {
      layerId: irLayerIdByDSLId.get(layer.id) ?? convertLayerIdToIR(layer.id),
      parentLayerId: parentId != null ? irLayerIdByDSLId.get(parentId) : undefined,
      compositionDurationSeconds: composition.meta.duration,
      frameRate: composition.meta.fps,
    }, imageAssets, fontAssets);
  });
}

function convertLayerToIR(
  layer: Layer,
  context: LayerConversionContext,
  imageAssets: IRImageAsset[],
  fontAssets: IRFontAsset[],
): IRLayer {
  const layerType = mapLayerType(layer.type);
  const imageAssetId = layerType === 'image' && layer.asset != null
    ? createId()
    : undefined;
  const textContent = layer.type === 'text' && layer.text != null
    ? convertTextData(layer.text, fontAssets)
    : undefined;
  const particleContent = layer.type === 'particle'
    ? convertDSLParticleToIRContent(requireParticleProperties(layer), context.frameRate)
    : undefined;

  if (imageAssetId != null && layer.asset != null) {
    imageAssets.push({
      id: imageAssetId,
      type: 'image',
      source: resolveAssetSource(layer.asset),
    });
  }

  const convertedLayer = {
    id: context.layerId,
    name: typeof layer.name === 'string' ? layer.name : layer.id,
    type: layerType,
    time: convertLayerTime(layer, context.compositionDurationSeconds, context.frameRate),
    ...(context.parentLayerId != null && {
      parentId: context.parentLayerId,
    }),
    visible: true,
    ...(imageAssetId != null && { content: { assetId: imageAssetId } }),
    ...(textContent != null && { content: textContent }),
    ...(particleContent != null && { content: particleContent }),
    transform: {
      position: convertDSLPositionToIR(layer.position, context.frameRate),
      rotation: convertDSLPropertyToIRRotation(layer.rotation, context.frameRate, [0, 0, 0]),
      scale: convertDSLPropertyToIRVec3(layer.scale, context.frameRate, [1, 1, 1]),
      anchor: convertDSLPropertyToStaticIRVec3(layer.anchor, [0, 0, 0]),
      opacity: convertDSLPropertyToIRNumber(layer.opacity, context.frameRate, 1),
    },
  } as IRLayer;

  if (textContent != null) {
    convertedLayer.localBounds = resolveTextLocalBounds(layer, textContent);
  } else if (layer.width > 0 && layer.height > 0) {
    convertedLayer.localBounds = { x: 0, y: 0, width: layer.width, height: layer.height };
  }

  return convertedLayer;
}

function convertDSLPositionToIR(position: Layer['position'], frameRate: number): IRAnimatedProperty<IRVec3> {
  const result = convertDSLPropertyToIRVec3(position, frameRate, [0, 0, 0], true);

  // Authored DSL uses Z for stacking; its pixel coordinates stay on the 2D plane.
  if (result.type === 'static') {
    result.value[2] = 0;
  } else {
    for (const keyframe of result.keyframes) {
      keyframe.value[2] = 0;
      if (keyframe.endValue != null) {
        keyframe.endValue[2] = 0;
      }
    }
  }

  return result;
}

function requireParticleProperties(layer: Layer): ParticleProperties {
  if (layer.particle == null) {
    throw new TypeError(`[dsl-ir] Particle layer '${layer.id}' requires particle data.`);
  }

  return layer.particle;
}

function resolveTextLocalBounds(layer: Layer, text: IRTextContent): NonNullable<IRLayer['localBounds']> {
  const estimatedBounds = estimateTextBounds(text);
  const width = Number.isFinite(layer.width) && layer.width > 0 ? layer.width : estimatedBounds.width;
  const [originX, originY] = getTextLayoutOrigin(text, width);

  return {
    x: 0 - originX,
    y: 0 - originY,
    width,
    height: Number.isFinite(layer.height) && layer.height > 0 ? layer.height : estimatedBounds.height,
  };
}

function convertLayerIdToIR(layerId: string): string {
  return isIRId(layerId) ? layerId : createId();
}

function flattenLayersInRenderOrder(
  layers: Layer[],
  nestedParentId: string | null = null,
  flattenedLayers: FlattenedLayer[] = [],
): FlattenedLayer[] {
  const orderedLayers = [...layers].sort((left, right) =>
    getLayerStackingOrder(left) - getLayerStackingOrder(right) || left.id.localeCompare(right.id),
  );

  for (const layer of orderedLayers) {
    flattenedLayers.push({ layer, nestedParentId });
    flattenLayersInRenderOrder(layer.children ?? [], layer.id, flattenedLayers);
  }

  return flattenedLayers;
}

function mapLayerType(type: Layer['type']): IRLayerType {
  switch (type) {
    case 'layer':
      return 'image';
    case 'text':
      return 'text';
    case 'null':
      return 'null';
    case 'particle':
      return 'particle';
  }
}

function convertLayerTime(layer: Layer, compositionDurationSeconds: number, frameRate: number): IRLayer['time'] {
  const startSeconds = resolveFiniteNumber(layer.time_range?.[0], 0);
  const endSeconds = resolveFiniteNumber(layer.time_range?.[1], compositionDurationSeconds);

  return {
    inFrame: secondsToFrames(startSeconds, frameRate),
    outFrame: secondsToFrames(endSeconds, frameRate),
  };
}

function convertTextData(text: TextProperties, fontAssets: IRFontAsset[]): IRTextContent {
  const style = resolveTextStyle(text);
  const fontFamily = normalizeDSLFontFamily(style.font);
  // DSL text cannot express style or weight, so new IR fonts use the canonical normal/400 defaults.
  const fontAssetId = ensureSystemFontAsset(fontAssets, fontFamily, 'normal', 400);
  const fontSize = text.size;

  return {
    text: text.content,
    fontAssetId,
    fontSize,
    color: hexToIRColor(style.color),
    letterSpacing: style.letter_spacing ?? 0,
    lineHeight: style.line_height ?? fontSize * 1.2,
    textAlign: style.align ?? 'left',
  };
}
