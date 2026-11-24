import { resolveDataPathId } from '../common/data-path';
import {
  mapParticleVector, particleCameraRatio, particleItemWorld, particleVector, sampleParticleDirection, sampleParticlePoint,
} from './map-particle-space';
import {
  createParticleRandom, particleArray, particleNumber, particleRecord, particleSampler,
  sampleParticleValues, scaleParticleValue,
} from './sample-particle-values';

interface ParticleSizeProfile {
  d99: number;
  coverage: number;
}

interface ParticleDepthCheck {
  scale: number;
  camera: Record<string, unknown>;
  onClipping: (system: Record<string, unknown>, plane: 'near' | 'far', time: number) => void;
}

function particleEmissionTimes(
  system: Record<string, unknown>, item: Record<string, unknown>, duration: number, random: () => number,
): number[] {
  const emission = particleRecord(system['emission']);
  const delay = particleNumber(item['delay']);
  const end = Math.min(delay + particleNumber(item['duration'], duration), duration);
  const times: number[] = [];
  const rate = emission['rateOverTime'] ?? 0;
  const samples = Array.isArray(rate) && rate[0] === 4
    ? particleArray(rate[1]).map(value => particleNumber(value)) : sampleParticleValues(rate, random, 1);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;

  for (let index = 0; index < Math.floor(mean * (end - delay)); index++) {
    times.push(delay + (index + random()) / mean);
  }
  const bursts: unknown[] = Array.isArray(emission['bursts']) ? emission['bursts'] : [];

  for (const value of bursts) {
    const burst = particleRecord(value);
    const start = particleNumber(burst['time']);
    const count = Math.max(0, Math.floor(particleNumber(burst['count'])));
    const interval = particleNumber(burst['interval']);
    const cycles = particleNumber(burst['cycles'], 1);
    const repetitions = cycles === 0 && interval > 0
      ? Math.max(1, Math.ceil((end - delay - start) / interval)) : Math.max(1, Math.floor(cycles));

    for (let cycle = 0; cycle < repetitions; cycle++) {
      const time = delay + start + cycle * interval;

      if (time >= end + 1e-6) { break; }
      for (let index = 0; index < count; index++) { times.push(time); }
    }
  }

  return times.filter(time => time >= 0 && time < end + 1e-6).sort((left, right) => left - right);
}

function particleGradientAlpha(value: unknown): (age: number) => number {
  if (!Array.isArray(value) || value[0] !== 9) {
    return () => 1;
  }
  const stops = particleArray(value[1]).map(stop => {
    const parts = particleArray(stop);

    return [particleNumber(parts[0]), particleNumber(parts[4]) / 255];
  });

  return stops.length === 0 ? () => 1 : particleSampler([5, stops], () => 0);
}

