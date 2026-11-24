import { describe, expect, it } from 'vitest';
import { sha1 } from '../../src/core/sha1';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

describe('sha1', () => {
  it.each([
    ['', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    ['Design Bridge', 'c97ca90500c97794b38465a4a0248ccfb5a45300'],
  ])('matches the SHA-1 vector for %j', (input, expected) => {
    expect(toHex(sha1(new TextEncoder().encode(input)))).toBe(expected);
  });
});
