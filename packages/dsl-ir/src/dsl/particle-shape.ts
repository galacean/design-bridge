/** Source emitter arc-distribution tag, retained for context; DSL edits do not change emitter geometry. */
export type ParticleShapeArcMode = 0 | 1 | 2 | 3;

/** Descriptive emitter name derived from the source type tag by parseParticleShape. */
export type ParticleShapeName = ParticleShape['shape'];

/** Source expression retained only to describe emitter direction. */
export type ParticleShapeNumberExpression = [type: number, value: unknown];

interface ParticleShapeBase {
  arcMode: ParticleShapeArcMode;
  alignSpeedDirection?: boolean;
  upDirection?: [x: number, y: number, z: number];
  turbulenceX?: ParticleShapeNumberExpression;
  turbulenceY?: ParticleShapeNumberExpression;
  turbulenceZ?: ParticleShapeNumberExpression;
}

interface ParticleShapeNone {
  type: 0;
  shape: 'None';
  turbulenceX?: ParticleShapeNumberExpression;
  turbulenceY?: ParticleShapeNumberExpression;
  turbulenceZ?: ParticleShapeNumberExpression;
  upDirection?: number[];
}

interface ParticleShapeSphere extends ParticleShapeBase {
  type: 1;
  shape: 'Sphere';
  radius: number;
  arc: number;
}

interface ParticleShapeCone extends ParticleShapeBase {
  type: 2;
  shape: 'Cone';
  angle: number;
  radius: number;
  arc: number;
}

interface ParticleShapeHemisphere extends ParticleShapeBase {
  type: 3;
  shape: 'Hemisphere';
  radius: number;
  arc: number;
}

interface ParticleShapeCircle extends ParticleShapeBase {
  type: 4;
  shape: 'Circle';
  radius: number;
  arc: number;
}

interface ParticleShapeDonut extends ParticleShapeBase {
  type: 5;
  shape: 'Donut';
  radius: number;
  donutRadius: number;
  arc: number;
}

interface ParticleShapeRectangle extends ParticleShapeBase {
  type: 6;
  shape: 'Rectangle';
  width: number;
  height: number;
}

interface ParticleShapeRectangleEdge extends ParticleShapeBase {
  type: 7;
  shape: 'RectangleEdge';
  width: number;
  height: number;
}

interface ParticleShapeEdge extends ParticleShapeBase {
  type: 8;
  shape: 'Edge';
  width: number;
}

/** Source texture-emitter sampling data retained for context; it is not an editable DSL emission control. */
export interface ParticleTextureShapeDetail {
  width: number;
  height: number;
  block: [width: number, height: number];
  anchors: number[];
}

interface ParticleShapeTexture extends ParticleShapeBase {
  type: 9;
  shape: 'Texture';
  detail: ParticleTextureShapeDetail;
  random: number;
  width: number;
  height: number;
}

/** Particle emitter geometry projected from a source adapter for model context. */
export type ParticleShape =
  ParticleShapeNone | ParticleShapeSphere | ParticleShapeCone |
  ParticleShapeHemisphere | ParticleShapeCircle | ParticleShapeDonut |
  ParticleShapeRectangle | ParticleShapeRectangleEdge | ParticleShapeEdge |
  ParticleShapeTexture;
