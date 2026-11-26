import type {
  IRBlendMode, IRColor, IRBezierPath, IRStaticProperty,
  IRFontAsset, IRLocalBounds, IRParticleContent, IRShape, IRShapePaint, IRShapeStyle, IRTextContent,
} from '@galacean/animation-ir';
import { IRPaintType, IRLineCap, IRLineJoin, IRShapePrimitiveType, IRTextureScaleMode } from '@galacean/animation-ir';
import {
  createIRResourceSource, resolveIRResourceUrl,
} from '@galacean/animation-ir/adapter';
import { isIRId } from '@galacean/animation-ir/validator';
import {
  DataType, type DataPath, FillType, LineCap, LineJoin,
  ItemType, ShapePrimitiveType, TextAlignment, TextSizeMode, TexturePaintScaleMode,
} from '@galacean/effects-specification';
import { resolveDataPath, resolveDataPathId } from '../../common/data-path';
import { createId } from '../../common/id';
import { isRecord, normalizeJSONValue } from '../../common/json-normalization';
import { mapBlendModeToIR } from '../mapping';
import type { GESceneContext } from '../types';
import type {
  EffectsLayerPreservedData, EffectsSpriteSplit, EffectsTextSizeMode, EffectsTextureSheetAnimation,
} from '../../preserved-data';
import { parseParticleComponent } from './parse-particle-component';

interface ParsedComponentData {
  type: 'image' | 'solid' | 'text' | 'shape' | 'particle';
  imageAssetId?: string;
  spriteStartColor?: IRColor;
  text?: IRTextContent;
  textBounds?: IRLocalBounds;
  shapes?: IRShape[];
  blendMode?: IRBlendMode;
  anchorScale?: [number, number];
  spriteSplits?: EffectsSpriteSplit[];
  spriteTexture?: EffectsLayerPreservedData['spriteTexture'];
  textureSheetAnimation?: EffectsTextureSheetAnimation;
  textSizeMode?: EffectsTextSizeMode;
  /** Source identity used to remap cross-component references. */
  GEComponentId?: string;
  /** Preserved for source and target reconstruction. */
  rawMask?: Record<string, unknown>;
  particle?: IRParticleContent;
  rawParticleContent?: Record<string, unknown>;
}

export function parseComponent(item: Record<string, unknown>, ctx: GESceneContext): ParsedComponentData | undefined {
  const componentRefs = item['components'] as DataPath[] | undefined;

  if (componentRefs == null || componentRefs.length === 0) {
    return undefined;
  }
  const componentIds = componentRefs.map(resolveDataPathId).filter((id): id is string => id != null);
  // A declared Particle Item may list auxiliary render components before its ParticleSystem.
  const orderedComponentIds = item['type'] === ItemType.particle
    ? [
        ...componentIds.filter(componentId => ctx.componentById.get(componentId)?.['dataType'] === DataType.ParticleSystem),
        ...componentIds.filter(componentId => ctx.componentById.get(componentId)?.['dataType'] !== DataType.ParticleSystem),
      ]
    : componentIds;

  for (const componentId of orderedComponentIds) {
    const component = ctx.componentById.get(componentId);

    if (component == null) {
      continue;
    }

    const dataType = component['dataType'] as DataType;
    let result: ParsedComponentData | undefined;

    if (dataType === DataType.SpriteComponent) {
      result = parseSpriteComponent(component, ctx);
    } else if (dataType === DataType.TextComponent) {
      result = parseTextComponent(component, ctx);
    } else if (dataType === DataType.ShapeComponent) {
      result = parseShapeComponent(component, ctx);
    } else if (dataType === DataType.ParticleSystem) {
      const parsedParticle = parseParticleComponent(component, ctx.frameRate);

      if (parsedParticle != null) {
        const { normalizedBurstRuntimeDefaults, ...particleData } = parsedParticle;

        result = {
          type: 'particle',
          ...particleData,
          ...parseRendererLayerProperties(component['renderer'], [0, 0]),
        };
        if (normalizedBurstRuntimeDefaults) {
          ctx.diagnostics.push({
            code: 'GE_PARTICLE_BURST_RUNTIME_DEFAULTS_NORMALIZED',
            severity: 'info',
            action: 'normalized',
            path: `$.components[id=${JSON.stringify(componentId)}].emission.bursts`,
            sourceId: componentId,
            feature: 'particle-bursts',
            message: 'GE burst cycles or interval used zero/omitted runtime defaults and were made explicit in IR.',
          });
        }
      }
    }

    if (result == null) {
      continue;
    }

    if (dataType === DataType.SpriteComponent || dataType === DataType.TextComponent) {
      result.textureSheetAnimation = parseTextureSheetAnimation(component['textureSheetAnimation']);
    }
    if (result.type === 'image') {
      result.spriteTexture = parseSpriteTexture(component['renderer'], ctx);
    }
    result.GEComponentId = component['id'] as string;

    const mask = component['mask'];

    if (isRecord(mask)) {
      result.rawMask = mask;
      // Normalize the legacy single-mask contract before IR parsing and preserved-data export.
      if (mask['references'] == null && isRecord(mask['reference'])) {
        const { reference, inverted, ...remaining } = mask;

        result.rawMask = {
          ...remaining,
          isMask: mask['isMask'] ?? false,
          alphaMaskEnabled: mask['alphaMaskEnabled'] ?? false,
          references: [{ mask: reference, inverted: inverted ?? false }],
        };
      }
    }

    return result;
  }

  return undefined;
}