/** Measure edited source particles before world-motion baking; this is an analytic estimate, not a renderer. */
function measureParticleSize(
  systems: readonly Record<string, unknown>[], items: ReadonlyMap<string, Record<string, unknown>>,
  composition: Record<string, unknown>, bounds: readonly number[],
  textureFills: ReadonlyMap<string, number>,
  depthCheck?: ParticleDepthCheck,
): ParticleSizeProfile | undefined {
  const random = createParticleRandom(11);
  const camera = particleRecord(composition['camera']);
  const [width, height] = particleVector(composition['previewSize']);
  const distance = particleVector(camera['position'] ?? [0, 0, 8])[2];
  const focal = distance / particleCameraRatio(composition);
  const near = particleNumber(camera['near'], 0.1);
  const hostCamera = depthCheck?.camera ?? camera;
  const hostDistance = particleVector(hostCamera['position'] ?? [0, 0, 8])[2];
  const hostNear = particleNumber(hostCamera['near'], 0.1);
  const hostFar = particleNumber(hostCamera['far'], 40);

  if (depthCheck != null && (hostNear <= 0 || hostFar <= hostNear)) {
    throw new TypeError('[ge-ir:particle-layout] Host camera requires 0 < near < far.');
  }
  const duration = particleNumber(composition['duration'], 4);
  const frames = Math.max(1, Math.floor(duration * 30));
  const areas = new Float64Array(frames);
  const diameters: number[] = [];
  const [left, top, boundsWidth, boundsHeight] = bounds;

  for (const system of systems) {
    const itemId = resolveDataPathId(system['item']);
    const item = itemId == null ? undefined : items.get(itemId);

    if (item == null || itemId == null) {
      throw new TypeError('[ge-ir:particle-layout] Particle size measurement requires its source Item.');
    }
    const { position, matrix } = particleItemWorld(items, itemId);
    // World XY scale changes sprite area; use its geometric mean for the equivalent disc diameter.
    const spriteScale = Math.sqrt(Math.hypot(matrix[0][0], matrix[1][0], matrix[2][0]) *
      Math.hypot(matrix[0][1], matrix[1][1], matrix[2][1]));
    const emitterDelay = particleNumber(item['delay']);
    const emitterDuration = particleNumber(item['duration'], duration);
    const options = particleRecord(system['options']);
    const motion = particleRecord(system['positionOverLifetime']);
    const size = particleRecord(system['sizeOverLifetime']);
    const color = particleRecord(system['colorOverLifetime']);
    const shape = particleRecord(system['shape']);
    const fill = typeof system['id'] === 'string' ? textureFills.get(system['id']) : undefined;
    const disc = Math.sqrt(4 * (fill ?? Math.PI / 4) / Math.PI);
    const gravity = particleVector(motion['gravity']);
    const alpha = particleGradientAlpha(color['color']);
    const maxCount = particleNumber(options['maxCount'], 1e6);
    let alive: number[] = [];
    let nearFrame = Infinity;
    let farFrame = Infinity;

    for (const born of particleEmissionTimes(system, item, duration, random)) {
      alive = alive.filter(end => end > born);
      if (alive.length >= maxCount) { continue; }
      const emitterProgress = (born - emitterDelay) / emitterDuration;
      const life = particleSampler(options['startLifetime'], random)(emitterProgress);

      if (life <= 0) { continue; }
      alive.push(born + life);
      const initialSize = particleSampler(options[options['start3DSize'] === true ? 'startSizeX' : 'startSize'],
        random)(emitterProgress);
      const sizeCurve = particleSampler(size['size'] ?? size['x'], random);
      const initialSpeed = particleSampler(motion['startSpeed'], random, 0)(emitterProgress);
      const speedCurve = particleSampler(motion['speedOverLifetime'], random);
      const gravityCurve = particleSampler(motion['gravityOverLifetime'], random, 0);
      const linear = ['linearX', 'linearY', 'linearZ'].map(key => particleSampler(motion[key], random, 0));
      const opacity = particleSampler(color['opacity'], random);
      const direction = mapParticleVector(matrix, sampleParticleDirection(shape, random));
      const norm = Math.hypot(...direction) || 1;
      const point = mapParticleVector(matrix, sampleParticlePoint(shape, random));
      const start = position.map((value, axis) => value + point[axis]);
      let travelled = 0;
      let fall = 0;
      let previous = 0;
      const drift = [0, 0, 0];

      for (let frame = Math.max(0, Math.ceil(born * 30 - 1e-9)); frame < frames; frame++) {
        const age = frame / 30 - born;

        if (age > life) { break; }
        const step = age - previous;
        const middle = (age + previous) / 2 / life;

        travelled += initialSpeed * speedCurve(middle) * step;
        fall += gravityCurve(middle) * (age + previous) / 2 * step;
        for (let axis = 0; axis < 3; axis++) { drift[axis] += linear[axis](middle) * step; }
        previous = age;
        const progress = age / life;
        const p = start.map((value, axis) => value + direction[axis] / norm * travelled + gravity[axis] * fall
          + (motion['asMovement'] === true ? linear[axis](progress) : drift[axis]));
        const depth = distance - p[2];

        if (depthCheck != null) {
          // Emission positions inherit wrapper scale; world-space depth travel does not.
          const hostDepth = hostDistance - (p[2] + (depthCheck.scale - 1) * start[2]);

          if (hostDepth < hostNear) {
            nearFrame = Math.min(nearFrame, frame);
            continue;
          }
          if (hostDepth > hostFar) {
            farFrame = Math.min(farFrame, frame);
            continue;
          }
        }

        if (depth <= near || alpha(progress) * opacity(progress) < 0.15) { continue; }
        const x = width / 2 + focal * p[0] / depth;
        const y = height / 2 - focal * p[1] / depth;

        if (x < left || x > left + boundsWidth || y < top || y > top + boundsHeight) { continue; }
        const diameter = initialSize * sizeCurve(progress) * spriteScale * focal / depth * disc;
        const area = Math.PI * diameter ** 2 / 4;

        diameters.push(diameter);
        areas[frame] += area;
      }
    }
    if (Number.isFinite(nearFrame)) { depthCheck?.onClipping(system, 'near', nearFrame / 30); }
    if (Number.isFinite(farFrame)) { depthCheck?.onClipping(system, 'far', farFrame / 30); }
  }
  if (diameters.length === 0) { return undefined; }
  diameters.sort((left, right) => left - right);
  const activeAreas = areas.filter(value => value > 0);

  return {
    d99: diameters[Math.min(diameters.length - 1, Math.floor(diameters.length * 0.99))],
    coverage: activeAreas.reduce((sum, value) => sum + value, 0) / activeAreas.length / boundsWidth / boundsHeight,
  };
}

