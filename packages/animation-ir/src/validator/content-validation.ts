import { IRMaskMode } from '../schema/layer.js';
import { IRPaintType, IRLineCap, IRLineJoin, IRShapePrimitiveType, IRTextureScaleMode } from '../schema/shape.js';
import type { IRValidationErrorCode } from './contract.js';
import type { ValidationContext } from './context.js';
import {
  isFiniteNumber, isIRId, isNormalizedNumber, isNumberTuple, isOneOfConst,
  isRecord, validateColor,
} from './value-validation.js';

export function validateTextData(ctx: ValidationContext, value: unknown, path: string, layerId: string | undefined): void {
  if (!isRecord(value)) {
    ctx.error('IR_TEXT_DATA_INVALID', path, 'must be an object', layerId);

    return;
  }

  if (typeof value['text'] !== 'string') {
    ctx.error('IR_TEXT_DATA_INVALID', `${path}.text`, 'must be a string', layerId);
  }
  if (!isIRId(value['fontAssetId'])) {
    ctx.error('IR_TEXT_DATA_INVALID', `${path}.fontAssetId`, 'must be a valid Asset ID', layerId);
  }
  if (!isFiniteNumber(value['fontSize']) || value['fontSize'] <= 0) {
    ctx.error('IR_TEXT_DATA_INVALID', `${path}.fontSize`, 'must be greater than 0', layerId);
  }
  validateColor(ctx, value['color'], 'IR_TEXT_COLOR_INVALID', `${path}.color`, layerId);

  if (value['textAlign'] !== 'left' && value['textAlign'] !== 'center' && value['textAlign'] !== 'right') {
    ctx.error('IR_TEXT_DATA_INVALID', `${path}.textAlign`, 'must be left, center, or right', layerId);
  }
  if (!isFiniteNumber(value['letterSpacing'])) {
    ctx.error('IR_TEXT_DATA_INVALID', `${path}.letterSpacing`, 'must be finite', layerId);
  }

  if (!isFiniteNumber(value['lineHeight']) || value['lineHeight'] <= 0) {
    ctx.error('IR_TEXT_DATA_INVALID', `${path}.lineHeight`, 'must be greater than 0', layerId);
  }
}

function validatePath(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  layerId: string | undefined,
  errorCode: IRValidationErrorCode = 'IR_SHAPE_DATA_INVALID',
): void {
  if (!isRecord(value)) {
    ctx.error(errorCode, path, 'must be an object', layerId);

    return;
  }

  const points = value['points'];
  const inTangents = value['inTangents'];
  const outTangents = value['outTangents'];

  if (!Array.isArray(points)) {
    ctx.error(errorCode, `${path}.points`, 'must be an array', layerId);
  }
  if (!Array.isArray(inTangents)) {
    ctx.error(errorCode, `${path}.inTangents`, 'must be an array', layerId);
  }
  if (!Array.isArray(outTangents)) {
    ctx.error(errorCode, `${path}.outTangents`, 'must be an array', layerId);
  }
  if (typeof value['closed'] !== 'boolean') {
    ctx.error(errorCode, `${path}.closed`, 'must be boolean', layerId);
  }

  if (Array.isArray(points)) {
    if (points.length === 0) {
      ctx.error(errorCode, `${path}.points`, 'must be a non-empty array', layerId);
    }
    for (const [index, point] of points.entries()) {
      if (!isRecord(point) || !isFiniteNumber(point['x']) || !isFiniteNumber(point['y'])) {
        ctx.error(errorCode, `${path}.points[${index}]`, 'must be a finite { x, y } point', layerId);
      }
    }
    if (Array.isArray(inTangents) && inTangents.length !== points.length) {
      ctx.error(errorCode, `${path}.inTangents`, 'must contain one handle for every point', layerId);
    }
    if (Array.isArray(outTangents) && outTangents.length !== points.length) {
      ctx.error(errorCode, `${path}.outTangents`, 'must contain one handle for every point', layerId);
    }
  }

  for (const [field, handles] of [
    ['inTangents', inTangents],
    ['outTangents', outTangents],
  ] as const) {
    if (!Array.isArray(handles)) {
      continue;
    }
    for (const [index, handle] of handles.entries()) {
      if (!isRecord(handle) || !isFiniteNumber(handle['x']) || !isFiniteNumber(handle['y'])) {
        ctx.error(errorCode, `${path}.${field}[${index}]`, 'must be a finite { x, y } handle', layerId);
      }
    }
  }
}

