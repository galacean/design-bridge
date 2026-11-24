import { describe, expect, it } from 'vitest';
import type { Font } from 'fontkit';
import { applyFontVariation } from '../../src/core/font-resolution';

describe('font resolution', () => {
  it('uses a valid variable font instance for the requested weight', () => {
    const variedFontFace = {
      glyphForCodePoint: () => ({ id: 0 }),
    } as unknown as Font;
    const fontFace = {
      variationAxes: { wght: { min: 100, default: 400, max: 900 } },
      getVariation: () => variedFontFace,
    } as unknown as Font;

    expect(applyFontVariation(fontFace, 600)).toBe(variedFontFace);
  });

  it('falls back when fontkit creates a variable font without a usable cmap', () => {
    const fontFace = {
      variationAxes: { wght: { min: 100, default: 400, max: 900 } },
      getVariation: () => ({
        glyphForCodePoint: () => {
          throw new TypeError("Cannot read properties of undefined (reading 'tables')");
        },
      }),
    } as unknown as Font;

    expect(applyFontVariation(fontFace, 400)).toBe(fontFace);
  });
});
