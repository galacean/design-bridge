import type { LottieGradientData, LottieShapeElement } from '../common/conversion-types';
import type { Shape } from '@lottie-animation-community/lottie-types';
import type {
  IRColor, IRBezierPath, IRGradientColorStop, IRShape, IRShapePaint,
  IRShapeStroke,
} from '@galacean/animation-ir';
import { IRPaintType, IRLineCap, IRLineJoin, IRShapePrimitiveType } from '@galacean/animation-ir';

/** Stable diagnostic labels for unsupported Lottie shape operators. */
export const SHAPE_FEATURE_LABELS: Record<string, string> = {
  tm: 'trim-path',
  rp: 'repeater',
  mm: 'merge-path',
  pb: 'pucker-bloat',
  zz: 'zig-zag',
  op: 'offset-path',
  rd: 'round-corners',
  'fill-rule': 'even-odd-fill-rule',
  'paint-order': 'interleaved-fill-stroke-order',
};

interface LottieShapeConversion {
  shapes: IRShape[];
  approximatedFeatures: string[];
  hasRenderableGeometry: boolean;
  unsupportedFeatures: string[];
}

interface ShapeFeatureCollector {
  approximatedFeatures: Set<string>;
  hasRenderableGeometry: boolean;
  unsupportedFeatures: Set<string>;
}

function recordShapeFeatures(item: LottieShapeElement, collector: ShapeFeatureCollector): void {
  const type = item.ty;

  if (type in SHAPE_FEATURE_LABELS) {
    collector.unsupportedFeatures.add(type);
  }
  if ((type === 'fl' || type === 'gf') && item.r === 2) {
    collector.unsupportedFeatures.add('fill-rule');
  }
  if (hasAnimatedGradient(item)) {
    collector.approximatedFeatures.add('animated-gradient');
  }
  if (type === 'el' || type === 'rc' || type === 'sr' || type === 'sh') {
    collector.hasRenderableGeometry = true;
  }
}

function recordPaintOrder(
  type: LottieShapeElement['ty'],
  hasFillAbove: boolean,
  collector: ShapeFeatureCollector,
): boolean {
  if ((type === 'st' || type === 'gs') && hasFillAbove) {
    collector.unsupportedFeatures.add('paint-order');
  }

  return hasFillAbove || type === 'fl' || type === 'gf';
}

function collectDroppedGroupFeatures(items: LottieShapeElement[], collector: ShapeFeatureCollector): void {
  let hasFillAbove = false;

  for (const item of items) {
    if (item.hd === true) {
      continue;
    }
    recordShapeFeatures(item, collector);
    hasFillAbove = recordPaintOrder(item.ty, hasFillAbove, collector);
    if (item.ty === 'gr') {
      collectDroppedGroupFeatures(item.it ?? [], collector);
    }
  }
}

function hasAnimatedGradient(item: LottieShapeElement): boolean {
  if ((item.ty !== 'gf' && item.ty !== 'gs') || item.g == null) {
    return false;
  }

  const gradientProperty = item.g.k;

  return gradientProperty.a === 1 || gradientProperty.k.some(value => typeof value === 'object' && value != null);
}

function getStaticValue(prop: unknown, defaultValue: number = 0): number {
  if (prop == null) {
    return defaultValue;
  }
  if (typeof prop === 'number') {
    return prop;
  }
  if (typeof prop === 'object' && 'k' in prop) {
    const keyValue = prop.k;

    if (typeof keyValue === 'number') {
      return keyValue;
    }
    if (Array.isArray(keyValue) && typeof keyValue[0] === 'number') {
      return keyValue[0];
    }
  }

  return defaultValue;
}

function getStaticArrayValue(prop: unknown, defaultValue: number[] = [0, 0]): number[] {
  if (prop == null) {
    return defaultValue;
  }
  if (typeof prop === 'object' && 'k' in prop) {
    const keyValue = prop.k;

    if (Array.isArray(keyValue) && typeof keyValue[0] === 'number') {
      return keyValue as number[];
    }
  }

  return defaultValue;
}

