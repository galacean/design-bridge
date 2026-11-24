import {
  mapParticleVector, particleVector, rotateParticleXY, sampleParticleDirection,
  type ParticleMatrix, type ParticleVector,
} from './map-particle-space';
import {
  addParticleValue, createParticleRandom, isZeroParticleValue, particleNumber,
  particleRecord, sampleParticleValues, scaleParticleValue,
} from './sample-particle-values';

export interface ParticlePlacement {
  scale: number;
  rotation: number;
  position: ParticleVector;
}

function planParticleSpeed(
  system: Record<string, unknown>, scale: number, matrix: ParticleMatrix, shear: [number, number],
): { factor: number; fallbackFactor: number; linear: ParticleVector; depthVariance: number } {
  const random = createParticleRandom(7);
  const count = 4096;
  const motion = particleRecord(system['positionOverLifetime']);
  const speeds = sampleParticleValues(motion['startSpeed'], random, count);
  const shape = particleRecord(system['shape']);
  const actual: ParticleVector[] = [];
  const wanted: ParticleVector[] = [];
  const meanActual: ParticleVector = [0, 0, 0];
  const meanWanted: ParticleVector = [0, 0, 0];
  let totalSpeed = 0;

  for (let index = 0; index < count; index++) {
    const direction = mapParticleVector(matrix, sampleParticleDirection(shape, random));
    const speed = speeds[index % speeds.length];
    const divisor = Math.hypot(...direction) || 1;
    const vector: ParticleVector = [speed * direction[0] / divisor, speed * direction[1] / divisor,
      speed * direction[2] / divisor];
    const target: ParticleVector = [scale * vector[0] - shear[0] * vector[2],
      scale * vector[1] - shear[1] * vector[2], vector[2]];

    actual.push(vector);
    wanted.push(target);
    totalSpeed += Math.hypot(...vector);
    for (let axis = 0; axis < 3; axis++) {
      meanActual[axis] += vector[axis] / count;
      meanWanted[axis] += target[axis] / count;
    }
  }
  let covariance = 0;
  let variance = 0;
  let numerator = 0;
  let denominator = 0;
  let depthVariance = 0;

  for (let index = 0; index < count; index++) {
    const vector = actual[index];
    const target = wanted[index];

    depthVariance += (vector[2] - meanActual[2]) ** 2 / count;
    for (let axis = 0; axis < 3; axis++) {
      const weight = axis === 2 ? 0.05 : 1;

      covariance += weight * (target[axis] - meanWanted[axis]) * (vector[axis] - meanActual[axis]);
      variance += weight * (vector[axis] - meanActual[axis]) ** 2;
      numerator += weight * target[axis] * vector[axis];
      denominator += weight * vector[axis] ** 2;
    }
  }
  const fallbackFactor = denominator > 1e-12 ? numerator / denominator : scale;
  const factor = variance > 1e-12 ? covariance / variance : fallbackFactor;
  const correction = (axis: number): number => {
    const value = meanWanted[axis] - factor * meanActual[axis];

    return Math.abs(value) > 0.01 * totalSpeed / count ? value : 0;
  };

  return { factor, fallbackFactor,
    linear: [correction(0), correction(1), correction(2)], depthVariance };
}

