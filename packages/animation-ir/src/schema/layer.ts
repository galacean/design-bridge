import type { IRParticleContent } from './particle.js';
import type { IRBezierPath, IRShape } from './shape.js';
import type { IRColor, IREndBehavior, IRLayerTime, IRPrecompTime, IRTransform } from './value-types.js';

/**
 * Non-empty [start, end) range in UTF-16 code units; must not split surrogate pairs.
 * Omitted styles inherit from IRTextContent.
 */
export interface IRTextStyleRange {
  start: number;
  end: number;
  /** Resolves family, weight and style from a Font Asset. */
  fontAssetId?: string;
  fontSize?: number;
  color?: IRColor;
  letterSpacing?: number;
}

/** Static text with block layout and range styles; font fallback, shaping and glyph metrics are consumer-defined. */
export interface IRTextContent {
  color: IRColor;
  text: string;
  fontAssetId: string;
  /** Font size in Layer-local pixels. */
  fontSize: number;
  /** Additional character spacing in local pixels; independent of fontSize, may be negative. */
  letterSpacing: number;
  /** Vertical advance between lines in Layer-local pixels, not a fontSize multiplier. */
  lineHeight: number;
  textAlign: 'left' | 'center' | 'right';
  /** Sorted, non-overlapping; uncovered text keeps the default style. */
  styleRanges?: IRTextStyleRange[];
  /**
   * Defaults to auto-width. Fixed constrains both localBounds dimensions; auto-height constrains width.
   * Other dimensions are measured from text after line breaking.
   */
  sizeMode?: 'fixed' | 'auto-width' | 'auto-height';
  /**
   * Defaults to false (only explicit \n breaks). True wraps to the constrained width;
   * requires fixed or auto-height. Break opportunities are consumer-defined.
   */
  wrap?: boolean;
  /**
   * Defaults to visible. Clip crops to the resolved box; shrink uniformly reduces the laid-out block,
   * including spacing, to fit without reflow. Resolve wrapping and dimensions before overflow, then alignment.
   */
  overflow?: 'visible' | 'clip' | 'shrink';
  /** Defaults to top; aligns within the resolved box after shrinking. */
  verticalAlign?: 'top' | 'center' | 'bottom';
}

/** Operations used to combine paths in the ordered Layer mask stack. */
export const IRMaskMode = {
  Add: 'add',
  Subtract: 'subtract',
  Intersect: 'intersect',
} as const;

/** Selects how an authored path adds to, subtracts from or intersects Layer coverage. */
export type IRMaskMode = (typeof IRMaskMode)[keyof typeof IRMaskMode];

/** One authored, fully opaque, static entry in a Layer mask stack. */
export interface IRMask {
  path: IRBezierPath;
  mode: IRMaskMode;
  inverted?: boolean;
}

/** Coverage sources for mattes: geometry, alpha or luminance of another Layer. */
export const IRMatteMode = {
  Geometry: 'geometry',
  Alpha: 'alpha',
  Luminance: 'luminance',
} as const;

/** Selects which property of the referenced matte Layer supplies coverage. */
export type IRMatteMode = (typeof IRMatteMode)[keyof typeof IRMatteMode];

/** Uses another Layer as coverage without changing that source Layer's own compositing. */
export interface IRLayerMatte {
  sourceLayerId: string;
  mode: IRMatteMode;
  inverted?: boolean;
}

/** Layer discriminants; each variant requires its corresponding content and bounds. */
export const IRLayerType = {
  Precomp: 'precomp',
  Solid: 'solid',
  Image: 'image',
  Null: 'null',
  Shape: 'shape',
  Text: 'text',
  Particle: 'particle',
} as const;

/** Discriminant used to narrow the IRLayer union to a specific content contract. */
export type IRLayerType = (typeof IRLayerType)[keyof typeof IRLayerType];

/** Layer compositing modes; an omitted blendMode uses normal compositing. */
export const IRBlendMode = {
  Normal: 'normal',
  Multiply: 'multiply',
  Screen: 'screen',
  Overlay: 'overlay',
  Darken: 'darken',
  Lighten: 'lighten',
  ColorDodge: 'color-dodge',
  ColorBurn: 'color-burn',
  HardLight: 'hard-light',
  SoftLight: 'soft-light',
  Difference: 'difference',
  Exclusion: 'exclusion',
  Hue: 'hue',
  Saturation: 'saturation',
  Color: 'color',
  Luminosity: 'luminosity',
  Add: 'add',
} as const;

