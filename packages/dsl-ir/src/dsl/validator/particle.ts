import { isRecord } from '../../common/utils';
import { ValueType } from '../number-expression';

type DSLRecord = Record<string, unknown>;

const PARTICLE_SHAPE_NAMES = [
  'None', 'Sphere', 'Cone', 'Hemisphere', 'Circle',
  'Donut', 'Rectangle', 'RectangleEdge', 'Edge', 'Texture',
] as const;
const PARTICLE_SHAPE_BASE_FIELDS = [
  'type', 'shape', 'arcMode', 'alignSpeedDirection', 'upDirection',
  'turbulenceX', 'turbulenceY', 'turbulenceZ',
] as const;
const PARTICLE_SHAPE_FIELDS_BY_TYPE: Readonly<Record<number, readonly string[]>> = {
  0: ['type', 'shape', 'upDirection', 'turbulenceX', 'turbulenceY', 'turbulenceZ'],
  1: [...PARTICLE_SHAPE_BASE_FIELDS, 'radius', 'arc'],
  2: [...PARTICLE_SHAPE_BASE_FIELDS, 'angle', 'radius', 'arc'],
  3: [...PARTICLE_SHAPE_BASE_FIELDS, 'radius', 'arc'],
  4: [...PARTICLE_SHAPE_BASE_FIELDS, 'radius', 'arc'],
  5: [...PARTICLE_SHAPE_BASE_FIELDS, 'radius', 'donutRadius', 'arc'],
  6: [...PARTICLE_SHAPE_BASE_FIELDS, 'width', 'height'],
  7: [...PARTICLE_SHAPE_BASE_FIELDS, 'width', 'height'],
  8: [...PARTICLE_SHAPE_BASE_FIELDS, 'width'],
  9: [...PARTICLE_SHAPE_BASE_FIELDS, 'detail', 'random', 'width', 'height'],
};
const PARTICLE_SHAPE_NUMBER_FIELDS_BY_TYPE: Readonly<Record<number, readonly string[]>> = {
  0: [],
  1: ['radius', 'arc'],
  2: ['angle', 'radius', 'arc'],
  3: ['radius', 'arc'],
  4: ['radius', 'arc'],
  5: ['radius', 'donutRadius', 'arc'],
  6: ['width', 'height'],
  7: ['width', 'height'],
  8: ['width'],
  9: ['random', 'width', 'height'],
};

export interface ParticleValidationIssue {
  code: string;
  message: string;
  path: string;
}

export function lintParticle(
  particle: DSLRecord,
  layer: DSLRecord,
  particlePath: string,
): ParticleValidationIssue[] {
  const issues: ParticleValidationIssue[] = [];

  reportUnknownFields(particle, new Set(['shape', 'options', 'emission']), 'PT005', particlePath, issues);
  if (Object.hasOwn(particle, 'shape')) {
    checkParticleShapeValue(particle['shape'], `${particlePath}.shape`, issues);
  }
  checkParticleOptionsValue(particle['options'], `${particlePath}.options`, issues);
  checkParticleEmissionValue(particle['emission'], layer, `${particlePath}.emission`, issues);

  return issues;
}

