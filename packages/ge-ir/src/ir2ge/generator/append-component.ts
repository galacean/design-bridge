import type {
  IRAnimatedProperty, IRPropertyValue, IRColor, IRBezierPath, IRLayer,
  IRShape, IRShapeLayer, IRShapePaint, IRShapeStroke, IRTextLayer,
} from '@galacean/animation-ir';
import {
  IRPaintType, IRLineCap, IRLineJoin, IRShapePrimitiveType, IRTextureScaleMode,
} from '@galacean/animation-ir';
import { getIRResourceSourceUrl } from '@galacean/animation-ir/adapter';
import {
  DataType, type DataPath, FillType, LineCap, LineJoin,
  RenderMode, type RGBAColorValue, ShapePrimitiveType, type SplitParameter, TextAlignment,
  TextSizeMode, TextWeight, TexturePaintScaleMode, ValueType,
} from '@galacean/effects-specification';
import { toDataPath } from '../../common/data-path';
import { TEXT_WORLD_UNITS_PER_PIXEL } from '../../common/coordinate-mapping';
import { createId } from '../../common/id';
import { normalizeJSONValue } from '../../common/json-normalization';
import { roundNumber } from '../../common/math';
import { mapBlendModeToGE } from '../mapping';
import { getLayerLocalBounds } from '../converter/transform';
import type { ECSCollector, GeneratedComponentData, LayerGenerationContext } from '../types';
import type { EffectsLayerPreservedData, EffectsSpriteSplit } from '../../preserved-data';
import { appendParticleComponent } from './append-particle-component';
import { copyPreservedMaskToComponent, resolveComponentId, restoreComponentRenderData } from './component-preservation';

function registerTexture(
  collector: ECSCollector,
  imageUrl: string,
  cache: Map<string, DataPath>,
  preserved?: EffectsLayerPreservedData['spriteTexture'],
): DataPath {
  const cacheKey = JSON.stringify([imageUrl, preserved]);
  const cached = cache.get(cacheKey);

  if (cached != null) {
    return cached;
  }

  const imageId = createId();
  const textureId = createId();

  collector.images.push({ ...preserved?.image, id: imageId, url: imageUrl });
  collector.textures.push({
    flipY: true,
    ...preserved?.texture,
    id: textureId,
    dataType: DataType.Texture,
    source: toDataPath(imageId),
  });

  const dataPathRef = toDataPath(textureId);

  cache.set(cacheKey, dataPathRef);

  return dataPathRef;
}

export function appendComponent(
  layer: IRLayer,
  itemId: string,
  anchorScaleX: number,
  anchorScaleY: number,
  ctx: LayerGenerationContext,
): string | undefined {
  switch (layer.type) {
    case 'image':
    case 'solid':
      return appendSpriteComponent(layer, itemId, anchorScaleX, anchorScaleY, ctx);
    case 'text':
      return appendTextComponent(layer, itemId, anchorScaleX, anchorScaleY, ctx);
    case 'shape':
      return appendShapeComponent(layer, itemId, ctx);
    case 'particle':
      return appendParticleComponent(layer, itemId, anchorScaleX, anchorScaleY, ctx);
    default:
      return undefined;
  }
}

