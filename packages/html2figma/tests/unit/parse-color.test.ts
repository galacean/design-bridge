import { describe, it, expect } from 'vitest';
import { parseColor } from '@galacean/html2figma';

describe('parseColor', () => {
  it('supports uppercase HEX with alpha', () => {
    const parsed = parseColor('#FFAA0080');

    expect(parsed).toEqual({
      r: 1,
      g: 170 / 255,
      b: 0,
      a: 128 / 255,
    });
  });

  it('returns null for unsupported 4-digit hex', () => {
    expect(parseColor('#f0f8')).toBeNull();
  });

  it('returns null for percentage rgb values', () => {
    expect(parseColor('rgb(100%, 0%, 0%)')).toBeNull();
  });

  it('returns null for malformed rgba syntax', () => {
    const result = parseColor('rgba(255, 0, 0,)');

    expect(result).toBeNull();
  });
});