/** Layer compositing mode; support for individual modes depends on the target renderer. */
export type IRBlendMode = (typeof IRBlendMode)[keyof typeof IRBlendMode];

/** Layer-local pixel bounds; these describe content and do not add a Transform translation. */
export interface IRLocalBounds {
  /** Left edge in Layer-local pixels. */
  x: number;
  /** Top edge in Layer-local pixels. */
  y: number;
  width: number;
  height: number;
}

/** Shared Layer contract; parenting affects transforms, while array order controls painting. */
export interface IRLayerBase {
  /** Opaque identity unique within the owning Composition. */
  id: string;
  name?: string;
  time: IRLayerTime;
  /** Playback behavior after outFrame; defaults to destroy. */
  endBehavior?: IREndBehavior;
  /** Transform Parent in the same Composition; does not control visibility or order. */
  parentId?: string;
  visible: boolean;
  transform?: IRTransform;
  blendMode?: IRBlendMode;
  /** Ordered authored Mask stack; Precomp canvas clipping lives in content.clipToBounds. */
  masks?: IRMask[];
  matte?: IRLayerMatte;
  /** Source-neutral bounds for interpreting anchor and content coordinates. */
  localBounds?: IRLocalBounds;
}

/** Image reference whose display dimensions are supplied by the owning Layer's localBounds. */
export interface IRImageContent {
  /** Resolves an Image Asset in the owning Scene registry. */
  assetId: string;
}

/** Image instance with required display bounds independent of the referenced resource dimensions. */
export interface IRImageLayer extends IRLayerBase {
  type: 'image';
  content: IRImageContent;
  /** Display bounds are independent of resource dimensions. */
  localBounds: IRLocalBounds;
}

/** Static text, styles and layout animated through the Layer transform. */
export interface IRTextLayer extends IRLayerBase {
  type: 'text';
  content: IRTextContent;
  /**
   * Layout box in local pixels, not glyph bounds; defaults to origin (0, 0) when omitted.
   * Required for fixed/auto-height, with positive constrained dimensions. Automatic dimensions are
   * finite non-negative measurement hints (0 if unmeasured); recompute from text, never use as constraints.
   * Resizing preserves the origin and transform anchor.
   */
  localBounds?: IRLocalBounds;
}

/** Uniform normalized RGBA fill covering the owning Layer's localBounds. */
export interface IRSolidContent {
  color: IRColor;
}

/** Solid color rectangle defined by localBounds and animated through the Layer transform. */
export interface IRSolidLayer extends IRLayerBase {
  type: 'solid';
  content: IRSolidContent;
  localBounds: IRLocalBounds;
}

/** Vector geometry and paints with independent animation; shape order is independent of Layer parenting. */
export interface IRShapeContent {
  /** Back-to-front painter order: first is bottommost, last is topmost. */
  shapes: IRShape[];
}

/** Ordered shapes with content animation and a shared Layer transform. */
export interface IRShapeLayer extends IRLayerBase {
  type: 'shape';
  content: IRShapeContent;
}

/** Particle parameters with authoring bounds; emitter geometry and renderer data remain adapter-owned. */
export interface IRParticleLayer extends IRLayerBase {
  type: 'particle';
  content: IRParticleContent;
  /** Authoring bounds used for placement; particle emission geometry remains adapter-owned. */
  localBounds: IRLocalBounds;
}

/** Non-rendering transform and hierarchy node. */
export interface IRNullLayer extends IRLayerBase {
  type: 'null';
}

/** References a Scene Composition and controls instance clipping and source timeline end behavior. */
export interface IRPrecompContent {
  /** Resolves a Composition in the owning Scene. */
  compositionId: string;
  /** Clips this instance to the referenced Composition canvas. */
  clipToBounds: boolean;
  /** Overrides source timeline behavior; does not keep an inactive parent instance visible. */
  endBehavior?: IREndBehavior;
}

/** Instance of another Composition with an independent source-time mapping. */
export interface IRPrecompLayer extends IRLayerBase {
  type: 'precomp';
  time: IRPrecompTime;
  content: IRPrecompContent;
}

/** Composition content discriminated by type; each variant defines its required content and bounds. */
export type IRLayer =
  | IRImageLayer | IRTextLayer | IRSolidLayer | IRShapeLayer | IRPrecompLayer
  | IRNullLayer | IRParticleLayer;