/** Maps Lottie `lc`: 1 butt, 2 round, 3 square. */
function mapLineCap(lottieCap: number): IRLineCap {
  switch (lottieCap) {
    case 2:
      return IRLineCap.Round;
    case 3:
      return IRLineCap.Square;
    default:
      return IRLineCap.Butt;
  }
}

/** Maps Lottie `lj`: 1 miter, 2 round, 3 bevel. */
function mapLineJoin(lottieJoin: number): IRLineJoin {
  switch (lottieJoin) {
    case 2:
      return IRLineJoin.Round;
    case 3:
      return IRLineJoin.Bevel;
    default:
      return IRLineJoin.Miter;
  }
}

/** Maps gradient `t`: 1 linear, 2 radial, 3 angular. */
function mapGradientType(
  lottieType: number,
): typeof IRPaintType.LinearGradient | typeof IRPaintType.RadialGradient | typeof IRPaintType.AngularGradient {
  switch (lottieType) {
    case 2:
      return IRPaintType.RadialGradient;
    case 3:
      return IRPaintType.AngularGradient;
    default:
      return IRPaintType.LinearGradient;
  }
}

function makeSolidPaint(r: number, g: number, b: number, a: number): IRShapePaint {
  return {
    type: IRPaintType.Solid,
    color: [r, g, b, a] as IRColor,
  };
}

/** Converts color and opacity stops to IR RGBA stops. */
function convertGradientStops(
  gradientData: LottieGradientData | undefined | null,
  opacity: number,
): IRGradientColorStop[] {
  if (gradientData == null) {
    return [];
  }

  const colorCount = gradientData.p ?? 0;
  const keyData = gradientData.k;

  if (keyData == null) {
    return [];
  }

  let flatValues: number[];
  const keyValue = keyData.k;

  if (Array.isArray(keyValue) && typeof keyValue[0] === 'number') {
    flatValues = keyValue as number[];
  } else if (Array.isArray(keyValue) && typeof keyValue[0] === 'object' && keyValue[0] != null) {
    // Animated gradients use the first keyframe value.
    const startValues = keyValue[0].s;

    if (Array.isArray(startValues)) {
      flatValues = startValues;
    } else {
      return [];
    }
  } else {
    return [];
  }

  const stops: IRGradientColorStop[] = [];
  const colorDataLength = colorCount * 4;

  for (let i = 0; i < colorCount; i++) {
    const offset = i * 4;

    if (offset + 3 >= flatValues.length) {
      break;
    }

    const position = flatValues[offset];
    const r = flatValues[offset + 1];
    const g = flatValues[offset + 2];
    const b = flatValues[offset + 3];

    let alpha = opacity;
    const alphaOffset = colorDataLength + i * 2;

    if (alphaOffset + 1 < flatValues.length) {
      alpha = flatValues[alphaOffset + 1] * opacity;
    }

    stops.push([position, r, g, b, alpha]);
  }

  return stops;
}

function convertGradientPaint(item: Shape.GradientFill | Shape.GradientStroke): IRShapePaint {
  const gradientType = mapGradientType(typeof item.t === 'number' ? item.t : 1);
  const opacity = getStaticValue(item.o, 100) / 100;
  const stops = convertGradientStops(item.g, opacity);

  const startPoint = getStaticArrayValue(item.s, [0, 0]);
  const endPoint = getStaticArrayValue(item.e, [100, 0]);

  return {
    type: gradientType,
    gradientStops: stops,
    gradientStart: [startPoint[0], startPoint[1]],
    gradientEnd: [endPoint[0], endPoint[1]],
  };
}

interface PaintStyles {
  fills: IRShapePaint[];
  strokes: IRShapeStroke[];
}

function makeStroke(item: Shape.Stroke | Shape.GradientStroke, paint: IRShapePaint): IRShapeStroke {
  return {
    paint,
    width: Math.max(getStaticValue(item.w, 1), 0),
    cap: mapLineCap(item.lc ?? 1),
    join: mapLineJoin(item.lj ?? 1),
  };
}