function parseSpriteComponent(component: Record<string, unknown>, ctx: GESceneContext): ParsedComponentData {
  const renderer = component['renderer'] as Record<string, unknown> | undefined;
  const options = component['options'] as Record<string, unknown> | undefined;

  let imageAssetId: string | undefined;
  let spriteStartColor: IRColor | undefined;
  const spriteSplits = parseSpriteSplits(component['splits']);
  const rendererLayerProperties = parseRendererLayerProperties(renderer);

  if (renderer != null) {
    imageAssetId = resolveImageAssetIdFromTexture(renderer['texture'], ctx);
  }

  if (options != null) {
    const startColor = options['startColor'] as number[] | undefined;

    if (startColor != null && startColor.length >= 4) {
      const isWhite =
        Math.abs(startColor[0] - 1) < 1e-4 &&
        Math.abs(startColor[1] - 1) < 1e-4 &&
        Math.abs(startColor[2] - 1) < 1e-4 &&
        Math.abs(startColor[3] - 1) < 1e-4;

      if (!isWhite) {
        spriteStartColor = [startColor[0], startColor[1], startColor[2], startColor[3]];
      }
    }
  }

  const type = imageAssetId != null ? ('image' as const) : ('solid' as const);

  return {
    type,
    imageAssetId,
    spriteStartColor,
    ...rendererLayerProperties,
    spriteSplits,
  };
}

function parseRendererLayerProperties(
  value: unknown,
  defaultAnchorScale?: [number, number],
): Pick<ParsedComponentData, 'blendMode' | 'anchorScale'> {
  if (!isRecord(value)) {
    return defaultAnchorScale == null ? {} : { anchorScale: defaultAnchorScale };
  }

  const blending = value['blending'];
  const blendMode = typeof blending === 'number' && Number.isFinite(blending)
    ? mapBlendModeToIR(blending)
    : undefined;
  const anchor = value['anchor'];
  const anchorScale = Array.isArray(anchor) && anchor.length >= 2 &&
    typeof anchor[0] === 'number' && Number.isFinite(anchor[0]) &&
    typeof anchor[1] === 'number' && Number.isFinite(anchor[1])
    ? [anchor[0], anchor[1]] satisfies [number, number]
    : defaultAnchorScale;

  return {
    ...(blendMode != null && { blendMode }),
    ...(anchorScale != null && { anchorScale }),
  };
}