function appendSpriteComponent(
  layer: IRLayer,
  itemId: string,
  anchorScaleX: number,
  anchorScaleY: number,
  ctx: LayerGenerationContext,
): string {
  const componentId = resolveComponentId(layer, ctx);
  const blending = mapBlendModeToGE(layer.blendMode);
  const layerData = ctx.layerDataById[layer.id];
  const spriteSplits = layerData?.spriteSplits;
  const splits = spriteSplits?.map(copySpriteSplit);
  const textureSheetAnimation = layerData?.textureSheetAnimation;
  const normalizedColor = layer.type === 'solid' ? layer.content.color : layerData?.spriteStartColor;
  const startColor: RGBAColorValue =
    normalizedColor != null
      ? [
          roundNumber(normalizedColor[0], 4),
          roundNumber(normalizedColor[1], 4),
          roundNumber(normalizedColor[2], 4),
          roundNumber(normalizedColor[3], 4),
        ]
      : [1, 1, 1, 1];

  let textureDataPath: DataPath | undefined;

  const imageAsset = layer.type === 'image' ? ctx.imageAssetById.get(layer.content.assetId) : undefined;
  const textureUrl = imageAsset == null ? undefined : getIRResourceSourceUrl(imageAsset.source);

  if (textureUrl != null && textureUrl !== '' && textureUrl !== 'mask://placeholder') {
    textureDataPath = registerTexture(ctx.collector, textureUrl, ctx.textureCache, layerData?.spriteTexture);
  }

  const component: GeneratedComponentData = {
    id: componentId,
    dataType: DataType.SpriteComponent,
    item: toDataPath(itemId),
    options: { startColor },
    ...(splits != null && { splits }),
    ...(textureSheetAnimation != null && {
      textureSheetAnimation: normalizeJSONValue(textureSheetAnimation),
    }),
    renderer: {
      renderMode: RenderMode.MESH,
      ...(blending !== undefined && { blending }),
      ...(textureDataPath != null && { texture: textureDataPath }),
    },
  };

  const isNonDefaultAnchor = Math.abs(anchorScaleX - 0.5) > 0.001 || Math.abs(anchorScaleY - 0.5) > 0.001;

  if (isNonDefaultAnchor) {
    (component['renderer'] as Record<string, unknown>)['anchor'] = [
      roundNumber(anchorScaleX, 4),
      roundNumber(anchorScaleY, 4),
    ];
  }

  copyPreservedMaskToComponent(layer, component, ctx);
  restoreComponentRenderData(layer, component, ctx);
  ctx.collector.components.push(component);

  return componentId;
}

function copySpriteSplit(split: EffectsSpriteSplit): SplitParameter {
  return [split[0], split[1], split[2], split[3], split[4]];
}

function appendTextComponent(
  layer: IRTextLayer,
  itemId: string,
  anchorScaleX: number,
  anchorScaleY: number,
  ctx: LayerGenerationContext,
): string {
  const textInfo = layer.content;
  const fontAsset = ctx.fontAssetById.get(textInfo.fontAssetId);

  if (fontAsset == null) {
    throw new TypeError(`[ge-ir] Text layer '${layer.id}' references a missing Font Asset: ${textInfo.fontAssetId}`);
  }

  const componentId = resolveComponentId(layer, ctx);
  const blending = mapBlendModeToGE(layer.blendMode);
  const textureSheetAnimation = ctx.layerDataById[layer.id]?.textureSheetAnimation;
  const textColor: RGBAColorValue = [
    roundNumber(textInfo.color[0], 4),
    roundNumber(textInfo.color[1], 4),
    roundNumber(textInfo.color[2], 4),
    textInfo.color[3],
  ];
  const { width: layerWidth, height: layerHeight } = getLayerLocalBounds(layer);
  const textWidth = layerWidth;
  const textHeight = Math.max(layerHeight, textInfo.lineHeight);
  const textSizeW = roundNumber(TEXT_WORLD_UNITS_PER_PIXEL * layerWidth, 4);
  const textSizeH = roundNumber(TEXT_WORLD_UNITS_PER_PIXEL * layerHeight, 4);
  const textSizeMode = ctx.layerDataById[layer.id]?.textSizeMode ?? 'fixed';

  const component: GeneratedComponentData = {
    id: componentId,
    dataType: DataType.TextComponent,
    item: toDataPath(itemId),
    options: {
      text: textInfo.text,
      fontSize: textInfo.fontSize,
      textColor,
      fontFamily: fontAsset.family,
      fontWeight: mapFontWeightToGE(fontAsset.weight),
      textAlign:
        textInfo.textAlign === 'center'
          ? TextAlignment.middle
          : textInfo.textAlign === 'right'
            ? TextAlignment.right
            : TextAlignment.left,
      fontStyle: fontAsset.style,
      letterSpace: textInfo.letterSpacing,
      lineHeight: textInfo.lineHeight,
      textWidth,
      textHeight,
      ...mapTextSizeModeToGE(textSizeMode),
      size: [textSizeW, textSizeH],
    },
    ...(textureSheetAnimation != null && {
      textureSheetAnimation: normalizeJSONValue(textureSheetAnimation),
    }),
    renderer: {
      renderMode: RenderMode.MESH,
      anchor: [anchorScaleX, anchorScaleY],
      ...(blending !== undefined && { blending }),
    },
  };

  copyPreservedMaskToComponent(layer, component, ctx);
  restoreComponentRenderData(layer, component, ctx);
  ctx.collector.components.push(component);

  return componentId;
}

