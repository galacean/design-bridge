import type { IRBezierPath, IRGradientColorStop } from './shape.js';

/**
 * Behavior after the timeline's exclusive end: destroy deactivates, continue advances local time,
 * freeze holds the last pre-end state, and loop wraps to the start.
 * For positive duration, loop samples start + ((frame - start) % (end - start)) after reaching end.
 * Exact freeze subframe sampling and zero-duration loop/freeze behavior are consumer-defined.
 */
export const IREndBehavior = {
  Destroy: 'destroy',
  Loop: 'loop',
  Continue: 'continue',
  Freeze: 'freeze',
} as const;

/** Timeline end policy; see the IREndBehavior constants for sampling semantics. */
export type IREndBehavior = (typeof IREndBehavior)[keyof typeof IREndBehavior];

/** Two-dimensional tuple whose coordinate meaning is defined by the owning field. */
export type IRVec2 = [number, number];

/** Three-dimensional tuple whose coordinate meaning is defined by the owning field. */
export type IRVec3 = [number, number, number];

/** Normalized RGBA in 0..1; color space and premultiplication conventions are not specified. */
export type IRColor = [number, number, number, number];

/** Equal endpoints define an empty activation interval; a reversed interval is invalid. */
export interface IRLayerTime {
  /** Inclusive activation frame in the parent Composition frame domain. */
  inFrame: number;
  /** Exclusive deactivation frame in the parent Composition frame domain. */
  outFrame: number;
}

/**
 * Source-time mapping owned by a Precomp instance.
 * Source frame = sourceStartFrame + (parentFrame - inFrame) * sourceFps / (parentFps * stretch).
 * Apply the referenced Composition's end behavior after this mapping. The instance Transform
 * remains in parent frames; referenced Layers are sampled in source frames.
 */
export interface IRPrecompTime extends IRLayerTime {
  /** Referenced Composition frame shown at inFrame. Defaults to its inPoint. */
  sourceStartFrame?: number;
  /** Positive source-time stretch; 2 means half-speed playback. Defaults to 1. */
  stretch?: number;
}

/**
 * X points right and Y down. For 2D column vectors:
 * local = T(position) * Rz(rotation.z) * S(scale) * T(-anchor); world = parentWorld * local.
 * Positive Z rotation is clockwise on screen; negative scale mirrors the corresponding axis.
 * Bounds do not add another translation, and anchor is in local pixels, not normalized bounds units.
 */
export interface IRTransform {
  /** Parent-space x/y pixels plus z depth; defaults to [0, 0, 0]. */
  position?: IRAnimatedProperty<IRVec3>;
  /** Layer-local x/y pixels plus z depth; defaults to [0, 0, 0]. */
  anchor?: IRStaticProperty<IRVec3>;
  /** Unitless factors; defaults to [1, 1, 1]. */
  scale?: IRAnimatedProperty<IRVec3>;
  /** Euler degrees; missing axes default to 0. */
  rotation?: IRRotation;
  /** Normalized 0..1 value; defaults to 1. */
  opacity?: IRAnimatedProperty<number>;
}

/**
 * Independently animated Euler degrees, interpolated numerically without shortest-angle wrapping.
 * A 2D rotation uses only z; combined-axis order, projection and depth compositing are not specified.
 */
export interface IRRotation {
  x?: IRAnimatedProperty<number>;
  y?: IRAnimatedProperty<number>;
  z?: IRAnimatedProperty<number>;
}

/**
 * Position-path control offset in pixels. Arc-length versus parameter sampling, one-sided handle
 * completion and the Z component of 2D handles on 3D positions are consumer-defined.
 */
export type IRSpatialTangent = IRVec2 | IRVec3;
/** Numeric property payload; the owning channel determines tuple dimensions, units and valid ranges. */
export type IRPropertyValue = number | IRVec2 | IRVec3 | IRColor | IRGradientColorStop[] | IRBezierPath[];

/** Segment-normalized time/value coordinates; x is in 0..1 and y may overshoot. */
export interface IRBezierHandle {
  x: number;
  y: number;
}

/**
 * Tangents belong to the keyframe where they are stored. A segment from `current` to `next` uses
 * `current.outTangent` or `current.spatialOut` and `next.inTangent` or `next.spatialIn`.
 * `endValue` and `hold` describe the outgoing segment. Fields without a corresponding segment are ignored.
 * A single keyframe holds its value across the sampled range.
 * For A -> B, end = A.endValue ?? B.value. Unless A.hold is true, solve C(u).x =
 * (frame - A.frame) / (B.frame - A.frame), where C has controls [0,0], A.outTangent,
 * B.inTangent, [1,1]; interpolate each value component using C(u).y.
 * Omitting both temporal handles gives linear interpolation. One-sided completion, extrapolation
 * and exact discontinuity-boundary sampling are not specified; supply both handles for portability.
 * Position-path controls are A.value + A.spatialOut and end + B.spatialIn.
 * Gradient stops and path coordinates interpolate component-wise by array index; their owning fields
 * define compatible structures. Spatial tangents apply only to transform.position.
 */
export interface IRKeyframe<T extends IRPropertyValue = IRPropertyValue> {
  /** Absolute Composition frame, including subframes; do not add Layer inFrame. */
  frame: number;
  value: T;
  /** Segment end value; may differ from the next keyframe's start value. */
  endValue?: T;
  hold?: boolean;
  inTangent?: IRBezierHandle;
  outTangent?: IRBezierHandle;
  /** Pixel offset from this outgoing segment's start position. */
  spatialOut?: IRSpatialTangent;
  /** Pixel offset from the preceding segment's end position. */
  spatialIn?: IRSpatialTangent;
}

/** Discriminants for constant properties and tracks sampled in Composition frames. */
export const IRPropertyType = {
  Static: 'static',
  Keyframed: 'keyframed',
} as const;

/** A value held constant across the timeline; units and bounds come from the owning channel. */
export interface IRStaticProperty<T extends IRPropertyValue = IRPropertyValue> {
  type: typeof IRPropertyType.Static;
  value: T;
}

/** Keyframes in the owning Composition's frame domain, independent of the Layer activation interval. */
export interface IRKeyframedProperty<T extends IRPropertyValue = IRPropertyValue> {
  type: typeof IRPropertyType.Keyframed;
  /** Non-empty, strictly increasing frames; may extend beyond the Layer interval. */
  keyframes: IRKeyframe<T>[];
}

/** A constant value or keyframed track, discriminated by type; units come from the owning field. */
export type IRAnimatedProperty<T extends IRPropertyValue = IRPropertyValue> =
  IRStaticProperty<T> | IRKeyframedProperty<T>;
