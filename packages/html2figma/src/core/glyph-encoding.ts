import type * as fontkit from 'fontkit';
import { getFontFace, getFontLayoutFace, getFontSourceFallbacks, normalizeFontCacheKey } from './font-resolution';
import { encodeGlyphCommandsBlob } from './glyph-path-encoding';
import type { ClipboardBlobStore } from './clipboard-blob-store';

export const GLYPH_BLOB_CACHE = new Map<string, { index: number | null; family: string | null; missing: boolean }>();

export function computeKerningAwareCharWidths(
  fontFamily: string,
  fontStyle: string,
  fontWeight: number,
  fontSource: string | null | undefined,
  text: string,
  fontSize: number,
): number[] | null {
  if (!text || !Number.isFinite(fontSize) || fontSize <= 0) {
    return null;
  }

  const chars = Array.from(text);

  if (chars.length !== text.length) {
    return null;
  }

  const fontFace = getFontLayoutFace(fontFamily, fontStyle, fontSource, fontWeight);

  if (!fontFace || typeof fontFace.layout !== 'function') {
    return null;
  }

  try {
    const unitsPerEm = Number(fontFace.unitsPerEm || 1000);

    if (!Number.isFinite(unitsPerEm) || unitsPerEm <= 0) {
      return null;
    }

    const layout = fontFace.layout(text);
    const glyphs = Array.isArray(layout?.glyphs) ? layout.glyphs : [];
    const positions = Array.isArray(layout?.positions) ? layout.positions : [];

    if (glyphs.length !== chars.length || positions.length !== chars.length) {
      return null;
    }

    return positions.map((position, idx: number) => {
      const fallbackAdvance = Number(glyphs[idx]?.advanceWidth || 0);
      const xAdvance = Number.isFinite(position?.xAdvance)
        ? Number(position.xAdvance)
        : Number.isFinite(fallbackAdvance)
          ? fallbackAdvance
          : 0;

      return (xAdvance / unitsPerEm) * fontSize;
    });
  } catch {
    return null;
  }
}

export function glyphPathToBlobIndex(
  fontFamily: string,
  fontStyle: string,
  fontWeight: number,
  fontSource: string | null | undefined,
  character: string,
  blobStore: ClipboardBlobStore,
  onResolution?: (family: string | null, missing: boolean) => void,
): number | null {
  const cacheKey = `${normalizeFontCacheKey(fontFamily, fontStyle, fontSource, fontWeight)}::${character}`;
  const cached = GLYPH_BLOB_CACHE.get(cacheKey);

  if (cached !== undefined) {
    onResolution?.(cached.family, cached.missing);

    return cached.index;
  }

  let fontFace = getFontFace(fontFamily, fontStyle, fontSource, fontWeight);
  const codePoint = character.codePointAt(0);

  if (!fontFace || codePoint === undefined) {
    GLYPH_BLOB_CACHE.set(cacheKey, { index: null, family: null, missing: true });
    onResolution?.(null, true);

    return null;
  }

  const safeGlyphForCodePoint = (face: fontkit.Font, cp: number): fontkit.Glyph | null => {
    try {
      return face.glyphForCodePoint(cp);
    } catch {
      return null;
    }
  };

  let glyph = safeGlyphForCodePoint(fontFace, codePoint);

  if (!glyph) {
    const unvariedFace = getFontFace(fontFamily, fontStyle, fontSource, undefined);

    if (unvariedFace) {
      const unvariedGlyph = safeGlyphForCodePoint(unvariedFace, codePoint);

      if (unvariedGlyph) {
        fontFace = unvariedFace;
        glyph = unvariedGlyph;
      }
    }
  }

  if (!glyph) {
    GLYPH_BLOB_CACHE.set(cacheKey, { index: null, family: null, missing: true });
    onResolution?.(null, true);

    return null;
  }
  const isMissingGlyph = (candidate: fontkit.Glyph | null): boolean => {
    if (!candidate) {
      return true;
    }
    if (typeof candidate.id === 'number' && candidate.id === 0) {
      return true;
    }
    if (typeof candidate.name === 'string' && candidate.name.toLowerCase().includes('.notdef')) {
      return true;
    }

    return false;
  };

  if (fontSource !== undefined && fontSource !== null && fontSource !== '' && isMissingGlyph(glyph)) {
    for (const fallbackSource of getFontSourceFallbacks(fontSource)) {
      const candidateFace = getFontFace(fontFamily, fontStyle, fallbackSource, fontWeight);
      const candidateGlyph = candidateFace !== null ? safeGlyphForCodePoint(candidateFace, codePoint) : null;

      if (candidateFace !== null && !isMissingGlyph(candidateGlyph)) {
        fontFace = candidateFace;
        glyph = candidateGlyph;

        break;
      }
    }
  }

  if (fontSource !== undefined && fontSource !== null && fontSource !== '' && isMissingGlyph(glyph)) {
    const fallbackFace = getFontFace(fontFamily, fontStyle, null, fontWeight);

    if (fallbackFace) {
      const fallbackGlyph = safeGlyphForCodePoint(fallbackFace, codePoint);

      if (!isMissingGlyph(fallbackGlyph)) {
        fontFace = fallbackFace;
        glyph = fallbackGlyph;
      }
    }
  }

  if (glyph === null) {
    GLYPH_BLOB_CACHE.set(cacheKey, { index: null, family: null, missing: true });
    onResolution?.(null, true);

    return null;
  }

  const unitsPerEm = fontFace.unitsPerEm || 1000;
  const glyphPath = glyph.path;

  const blob = encodeGlyphCommandsBlob(glyphPath, unitsPerEm);

  const blobIndex = blobStore.add('glyph', blob);

  const missing = isMissingGlyph(glyph);

  GLYPH_BLOB_CACHE.set(cacheKey, { index: blobIndex, family: fontFace.familyName, missing });
  onResolution?.(fontFace.familyName, missing);

  return blobIndex;
}