function mapTextSizeModeToGE(sizeMode: NonNullable<EffectsLayerPreservedData['textSizeMode']>): Record<string, unknown> {
  switch (sizeMode) {
    case 'auto-width':
      return { autoResize: TextSizeMode.autoWidth };
    case 'auto-height':
      return { autoResize: TextSizeMode.autoHeight };
    case 'fixed':
      return { autoResize: TextSizeMode.fixed };
  }
}

function mapFontWeightToGE(weight: number): TextWeight | number {
  if (weight === 400) {
    return TextWeight.normal;
  }
  if (weight === 700) {
    return TextWeight.bold;
  }
  if (weight === 300) {
    return TextWeight.lighter;
  }

  return weight;
}

function appendShapeComponent(layer: IRShapeLayer, itemId: string, ctx: LayerGenerationContext): string | undefined {
  const shapeData = layer.content?.shapes[0];

  if (shapeData == null) {
    return undefined;
  }

  const componentId = resolveComponentId(layer, ctx);
  const blending = mapBlendModeToGE(layer.blendMode);

  const component: GeneratedComponentData = {
    id: componentId,
    dataType: DataType.ShapeComponent,
    item: toDataPath(itemId),
    ...buildShapeOptions(shapeData, ctx.ratio, ctx),
    renderer: {
      renderMode: RenderMode.MESH,
      ...(blending !== undefined && { blending }),
    },
  };

  copyPreservedMaskToComponent(layer, component, ctx);
  restoreComponentRenderData(layer, component, ctx);
  ctx.collector.components.push(component);

  return componentId;
}

export function readStaticShapeProperty<T extends IRPropertyValue>(property: IRAnimatedProperty<T>): T {
  if (property.type !== 'static') {
    throw new TypeError('[ge-ir:ir2ge] Animated shape geometry and paints are not supported yet.');
  }

  return property.value;
}

export function buildShapeOptions(
  shapeData: IRShape,
  ratio: number,
  ctx?: LayerGenerationContext,
  renderStyle?: ShapeRenderStyle,
): Record<string, unknown> {
  const options: Record<string, unknown> = {
    type: mapShapePrimitiveType(shapeData.primitiveType),
  };

  switch (shapeData.primitiveType) {
    case IRShapePrimitiveType.Custom:
      Object.assign(options, mapCustomPaths(readStaticShapeProperty(shapeData.customPaths), ratio));

      break;
    case IRShapePrimitiveType.Rectangle:
      options['width'] = roundNumber(readStaticShapeProperty(shapeData.width) * ratio, 4);
      options['height'] = roundNumber(readStaticShapeProperty(shapeData.height) * ratio, 4);
      options['roundness'] = mapRectangleCornerRadiusToGERoundness(shapeData);

      break;
    case IRShapePrimitiveType.Ellipse:
      options['xRadius'] = roundNumber(readStaticShapeProperty(shapeData.xRadius) * ratio, 4);
      options['yRadius'] = roundNumber(readStaticShapeProperty(shapeData.yRadius) * ratio, 4);

      break;
    case IRShapePrimitiveType.Polygon:
      options['pointCount'] = shapeData.pointCount;
      options['radius'] = roundNumber(readStaticShapeProperty(shapeData.radius) * ratio, 4);
      options['roundness'] = shapeData.roundness == null ? 0 : readStaticShapeProperty(shapeData.roundness);

      break;
    case IRShapePrimitiveType.Star:
      options['pointCount'] = shapeData.pointCount;
      options['innerRadius'] = roundNumber(readStaticShapeProperty(shapeData.innerRadius) * ratio, 4);
      options['outerRadius'] = roundNumber(readStaticShapeProperty(shapeData.outerRadius) * ratio, 4);
      options['innerRoundness'] = shapeData.innerRoundness == null ? 0 : readStaticShapeProperty(shapeData.innerRoundness);
      options['outerRoundness'] = shapeData.outerRoundness == null ? 0 : readStaticShapeProperty(shapeData.outerRoundness);

      break;
  }

  const fills = renderStyle?.fills ?? shapeData.fills;
  const strokes = renderStyle?.strokes ?? shapeData.strokes;

  if (fills.length > 0) {
    options['fills'] = fills
      .map(fill => mapShapePaint(fill, ratio, ctx))
      .filter((fill): fill is Record<string, unknown> => fill != null);
  } else {
    options['fills'] = [];
  }
  if (strokes.length > 0) {
    options['strokes'] = strokes
      .map(stroke => mapShapePaint(stroke.paint, ratio, ctx))
      .filter((stroke): stroke is Record<string, unknown> => stroke != null);
  } else {
    options['strokes'] = [];
  }
  const strokeStyle = strokes[0];

  if (strokeStyle != null) {
    options['strokeWidth'] = roundNumber(readStaticShapeProperty(strokeStyle.width) * ratio, 4);
    options['strokeCap'] = mapLineCap(strokeStyle.cap);
    options['strokeJoin'] = mapLineJoin(strokeStyle.join);
  }

  return options;
}