function validateShapePaint(ctx: ValidationContext, value: unknown, path: string, layerId: string | undefined): void {
  if (!isRecord(value)) {
    ctx.error('IR_SHAPE_PAINT_INVALID', path, 'must be an object', layerId);

    return;
  }
  if (!isOneOfConst(value['type'], IRPaintType)) {
    ctx.error('IR_SHAPE_PAINT_INVALID', `${path}.type`, 'is invalid', layerId);

    return;
  }

  switch (value['type']) {
    case IRPaintType.Solid:
      validateColor(ctx, value['color'], 'IR_SHAPE_PAINT_INVALID', `${path}.color`, layerId);

      break;
    case IRPaintType.LinearGradient:
    case IRPaintType.RadialGradient:
    case IRPaintType.AngularGradient: {
      const stops = value['gradientStops'];

      if (!Array.isArray(stops) || stops.length === 0) {
        ctx.error('IR_SHAPE_PAINT_INVALID', `${path}.gradientStops`, 'must be a non-empty array', layerId);
      } else {
        let previousPosition = Number.NEGATIVE_INFINITY;

        for (const [index, stop] of stops.entries()) {
          const stopPath = `${path}.gradientStops[${index}]`;

          if (!isNumberTuple(stop, 5)) {
            ctx.error('IR_SHAPE_PAINT_INVALID', stopPath, 'must be [position, r, g, b, a]', layerId);
            continue;
          }
          if (!stop.every(isNormalizedNumber)) {
            ctx.error('IR_SHAPE_PAINT_INVALID', stopPath, 'must contain values in the 0..1 range', layerId);
          }
          if (stop[0] < previousPosition) {
            ctx.error(
              'IR_SHAPE_PAINT_INVALID',
              `${stopPath}[0]`,
              'positions must be sorted in ascending order',
              layerId,
            );
          }
          previousPosition = stop[0];
        }
      }
      if (!isNumberTuple(value['gradientStart'], 2)) {
        ctx.error('IR_SHAPE_PAINT_INVALID', `${path}.gradientStart`, 'is required as a finite 2D tuple', layerId);
      }
      if (!isNumberTuple(value['gradientEnd'], 2)) {
        ctx.error('IR_SHAPE_PAINT_INVALID', `${path}.gradientEnd`, 'is required as a finite 2D tuple', layerId);
      }

      break;
    }
    case IRPaintType.Texture:
      if (!isIRId(value['assetId'])) {
        ctx.error('IR_SHAPE_PAINT_INVALID', `${path}.assetId`, 'must be a valid Asset ID', layerId);
      }
      if (value['scaleMode'] !== undefined && !isOneOfConst(value['scaleMode'], IRTextureScaleMode)) {
        ctx.error('IR_SHAPE_PAINT_INVALID', `${path}.scaleMode`, 'must be fill, fit, crop, or tile', layerId);
      }

      break;
  }
}

function validateShapeStroke(ctx: ValidationContext, value: unknown, path: string, layerId: string | undefined): void {
  if (!isRecord(value)) {
    ctx.error('IR_SHAPE_DATA_INVALID', path, 'must be an object', layerId);

    return;
  }

  validateShapePaint(ctx, value['paint'], `${path}.paint`, layerId);
  if (!isFiniteNumber(value['width']) || value['width'] < 0) {
    ctx.error('IR_SHAPE_DATA_INVALID', `${path}.width`, 'must be a finite non-negative number', layerId);
  }
  if (!isOneOfConst(value['cap'], IRLineCap)) {
    ctx.error('IR_SHAPE_DATA_INVALID', `${path}.cap`, 'is invalid', layerId);
  }
  if (!isOneOfConst(value['join'], IRLineJoin)) {
    ctx.error('IR_SHAPE_DATA_INVALID', `${path}.join`, 'is invalid', layerId);
  }
}