function applyPaintItem(item: LottieShapeElement, styles: PaintStyles): boolean {
  switch (item.ty) {
    case 'fl': {
      const colorArray = getStaticArrayValue(item.c, [0, 0, 0]);
      const opacity = getStaticValue(item.o, 100) / 100;

      styles.fills.unshift(makeSolidPaint(colorArray[0] ?? 0, colorArray[1] ?? 0, colorArray[2] ?? 0, opacity));

      return true;
    }
    case 'gf': {
      styles.fills.unshift(convertGradientPaint(item));

      return true;
    }
    case 'st': {
      const colorArray = getStaticArrayValue(item.c, [0, 0, 0]);
      const opacity = getStaticValue(item.o, 100) / 100;
      const paint = makeSolidPaint(colorArray[0] ?? 0, colorArray[1] ?? 0, colorArray[2] ?? 0, opacity);

      styles.strokes.unshift(makeStroke(item, paint));

      return true;
    }
    case 'gs': {
      styles.strokes.unshift(makeStroke(item, convertGradientPaint(item)));

      return true;
    }
    default:
      return false;
  }
}

/**
 * Converts supported visible shape geometry into IR painter order.
 *
 * Top-level paints are inherited by groups that do not define their own fills or strokes.
 */
export function convertLottieShapes(shapes: LottieShapeElement[]): LottieShapeConversion {
  const results: IRShape[] = [];
  const topStyles: PaintStyles = { fills: [], strokes: [] };
  const groups: Shape.Group[] = [];
  const collector: ShapeFeatureCollector = {
    approximatedFeatures: new Set(),
    hasRenderableGeometry: false,
    unsupportedFeatures: new Set(),
  };
  let topGeometry: Shape.Ellipse | Shape.Rectangle | Shape.PolyStar | null = null;
  let hasFillAbove = false;

  for (const shape of shapes) {
    if (shape.hd === true) {
      continue;
    }
    recordShapeFeatures(shape, collector);
    hasFillAbove = recordPaintOrder(shape.ty, hasFillAbove, collector);
    if (applyPaintItem(shape, topStyles)) {
      continue;
    }

    if (shape.ty === 'gr') {
      groups.push(shape);
    } else if (topGeometry == null && (shape.ty === 'el' || shape.ty === 'rc' || shape.ty === 'sr')) {
      topGeometry = shape;
    }
  }

  if (groups.length > 0) {
    for (const group of groups) {
      const groupShapes = convertShapeGroup(group.it ?? [], collector);

      for (const shapeData of groupShapes) {
        if (shapeData.fills.length === 0 && topStyles.fills.length > 0) {
          shapeData.fills = [...topStyles.fills];
        }
        if (shapeData.strokes.length === 0 && topStyles.strokes.length > 0) {
          shapeData.strokes = [...topStyles.strokes];
        }
      }
      results.push(...groupShapes);
    }
  } else if (topGeometry != null) {
    const convertedShape = buildShapeData(topGeometry, topStyles.fills, topStyles.strokes, null);

    if (convertedShape != null) {
      results.push(convertedShape);
    }
  }

  return {
    shapes: results.filter(shape => shape.fills.length > 0 || shape.strokes.length > 0).reverse(),
    approximatedFeatures: Array.from(collector.approximatedFeatures).sort(),
    hasRenderableGeometry: collector.hasRenderableGeometry,
    unsupportedFeatures: Array.from(collector.unsupportedFeatures).sort(),
  };
}

