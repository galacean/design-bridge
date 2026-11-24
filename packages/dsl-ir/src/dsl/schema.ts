import type { NumberExpression } from './number-expression';
import type { ParticleShape } from './particle-shape';

type Vector3 = [number, number, number];

/** One animation segment; scalar endpoints use single-element arrays, while vector endpoints keep their dimensions. */
export interface AnimationCurve<T extends number | number[] = number | number[]> {
  /** Segment start and end in seconds on the composition timeline. */
  t: [number, number];
  start: T extends number ? [number] : T;
  end: T extends number ? [number] : T;
  /** Cubic Bezier [x1, y1, x2, y2] over normalized segment time and progress. */
  easing: [number, number, number, number];
  /** Incoming/outgoing spatial offsets for position segments, in composition pixels. */
  in?: [number, number, number];
  out?: [number, number, number];
}

/** Static value or animated segments, discriminated by a; animation times are seconds, not IR frames. */
export type AnimatedProperty<T extends number | number[] = number | number[]> =
  { a: false; value: T } | { a: true; animation: AnimationCurve<T>[] };

/** Authoring descriptions for an element and its composition context; these do not affect Animation IR rendering. */
export interface Description {
  self: string;
  composite: string;
}

/** Caller-provided image at an absolute URL or Data URL; conversion resolves the reference without fetching it. */
export interface UserAsset {
  source: 'user';
  url: string;
  prompt: '';
}

/** Generated SVG and its prompt; conversion prefers a valid url, otherwise embeds svg as a Data URL. */
export interface LLMSVGAsset {
  source: 'llm_svg';
  format: 'svg';
  svg: string;
  prompt: string;
  url?: string;
}

/** Image input: user assets require an absolute URL or Data URL; generated SVG can fall back to inline content. */
export type Asset = UserAsset | LLMSVGAsset;

/** Editable text style; font names resolve to system fonts when converted to Animation IR. */
export interface TextProperties {
  content: string;
  font?: string;
  /** Font size in composition pixels; finite and greater than zero. */
  size: number;
  color: string;
  align?: 'left' | 'center' | 'right';
  /** Absolute line height in composition pixels; greater than zero. Omission uses size * 1.2. */
  line_height?: number;
  /** Additional spacing in composition pixels, independent of size; negative values are allowed. */
  letter_spacing?: number;
}

/** Editable particle capacity and lifetime; emitter geometry and rendering settings remain source-owned. */
export interface ParticleOptions {
  /** Positive integer limit on simultaneously living particles. */
  maxCount: number;
  /** Particle lifetime in seconds, expressed as a constant or random range. */
  startLifetime: NumberExpression;
}

/** Scheduled particle emission relative to Layer activation; finite cycles must fit within the Layer duration. */
export interface ParticleBurst {
  /** Seconds from the particle Layer's activation start. */
  time: number;
  count: number;
  /** Total cycles. Omitted or zero means unbounded repetition until the layer ends. */
  cycles?: number;
  /** Seconds between repeated cycles. Required to be positive when repetition is enabled. */
  interval?: number;
}

/** Continuous emission and optional bursts; DSL uses seconds and supports constant or random rates. */
export interface ParticleEmissionProperties {
  /** Particles emitted per second. */
  rateOverTime: NumberExpression;
  bursts?: ParticleBurst[];
}

/** Editable particle lifetime and emission; renderer, resources and emitter geometry remain source-owned. */
export interface ParticleProperties {
  /** Read-only emitter geometry supplied by source adapters when available. */
  shape?: ParticleShape;
  options: ParticleOptions;
  emission: ParticleEmissionProperties;
}

/** Missing optional transform channels retain source values on write-back; fresh conversion uses identity defaults. */
interface LayerBase {
  id: string;
  name: string;
  width: number;
  height: number;
  description: Description;
  parent?: string | null;
  /** Start and end in composition seconds; omission retains source timing or uses the new composition duration. */
  time_range?: [number, number];
  /** Parent-local pixels; text origin is its horizontal alignment point on the first baseline. Initial Z ranks siblings. */
  position: AnimatedProperty<Vector3>;
  /** Euler angles in degrees. */
  rotation?: AnimatedProperty<Vector3>;
  /** Unitless axis multipliers. */
  scale?: AnimatedProperty<Vector3>;
  /** Static anchor in layer-local pixels. */
  anchor?: { a: false; value: Vector3 };
  /** Unitless opacity in [0, 1]; animated endpoints are single-element arrays. */
  opacity?: AnimatedProperty<number>;
  asset?: Asset;
  text?: TextProperties;
  particle?: ParticleProperties;
  children?: Layer[];
}

/**
 * Editable Layer. Visual variants require asset, text, or particle content according to `type`.
 *
 * @remarks
 * `time_range` gives the start and end in seconds on the composition timeline. Fresh conversion defaults
 * omitted fields to `[0, meta.duration]` for timing, zero rotation and anchor, unit scale, and full opacity.
 * When writing back to an existing layer, omitted timing and transform fields retain their source values.
 *
 * `position` uses parent-local pixels for X and Y, or composition pixels for root layers. The initial Z
 * value determines stacking order among siblings.
 */
export type Layer = LayerBase & (
  { type: 'null' } | { type: 'layer'; asset: Asset } |
  { type: 'text'; text: TextProperties } | { type: 'particle'; particle: ParticleProperties }
);

/** Canvas and playback settings; time is measured in seconds and dimensions in pixels. */
export interface CompositionMeta {
  name: string;
  /** Finite positive duration in seconds. */
  duration: number;
  /** Finite positive frames per second; fractional rates are supported. */
  fps: number;
  /** Finite positive canvas dimensions in composition pixels; fractional sizes are supported. */
  width: number;
  height: number;
  loop: boolean;
  background_color?: string | null;
}

/** Public DSL document. Its runtime shape matches the persisted DSL JSON. */
export interface Composition {
  meta: CompositionMeta;
  layers: Layer[];
}
