import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import * as fontkit from 'fontkit';
import { DEFAULT_FONT_FALLBACK_FAMILIES } from './font-mapping';

export { mapFontStyle, normalizeFontFamily, shouldEmitFallbackFonts } from './font-mapping';

// ---- Font caches ----

const FONT_FILE_CACHE = new Map<string, string | null>();
const FONT_FACE_CACHE = new Map<string, fontkit.Font | null>();

export const FONT_LAYOUT_FACE_CACHE = new Map<string, fontkit.Font | null>();
const FONT_SOURCE_FALLBACKS = new Map<string, string[]>();

export function registerFontSourceFallbacks(primarySource: string, sources: string[]): void {
  const existing = FONT_SOURCE_FALLBACKS.get(primarySource) ?? [];
  const merged = new Set([...existing, ...sources]);

  merged.delete(primarySource);
  FONT_SOURCE_FALLBACKS.set(primarySource, Array.from(merged));
}

export function getFontSourceFallbacks(primarySource: string | null | undefined): string[] {
  return primarySource === undefined || primarySource === null ? [] : FONT_SOURCE_FALLBACKS.get(primarySource) ?? [];
}

export function normalizeFontCacheKey(
  fontFamily: string,
  fontStyle: string,
  fontSource?: string | null,
  fontWeight?: number,
): string {
  const normalizedWeight = Number.isFinite(fontWeight) ? Math.round(fontWeight as number) : 0;

  return `${fontFamily}::${fontStyle}::${fontSource || ''}::${normalizedWeight}`.toLowerCase();
}

function resolveFontFilePath(
  fontFamily: string,
  fontStyle: string,
  fontSource?: string | null,
  fontWeight?: number,
): string | null {
  const cacheKey = normalizeFontCacheKey(fontFamily, fontStyle, fontSource, fontWeight);

  if (FONT_FILE_CACHE.has(cacheKey)) {
    const cached = FONT_FILE_CACHE.get(cacheKey) ?? null;

    if (cached !== null || fontSource === undefined || fontSource === null || !fs.existsSync(fontSource)) {
      return cached;
    }

    FONT_FILE_CACHE.delete(cacheKey);
  }

  if (fontSource && fs.existsSync(fontSource)) {
    FONT_FILE_CACHE.set(cacheKey, fontSource);

    return fontSource;
  }

  const fallbackFamilies = (
    process.env.FONT_FALLBACK_FAMILIES ? process.env.FONT_FALLBACK_FAMILIES : DEFAULT_FONT_FALLBACK_FAMILIES.join(',')
  )
    .split(',')
    .map(family => family.trim())
    .filter(Boolean);

  if (!fallbackFamilies.includes('sans-serif')) {
    fallbackFamilies.push('sans-serif');
  }

  const patterns = [
    fontStyle ? `${fontFamily}:style=${fontStyle}` : fontFamily,
    fontFamily,
    ...fallbackFamilies.flatMap(family => [fontStyle ? `${family}:style=${fontStyle}` : family, family]),
  ];

  for (const pattern of patterns) {
    try {
      const filePath = execFileSync('fc-match', ['-f', '%{file}', pattern], {
        encoding: 'utf8',
      }).trim();

      if (filePath && fs.existsSync(filePath)) {
        FONT_FILE_CACHE.set(cacheKey, filePath);

        return filePath;
      }
    } catch {
      // Try the next fallback pattern.
    }
  }

  FONT_FILE_CACHE.set(cacheKey, null);

  return null;
}

function isFontCollection(font: fontkit.Font | fontkit.FontCollection): font is fontkit.FontCollection {
  return Array.isArray((font as fontkit.FontCollection).fonts);
}