function convertShapeGroup(items: LottieShapeElement[], collector: ShapeFeatureCollector): IRShape[] {
  let geometry: Shape.Ellipse | Shape.Rectangle | Shape.PolyStar | null = null;
  const styles: PaintStyles = { fills: [], strokes: [] };
  let transform: Shape.Transform | null = null;
  const shPaths: Shape.Path[] = [];
  let nestedItems: LottieShapeElement[] | undefined;
  let hasFillAbove = false;

  for (const item of items) {
    if (item.hd === true) {
      continue;
    }
    recordShapeFeatures(item, collector);
    hasFillAbove = recordPaintOrder(item.ty, hasFillAbove, collector);
    if (nestedItems != null) {
      if (item.ty === 'gr') {
        collectDroppedGroupFeatures(item.it ?? [], collector);
      }
      continue;
    }
    if (applyPaintItem(item, styles)) {
      continue;
    }

    switch (item.ty) {
      case 'el':
      case 'rc':
      case 'sr':
        geometry = item;

        break;
      case 'sh':
        shPaths.push(item);

        break;
      case 'tr':
        transform = item;

        break;
      case 'gr':
        nestedItems = item.it ?? [];

        break;
    }
  }

  if (nestedItems != null) {
    return convertShapeGroup(nestedItems, collector);
  }

  if (geometry != null) {
    const shapeData = buildShapeData(geometry, styles.fills, styles.strokes, transform);

    return shapeData ? [shapeData] : [];
  }

  if (shPaths.length > 0) {
    const customShape = buildCustomShapeData(shPaths, styles.fills, styles.strokes, transform);

    return customShape ? [customShape] : [];
  }

  return [];
}

function clampRectangleCornerRadius(value: number, width: number, height: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const maxRadius = Math.min(Math.abs(width), Math.abs(height)) / 2;

  return Math.min(Math.max(value, 0), maxRadius);
}

function buildShapeData(
  geometry: Shape.Ellipse | Shape.Rectangle | Shape.PolyStar,
  fills: IRShapePaint[],
  strokes: IRShapeStroke[],
  transform: Shape.Transform | null,
): IRShape | null {
  const geoType = geometry.ty;
  let shapeData: IRShape;

  const geoPosition = getStaticArrayValue(geometry.p, [0, 0]);

  if (geoType === 'el') {
    const sizeArray = getStaticArrayValue(geometry.s, [100, 100]);
    const xRadius = sizeArray[0] / 2;
    const yRadius = sizeArray[1] / 2;

    shapeData = {
      primitiveType: IRShapePrimitiveType.Ellipse,
      xRadius,
      yRadius,
      fills,
      strokes,
      position: [geoPosition[0], geoPosition[1]],
    };
  } else if (geoType === 'rc') {
    const sizeArray = getStaticArrayValue(geometry.s, [100, 100]);
    const cornerRadius = clampRectangleCornerRadius(getStaticValue(geometry.r, 0), sizeArray[0], sizeArray[1]);

    shapeData = {
      primitiveType: IRShapePrimitiveType.Rectangle,
      width: sizeArray[0],
      height: sizeArray[1],
      cornerRadius,
      fills,
      strokes,
      position: [geoPosition[0], geoPosition[1]],
    };
  } else if (geoType === 'sr') {
    const pointCount = getStaticValue(geometry.pt, 5);
    const outerRadius = getStaticValue(geometry.or, 50);
    const outerRoundness = getStaticValue(geometry.os, 0);
    const innerRadius = 'ir' in geometry ? getStaticValue(geometry.ir, 0) : 0;
    const innerRoundness = 'is' in geometry ? getStaticValue(geometry.is, 0) : 0;

    if (innerRadius > 0) {
      shapeData = {
        primitiveType: IRShapePrimitiveType.Star,
        pointCount,
        innerRadius,
        outerRadius,
        innerRoundness,
        outerRoundness,
        fills,
        strokes,
        position: [geoPosition[0], geoPosition[1]],
      };
    } else {
      shapeData = {
        primitiveType: IRShapePrimitiveType.Polygon,
        pointCount,
        radius: outerRadius,
        roundness: outerRoundness,
        fills,
        strokes,
        position: [geoPosition[0], geoPosition[1]],
      };
    }
  } else {
    return null;
  }

  if (transform != null) {
    const trPosition = getStaticArrayValue(transform.p, [0, 0]);
    const trScale = getStaticArrayValue(transform.s, [100, 100]);
    const scaleX = trScale[0] / 100;
    const scaleY = trScale[1] / 100;

    switch (shapeData.primitiveType) {
      case IRShapePrimitiveType.Rectangle:
        shapeData.width *= scaleX;
        shapeData.height *= scaleY;
        if (shapeData.cornerRadius != null) {
          shapeData.cornerRadius = clampRectangleCornerRadius(
            shapeData.cornerRadius * Math.min(Math.abs(scaleX), Math.abs(scaleY)),
            shapeData.width,
            shapeData.height,
          );
        }

        break;
      case IRShapePrimitiveType.Ellipse:
        shapeData.xRadius *= scaleX;
        shapeData.yRadius *= scaleY;

        break;
      case IRShapePrimitiveType.Polygon:
        shapeData.radius *= Math.max(scaleX, scaleY);

        break;
      case IRShapePrimitiveType.Star:
        shapeData.outerRadius *= Math.max(scaleX, scaleY);
        shapeData.innerRadius *= Math.max(scaleX, scaleY);

        break;
    }

    // Gradient endpoints use the shape's local pixel space.
    for (const paint of [...shapeData.fills, ...shapeData.strokes.map(stroke => stroke.paint)]) {
      if ('gradientStart' in paint && paint.gradientStart != null) {
        paint.gradientStart = [paint.gradientStart[0] * scaleX, paint.gradientStart[1] * scaleY];
      }
      if ('gradientEnd' in paint && paint.gradientEnd != null) {
        paint.gradientEnd = [paint.gradientEnd[0] * scaleX, paint.gradientEnd[1] * scaleY];
      }
    }

    shapeData.position = [
      shapeData.position[0] * scaleX + trPosition[0],
      shapeData.position[1] * scaleY + trPosition[1],
    ];
  }

  return shapeData;
}