export function planParticleSize(
  systems: readonly Record<string, unknown>[], items: ReadonlyMap<string, Record<string, unknown>>,
  composition: Record<string, unknown>, bounds: readonly number[], pixelScale: number, hostWidth: number,
  textureFills: ReadonlyMap<string, number>, mode: boolean | number = true,
  depthCheck?: ParticleDepthCheck,
): { factor: number; limitedBy: string; limits?: Record<'display' | 'tail' | 'coverage' | 'maximum', number> } {
  const profile = mode === true || depthCheck != null
    ? measureParticleSize(systems, items, composition, bounds, textureFills, depthCheck) : undefined;

  if (mode === false) { return { factor: 1, limitedBy: 'disabled' }; }
  if (typeof mode === 'number') { return { factor: mode, limitedBy: 'fixed' }; }

  if (profile == null) { return { factor: 1, limitedBy: 'no visible particles' }; }
  const limits = {
    display: hostWidth / particleVector(composition['previewSize'])[0] / pixelScale,
    tail: profile.d99 > 0 ? 0.15 * Math.min(bounds[2], bounds[3]) / profile.d99 : 3,
    coverage: profile.coverage > 0 ? Math.sqrt(0.12 / profile.coverage) : 3,
    maximum: 3,
  };
  const [limitedBy, raw] = Object.entries(limits).sort((left, right) => left[1] - right[1])[0];

  return { factor: Math.max(1, Math.min(3, raw)), limitedBy: raw < 1 ? 'floor' : limitedBy, limits };
}

export function applyParticleSize(system: Record<string, unknown>, factor: number): void {
  if (Math.abs(factor - 1) < 1e-9) { return; }
  const options = particleRecord(system['options']);
  const keys = options['start3DSize'] === true ? ['startSizeX', 'startSizeY', 'startSizeZ'] : ['startSize'];

  for (const key of keys) {
    if (options[key] != null) { options[key] = scaleParticleValue(options[key], factor); }
  }
  if (system['trails'] != null) {
    const trails = particleRecord(system['trails']);

    if (trails['sizeAffectsWidth'] !== true) {
      trails['widthOverTrail'] = scaleParticleValue(trails['widthOverTrail'] ?? [0, 1], factor);
    }
  }
}
