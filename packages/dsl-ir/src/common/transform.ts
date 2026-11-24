import type { Layer } from '../dsl/schema';

/** Static defaults for absent transform channels. */
export const TRANSFORM_FALLBACK: {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  anchor: [number, number, number];
  opacity: number;
} = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  anchor: [0, 0, 0],
  opacity: 1,
};

export function getLayerStackingOrder(layer: Layer): number {
  const value = layer.position.a ? layer.position.animation[0]?.start : layer.position.value;

  return Array.isArray(value) ? (value[2] ?? 0) : 0;
}

export function withPositionZ(position: Layer['position'], depth: number): Layer['position'] {
  const result = structuredClone(position);

  if (result.a) {
    for (const segment of result.animation) {
      segment.start[2] = depth;
      segment.end[2] = depth;
    }
  } else if (Array.isArray(result.value)) {
    result.value[2] = depth;
  }

  return result;
}

export function translateDSLPosition(position: Layer['position'], offset: [number, number]): Layer['position'] {
  const result = structuredClone(position);
  const points = result.a ? result.animation.flatMap(segment => [segment.start, segment.end]) : [result.value];

  for (const point of points) {
    point[0] += offset[0];
    point[1] += offset[1];
  }

  return result;
}
