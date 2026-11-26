import { IRMaskMode } from '../schema/layer.js';
import { IRPaintType, IRLineCap, IRLineJoin, IRShapePrimitiveType, IRTextureScaleMode } from '../schema/shape.js';
import type { IRValidationErrorCode } from './contract.js';
import type { ValidationContext } from './context.js';
import { validateAnimatedProperty } from './property-validation.js';
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
  const sizeMode = value['sizeMode'];
  const wrap = value['wrap'];
  const overflow = value['overflow'];
  const verticalAlign = value['verticalAlign'];

  if (sizeMode !== undefined && sizeMode !== 'fixed' && sizeMode !== 'auto-width' && sizeMode !== 'auto-height') {
    ctx.error('IR_TEXT_DATA_INVALID', `${path}.sizeMode`, 'must be fixed, auto-width, or auto-height', layerId);
  }
  if (wrap !== undefined && typeof wrap !== 'boolean') {
    ctx.error('IR_TEXT_DATA_INVALID', `${path}.wrap`, 'must be boolean', layerId);
  } else if (wrap === true && (sizeMode === undefined || sizeMode === 'auto-width')) {
    ctx.error('IR_TEXT_DATA_INVALID', `${path}.wrap`, 'requires fixed or auto-height sizeMode', layerId);
  }
  if (overflow !== undefined && overflow !== 'visible' && overflow !== 'clip' && overflow !== 'shrink') {
    ctx.error('IR_TEXT_DATA_INVALID', `${path}.overflow`, 'must be visible, clip, or shrink', layerId);
  }
  if (verticalAlign !== undefined && verticalAlign !== 'top' && verticalAlign !== 'center' && verticalAlign !== 'bottom') {
    ctx.error('IR_TEXT_DATA_INVALID', `${path}.verticalAlign`, 'must be top, center, or bottom', layerId);
  }
  validateTextStyleRanges(ctx, value['styleRanges'], value['text'], `${path}.styleRanges`, layerId);
}

function splitsSurrogatePair(text: string, offset: number): boolean {
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);

  return previous >= 0xD800 && previous <= 0xDBFF && current >= 0xDC00 && current <= 0xDFFF;
}

