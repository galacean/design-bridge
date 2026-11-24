import type {
  ParticleShape, ParticleShapeArcMode, ParticleShapeNumberExpression, ParticleTextureShapeDetail,
} from './particle-shape';

interface ProjectedShapeBase {
  arcMode: ParticleShapeArcMode;
  alignSpeedDirection?: boolean;
  upDirection?: [x: number, y: number, z: number];
  turbulenceX?: ParticleShapeNumberExpression;
  turbulenceY?: ParticleShapeNumberExpression;
  turbulenceZ?: ParticleShapeNumberExpression;
}

/**
 * Project a GE-style emitter shape (numeric type 0..9) into read-only DSL context.
 * Shape names come from the type tag; missing arcMode defaults to 0. Other numeric
 * fields retain source units. Unsupported types or invalid required fields return
 * undefined; invalid optional fields are omitted. Direction expressions are cloned,
 * so their payloads must be structured-cloneable. No geometry is written into IR.
 */
export function parseParticleShape(value: unknown): ParticleShape | undefined {
  if (!isRecord(value) || !isIntegerInRange(value['type'], 0, 9)) {
    return undefined;
  }
  const type = value['type'];

  if (type === 0) {
    return {
      type: 0,
      shape: 'None',
      ...projectDirectionExpressions(value),
      ...(isFiniteNumberArray(value['upDirection']) && { upDirection: [...value['upDirection']] }),
    };
  }
  const base = projectShapeBase(value);

  if (base == null) {
    return undefined;
  }

  switch (type) {
    case 1: {
      const radial = projectRadialFields(value);

      return radial == null ? undefined : { type: 1, shape: 'Sphere', ...base, ...radial };
    }
    case 2: {
      const radial = projectRadialFields(value);
      const angle = readFiniteNumber(value['angle']);

      return radial == null || angle == null
        ? undefined
        : { type: 2, shape: 'Cone', ...base, angle, ...radial };
    }
    case 3: {
      const radial = projectRadialFields(value);

      return radial == null ? undefined : { type: 3, shape: 'Hemisphere', ...base, ...radial };
    }
    case 4: {
      const radial = projectRadialFields(value);

      return radial == null ? undefined : { type: 4, shape: 'Circle', ...base, ...radial };
    }
    case 5: {
      const radial = projectRadialFields(value);
      const donutRadius = readFiniteNumber(value['donutRadius']);

      return radial == null || donutRadius == null
        ? undefined
        : { type: 5, shape: 'Donut', ...base, ...radial, donutRadius };
    }
    case 6: {
      const rectangle = projectRectangleFields(value);

      return rectangle == null ? undefined : { type: 6, shape: 'Rectangle', ...base, ...rectangle };
    }
    case 7: {
      const rectangle = projectRectangleFields(value);

      return rectangle == null ? undefined : { type: 7, shape: 'RectangleEdge', ...base, ...rectangle };
    }
    case 8: {
      const width = readFiniteNumber(value['width']);

      return width == null ? undefined : { type: 8, shape: 'Edge', ...base, width };
    }
    case 9:
      return projectTextureShape(value, base);
  }
}

function projectRadialFields(
  value: Record<string, unknown>,
): { radius: number; arc: number } | undefined {
  const radius = readFiniteNumber(value['radius']);
  const arc = readFiniteNumber(value['arc']);

  if (radius == null || arc == null) {
    return undefined;
  }

  return { radius, arc };
}

function projectRectangleFields(
  value: Record<string, unknown>,
): { width: number; height: number } | undefined {
  const width = readFiniteNumber(value['width']);
  const height = readFiniteNumber(value['height']);

  if (width == null || height == null) {
    return undefined;
  }

  return { width, height };
}

function projectTextureShape(
  value: Record<string, unknown>,
  base: ProjectedShapeBase,
): Extract<ParticleShape, { type: 9 }> | undefined {
  const detail = projectTextureShapeDetail(value['detail']);
  const random = readFiniteNumber(value['random']);
  const width = readFiniteNumber(value['width']);
  const height = readFiniteNumber(value['height']);

  if (detail == null || random == null || width == null || height == null) {
    return undefined;
  }

  return { type: 9, shape: 'Texture', ...base, detail, random, width, height };
}

function projectTextureShapeDetail(value: unknown): ParticleTextureShapeDetail | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const width = readFiniteNumber(value['width']);
  const height = readFiniteNumber(value['height']);
  const block = value['block'];
  const anchors = value['anchors'];

  if (width == null || height == null || !isFiniteNumberTuple(block, 2) || !isFiniteNumberArray(anchors)) {
    return undefined;
  }

  return { width, height, block: [block[0], block[1]], anchors: [...anchors] };
}

function projectShapeBase(value: Record<string, unknown>): ProjectedShapeBase | undefined {
  const arcMode = value['arcMode'] === undefined ? 0 : value['arcMode'];

  if (!isParticleShapeArcMode(arcMode)) {
    return undefined;
  }

  return {
    arcMode,
    ...(typeof value['alignSpeedDirection'] === 'boolean' && {
      alignSpeedDirection: value['alignSpeedDirection'],
    }),
    ...(isFiniteNumberTuple(value['upDirection'], 3) && {
      upDirection: [value['upDirection'][0], value['upDirection'][1], value['upDirection'][2]],
    }),
    ...projectDirectionExpressions(value),
  };
}

function projectDirectionExpressions(value: Record<string, unknown>): Partial<ProjectedShapeBase> {
  const result: Partial<ProjectedShapeBase> = {};

  for (const field of ['turbulenceX', 'turbulenceY', 'turbulenceZ'] as const) {
    const expression = value[field];

    if (isTaggedExpression(expression)) {
      result[field] = [expression[0], structuredClone(expression[1])];
    }
  }

  return result;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(entry => readFiniteNumber(entry) != null);
}

function isFiniteNumberTuple(value: unknown, length: number): value is number[] {
  return isFiniteNumberArray(value) && value.length === length;
}

function isTaggedExpression(value: unknown): value is [number, unknown] {
  return Array.isArray(value) && value.length === 2 && Number.isInteger(value[0]);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isParticleShapeArcMode(value: unknown): value is ParticleShapeArcMode {
  return isIntegerInRange(value, 0, 3);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
