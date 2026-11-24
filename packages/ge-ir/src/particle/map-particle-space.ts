import { resolveDataPathId } from '../common/data-path';
import { particleNumber, particleRecord } from './sample-particle-values';

export type ParticleVector = [number, number, number];
export type ParticleMatrix = [ParticleVector, ParticleVector, ParticleVector];

export function particleVector(value: unknown, fallback = 0): ParticleVector {
  const record = particleRecord(value);
  const entries: unknown[] = Array.isArray(value) ? value : [record['x'], record['y'], record['z']];

  return [particleNumber(entries[0], fallback), particleNumber(entries[1], fallback), particleNumber(entries[2], fallback)];
}

export function rotateParticleXY(degrees: number, x: number, y: number): [number, number] {
  const angle = degrees * Math.PI / 180;

  return [Math.cos(angle) * x + Math.sin(angle) * y, -Math.sin(angle) * x + Math.cos(angle) * y];
}

export function mapParticleVector(matrix: ParticleMatrix, vector: ParticleVector): ParticleVector {
  const dot = (row: ParticleVector): number => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2];

  return [dot(matrix[0]), dot(matrix[1]), dot(matrix[2])];
}

function multiplyParticleMatrices(left: ParticleMatrix, right: ParticleMatrix): ParticleMatrix {
  const row = (values: ParticleVector): ParticleVector => [
    values[0] * right[0][0] + values[1] * right[1][0] + values[2] * right[2][0],
    values[0] * right[0][1] + values[1] * right[1][1] + values[2] * right[2][1],
    values[0] * right[0][2] + values[1] * right[1][2] + values[2] * right[2][2],
  ];

  return [row(left[0]), row(left[1]), row(left[2])];
}

function particleEulerMatrix(euler: ParticleVector, scale: ParticleVector): ParticleMatrix {
  const [x, y, z] = euler.map(value => value * Math.PI / 360);
  const [c1, c2, c3] = [Math.cos(x), Math.cos(y), Math.cos(z)];
  const [s1, s2, s3] = [Math.sin(x), Math.sin(y), Math.sin(z)];
  // GE conjugates the ZYX Euler quaternion when constructing its world transform.
  const qx = -(s1 * c2 * c3 - c1 * s2 * s3);
  const qy = -(c1 * s2 * c3 + s1 * c2 * s3);
  const qz = -(c1 * c2 * s3 - s1 * s2 * c3);
  const qw = c1 * c2 * c3 + s1 * s2 * s3;
  const matrix: ParticleMatrix = [
    [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
    [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
    [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
  ];

  return multiplyParticleMatrices(matrix, [[scale[0], 0, 0], [0, scale[1], 0], [0, 0, scale[2]]]);
}

export function particleItemWorld(
  items: ReadonlyMap<string, Record<string, unknown>>, itemId: string,
): { position: ParticleVector; matrix: ParticleMatrix } {
  const chain: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let id: string | undefined = itemId;

  while (id != null) {
    const item = items.get(id);

    if (item == null || seen.has(id)) {
      throw new TypeError('[ge-ir:particle-layout] Invalid source Item hierarchy.');
    }
    seen.add(id);
    chain.unshift(item);
    const parent: unknown = item['parentId'];

    id = typeof parent === 'string' ? parent : resolveDataPathId(parent);
  }
  let position: ParticleVector = [0, 0, 0];
  let matrix: ParticleMatrix = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  for (const item of chain) {
    const transform = particleRecord(item['transform']);
    const step = mapParticleVector(matrix, particleVector(transform['position']));

    position = [position[0] + step[0], position[1] + step[1], position[2] + step[2]];
    matrix = multiplyParticleMatrices(matrix, particleEulerMatrix(
      particleVector(transform['eulerHint'] ?? transform['rotation']), particleVector(transform['scale'], 1),
    ));
  }

  return { position, matrix };
}

export function particleCameraRatio(composition: Record<string, unknown>): number {
  const preview = particleVector(composition['previewSize']);
  const camera = particleRecord(composition['camera']);
  const distance = Math.abs(particleVector(camera['position'] ?? [0, 0, 8])[2]);
  const fov = particleNumber(camera['fov'], 60);
  const clipMode = particleNumber(camera['clipMode'], 1);

  if (preview[0] <= 0 || preview[1] <= 0 || distance <= 0 || fov <= 0 || fov >= 180 ||
    (clipMode !== 0 && clipMode !== 1)) {
    throw new TypeError('[ge-ir:particle-layout] Invalid source camera or preview size.');
  }

  return 2 * distance * Math.tan(fov * Math.PI / 360) / preview[clipMode === 1 ? 0 : 1];
}

export function sampleParticleDirection(shape: Record<string, unknown>, random: () => number): ParticleVector {
  const kind = particleNumber(shape['type']);
  const arc = (): number => random() * particleNumber(shape['arc'], 360) * Math.PI / 180;
  let direction: ParticleVector;

  if (kind === 1 || kind === 3) {
    const horizontal = ((kind === 1 ? -90 : 0) + random() * (kind === 1 ? 180 : 90)) * Math.PI / 180;
    const angle = arc();

    return [Math.cos(horizontal) * Math.cos(angle), Math.cos(horizontal) * Math.sin(angle), Math.sin(horizontal)];
  }
  if (kind === 2) {
    const angle = arc();
    const slope = particleNumber(shape['radius'], 1) * Math.tan(particleNumber(shape['angle']) * Math.PI / 180);

    direction = [Math.cos(angle) * slope, Math.sin(angle) * slope, 1];
  } else if ([4, 5, 7, 9].includes(kind)) {
    const angle = kind === 5 || kind === 9 ? random() * 2 * Math.PI : arc();

    direction = [Math.cos(angle), Math.sin(angle), 0];
  } else if (kind === 6) {
    direction = [0, 0, 1];
  } else if (kind === 8) {
    direction = [0, 1, 0];
  } else if (kind === 0) {
    direction = [0, 0, 0];
  } else {
    throw new TypeError(`[ge-ir:particle-layout] Unsupported particle shape '${kind}'.`);
  }
  const length = Math.hypot(...direction) || 1;

  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

export function sampleParticlePoint(shape: Record<string, unknown>, random: () => number): ParticleVector {
  const kind = particleNumber(shape['type']);
  const radius = particleNumber(shape['radius'], 1);

  if (kind === 1 || kind === 3) {
    const angle = random() * 2 * Math.PI;
    const height = Math.asin(kind === 1 ? random() * 2 - 1 : random());

    return [radius * Math.cos(height) * Math.cos(angle), radius * Math.cos(height) * Math.sin(angle),
      radius * Math.sin(height)];
  }
  if ([2, 4, 5].includes(kind)) {
    const angle = random() * 2 * Math.PI;
    const distance = kind === 4 ? radius * Math.sqrt(random()) : radius;

    return [distance * Math.cos(angle), distance * Math.sin(angle), 0];
  }
  const width = particleNumber(shape['width'], 1);
  const height = particleNumber(shape['height'], 1);

  return [kind >= 6 ? (random() - 0.5) * width : 0,
    kind === 6 || kind === 9 ? (random() - 0.5) * height : kind === 7 ? (random() < 0.5 ? -height : height) / 2 : 0, 0];
}