function validateTextStyleRanges(
  ctx: ValidationContext,
  value: unknown,
  text: unknown,
  path: string,
  layerId: string | undefined,
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    ctx.error('IR_TEXT_DATA_INVALID', path, 'must be an array', layerId);

    return;
  }
  let previousEnd = 0;

  for (const [index, range] of value.entries()) {
    const rangePath = `${path}[${index}]`;

    if (!isRecord(range)) {
      ctx.error('IR_TEXT_DATA_INVALID', rangePath, 'must be an object', layerId);
      continue;
    }
    const start = range['start'];
    const end = range['end'];

    if (
      !isFiniteNumber(start) || !Number.isInteger(start) || start < 0 ||
      !isFiniteNumber(end) || !Number.isInteger(end) || end <= start
    ) {
      ctx.error('IR_TEXT_DATA_INVALID', rangePath, 'must define a non-empty integer range [start, end)', layerId);
    } else {
      if (start < previousEnd) {
        ctx.error('IR_TEXT_DATA_INVALID', `${rangePath}.start`, 'ranges must be sorted and non-overlapping', layerId);
      }
      if (typeof text === 'string') {
        if (end > text.length) {
          ctx.error('IR_TEXT_DATA_INVALID', `${rangePath}.end`, 'must not exceed the text length', layerId);
        }
        for (const [field, offset] of [['start', start], ['end', end]] as const) {
          if (splitsSurrogatePair(text, offset)) {
            ctx.error('IR_TEXT_DATA_INVALID', `${rangePath}.${field}`, 'must not split a UTF-16 surrogate pair', layerId);
          }
        }
      }
      previousEnd = Math.max(previousEnd, end);
    }
    if (range['fontAssetId'] !== undefined && !isIRId(range['fontAssetId'])) {
      ctx.error('IR_TEXT_DATA_INVALID', `${rangePath}.fontAssetId`, 'must be a valid Asset ID', layerId);
    }
    if (range['fontSize'] !== undefined && (!isFiniteNumber(range['fontSize']) || range['fontSize'] <= 0)) {
      ctx.error('IR_TEXT_DATA_INVALID', `${rangePath}.fontSize`, 'must be greater than 0', layerId);
    }
    if (range['letterSpacing'] !== undefined && !isFiniteNumber(range['letterSpacing'])) {
      ctx.error('IR_TEXT_DATA_INVALID', `${rangePath}.letterSpacing`, 'must be finite', layerId);
    }
    if (range['color'] !== undefined) {
      validateColor(ctx, range['color'], 'IR_TEXT_COLOR_INVALID', `${rangePath}.color`, layerId);
    }
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
  validateAnimatedProperty(ctx, value['opacity'], 'number', `${path}.opacity`, layerId, { normalized: true });

  switch (value['type']) {
    case IRPaintType.Solid:
      if (value['color'] == null) {
        ctx.error('IR_SHAPE_PAINT_INVALID', `${path}.color`, 'must be an animated RGBA property', layerId);
      } else {
        validateAnimatedProperty(ctx, value['color'], 4, `${path}.color`, layerId, { normalized: true });
      }

      break;
    case IRPaintType.LinearGradient:
    case IRPaintType.RadialGradient:
    case IRPaintType.AngularGradient: {
      validateAnimatedProperty(
        ctx, value['gradientStops'],
        (stops, stopsPath) => validateGradientStops(ctx, stops, stopsPath, layerId),
        `${path}.gradientStops`, layerId,
        {
          required: true,
          validateSegment(start, end, segmentPath) {
            if (Array.isArray(start) && Array.isArray(end) && start.length !== end.length) {
              ctx.error('IR_SHAPE_PAINT_INVALID', segmentPath, 'interpolated stops must have equal counts', layerId);
            }
          },
        },
      );
      for (const field of ['gradientStart', 'gradientEnd']) {
        validateAnimatedProperty(ctx, value[field], 2, `${path}.${field}`, layerId, { required: true });
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

function validateGradientStops(ctx: ValidationContext, value: unknown, path: string, layerId?: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    ctx.error('IR_SHAPE_PAINT_INVALID', path, 'must be a non-empty array', layerId);

    return;
  }
  let previousPosition = Number.NEGATIVE_INFINITY;

  for (const [index, stop] of value.entries()) {
    const stopPath = `${path}[${index}]`;

    if (!isNumberTuple(stop, 5)) {
      ctx.error('IR_SHAPE_PAINT_INVALID', stopPath, 'must be [position, r, g, b, a]', layerId);
      continue;
    }
    if (!stop.every(isNormalizedNumber)) {
      ctx.error('IR_SHAPE_PAINT_INVALID', stopPath, 'must contain values in the 0..1 range', layerId);
    }
    if (stop[0] < previousPosition) {
      ctx.error('IR_SHAPE_PAINT_INVALID', `${stopPath}[0]`, 'positions must be sorted in ascending order', layerId);
    }
    previousPosition = stop[0];
  }
}

function validateShapeStroke(ctx: ValidationContext, value: unknown, path: string, layerId: string | undefined): void {
  if (!isRecord(value)) {
    ctx.error('IR_SHAPE_DATA_INVALID', path, 'must be an object', layerId);

    return;
  }

  validateShapePaint(ctx, value['paint'], `${path}.paint`, layerId);
  validateRequiredNonNegativeShapeNumber(ctx, value, 'width', path, layerId);
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
  if (value[field] === undefined) {
    ctx.error('IR_SHAPE_DATA_INVALID', `${path}.${field}`, 'is required', layerId);

    return;
  }
  validateShapeNumber(ctx, value[field], `${path}.${field}`, layerId);
}

function validateShapeNumber(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  layerId: string | undefined,
  maximum = Number.POSITIVE_INFINITY,
): void {
  validateAnimatedProperty(ctx, value, (sample, samplePath) => {
    if (!isFiniteNumber(sample) || sample < 0 || sample > maximum) {
      const message = Number.isFinite(maximum)
        ? `must be finite and in the 0..${maximum} range`
        : 'must be a finite non-negative number';

      ctx.error('IR_SHAPE_DATA_INVALID', samplePath, message, layerId);
    }
  }, path, layerId);
}

function validateShapePointCount(ctx: ValidationContext, value: unknown, path: string, layerId: string | undefined): void {
  if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 2) {
    ctx.error('IR_SHAPE_DATA_INVALID', path, 'must be an integer greater than or equal to 2', layerId);
  }
}

function validateOptionalRectangleCornerRadius(
  ctx: ValidationContext,
  value: Record<string, unknown>,
  path: string,
  layerId: string | undefined,
): void {
  const cornerRadius = value['cornerRadius'];

  validateShapeNumber(ctx, cornerRadius, `${path}.cornerRadius`, layerId);
  const width = value['width'];
  const height = value['height'];

  if (
    isRecord(cornerRadius) && cornerRadius['type'] === 'static' && isFiniteNumber(cornerRadius['value']) &&
    isRecord(width) && width['type'] === 'static' && isFiniteNumber(width['value']) &&
    isRecord(height) && height['type'] === 'static' && isFiniteNumber(height['value']) &&
    cornerRadius['value'] > Math.min(width['value'], height['value']) / 2
  ) {
    ctx.error(
      'IR_SHAPE_DATA_INVALID', `${path}.cornerRadius.value`, 'must not exceed half of the shorter edge', layerId,
    );
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

function validatePathTopology(
  ctx: ValidationContext,
  start: unknown,
  end: unknown,
  path: string,
  layerId: string | undefined,
): void {
  if (!Array.isArray(start) || !Array.isArray(end)) {
    return;
  }
  if (start.length !== end.length) {
    ctx.error('IR_SHAPE_DATA_INVALID', path, 'interpolated compound paths must have equal path counts', layerId);

    return;
  }
  for (const [index, source] of start.entries()) {
    const target: unknown = end[index];

    if (!isRecord(source) || !isRecord(target)) {
      continue;
    }
    const sourcePoints = source['points'];
    const targetPoints = target['points'];

    if (
      source['closed'] !== target['closed'] ||
      (Array.isArray(sourcePoints) && Array.isArray(targetPoints) && sourcePoints.length !== targetPoints.length)
    ) {
      ctx.error(
        'IR_SHAPE_DATA_INVALID', path,
        `interpolated path ${index} must preserve its vertex count and closed flag`, layerId,
      );
    }
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
  validateAnimatedProperty(ctx, value['position'], 2, `${path}.position`, layerId, { required: true });
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
      validateAnimatedProperty(
        ctx, value['customPaths'],
        (paths, pathsPath) => validateCustomShapePaths(ctx, paths, pathsPath, layerId),
        `${path}.customPaths`, layerId,
        {
          required: true,
          validateSegment: (start, end, segmentPath) => validatePathTopology(ctx, start, end, segmentPath, layerId),
        },
      );

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
      validateShapeNumber(ctx, value['roundness'], `${path}.roundness`, layerId, 100);

      break;
    case IRShapePrimitiveType.Star:
      validateShapePointCount(ctx, value['pointCount'], `${path}.pointCount`, layerId);
      validateRequiredNonNegativeShapeNumber(ctx, value, 'innerRadius', path, layerId);
      validateRequiredNonNegativeShapeNumber(ctx, value, 'outerRadius', path, layerId);
      validateShapeNumber(ctx, value['innerRoundness'], `${path}.innerRoundness`, layerId, 100);
      validateShapeNumber(ctx, value['outerRoundness'], `${path}.outerRoundness`, layerId, 100);

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

export function validateLocalBounds(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  layerId?: string,
  automaticDimensions: ReadonlyArray<'width' | 'height'> = [],
): void {
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
    const automatic = automaticDimensions.includes(field);

    if (!isFiniteNumber(value[field]) || (automatic ? value[field] < 0 : value[field] <= 0)) {
      ctx.error('IR_LAYER_LOCAL_BOUNDS_INVALID', `${path}.${field}`,
        automatic ? 'must be finite and non-negative' : 'must be finite and greater than 0', layerId);
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