function parseSpriteSplits(value: unknown): EffectsSpriteSplit[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const splits: EffectsSpriteSplit[] = [];

  for (const split of value) {
    if (!isSpriteSplit(split)) {
      return undefined;
    }
    splits.push([split[0], split[1], split[2], split[3], split[4]]);
  }

  return splits;
}

function isSpriteSplit(value: unknown): value is EffectsSpriteSplit {
  return (
    Array.isArray(value) &&
    value.length === 5 &&
    value.slice(0, 4).every(entry => typeof entry === 'number' && Number.isFinite(entry)) &&
    (value[4] === 0 || value[4] === 1)
  );
}

function parseTextureSheetAnimation(value: unknown): EffectsTextureSheetAnimation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const row = value['row'];
  const col = value['col'];
  const total = value['total'];
  const animate = value['animate'];
  const loop = value['loop'];

  if (
    !isPositiveSafeInteger(row) ||
    !isPositiveSafeInteger(col) ||
    (total !== undefined && !isPositiveSafeInteger(total)) ||
    typeof animate !== 'boolean' ||
    (loop !== undefined && typeof loop !== 'boolean')
  ) {
    return undefined;
  }

  return {
    ...normalizeJSONValue(value),
    row,
    col,
    ...(total !== undefined && { total }),
    animate,
    ...(loop !== undefined && { loop }),
  };
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseTextComponent(component: Record<string, unknown>, ctx: GESceneContext): ParsedComponentData {
  const options = component['options'] as Record<string, unknown> | undefined;
  const renderer = component['renderer'] as Record<string, unknown> | undefined;

  if (options == null) {
    return { type: 'text' };
  }

  const textColor = options['textColor'] as number[] | undefined;
  const color: IRColor =
    textColor != null && textColor.length >= 4
      ? [textColor[0], textColor[1], textColor[2], textColor[3]]
      : [0, 0, 0, 1];

  const textAlignCode = options['textAlign'] as number | undefined;
  const textAlign =
    textAlignCode === TextAlignment.middle ? 'center' : textAlignCode === TextAlignment.right ? 'right' : 'left';
  const fontFamily = (options['fontFamily'] as string) || 'sans-serif';
  const fontWeight = normalizeFontAssetWeight(options['fontWeight']);
  const fontStyle = normalizeFontAssetStyle(options['fontStyle']);
  const fontAssetId = registerFontAsset(ctx, fontFamily, fontStyle, fontWeight);
  const fontSize = readPositiveNumber(options['fontSize']) ?? 12;
  const lineHeight = readPositiveNumber(options['lineHeight']) ?? fontSize;
  const textWidth = readPositiveNumber(options['textWidth']);
  const textHeight = readPositiveNumber(options['textHeight']);

  const text: IRTextContent = {
    text: (options['text'] as string) ?? '',
    fontAssetId,
    fontSize,
    color,
    textAlign,
    letterSpacing: (options['letterSpace'] as number) ?? 0,
    lineHeight,
  };
  const textBounds =
    textWidth != null && textHeight != null
      ? { x: 0, y: 0, width: textWidth, height: textHeight }
      : undefined;

  let blendMode: IRBlendMode | undefined;
  let anchorScale: [number, number] | undefined;

  if (renderer != null) {
    blendMode = mapBlendModeToIR(renderer['blending'] as number | undefined);
    const anchor = renderer['anchor'] as [number, number] | undefined;

    if (anchor != null && Array.isArray(anchor) && anchor.length >= 2) {
      anchorScale = [anchor[0], anchor[1]];
    }
  }

  return {
    type: 'text',
    text,
    textBounds,
    blendMode,
    anchorScale,
    textSizeMode: parseTextSizeMode(options),
  };
}

function parseTextSizeMode(options: Record<string, unknown>): EffectsTextSizeMode {
  switch (options['autoResize']) {
    case TextSizeMode.autoWidth:
      return 'auto-width';
    case TextSizeMode.autoHeight:
      return 'auto-height';
    case TextSizeMode.fixed:
      return 'fixed';
  }

  return 'fixed';
}

