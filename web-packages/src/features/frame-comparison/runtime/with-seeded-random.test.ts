import { describe, expect, it } from 'vitest';
import { withSeededRandom } from './with-seeded-random';

describe('synchronous seeded simulation', () => {
  it('repeats a random sequence and restores the caller random function', () => {
    const original = Math.random;
    const sample = () => Array.from({ length: 10 }, () => Math.random());
    const first = withSeededRandom(sample);

    expect(withSeededRandom(sample)).toEqual(first);
    expect(new Set(first).size).toBe(10);
    expect(Math.random).toBe(original);
  });

  it('restores the random function when simulation fails', () => {
    const original = Math.random;

    expect(() => withSeededRandom(() => { throw new Error('simulation'); })).toThrow('simulation');
    expect(Math.random).toBe(original);
  });
});
