import { isRecord } from '../common/json-normalization';

export function particleRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function particleNumber(value: unknown, fallback = 0): number {
  if (value == null) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('[ge-ir:particle-layout] Expected a finite number.');
  }

  return value;
}

export function particleArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError('[ge-ir:particle-layout] Expected a particle expression array.');
  }

  return value;
}

export function createParticleRandom(seed: number): () => number {
  let state = seed;

  return () => {
    state = Math.imul(1664525, state) + 1013904223 | 0;

    return (state >>> 0) / 4294967296;
  };
}

export function scaleParticleValue(value: unknown, factor: number): unknown {
  if (typeof value === 'number') {
    return particleNumber(value) * factor;
  }
  const [kind, payload] = particleArray(value);

  if (kind === 0) {
    return [kind, particleNumber(payload) * factor];
  }
  if (kind === 4) {
    return [kind, particleArray(payload).map(entry => particleNumber(entry) * factor)];
  }
  if (kind === 5 || kind === 6) {
    return [kind, particleArray(payload).map(entry => particleArray(entry)
      .map((part, index) => index === 0 ? part : particleNumber(part) * factor))];
  }
  if (kind === 21) {
    return [kind, particleArray(payload).map(entry => {
      const [type, points, ...rest] = particleArray(entry);

      return [type, particleArray(points).map((part, index) =>
        index % 2 === 0 ? part : particleNumber(part) * factor), ...rest];
    })];
  }

  throw new TypeError(`[ge-ir:particle-layout] Unsupported scalar expression '${String(kind)}'.`);
}

export function isZeroParticleValue(value: unknown): boolean {
  if (value == null || value === 0) {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }

  return value[0] === 0 ? value[1] === 0
    : value[0] === 4 && Array.isArray(value[1]) && value[1].every(entry => entry === 0);
}

export function addParticleValue(value: unknown, addition: unknown): unknown {
  if (isZeroParticleValue(value)) {
    return structuredClone(addition);
  }
  if (isZeroParticleValue(addition)) {
    return structuredClone(value);
  }
  if (!Array.isArray(addition) || addition[0] !== 0) {
    return undefined;
  }
  const amount = particleNumber(addition[1]);

  if (typeof value === 'number') {
    return [0, value + amount];
  }
  const [kind, payload] = particleArray(value);

  if (kind === 0) {
    return [0, particleNumber(payload) + amount];
  }
  if (kind === 4) {
    return [4, particleArray(payload).map(entry => particleNumber(entry) + amount)];
  }

  return undefined;
}

export function sampleParticleValues(value: unknown, random: () => number, count: number): number[] {
  if (value == null || typeof value === 'number') {
    return [particleNumber(value)];
  }
  const [kind, payload] = particleArray(value);

  if (kind === 0) {
    return [particleNumber(payload)];
  }
  if (kind === 4) {
    const [left, right] = particleArray(payload).map(entry => particleNumber(entry));

    return Array.from({ length: count }, () => left + (right - left) * random());
  }
  if (kind === 5 || kind === 6) {
    return particleArray(payload).map(point => particleNumber(particleArray(point)[1]));
  }
  if (kind === 21) {
    return particleArray(payload).flatMap(frame => particleArray(particleArray(frame)[1])
      .filter((_, index) => index % 2 === 1).map(entry => particleNumber(entry)));
  }

  throw new TypeError(`[ge-ir:particle-layout] Unsupported scalar expression '${String(kind)}'.`);
}

/** Deterministic analytic replay uses key values with linear interpolation, including Bezier key values. */
export function particleSampler(value: unknown, random: () => number, fallback = 1): (age: number) => number {
  if (value == null) {
    return () => fallback;
  }
  if (typeof value === 'number') {
    return () => value;
  }
  const [kind, payload] = particleArray(value);

  if (kind === 0 || kind === 4) {
    const sampled = sampleParticleValues(value, random, 1)[0];

    return () => sampled;
  }
  const points = particleArray(payload).map(entry => {
    const frame = particleArray(entry);
    const values = kind === 21 ? particleArray(frame[1]) : frame;
    const offset = kind === 21 && (frame[0] === 1 || frame[0] === 2) ? 2 : 0;

    return [particleNumber(values[offset]), particleNumber(values[offset + 1])];
  }).sort((left, right) => left[0] - right[0]);

  if (points.length === 0 || ![5, 6, 21].includes(particleNumber(kind))) {
    throw new TypeError('[ge-ir:particle-layout] Unsupported particle curve.');
  }

  return age => {
    if (age <= points[0][0]) {
      return points[0][1];
    }
    for (let index = 1; index < points.length; index++) {
      const [time, valueAtTime] = points[index];
      const [previousTime, previousValue] = points[index - 1];

      if (age <= time) {
        return previousValue + (valueAtTime - previousValue) * (age - previousTime) / (time - previousTime);
      }
    }

    return points[points.length - 1][1];
  };
}