export interface ShapeRenderStyle {
  fills: IRShapePaint[];
  strokes: IRShapeStroke[];
}

/** Split only when GE's component-level stroke geometry would lose an authored style. */
export function buildShapeRenderStyles(shape: IRShape): ShapeRenderStyle[] {
  const styles: ShapeRenderStyle[] = [];

  for (const stroke of shape.strokes) {
    const previous = styles[styles.length - 1];

    if (previous != null && previous.strokes.length > 0 && hasSameStrokeGeometry(previous.strokes[0], stroke)) {
      previous.strokes.push(stroke);
    } else {
      styles.push({ fills: styles.length === 0 ? shape.fills : [], strokes: [stroke] });
    }
  }

  return styles.length > 0 ? styles : [{ fills: shape.fills, strokes: [] }];
}

function hasSameStrokeGeometry(left: IRShapeStroke, right: IRShapeStroke): boolean {
  return readStaticShapeProperty(left.width) === readStaticShapeProperty(right.width) &&
    left.cap === right.cap && left.join === right.join;
}

function mapRectangleCornerRadiusToGERoundness(shape: Extract<IRShape, { primitiveType: 'rectangle' }>): number {
  const maxRadius = Math.min(readStaticShapeProperty(shape.width), readStaticShapeProperty(shape.height)) / 2;

  if (maxRadius <= 0 || shape.cornerRadius == null) {
    return 0;
  }

  return roundNumber(Math.min(Math.max(readStaticShapeProperty(shape.cornerRadius) / maxRadius, 0), 1) * 100, 4);
}

const SHAPE_PRIMITIVE_TYPE_TO_GE: Record<IRShape['primitiveType'], ShapePrimitiveType> = {
  [IRShapePrimitiveType.Custom]: ShapePrimitiveType.Custom,
  [IRShapePrimitiveType.Rectangle]: ShapePrimitiveType.Rectangle,
  [IRShapePrimitiveType.Ellipse]: ShapePrimitiveType.Ellipse,
  [IRShapePrimitiveType.Polygon]: ShapePrimitiveType.Polygon,
  [IRShapePrimitiveType.Star]: ShapePrimitiveType.Star,
};

const FILL_TYPE_TO_GE: Record<IRShapePaint['type'], FillType> = {
  [IRPaintType.Solid]: FillType.Solid,
  [IRPaintType.LinearGradient]: FillType.GradientLinear,
  [IRPaintType.RadialGradient]: FillType.GradientRadial,
  [IRPaintType.AngularGradient]: FillType.GradientAngular,
  [IRPaintType.Texture]: FillType.Texture,
};

const TEXTURE_SCALE_MODE_TO_GE: Record<IRTextureScaleMode, TexturePaintScaleMode> = {
  [IRTextureScaleMode.Fill]: TexturePaintScaleMode.Fill,
  [IRTextureScaleMode.Fit]: TexturePaintScaleMode.Fit,
  [IRTextureScaleMode.Crop]: TexturePaintScaleMode.Crop,
  [IRTextureScaleMode.Tile]: TexturePaintScaleMode.Tile,
};

const LINE_CAP_TO_GE: Record<string, LineCap> = {
  [IRLineCap.Butt]: LineCap.Butt,
  [IRLineCap.Round]: LineCap.Round,
  [IRLineCap.Square]: LineCap.Square,
};

const LINE_JOIN_TO_GE: Record<string, LineJoin> = {
  [IRLineJoin.Round]: LineJoin.Round,
  [IRLineJoin.Bevel]: LineJoin.Bevel,
  [IRLineJoin.Miter]: LineJoin.Miter,
};