/** Maps Lottie `sh` vertices and relative tangents to an IR Bezier path. */
function convertSinglePath(shItem: Shape.Path): IRBezierPath | null {
  const ks = shItem.ks;

  if (ks == null) {
    return null;
  }

  const keyData = ks.k;

  if (keyData == null || Array.isArray(keyData) || keyData.v == null) {
    return null;
  }

  const vertices: number[][] = keyData.v;
  const relativeInTangents: number[][] = keyData.i ?? [];
  const relativeOutTangents: number[][] = keyData.o ?? [];
  const closed: boolean = keyData.c ?? false;

  const points: Array<{ x: number; y: number }> = [];
  const inTangents: Array<{ x: number; y: number }> = [];
  const outTangents: Array<{ x: number; y: number }> = [];

  for (let idx = 0; idx < vertices.length; idx++) {
    const vx = vertices[idx][0];
    const vy = vertices[idx][1];

    points.push({ x: vx, y: vy });

    const inTangent = relativeInTangents[idx] as number[] | undefined;
    const inX = inTangent != null ? inTangent[0] : 0;
    const inY = inTangent != null ? inTangent[1] : 0;

    inTangents.push({ x: inX, y: inY });

    const outTangent = relativeOutTangents[idx] as number[] | undefined;
    const outX = outTangent != null ? outTangent[0] : 0;
    const outY = outTangent != null ? outTangent[1] : 0;

    outTangents.push({ x: outX, y: outY });
  }

  return { points, inTangents, outTangents, closed };
}

function buildCustomShapeData(
  shPaths: Shape.Path[],
  fills: IRShapePaint[],
  strokes: IRShapeStroke[],
  transform: Shape.Transform | null,
): IRShape | null {
  const customPaths: IRBezierPath[] = [];

  for (const shItem of shPaths) {
    const path = convertSinglePath(shItem);

    if (path) {
      customPaths.push(path);
    }
  }

  if (customPaths.length === 0) {
    return null;
  }

  const position: [number, number] = [0, 0];

  if (transform != null) {
    const trPosition = getStaticArrayValue(transform.p, [0, 0]);

    position[0] = trPosition[0];
    position[1] = trPosition[1];
  }

  const shapeData: IRShape = {
    primitiveType: IRShapePrimitiveType.Custom,
    customPaths,
    fills,
    strokes,
    position,
  };

  return shapeData;
}
