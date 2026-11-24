import { describe, expect, it } from 'vitest';
import { parseParticleShape } from '../src';

describe('particle shape context', () => {
  it('projects recognized shape fields and retains direction expressions', () => {
    const shape = { type: 3, radius: 0.5, arc: 80, turbulenceX: [0, 2], ignored: 'source-only' };

    expect(parseParticleShape(shape)).toEqual({
      type: 3, shape: 'Hemisphere', radius: 0.5, arc: 80, arcMode: 0, turbulenceX: [0, 2],
    });
    expect(parseParticleShape({ type: 3, radius: 'invalid', arc: 80 })).toBeUndefined();
  });
});
