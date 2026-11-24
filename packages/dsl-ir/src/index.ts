export { convertDSLToIR } from './dsl2ir/convert';
export { convertIRToDSL } from './ir2dsl/convert';
export { DSLValidationError, validateDSL } from './dsl/validator';

export type {
  AnimationCurve,
  AnimatedProperty,
  Asset,
  Composition,
  CompositionMeta,
  Description,
  Layer,
  LLMSVGAsset,
  ParticleBurst,
  ParticleEmissionProperties,
  ParticleOptions,
  ParticleProperties,
  TextProperties,
  UserAsset,
} from './dsl/schema';
export { ValueType } from './dsl/number-expression';
export type {
  ConstantNumber, NumberExpression, RandomValue,
} from './dsl/number-expression';
export type {
  ParticleShape, ParticleShapeArcMode, ParticleShapeName,
  ParticleShapeNumberExpression, ParticleTextureShapeDetail,
} from './dsl/particle-shape';
export type { DSLValidationIssue, DSLValidationResult } from './dsl/validator';

export type {
  DSLToIROptions, DSLParticleSource, DSLToIRChange, DSLToIRResult, DSLToIRWarning,
} from './dsl2ir/types';
export type { IRToDSLPreservedData, IRToDSLResult } from './ir2dsl/types';

export { parseParticleShape } from './dsl/parse-particle-shape';