function validateRequiredNonNegativeShapeNumber(
  ctx: ValidationContext,
  value: Record<string, unknown>,
  field: string,
  path: string,
  layerId: string | undefined,
): void {
  if (!isFiniteNumber(value[field]) || value[field] < 0) {
    ctx.error('IR_SHAPE_DATA_INVALID', `${path}.${field}`, 'must be a finite non-negative number', layerId);
  }
}

function validateShapePointCount(ctx: ValidationContext, value: unknown, path: string, layerId: string | undefined): void {
  if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 2) {
    ctx.error('IR_SHAPE_DATA_INVALID', path, 'must be an integer greater than or equal to 2', layerId);
  }
}

function validateOptionalShapeRoundness(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  layerId: string | undefined,
): void {
  if (value !== undefined && (!isFiniteNumber(value) || value < 0 || value > 100)) {
    ctx.error('IR_SHAPE_DATA_INVALID', path, 'must be in the 0..100 range', layerId);
  }
}

function validateOptionalRectangleCornerRadius(
  ctx: ValidationContext,
  value: Record<string, unknown>,
  path: string,
  layerId: string | undefined,
): void {
  const cornerRadius = value['cornerRadius'];

  if (cornerRadius === undefined) {
    return;
  }
  if (!isFiniteNumber(cornerRadius) || cornerRadius < 0) {
    ctx.error('IR_SHAPE_DATA_INVALID', `${path}.cornerRadius`, 'must be a finite non-negative number', layerId);

    return;
  }
  const width = value['width'];
  const height = value['height'];

  if (isFiniteNumber(width) && isFiniteNumber(height) && cornerRadius > Math.min(width, height) / 2) {
    ctx.error('IR_SHAPE_DATA_INVALID', `${path}.cornerRadius`, 'must not exceed half of the shorter edge', layerId);
  }
}

function validateCustomShapePaths(ctx: ValidationContext, value: unknown, path: string, layerId: string | undefined): void {
  if (!Array.isArray(value) || value.length === 0) {
    ctx.error('IR_SHAPE_DATA_INVALID', path, 'must be a non-empty array', layerId);

    return;
  }

  for (const [index, customPath] of value.entries()) {
    validatePath(ctx, customPath, `${path}[${index}]`, layerId);
  }
}

export function validateShapeData(ctx: ValidationContext, value: unknown, path: string, layerId: string | undefined): void {
  if (!isRecord(value)) {
    ctx.error('IR_SHAPE_DATA_INVALID', path, 'must be an object', layerId);

    return;
  }
  if (!isOneOfConst(value['primitiveType'], IRShapePrimitiveType)) {
    ctx.error('IR_SHAPE_DATA_INVALID', `${path}.primitiveType`, 'is invalid', layerId);
  }
  if (!isNumberTuple(value['position'], 2)) {
    ctx.error('IR_SHAPE_DATA_INVALID', `${path}.position`, 'must be a finite 2D tuple', layerId);
  }
  const fills = value['fills'];

  if (!Array.isArray(fills)) {
    ctx.error('IR_SHAPE_DATA_INVALID', `${path}.fills`, 'must be an array', layerId);
  } else {
    for (const [index, fill] of fills.entries()) {
      validateShapePaint(ctx, fill, `${path}.fills[${index}]`, layerId);
    }
  }
  const strokes = value['strokes'];

  if (!Array.isArray(strokes)) {
    ctx.error('IR_SHAPE_DATA_INVALID', `${path}.strokes`, 'must be an array', layerId);
  } else {
    for (const [index, stroke] of strokes.entries()) {
      validateShapeStroke(ctx, stroke, `${path}.strokes[${index}]`, layerId);
    }
  }

  switch (value['primitiveType']) {
    case IRShapePrimitiveType.Custom:
      validateCustomShapePaths(ctx, value['customPaths'], `${path}.customPaths`, layerId);

      break;
    case IRShapePrimitiveType.Rectangle:
      validateRequiredNonNegativeShapeNumber(ctx, value, 'width', path, layerId);
      validateRequiredNonNegativeShapeNumber(ctx, value, 'height', path, layerId);
      validateOptionalRectangleCornerRadius(ctx, value, path, layerId);

      break;
    case IRShapePrimitiveType.Ellipse:
      validateRequiredNonNegativeShapeNumber(ctx, value, 'xRadius', path, layerId);
      validateRequiredNonNegativeShapeNumber(ctx, value, 'yRadius', path, layerId);

      break;
    case IRShapePrimitiveType.Polygon:
      validateShapePointCount(ctx, value['pointCount'], `${path}.pointCount`, layerId);
      validateRequiredNonNegativeShapeNumber(ctx, value, 'radius', path, layerId);
      validateOptionalShapeRoundness(ctx, value['roundness'], `${path}.roundness`, layerId);

      break;
    case IRShapePrimitiveType.Star:
      validateShapePointCount(ctx, value['pointCount'], `${path}.pointCount`, layerId);
      validateRequiredNonNegativeShapeNumber(ctx, value, 'innerRadius', path, layerId);
      validateRequiredNonNegativeShapeNumber(ctx, value, 'outerRadius', path, layerId);
      validateOptionalShapeRoundness(ctx, value['innerRoundness'], `${path}.innerRoundness`, layerId);
      validateOptionalShapeRoundness(ctx, value['outerRoundness'], `${path}.outerRoundness`, layerId);

      break;
  }

}

