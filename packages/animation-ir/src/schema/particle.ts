/** Discriminants for particle scalars: fixed values, uniform random ranges and normalized emitter-progress curves. */
export const IRParticleExpressionType = {
  Constant: 'constant',
  RandomBetweenConstants: 'randomBetweenConstants',
  Curve: 'curve',
} as const;

/** Source-neutral scalar used by particle parameters. */
export type IRParticleScalarExpression =
  | IRParticleConstantExpression
  | IRParticleRandomBetweenConstantsExpression
  | IRParticleCurveExpression;

/** Fixed particle parameter; units and valid ranges are defined by the field using the expression. */
export interface IRParticleConstantExpression {
  type: typeof IRParticleExpressionType.Constant;
  value: number;
}

/** A value sampled uniformly from the inclusive `min..max` range. */
export interface IRParticleRandomBetweenConstantsExpression {
  type: typeof IRParticleExpressionType.RandomBetweenConstants;
  min: number;
  max: number;
}

/** Absolute curve coordinate; Bezier controls may extend beyond the keyframe progress and value ranges. */
export interface IRParticleCurvePoint {
  /** Emitter progress for lifetime and emission rate; control points use absolute coordinates. */
  progress: number;
  value: number;
}

/**
 * A keyframe on a normalized 0..1 parameter curve. Controls use absolute curve coordinates.
 * `hold` describes the outgoing segment; otherwise controls select Bezier interpolation and
 * a segment without controls is linear.
 * Segment A -> B uses A.outControl and B.inControl; solve the cubic's progress coordinate
 * before reading its value. Single-sided controls, extrapolation and non-monotonic progress
 * control handling are consumer-defined.
 */
export interface IRParticleCurveKeyframe extends IRParticleCurvePoint {
  hold?: boolean;
  inControl?: IRParticleCurvePoint;
  outControl?: IRParticleCurvePoint;
}

/** Non-empty curve with strictly increasing keyframe progress in [0, 1], evaluated over the emitter cycle. */
export interface IRParticleCurveExpression {
  type: typeof IRParticleExpressionType.Curve;
  keyframes: IRParticleCurveKeyframe[];
}

/**
 * Cycle k fires at Layer inFrame + frameOffset + k * repeatIntervalFrames, starting at k = 0.
 * Finite cycles must all fire before outFrame; infinite cycles remain subject to emitter activity.
 * Frame offsets use the owning Composition's frame rate when converted to seconds.
 */
export interface IRParticleBurst {
  /** Trigger offset in frames relative to the Layer inFrame. */
  frameOffset: number;
  /** Non-negative integer particles per burst. */
  count: number;
  /** Total number of burst cycles, or an unbounded cycle sequence. */
  cycleCount: number | 'infinite';
  /** Positive frame interval for repeated bursts; a single cycle may use zero. */
  repeatIntervalFrames: number;
}

/** Continuous emission and optional bursts; scheduling and capacity handling are consumer-defined. */
export interface IRParticleEmission {
  /** Particles per second, evaluated at normalized emitter progress. */
  rateOverTime: IRParticleScalarExpression;
  /** Omitted and empty arrays both mean no bursts. */
  bursts?: IRParticleBurst[];
}

/**
 * Curves use emitter progress (frame - inFrame) / (outFrame - inFrame) within a positive-duration
 * playback cycle. Lifetime uses the owning Composition's frames and emission rate uses particles per second.
 * Random seeds/resampling, discrete emission integration, capacity scheduling and surviving particles
 * after emission stops are consumer-defined; these parameters do not specify a complete particle renderer.
 */
export interface IRParticleContent {
  /** Maximum number of simultaneously living particles. */
  maxParticles: number;
  /** Positive duration in Composition frames, sampled at birth. Fractional frames are supported. */
  startLifetime: IRParticleScalarExpression;
  emission: IRParticleEmission;
}