/** GE normalizes emission direction; wrapper scale must also be applied to world-space motion. */
export function bakeParticleMotion(
  system: Record<string, unknown>, wrapper: ParticlePlacement, matrix: ParticleMatrix,
  camera: Record<string, unknown>,
): { system: Record<string, unknown>; warnings: string[] } {
  if (particleRecord(system['options'])['particleFollowParent'] === true) {
    throw new TypeError('[ge-ir:particle-layout] particleFollowParent=true is not supported by world-space baking.');
  }
  const result = structuredClone(system);
  const motion = particleRecord(result['positionOverLifetime']);
  const warnings: string[] = [];
  const cameraPosition = particleVector(camera['position'] ?? [0, 0, 8]);
  const distance = cameraPosition[2] - wrapper.position[2];
  const { scale, rotation, position } = wrapper;

  if (distance <= 0 || scale <= 0) {
    throw new TypeError('[ge-ir:particle-layout] Particle placement must be in front of the host camera.');
  }
  const hx = (position[0] - cameraPosition[0]) / distance;
  const hy = (position[1] - cameraPosition[1]) / distance;
  const mapVector = (value: ParticleVector): ParticleVector => {
    const [x, y] = rotateParticleXY(rotation, scale * value[0], scale * value[1]);

    return [x - hx * value[2], y - hy * value[2], value[2]];
  };
  const mapPoint = (value: unknown): ParticleVector => {
    const [x, y, z] = mapVector(particleVector(value));

    return [position[0] + x, position[1] + y, z];
  };

  result['positionOverLifetime'] = motion;
  if (motion['gravity'] != null) {
    motion['gravity'] = mapVector(particleVector(motion['gravity']));
  }
  const lx = motion['linearX'];
  const ly = motion['linearY'];
  const lz = motion['linearZ'];
  const radians = rotation * Math.PI / 180;

  if (Math.abs(rotation % 360) < 1e-9) {
    if (lx != null) { motion['linearX'] = scaleParticleValue(lx, scale); }
    if (ly != null) { motion['linearY'] = scaleParticleValue(ly, scale); }
  } else if (isZeroParticleValue(ly) && lx != null) {
    motion['linearX'] = scaleParticleValue(lx, scale * Math.cos(radians));
    motion['linearY'] = scaleParticleValue(lx, -scale * Math.sin(radians));
  } else if (isZeroParticleValue(lx) && ly != null) {
    motion['linearX'] = scaleParticleValue(ly, scale * Math.sin(radians));
    motion['linearY'] = scaleParticleValue(ly, scale * Math.cos(radians));
  } else if (lx != null || ly != null) {
    const x = addParticleValue(scaleParticleValue(lx ?? 0, scale * Math.cos(radians)),
      scaleParticleValue(ly ?? 0, scale * Math.sin(radians)));
    const y = addParticleValue(scaleParticleValue(ly ?? 0, scale * Math.cos(radians)),
      scaleParticleValue(lx ?? 0, -scale * Math.sin(radians)));

    if (x == null || y == null) {
      warnings.push('Independent animated linearX/Y cannot express their rotated sum; only scale was applied.');
      motion['linearX'] = scaleParticleValue(lx ?? 0, scale);
      motion['linearY'] = scaleParticleValue(ly ?? 0, scale);
    } else {
      motion['linearX'] = x;
      motion['linearY'] = y;
    }
  }
  for (const [key, shear] of [['linearX', hx], ['linearY', hy]] as const) {
    if (!isZeroParticleValue(lz) && shear !== 0) {
      const combined = addParticleValue(motion[key], scaleParticleValue(lz, -shear));

      if (combined == null) {
        warnings.push(`${key}: animated depth shear cannot be expressed.`);
      } else {
        motion[key] = combined;
      }
    }
  }
  const emission = particleRecord(result['emission']);

  if (Array.isArray(emission['burstOffsets'])) {
    emission['burstOffsets'] = emission['burstOffsets'].map((entry: unknown) => {
      if (Array.isArray(entry)) {
        const values: unknown[] = entry;

        return [values[0], ...mapVector(particleVector(values.slice(1, 4)))];
      }
      const record = particleRecord(entry);
      const [x, y, z] = mapVector(particleVector(record));

      return { ...record, x, y, z };
    });
  }
  if (motion['orbCenter'] != null) { motion['orbCenter'] = mapPoint(motion['orbCenter']); }
  if (motion['forceTarget'] === true) { motion['target'] = mapPoint(motion['target']); }
  if (!isZeroParticleValue(motion['orbitalX']) || !isZeroParticleValue(motion['orbitalY'])) {
    warnings.push('Orbital X/Y motion mixes depth into the image plane and is only approximated.');
  }
  const plan = planParticleSpeed(result, scale, matrix, rotateParticleXY(-rotation, hx, hy));
  const [linearX, linearY] = rotateParticleXY(rotation, plan.linear[0], plan.linear[1]);
  const linear = [linearX, linearY, plan.linear[2]];
  let factor = plan.factor;

  if (linear.some(value => value !== 0)) {
    const additions: Record<string, unknown> = {};
    let expressible = motion['asMovement'] !== true ||
      ['linearX', 'linearY', 'linearZ'].every(key => isZeroParticleValue(motion[key]));

    for (const [index, key] of ['linearX', 'linearY', 'linearZ'].entries()) {
      if (linear[index] === 0) { continue; }
      const combined = addParticleValue(motion[key], scaleParticleValue(motion['speedOverLifetime'] ?? [0, 1], linear[index]));

      expressible &&= combined != null;
      additions[key] = combined;
    }
    if (expressible) {
      Object.assign(motion, additions);
      if (motion['asMovement'] === true) { motion['asMovement'] = false; }
    } else {
      factor = plan.fallbackFactor;
      warnings.push('Mean velocity correction cannot be expressed; only the least-squares speed factor was applied.');
    }
  }
  if (motion['startSpeed'] != null) { motion['startSpeed'] = scaleParticleValue(motion['startSpeed'], factor); }
  if (plan.depthVariance > 1e-9 && Math.abs(factor - 1) > 1e-6) {
    warnings.push('Mixed 3D emission preserves mean depth motion; per-particle depth variance is approximated.');
  }
  if (result['trails'] != null) {
    const trails = particleRecord(result['trails']);

    if (trails['sizeAffectsWidth'] !== true) {
      trails['widthOverTrail'] = scaleParticleValue(trails['widthOverTrail'] ?? [0, 1], scale);
    }
    trails['minimumVertexDistance'] = particleNumber(trails['minimumVertexDistance'], 0.02) * scale;
    if (trails['sizeAffectsLifetime'] === true && trails['lifetime'] != null) {
      trails['lifetime'] = scaleParticleValue(trails['lifetime'], 1 / scale);
    }
    if (trails['parentAffectsPosition'] === true) { warnings.push('trails.parentAffectsPosition is not baked.'); }
  }
  const shape = particleRecord(result['shape']);

  if (['turbulenceX', 'turbulenceY', 'turbulenceZ'].some(key => !isZeroParticleValue(shape[key]))) {
    warnings.push('Shape turbulence is not included in the speed estimate.');
  }

  return { system: result, warnings };
}
