import type { IRAnimatedProperty, IRColor, IRVec2 } from './value-types.js';

/**
 * Local-pixel cubic path. Segment i -> j uses controls points[i], points[i] + outTangents[i],
 * points[j] + inTangents[j], points[j]. Both tangent arrays have one entry per vertex.
 * A closed path also connects the last vertex to the first; zero offsets coincide with vertices.
 */
export interface IRBezierPath {
  points: Array<{ x: number; y: number }>;
  inTangents: Array<{ x: number; y: number }>;
  outTangents: Array<{ x: number; y: number }>;
  closed: boolean;
}

/** Discriminants for solid, gradient and image paints used by Shape fills and strokes. */
export const IRPaintType = {
  Solid: 'solid',
  LinearGradient: 'linear-gradient',
  RadialGradient: 'radial-gradient',
  AngularGradient: 'angular-gradient',
  Texture: 'texture',
} as const;

/** Selects the payload required by a Shape fill or stroke paint. */
export type IRPaintType = (typeof IRPaintType)[keyof typeof IRPaintType];

/** Gradient color stop: [position(0..1), r, g, b, a]. */
export type IRGradientColorStop = [number, number, number, number, number];

/** Uniform normalized RGBA paint shared by Shape fills and strokes. */
export interface IRSolidPaint {
  type: typeof IRPaintType.Solid;
  color: IRAnimatedProperty<IRColor>;
  /** 0..1, default 1; multiplies color alpha and Layer opacity. */
  opacity?: IRAnimatedProperty<number>;
}

/** Animated gradient with ordered color stops and endpoints in local pixels. */
export interface IRGradientPaint {
  type: typeof IRPaintType.LinearGradient | typeof IRPaintType.RadialGradient | typeof IRPaintType.AngularGradient;
  /** Non-empty, sorted stops; interpolation requires equal counts and pairs stops by index. */
  gradientStops: IRAnimatedProperty<IRGradientColorStop[]>;
  gradientStart: IRAnimatedProperty<IRVec2>;
  gradientEnd: IRAnimatedProperty<IRVec2>;
  /** 0..1, default 1; multiplies stop alpha and Layer opacity. */
  opacity?: IRAnimatedProperty<number>;
}

/** Image placement policies within Shape bounds; individual values describe scaling and repetition. */
export const IRTextureScaleMode = {
  /** Stretch independently on each axis to fill the Shape bounds. */
  Fill: 'fill',
  /** Preserve aspect ratio and contain the image, allowing uncovered bounds. */
  Fit: 'fit',
  /** Preserve aspect ratio and cover the bounds, clipping overflow. */
  Crop: 'crop',
  /** Preserve intrinsic scale and repeat the image across the bounds. */
  Tile: 'tile',
} as const;

/** Selects how a texture covers Shape bounds while scaling, cropping or repeating the image. */
export type IRTextureScaleMode = (typeof IRTextureScaleMode)[keyof typeof IRTextureScaleMode];

/** Static image paint; assetId must resolve to an Image Asset in the owning Scene. */
export interface IRTexturePaint {
  type: typeof IRPaintType.Texture;
  assetId: string;
  scaleMode?: IRTextureScaleMode;
  /** 0..1, default 1; multiplies texture alpha and Layer opacity. */
  opacity?: IRAnimatedProperty<number>;
}

/** Paint shared by fills and strokes; the type discriminant selects the required payload. */
export type IRShapePaint = IRSolidPaint | IRGradientPaint | IRTexturePaint;

/** Endpoint treatments for open stroked paths: flush, semicircular or square extensions. */
export const IRLineCap = {
  Butt: 'butt',
  Round: 'round',
  Square: 'square',
} as const;

/** Controls the appearance of open path endpoints when a Shape stroke is drawn. */
export type IRLineCap = (typeof IRLineCap)[keyof typeof IRLineCap];

