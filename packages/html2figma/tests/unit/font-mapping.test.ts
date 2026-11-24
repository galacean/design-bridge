import { describe, expect, it } from 'vitest';
import { mapFontStyle, normalizeFontFamily, resolveFigmaFontFamily } from '../../src/core/font-mapping';

describe('font family mapping', () => {
  it.each(['Material Sans', 'Lexicon', 'Symbol Text'])('preserves the declared %s family', family => {
    expect(normalizeFontFamily(`"${family}", Inter`)).toBe(family);
  });

  it.each([
    [400, 'normal', 'Regular'],
    [400, 'italic', 'Italic'],
    [700, 'italic', 'Bold Italic'],
  ] as const)('maps weight %s and CSS %s to %s', (weight, cssStyle, expected) => {
    expect(mapFontStyle(weight, 'Roboto', cssStyle)).toBe(expected);
  });

  it('matches known fonts case-insensitively without relying on Set spread', () => {
    expect(normalizeFontFamily('roboto')).toBe('Roboto');
    expect(normalizeFontFamily('times new roman')).toBe('Times New Roman');
  });

  it('uses Google Font style names for Noto families', () => {
    expect(mapFontStyle(600, 'Noto Sans SC')).toBe('SemiBold');
    expect(mapFontStyle(800, 'Noto Sans SC')).toBe('ExtraBold');
    expect(mapFontStyle(600, 'Arial')).toBe('Semi Bold');
  });

  it('drops misleading weight suffixes from loaded font family names', () => {
    expect(resolveFigmaFontFamily('Noto Sans SC', 'Noto Sans SC Thin')).toBe('Noto Sans SC');
    expect(resolveFigmaFontFamily('WDXL Lubrifont SC', 'WDXL Lubrifont SC')).toBe('WDXL Lubrifont SC');
    expect(resolveFigmaFontFamily('Brand Sans', 'Brand Sans Pro')).toBe('Brand Sans Pro');
  });
});