function checkParticleShapeValue(
  value: unknown,
  shapePath: string,
  issues: ParticleValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, 'PT009', `particle.shape is ${describeValueType(value)}, expected an object`, shapePath);

    return;
  }
  const type = value['type'];

  if (!isIntegerInRange(type, 0, PARTICLE_SHAPE_NAMES.length - 1)) {
    addIssue(issues, 'PT009', 'particle.shape.type must be an integer from 0 to 9', `${shapePath}.type`);

    return;
  }
  const expectedName = PARTICLE_SHAPE_NAMES[type];

  reportUnknownFields(value, new Set(PARTICLE_SHAPE_FIELDS_BY_TYPE[type]), 'PT009', shapePath, issues);
  if (value['shape'] !== expectedName) {
    addIssue(
      issues,
      'PT009',
      `particle.shape.shape must be ${JSON.stringify(expectedName)} when type is ${String(type)}`,
      `${shapePath}.shape`,
    );
  }
  for (const field of PARTICLE_SHAPE_NUMBER_FIELDS_BY_TYPE[type]) {
    if (!isFiniteNumber(value[field])) {
      addIssue(issues, 'PT009', `particle.shape.${field} must be a finite number`, `${shapePath}.${field}`);
    }
  }
  for (const field of ['turbulenceX', 'turbulenceY', 'turbulenceZ'] as const) {
    if (Object.hasOwn(value, field) && !isTaggedParticleShapeExpression(value[field])) {
      addIssue(
        issues,
        'PT009',
        `particle.shape.${field} must be a tagged two-element expression`,
        `${shapePath}.${field}`,
      );
    }
  }

  if (type === 0) {
    if (Object.hasOwn(value, 'upDirection') && !isFiniteNumberArray(value['upDirection'])) {
      addIssue(issues, 'PT009', 'particle.shape.upDirection must contain finite numbers', `${shapePath}.upDirection`);
    }

    return;
  }
  if (!isIntegerInRange(value['arcMode'], 0, 3)) {
    addIssue(issues, 'PT009', 'particle.shape.arcMode must be an integer from 0 to 3', `${shapePath}.arcMode`);
  }
  if (Object.hasOwn(value, 'alignSpeedDirection') && typeof value['alignSpeedDirection'] !== 'boolean') {
    addIssue(
      issues,
      'PT009',
      'particle.shape.alignSpeedDirection must be a boolean',
      `${shapePath}.alignSpeedDirection`,
    );
  }
  if (Object.hasOwn(value, 'upDirection') && !isFiniteNumberTuple(value['upDirection'], 3)) {
    addIssue(
      issues,
      'PT009',
      'particle.shape.upDirection must contain three finite numbers',
      `${shapePath}.upDirection`,
    );
  }
  if (type === 9) {
    checkParticleTextureShapeDetail(value['detail'], `${shapePath}.detail`, issues);
  }
}

function checkParticleTextureShapeDetail(
  value: unknown,
  detailPath: string,
  issues: ParticleValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, 'PT009', 'particle.shape.detail must be an object', detailPath);

    return;
  }

  reportUnknownFields(value, new Set(['width', 'height', 'block', 'anchors']), 'PT009', detailPath, issues);
  for (const field of ['width', 'height'] as const) {
    if (!isFiniteNumber(value[field])) {
      addIssue(issues, 'PT009', `particle.shape.detail.${field} must be a finite number`, `${detailPath}.${field}`);
    }
  }
  if (!isFiniteNumberTuple(value['block'], 2)) {
    addIssue(issues, 'PT009', 'particle.shape.detail.block must contain two finite numbers', `${detailPath}.block`);
  }
  if (!isFiniteNumberArray(value['anchors'])) {
    addIssue(issues, 'PT009', 'particle.shape.detail.anchors must contain finite numbers', `${detailPath}.anchors`);
  }
}

function checkParticleOptionsValue(
  value: unknown,
  optionsPath: string,
  issues: ParticleValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, 'PT006', `particle.options is ${describeValueType(value)}, expected an object`, optionsPath);

    return;
  }

  reportUnknownFields(value, new Set(['maxCount', 'startLifetime']), 'PT005', optionsPath, issues);

  const maxCount = value['maxCount'];

  if (!isFiniteNumber(maxCount) || !Number.isInteger(maxCount) || maxCount <= 0) {
    addIssue(issues, 'PT007', 'particle.options.maxCount must be a positive integer', `${optionsPath}.maxCount`);
  }

  if (!isParticleNumberExpression(value['startLifetime'], true)) {
    addIssue(
      issues,
      'PT008',
      'particle.options.startLifetime must be a valid positive NumberExpression',
      `${optionsPath}.startLifetime`,
    );
  }
}

function checkParticleEmissionValue(
  value: unknown,
  layer: DSLRecord,
  emissionPath: string,
  issues: ParticleValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, 'PT001', `particle.emission is ${describeValueType(value)}, expected an object`, emissionPath);

    return;
  }

  reportUnknownFields(value, new Set(['rateOverTime', 'bursts']), 'PT005', emissionPath, issues);

  if (!isParticleNumberExpression(value['rateOverTime'], false)) {
    addIssue(
      issues,
      'PT002',
      'particle.emission.rateOverTime must be a valid non-negative NumberExpression',
      `${emissionPath}.rateOverTime`,
    );
  }

  if (!Object.hasOwn(value, 'bursts')) {
    return;
  }

  const bursts = value['bursts'];

  if (!Array.isArray(bursts)) {
    addIssue(issues, 'PT003', 'particle.emission.bursts must be an array', `${emissionPath}.bursts`);

    return;
  }

  bursts.forEach((burst, index) => {
    checkParticleBurst(burst, layer, `${emissionPath}.bursts[${index}]`, issues);
  });
}