function pickFontFace(
  fontCollection: fontkit.Font | fontkit.FontCollection,
  fontFamily: string,
  fontStyle: string,
): fontkit.Font | null {
  if (!isFontCollection(fontCollection)) {
    return fontCollection;
  }

  const normalizedFamily = fontFamily.trim().toLowerCase();
  const normalizedStyle = fontStyle.trim().replace(/\s+/g, '').toLowerCase();
  const faces = Array.isArray(fontCollection.fonts) ? fontCollection.fonts : [];

  if (faces.length === 0) {
    return null;
  }

  const exactMatch = faces.find((face: fontkit.Font) => {
    const faceFamily = String(face.familyName || '')
      .trim()
      .toLowerCase();
    const faceStyle = String(face.subfamilyName || '')
      .trim()
      .replace(/\s+/g, '')
      .toLowerCase();

    return faceFamily === normalizedFamily && faceStyle === normalizedStyle;
  });

  if (exactMatch) {
    return exactMatch;
  }

  const familyMatch = faces.find(
    (face: fontkit.Font) =>
      String(face.familyName || '')
        .trim()
        .toLowerCase() === normalizedFamily,
  );

  if (familyMatch) {
    return familyMatch;
  }

  const styleMatch = faces.find(
    (face: fontkit.Font) =>
      String(face.subfamilyName || '')
        .trim()
        .replace(/\s+/g, '')
        .toLowerCase() === normalizedStyle,
  );

  if (styleMatch) {
    return styleMatch;
  }

  return faces.length > 0 ? faces[0] : null;
}

export function applyFontVariation(fontFace: fontkit.Font | null, fontWeight?: number) {
  if (!fontFace || typeof fontFace.getVariation !== 'function') {
    return fontFace;
  }
  const axes = fontFace.variationAxes;
  const wghtAxis = axes.wght;

  if (!wghtAxis) {
    return fontFace;
  }

  const targetRaw = Number.isFinite(fontWeight) ? Number(fontWeight) : null;

  if (!Number.isFinite(targetRaw)) {
    return fontFace;
  }

  const min = Number.isFinite(wghtAxis.min) ? Number(wghtAxis.min) : 1;
  const max = Number.isFinite(wghtAxis.max) ? Number(wghtAxis.max) : 1000;
  const target = Math.max(min, Math.min(max, Number(targetRaw)));

  try {
    const variedFontFace = fontFace.getVariation({ wght: target });

    // Some unicode-range WOFF2 variable fonts lose their cmap table after
    // fontkit creates a variation instance. Probe it before using that face.
    variedFontFace.glyphForCodePoint(0);

    return variedFontFace;
  } catch {
    return fontFace;
  }
}

export function getFontFace(
  fontFamily: string,
  fontStyle: string,
  fontSource?: string | null,
  fontWeight?: number,
): fontkit.Font | null {
  const cacheKey = normalizeFontCacheKey(fontFamily, fontStyle, fontSource, fontWeight);

  if (FONT_FACE_CACHE.has(cacheKey)) {
    const cached = FONT_FACE_CACHE.get(cacheKey) ?? null;

    if (cached !== null || fontSource === undefined || fontSource === null || !fs.existsSync(fontSource)) {
      return cached;
    }

    FONT_FACE_CACHE.delete(cacheKey);
  }

  const fontFilePath = resolveFontFilePath(fontFamily, fontStyle, fontSource, fontWeight);

  if (!fontFilePath) {
    FONT_FACE_CACHE.set(cacheKey, null);

    return null;
  }

  try {
    const loadedFont = fontkit.openSync(fontFilePath);
    const fontFace = applyFontVariation(pickFontFace(loadedFont, fontFamily, fontStyle), fontWeight);

    FONT_FACE_CACHE.set(cacheKey, fontFace);

    return fontFace;
  } catch (error) {
    console.info(`⚠️ Failed to load font file for "${fontFamily}" (${fontStyle}):`, error);
    FONT_FACE_CACHE.set(cacheKey, null);

    return null;
  }
}

export function getFontLayoutFace(
  fontFamily: string,
  fontStyle: string,
  fontSource?: string | null,
  fontWeight?: number,
): fontkit.Font | null {
  const cacheKey = `${normalizeFontCacheKey(fontFamily, fontStyle, fontSource, fontWeight)}::layout`;

  if (FONT_LAYOUT_FACE_CACHE.has(cacheKey)) {
    return FONT_LAYOUT_FACE_CACHE.get(cacheKey) || null;
  }

  const fontFilePath = resolveFontFilePath(fontFamily, fontStyle, fontSource, fontWeight);

  if (!fontFilePath) {
    FONT_LAYOUT_FACE_CACHE.set(cacheKey, null);

    return null;
  }

  try {
    const loadedFont = fontkit.openSync(fontFilePath);
    const fontFace = applyFontVariation(pickFontFace(loadedFont, fontFamily, fontStyle), fontWeight);

    FONT_LAYOUT_FACE_CACHE.set(cacheKey, fontFace || null);

    return fontFace || null;
  } catch {
    FONT_LAYOUT_FACE_CACHE.set(cacheKey, null);

    return null;
  }
}