/** Corner treatments where stroked path segments meet: miter, round or bevel. */
export const IRLineJoin = {
  Miter: 'miter',
  Round: 'round',
  Bevel: 'bevel',
} as const;

/** Controls how adjacent path segments meet when a Shape stroke is drawn. */
export type IRLineJoin = (typeof IRLineJoin)[keyof typeof IRLineJoin];

/** One stroke paint and its independent local-pixel geometry. */
export interface IRShapeStroke {
  paint: IRShapePaint;
  /** Non-negative local pixels. */
  width: IRAnimatedProperty<number>;
  cap: IRLineCap;
  join: IRLineJoin;
}

/** Geometry discriminants for custom paths and parameterized Shape primitives. */
export const IRShapePrimitiveType = {
  Custom: 'custom',
  Rectangle: 'rectangle',
  Ellipse: 'ellipse',
  Polygon: 'polygon',
  Star: 'star',
} as const;

/** Discriminant used to narrow IRShape to the matching geometry contract. */
export type IRShapePrimitiveType = (typeof IRShapePrimitiveType)[keyof typeof IRShapePrimitiveType];

/** Independently animated geometry and paints, positioned in Layer-local pixels. */
export interface IRShapeStyle {
  /** Bottom-to-top; every fill is painted before every stroke. */
  fills: IRShapePaint[];
  /** Bottom-to-top above all fills. */
  strokes: IRShapeStroke[];
  position: IRAnimatedProperty<IRVec2>;
}

/** Compound cubic paths in local pixels; all paths share the Shape's fills, strokes and nonzero winding rule. */
export interface IRCustomShape extends IRShapeStyle {
  primitiveType: typeof IRShapePrimitiveType.Custom;
  /**
   * Non-empty. Continuous segments match paths and vertices by index, preserving path counts,
   * per-path vertex counts and closed flags. Coordinates and tangent offsets interpolate independently;
   * hold segments may change topology.
   */
  customPaths: IRAnimatedProperty<IRBezierPath[]>;
}

/** Rectangle with dimensions and optional rounded corners in local pixels. */
export interface IRRectangleShape extends IRShapeStyle {
  primitiveType: typeof IRShapePrimitiveType.Rectangle;
  width: IRAnimatedProperty<number>;
  height: IRAnimatedProperty<number>;
  /** Default 0; non-negative pixels, at most half the shorter sampled edge. */
  cornerRadius?: IRAnimatedProperty<number>;
}

/** Ellipse with independent horizontal and vertical radii in local pixels. */
export interface IREllipseShape extends IRShapeStyle {
  primitiveType: typeof IRShapePrimitiveType.Ellipse;
  xRadius: IRAnimatedProperty<number>;
  yRadius: IRAnimatedProperty<number>;
}

/** Regular polygon defined by a local-pixel radius, vertex count and optional corner rounding. */
export interface IRPolygonShape extends IRShapeStyle {
  primitiveType: typeof IRShapePrimitiveType.Polygon;
  pointCount: number;
  radius: IRAnimatedProperty<number>;
  /** Percentage in the 0..100 range; default 0. */
  roundness?: IRAnimatedProperty<number>;
}

/** Star with alternating inner and outer radii in local pixels and independently rounded corners. */
export interface IRStarShape extends IRShapeStyle {
  primitiveType: typeof IRShapePrimitiveType.Star;
  pointCount: number;
  innerRadius: IRAnimatedProperty<number>;
  outerRadius: IRAnimatedProperty<number>;
  /** Percentage in the 0..100 range; default 0. */
  innerRoundness?: IRAnimatedProperty<number>;
  /** Percentage in the 0..100 range; default 0. */
  outerRoundness?: IRAnimatedProperty<number>;
}

/** Vector geometry discriminated by primitiveType; each Shape carries its own paints and local position. */
export type IRShape =
  | IRCustomShape | IRRectangleShape | IREllipseShape
  | IRPolygonShape | IRStarShape;