function mapShapePrimitiveType(primitiveType: IRShape['primitiveType']): ShapePrimitiveType {
  return SHAPE_PRIMITIVE_TYPE_TO_GE[primitiveType];
}

function mapLineCap(lineCap: string): LineCap {
  return LINE_CAP_TO_GE[lineCap] ?? LineCap.Butt;
}

function mapLineJoin(lineJoin: string): LineJoin {
  return LINE_JOIN_TO_GE[lineJoin] ?? LineJoin.Miter;
}

function mapShapePaint(
  paint: IRShapePaint,
  ratio: number,
  ctx: LayerGenerationContext | undefined,
): Record<string, unknown> | undefined {
  const opacity = paint.opacity == null ? 1 : readStaticShapeProperty(paint.opacity);

  if (paint.type === IRPaintType.Solid) {
    const color = readStaticShapeProperty(paint.color);

    return {
      type: FILL_TYPE_TO_GE[paint.type],
      color: colorToGE([color[0], color[1], color[2], color[3] * opacity]),
    };
  }

  if (
    paint.type === IRPaintType.LinearGradient ||
    paint.type === IRPaintType.RadialGradient ||
    paint.type === IRPaintType.AngularGradient
  ) {
    return {
      type: FILL_TYPE_TO_GE[paint.type],
      gradientStops: [ValueType.GRADIENT_COLOR, readStaticShapeProperty(paint.gradientStops).map(stop => [
        stop[0], stop[1], stop[2], stop[3], stop[4] * opacity,
      ])],
      startPoint: vec2ToGE(readStaticShapeProperty(paint.gradientStart), ratio),
      endPoint: vec2ToGE(readStaticShapeProperty(paint.gradientEnd), ratio),
    };
  }

  if (paint.type === IRPaintType.Texture) {
    const imageAsset = ctx?.imageAssetById.get(paint.assetId);
    const textureUrl = imageAsset == null ? undefined : getIRResourceSourceUrl(imageAsset.source);
    const texture =
      textureUrl != null && ctx != null ? registerTexture(ctx.collector, textureUrl, ctx.textureCache) : undefined;

    return {
      type: FILL_TYPE_TO_GE[paint.type],
      ...(texture != null && { texture }),
      ...(opacity !== 1 && { opacity }),
      scaleMode: TEXTURE_SCALE_MODE_TO_GE[paint.scaleMode ?? IRTextureScaleMode.Fill],
    };
  }

  return undefined;
}

function colorToGE(color: IRColor): { r: number; g: number; b: number; a: number } {
  return {
    r: roundNumber(color[0], 4),
    g: roundNumber(color[1], 4),
    b: roundNumber(color[2], 4),
    a: roundNumber(color[3], 4),
  };
}

function vec2ToGE(value: [number, number], ratio: number): { x: number; y: number } {
  return {
    x: roundNumber(value[0] * ratio, 4),
    y: roundNumber(-value[1] * ratio, 4),
  };
}

function mapCustomPaths(paths: IRBezierPath[], ratio: number): Record<string, unknown> {
  const points: Array<{ x: number; y: number }> = [];
  const easingIns: Array<{ x: number; y: number }> = [];
  const easingOuts: Array<{ x: number; y: number }> = [];
  const shapes: Array<{
    close: boolean;
    indexes: Array<{ point: number; easingIn: number; easingOut: number }>;
  }> = [];

  for (const path of paths) {
    const indexes: Array<{ point: number; easingIn: number; easingOut: number }> = [];

    for (let index = 0; index < path.points.length; index++) {
      const point = path.points[index];
      const easingIn = path.inTangents[index];
      const easingOut = path.outTangents[index];
      const pointIndex = points.length;

      points.push({
        x: roundNumber(point.x * ratio, 4),
        y: roundNumber(-point.y * ratio, 4),
      });
      easingIns.push({
        x: roundNumber((easingIn?.x ?? 0) * ratio, 4),
        y: roundNumber(-(easingIn?.y ?? 0) * ratio, 4),
      });
      easingOuts.push({
        x: roundNumber((easingOut?.x ?? 0) * ratio, 4),
        y: roundNumber(-(easingOut?.y ?? 0) * ratio, 4),
      });
      indexes.push({ point: pointIndex, easingIn: pointIndex, easingOut: pointIndex });
    }

    shapes.push({ close: path.closed, indexes });
  }

  return { points, easingIns, easingOuts, shapes };
}