function checkParticleBurst(
  value: unknown,
  layer: DSLRecord,
  burstPath: string,
  issues: ParticleValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, 'PT004', `particle burst is ${describeValueType(value)}, expected an object`, burstPath);

    return;
  }

  reportUnknownFields(value, new Set(['time', 'count', 'cycles', 'interval']), 'PT004', burstPath, issues);

  const time = value['time'];
  const duration = readLayerDuration(layer);

  if (!isFiniteNumber(time) || time < 0 || (duration != null && time >= duration)) {
    addIssue(issues, 'PT004', 'particle burst time must be within the layer duration', `${burstPath}.time`);
  }
  if (!isNonNegativeInteger(value['count'])) {
    addIssue(issues, 'PT004', 'particle burst count must be a non-negative integer', `${burstPath}.count`);
  }
  if (Object.hasOwn(value, 'cycles') && !isNonNegativeInteger(value['cycles'])) {
    addIssue(
      issues,
      'PT004',
      'particle burst cycles must be a non-negative integer; 0 means unbounded',
      `${burstPath}.cycles`,
    );
  }
  if (Object.hasOwn(value, 'interval') && (!isFiniteNumber(value['interval']) || value['interval'] < 0)) {
    addIssue(
      issues,
      'PT004',
      'particle burst interval must be a non-negative finite number',
      `${burstPath}.interval`,
    );
  }

  const cycles = Object.hasOwn(value, 'cycles') ? value['cycles'] : 0;
  const interval = Object.hasOwn(value, 'interval') ? value['interval'] : 0;

  if (
    isNonNegativeInteger(cycles) && (cycles === 0 || cycles > 1) &&
    (!isFiniteNumber(interval) || interval <= 0)
  ) {
    addIssue(
      issues,
      'PT004',
      'particle burst interval must be greater than 0 when cycles is 0 or greater than 1',
      `${burstPath}.interval`,
    );
  }
  if (
    duration != null && isFiniteNumber(time) && time >= 0 && time < duration &&
    isPositiveInteger(cycles) && isFiniteNumber(interval) && interval >= 0 &&
    time + (cycles - 1) * interval >= duration
  ) {
    addIssue(issues, 'PT004', 'particle burst cycles extend beyond the layer duration', burstPath);
  }
}

function reportUnknownFields(
  value: DSLRecord,
  fieldSet: ReadonlySet<string>,
  code: string,
  path: string,
  issues: ParticleValidationIssue[],
): void {
  for (const field of Object.keys(value)) {
    if (!fieldSet.has(field)) {
      addIssue(issues, code, `unknown field ${JSON.stringify(field)}`, `${path}.${field}`);
    }
  }
}

function isParticleNumberExpression(value: unknown, positive: boolean): boolean {
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }

  const expression = value as unknown[];
  const type = expression[0];
  const payload = expression[1];

  if (type === ValueType.CONSTANT) {
    return isParticleNumber(payload, positive);
  }
  if (type === ValueType.RANDOM) {
    return isFiniteNumberTuple(payload, 2) &&
      isParticleNumber(payload[0], positive) && isParticleNumber(payload[1], positive) &&
      payload[0] <= payload[1];
  }

  return false;
}

function isParticleNumber(value: unknown, positive: boolean): value is number {
  return isFiniteNumber(value) && (positive ? value > 0 : value >= 0);
}

function readLayerDuration(layer: DSLRecord): number | null {
  const timeRange = layer['time_range'];

  if (!isFiniteNumberTuple(timeRange, 2)) {
    return null;
  }

  return timeRange[1] - timeRange[0];
}

function isFiniteNumberTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(isFiniteNumber);
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isFiniteNumber);
}

function isTaggedParticleShapeExpression(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && Number.isInteger(value[0]);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function describeValueType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'an array';
  }

  return typeof value;
}

function addIssue(issues: ParticleValidationIssue[], code: string, message: string, path: string): void {
  issues.push({ code, message, path });
}
