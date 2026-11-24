/** Wire tags for the supported particle expressions; other GE expression tags are not accepted by DSL. */
export enum ValueType {
  CONSTANT = 0,
  RANDOM = 4,
}

/** Constant [0, value] or random [4, [min, max]]; units are defined by the owning particle field. */
export type NumberExpression = ConstantNumber | RandomValue;

/** Fixed particle value encoded as [0, value]; units and valid range come from the owning field. */
export type ConstantNumber = [type: ValueType.CONSTANT, value: number];

/** Random particle range encoded as [4, [min, max]]; min must not exceed max. */
export type RandomValue = [type: ValueType.RANDOM, value: [min: number, max: number]];
