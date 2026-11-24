import type { Layer } from '../../src';

export function createTestAnimatedProperty<T extends number | [number, number, number]>(value: T): { a: false; value: T } {
  return { a: false, value };
}

export function createTestLayer(id: string, name: string, type: Layer['type']): Layer {
  const layer: Omit<Layer, 'type'> = {
    id,
    name,
    width: type === 'layer' || type === 'particle' ? 100 : 0,
    height: type === 'layer' || type === 'particle' ? 100 : 0,
    description: { self: '', composite: '' },
    parent: null,
    time_range: [0, 1],
    position: createTestAnimatedProperty([0, 0, 0]),
    rotation: createTestAnimatedProperty([0, 0, 0]),
    scale: createTestAnimatedProperty([1, 1, 1]),
    anchor: createTestAnimatedProperty([0, 0, 0]),
    opacity: createTestAnimatedProperty(1),
    children: [],
  };

  if (type === 'text') {
    return { ...layer, type, text: { content: '', size: 16, color: '#000000' } };
  }
  if (type === 'particle') {
    return { ...layer, type, particle: {
      options: { maxCount: 50, startLifetime: [4, [1, 2]] },
      emission: {
        rateOverTime: [0, 0],
        bursts: [{ time: 0, count: 20, cycles: 1, interval: 0 }],
      },
    } };
  }
  if (type === 'layer') {
    return { ...layer, type, asset: { source: 'user', url: 'https://example.com/image.png', prompt: '' } };
  }

  return { ...layer, type };
}