function registerFontAsset(
  ctx: GESceneContext,
  family: string,
  style: IRFontAsset['style'],
  weight: number,
): string {
  const definition = ctx.fontDefinitionByFamily.get(family);
  const rawUrl = definition?.['fontURL'] ?? definition?.['url'];
  const source = typeof rawUrl === 'string' && rawUrl !== ''
    ? createIRResourceSource(resolveIRResourceUrl(rawUrl, ctx.resourceBaseUrl))
    : { kind: 'system' as const };
  const identity = JSON.stringify([family, style, weight, source]);
  const existingId = ctx.fontAssetIdByIdentity.get(identity);

  if (existingId != null) {
    return existingId;
  }
  const assetId = createId();

  ctx.fontAssetIdByIdentity.set(identity, assetId);
  ctx.fontAssetById.set(assetId, { id: assetId, type: 'font', family, style, weight, source });

  return assetId;
}

function normalizeFontAssetWeight(weight: unknown): number {
  if (typeof weight === 'number') {
    return Number.isInteger(weight) && weight >= 1 && weight <= 1000 ? weight : 400;
  }

  switch (weight) {
    case 'bold':
    case 'bolder':
      return 700;
    case 'lighter':
      return 300;
    default:
      return 400;
  }
}

function normalizeFontAssetStyle(style: unknown): IRFontAsset['style'] {
  return style === 'italic' || style === 'oblique' ? style : 'normal';
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseShapeComponent(component: Record<string, unknown>, ctx: GESceneContext): ParsedComponentData {
  const renderer = component['renderer'] as Record<string, unknown> | undefined;
  let blendMode: IRBlendMode | undefined;

  if (renderer != null) {
    blendMode = mapBlendModeToIR(renderer['blending'] as number | undefined);
  }

  const shapeData = parseShapeOptions(component, ctx);

  return {
    type: 'shape',
    shapes: shapeData != null ? [shapeData] : undefined,
    blendMode,
  };
}

function parseShapeOptions(component: Record<string, unknown>, ctx: GESceneContext): IRShape | undefined {
  const GEType = component['type'] as ShapePrimitiveType | undefined;
  const primitiveType = mapShapePrimitiveTypeToIR(GEType ?? ShapePrimitiveType.Custom);
  const style: IRShapeStyle = {
    position: { type: 'static', value: [0, 0] },
    fills: [],
    strokes: [],
  };

  const GEFills = component['fills'] as Record<string, unknown>[] | undefined;
  const sourceComponentId = typeof component['id'] === 'string' ? component['id'] : undefined;
  const componentPath = sourceComponentId == null
    ? '$.components[shape]'
    : `$.components[id=${JSON.stringify(sourceComponentId)}]`;

  if (GEFills != null) {
    style.fills = GEFills.map((fill, index) =>
      parseShapePaint(fill, ctx, `${componentPath}.fills[${index}]`, sourceComponentId),
    ).filter(
      (fill): fill is IRShapePaint => fill != null,
    );
  }

  const GEStrokes = component['strokes'] as Record<string, unknown>[] | undefined;
  const GEStrokeWidth = component['strokeWidth'];
  const strokeWidth = typeof GEStrokeWidth === 'number' && Number.isFinite(GEStrokeWidth) && GEStrokeWidth >= 0
    ? GEStrokeWidth / ctx.ratio
    : 1 / ctx.ratio;
  const strokeCap = mapLineCapToIR(
    typeof component['strokeCap'] === 'number' ? component['strokeCap'] : LineCap.Butt,
  );
  const strokeJoin = mapLineJoinToIR(
    typeof component['strokeJoin'] === 'number' ? component['strokeJoin'] : LineJoin.Miter,
  );

  if (GEStrokes != null) {
    style.strokes = GEStrokes.flatMap((stroke, index) => {
      const paint = parseShapePaint(
        stroke,
        ctx,
        `${componentPath}.strokes[${index}]`,
        sourceComponentId,
      );

      return paint == null ? [] : [{ paint, width: { type: 'static', value: strokeWidth }, cap: strokeCap, join: strokeJoin }];
    });
  }

  switch (primitiveType) {
    case IRShapePrimitiveType.Custom: {
      const customPaths = parseCustomPaths(component, ctx.ratio);
      const firstPath = customPaths[0];

      return firstPath != null
        ? { ...style, primitiveType, customPaths: { type: 'static', value: customPaths } }
        : undefined;
    }
    case IRShapePrimitiveType.Rectangle: {
      const width = readScaledNumber(component, 'width', ctx.ratio);
      const height = readScaledNumber(component, 'height', ctx.ratio);

      return width != null && height != null
        ? {
            ...style,
            primitiveType,
            width: { type: 'static', value: width },
            height: { type: 'static', value: height },
            ...readRectangleCornerRadius(component, width, height),
          }
        : undefined;
    }
    case IRShapePrimitiveType.Ellipse: {
      const xRadius = readScaledNumber(component, 'xRadius', ctx.ratio);
      const yRadius = readScaledNumber(component, 'yRadius', ctx.ratio);

      return xRadius != null && yRadius != null ? {
        ...style, primitiveType,
        xRadius: { type: 'static', value: xRadius }, yRadius: { type: 'static', value: yRadius },
      } : undefined;
    }
    case IRShapePrimitiveType.Polygon: {
      const pointCount = readPointCount(component);
      const radius = readScaledNumber(component, 'radius', ctx.ratio);

      return pointCount != null && radius != null
        ? {
            ...style,
            primitiveType,
            pointCount,
            radius: { type: 'static', value: radius },
            ...readOptionalNumberField(component, 'roundness'),
          }
        : undefined;
    }
    case IRShapePrimitiveType.Star: {
      const pointCount = readPointCount(component);
      const innerRadius = readScaledNumber(component, 'innerRadius', ctx.ratio);
      const outerRadius = readScaledNumber(component, 'outerRadius', ctx.ratio);

      return pointCount != null && innerRadius != null && outerRadius != null
        ? {
            ...style,
            primitiveType,
            pointCount,
            innerRadius: { type: 'static', value: innerRadius },
            outerRadius: { type: 'static', value: outerRadius },
            ...readOptionalNumberField(component, 'innerRoundness'),
            ...readOptionalNumberField(component, 'outerRoundness'),
          }
        : undefined;
    }
  }
}

const GE_TO_SHAPE_PRIMITIVE_TYPE: Record<ShapePrimitiveType, IRShape['primitiveType']> = {
  [ShapePrimitiveType.Custom]: IRShapePrimitiveType.Custom,
  [ShapePrimitiveType.Rectangle]: IRShapePrimitiveType.Rectangle,
  [ShapePrimitiveType.Ellipse]: IRShapePrimitiveType.Ellipse,
  [ShapePrimitiveType.Polygon]: IRShapePrimitiveType.Polygon,
  [ShapePrimitiveType.Star]: IRShapePrimitiveType.Star,
};

function mapShapePrimitiveTypeToIR(GEType: ShapePrimitiveType): IRShape['primitiveType'] {
  return GE_TO_SHAPE_PRIMITIVE_TYPE[GEType] ?? IRShapePrimitiveType.Custom;
}

function parseShapePaint(
  paint: Record<string, unknown>,
  ctx: GESceneContext,
  path: string,
  sourceId?: string,
): IRShapePaint | undefined {
  const GEType = paint['type'] as FillType | undefined;

  if (GEType === FillType.Solid) {
    const color = paint['color'] as { r: number; g: number; b: number; a: number } | undefined;

    if (color == null) {
      return undefined;
    }

    return { type: IRPaintType.Solid, color: { type: 'static', value: [color.r, color.g, color.b, color.a] } };
  }

  if (GEType === FillType.GradientLinear || GEType === FillType.GradientRadial || GEType === FillType.GradientAngular) {
    const typeMap: Record<number, IRShapePaint['type']> = {
      [FillType.GradientLinear]: IRPaintType.LinearGradient,
      [FillType.GradientRadial]: IRPaintType.RadialGradient,
      [FillType.GradientAngular]: IRPaintType.AngularGradient,
    };

    const gradientStopsRaw = paint['gradientStops'] as [number, unknown] | undefined;
    const stops =
      Array.isArray(gradientStopsRaw) && gradientStopsRaw.length >= 2
        ? (gradientStopsRaw[1] as [number, number, number, number, number][])
        : [];

    const startPoint = readFinitePoint(paint['startPoint']);
    const endPoint = readFinitePoint(paint['endPoint']);

    if (startPoint == null || endPoint == null) {
      ctx.diagnostics.push({
        code: 'GE_SHAPE_GRADIENT_ENDPOINT_MISSING',
        severity: 'warning',
        action: 'dropped',
        path,
        ...(sourceId != null && { sourceId }),
        feature: 'gradient-endpoints',
        message: 'GE gradient paint requires finite startPoint and endPoint values before it can enter Animation IR.',
      });

      return undefined;
    }

    return {
      type: typeMap[GEType] as 'linear-gradient' | 'radial-gradient' | 'angular-gradient',
      gradientStops: { type: 'static', value: stops },
      gradientStart: { type: 'static', value: [startPoint.x / ctx.ratio, -startPoint.y / ctx.ratio] },
      gradientEnd: { type: 'static', value: [endPoint.x / ctx.ratio, -endPoint.y / ctx.ratio] },
    };
  }

  if (GEType === FillType.Texture) {
    const assetId = resolveImageAssetIdFromTexture(paint['texture'], ctx);

    if (assetId == null) {
      return undefined;
    }

    const scaleMode = mapTextureScaleModeToIR(paint['scaleMode']);

    return {
      type: IRPaintType.Texture,
      assetId,
      ...readOptionalNumberField(paint, 'opacity'),
      ...(scaleMode != null && { scaleMode }),
    };
  }

  return undefined;
}

function readFinitePoint(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const x = value['x'];
  const y = value['y'];

  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
    ? { x, y }
    : undefined;
}

function mapLineCapToIR(GECode: number): IRLineCap {
  const lineCapByCode: Record<number, IRLineCap> = {
    [LineCap.Butt]: IRLineCap.Butt,
    [LineCap.Round]: IRLineCap.Round,
    [LineCap.Square]: IRLineCap.Square,
  };

  return lineCapByCode[GECode] ?? IRLineCap.Butt;
}

function mapLineJoinToIR(GECode: number): IRLineJoin {
  const lineJoinByCode: Record<number, IRLineJoin> = {
    [LineJoin.Round]: IRLineJoin.Round,
    [LineJoin.Bevel]: IRLineJoin.Bevel,
    [LineJoin.Miter]: IRLineJoin.Miter,
  };

  return lineJoinByCode[GECode] ?? IRLineJoin.Miter;
}

function parseCustomPaths(component: Record<string, unknown>, ratio: number): IRBezierPath[] {
  const points = component['points'] as Array<{ x: number; y: number }> | undefined;
  const easingIns = component['easingIns'] as Array<{ x: number; y: number }> | undefined;
  const easingOuts = component['easingOuts'] as Array<{ x: number; y: number }> | undefined;
  const shapes = component['shapes'] as
    | Array<{
        close: boolean;
        indexes: Array<{ point: number; easingIn: number; easingOut: number }>;
      }>
    | undefined;

  if (points == null || shapes == null) {
    return [];
  }

  return shapes.map(shape => {
    const pathPoints: Array<{ x: number; y: number }> = [];
    const pathInTangents: Array<{ x: number; y: number }> = [];
    const pathOutTangents: Array<{ x: number; y: number }> = [];

    for (const pathIndex of shape.indexes) {
      const point = points[pathIndex.point];
      const easingIn = easingIns?.[pathIndex.easingIn];
      const easingOut = easingOuts?.[pathIndex.easingOut];

      pathPoints.push({ x: point.x / ratio, y: -point.y / ratio });
      pathInTangents.push({ x: (easingIn?.x ?? 0) / ratio, y: -(easingIn?.y ?? 0) / ratio });
      pathOutTangents.push({ x: (easingOut?.x ?? 0) / ratio, y: -(easingOut?.y ?? 0) / ratio });
    }

    return {
      points: pathPoints,
      inTangents: pathInTangents,
      outTangents: pathOutTangents,
      closed: shape.close,
    };
  });
}

function readScaledNumber(component: Record<string, unknown>, key: string, ratio: number): number | undefined {
  const value = component[key];

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return value / ratio;
}

function readOptionalNumberField<K extends string>(
  component: Record<string, unknown>,
  key: K,
): Partial<Record<K, IRStaticProperty<number>>> {
  const value = component[key];

  return typeof value === 'number' && Number.isFinite(value)
    ? ({ [key]: { type: 'static', value } } as Record<K, IRStaticProperty<number>>) : {};
}

function readRectangleCornerRadius(
  component: Record<string, unknown>,
  width: number,
  height: number,
): { cornerRadius?: IRStaticProperty<number> } {
  const roundness = component['roundness'];

  if (typeof roundness !== 'number' || !Number.isFinite(roundness)) {
    return {};
  }
  const percentage = Math.min(Math.max(roundness, 0), 100) / 100;

  return { cornerRadius: { type: 'static', value: percentage * Math.min(width, height) / 2 } };
}

function readPointCount(component: Record<string, unknown>): number | undefined {
  const value = component['pointCount'];

  return typeof value === 'number' && Number.isInteger(value) && value >= 2 ? value : undefined;
}

function resolveImageAssetIdFromTexture(textureReference: unknown, ctx: GESceneContext): string | undefined {
  const texture = resolveDataPath(ctx.textureById, textureReference);
  const sourceReference = texture?.['source'];
  const image = sourceReference != null ? resolveDataPath(ctx.imageById, sourceReference) : undefined;
  const sourceId = resolveDataPathId(sourceReference);
  const url = image?.['url'];

  if (sourceId == null || typeof url !== 'string' || url.trim() === '') {
    return undefined;
  }
  const existingId = ctx.imageAssetIdBySourceId.get(sourceId);
  const assetId = isIRId(sourceId) ? sourceId : existingId ?? createId();

  if (!isIRId(sourceId) && existingId == null) {
    ctx.imageAssetIdBySourceId.set(sourceId, assetId);
  }

  ctx.imageAssetById.set(assetId, {
    id: assetId,
    type: 'image',
    source: createIRResourceSource(resolveIRResourceUrl(url, ctx.resourceBaseUrl)),
  });

  return assetId;
}

function mapTextureScaleModeToIR(value: unknown): IRTextureScaleMode | undefined {
  switch (value) {
    case TexturePaintScaleMode.Fill:
      return IRTextureScaleMode.Fill;
    case TexturePaintScaleMode.Fit:
      return IRTextureScaleMode.Fit;
    case TexturePaintScaleMode.Crop:
      return IRTextureScaleMode.Crop;
    case TexturePaintScaleMode.Tile:
      return IRTextureScaleMode.Tile;
    default:
      return undefined;
  }
}

function parseSpriteTexture(renderer: unknown, ctx: GESceneContext): EffectsLayerPreservedData['spriteTexture'] {
  const texture = isRecord(renderer) ? resolveDataPath(ctx.textureById, renderer['texture']) : undefined;
  const image = texture == null ? undefined : resolveDataPath(ctx.imageById, texture['source']);

  if (texture == null || image == null) {
    return undefined;
  }
  const textureData = normalizeJSONValue(texture);
  const imageData = normalizeJSONValue(image);

  delete textureData['id'];
  delete textureData['source'];
  delete imageData['id'];
  delete imageData['url'];
  for (const key of ['webp', 'avif', 'ktx2']) {
    const url = imageData[key];

    if (typeof url === 'string' && url !== '') {
      imageData[key] = resolveIRResourceUrl(url, ctx.resourceBaseUrl);
    }
  }

  return { texture: textureData, image: imageData };
}