export function validateMask(ctx: ValidationContext, value: unknown, path: string, layerId: string | undefined): void {
  if (!isRecord(value)) {
    ctx.error('IR_MASK_DATA_INVALID', path, 'must be an object', layerId);

    return;
  }
  if (!isOneOfConst(value['mode'], IRMaskMode)) {
    ctx.error('IR_MASK_DATA_INVALID', `${path}.mode`, 'must be add, subtract, or intersect', layerId);
  }
  if (value['inverted'] !== undefined && typeof value['inverted'] !== 'boolean') {
    ctx.error('IR_MASK_DATA_INVALID', `${path}.inverted`, 'must be boolean when present', layerId);
  }
  const maskPath = value['path'];

  validatePath(ctx, maskPath, `${path}.path`, layerId, 'IR_MASK_DATA_INVALID');
  if (isRecord(maskPath) && maskPath['closed'] === false) {
    ctx.error('IR_MASK_DATA_INVALID', `${path}.path.closed`, 'must be true for a mask path', layerId);
  }
}

export function validateLocalBounds(ctx: ValidationContext, value: unknown, path: string, layerId?: string): void {
  if (!isRecord(value)) {
    ctx.error('IR_LAYER_LOCAL_BOUNDS_INVALID', path, 'must be an object', layerId);

    return;
  }

  for (const field of ['x', 'y'] as const) {
    if (!isFiniteNumber(value[field])) {
      ctx.error('IR_LAYER_LOCAL_BOUNDS_INVALID', `${path}.${field}`, 'must be finite', layerId);
    }
  }
  for (const field of ['width', 'height'] as const) {
    if (!isFiniteNumber(value[field]) || value[field] <= 0) {
      ctx.error('IR_LAYER_LOCAL_BOUNDS_INVALID', `${path}.${field}`, 'must be finite and greater than 0', layerId);
    }
  }
}

export function validateImageLayerContent(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  layerId?: string,
): void {
  if (!isRecord(value)) {
    ctx.error('IR_LAYER_IMAGE_CONTENT_INVALID', path, 'must be an object containing an assetId', layerId);

    return;
  }
  if (!isIRId(value['assetId'])) {
    ctx.error('IR_LAYER_IMAGE_CONTENT_INVALID', `${path}.assetId`, 'must be a valid Asset ID', layerId);
  }
}

export function validateSolidLayerContent(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  layerId?: string,
): void {
  if (!isRecord(value) || value['color'] === undefined) {
    ctx.error('IR_LAYER_SOLID_COLOR_MISSING', `${path}.color`, 'is required for solid layers', layerId);

    return;
  }

  validateColor(ctx, value['color'], 'IR_LAYER_SOLID_COLOR_INVALID', `${path}.color`, layerId);
}
