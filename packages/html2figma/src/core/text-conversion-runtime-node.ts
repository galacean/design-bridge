import { shapeFontLigatures } from './shape-font-ligatures';
import { getFontFace, getFontLayoutFace } from './font-resolution';
import { computeKerningAwareCharWidths, glyphPathToBlobIndex } from './glyph-encoding';
import { resolveFigmaFontFamily } from './font-mapping';
import type { TextConversionRuntime } from './text-conversion-runtime';

export const NODE_TEXT_CONVERSION_RUNTIME: TextConversionRuntime = {
  resolveFontFamily(fontFamily, fontStyle, fontSource, fontWeight) {
    const face = getFontFace(fontFamily, fontStyle, fontSource, fontWeight);

    return face === null ? null : resolveFigmaFontFamily(fontFamily, face.familyName);
  },
  getLigatureGlyphs: (family, style, weight, source, text, store) =>
    shapeFontLigatures(getFontLayoutFace(family, style, source, weight), text, store),
  computeCharWidths: computeKerningAwareCharWidths,
  getGlyphBlobIndex: glyphPathToBlobIndex,
};

export function createNodeTextRuntimeDiagnostics(): {
  runtime: TextConversionRuntime;
  getWarnings: () => string[];
  getMissingCharacters: () => string[];
} {
  const resolutions = new Map<string, { requested: string; encoded: string; characters: Set<string> }>();
  const missingCharacters = new Set<string>();
  const unavailableFamilies = new Set<string>();
  const record = (requested: string, encoded: string, character?: string): void => {
    const key = JSON.stringify([requested, encoded]);
    const resolution = resolutions.get(key) ?? { requested, encoded, characters: new Set<string>() };

    if (character !== undefined) {
      resolution.characters.add(character);
    }
    resolutions.set(key, resolution);
  };

  return {
    runtime: {
      ...NODE_TEXT_CONVERSION_RUNTIME,
      resolveFontFamily(family, style, source, weight) {
        const face = getFontFace(family, style, source, weight);

        if (face === null) {
          unavailableFamilies.add(family);
        } else {
          record(family, face.familyName);
        }

        return face === null ? null : resolveFigmaFontFamily(family, face.familyName);
      },
      getGlyphBlobIndex(family, style, weight, source, character, store) {
        return glyphPathToBlobIndex(family, style, weight, source, character, store, (encoded, missing) => {
          if (character.trim() === '') {
            return;
          }
          if (missing) {
            missingCharacters.add(character);
          }
          if (encoded !== null) {
            record(family, encoded, character);
          }
        });
      },
    },
    getMissingCharacters: () => [...missingCharacters],
    getWarnings() {
      const warnings: string[] = [];

      for (const resolution of resolutions.values()) {
        if (resolution.requested.toLowerCase() !== resolution.encoded.toLowerCase()) {
          warnings.push(
            `Font resolution: requested "${resolution.requested}", encoded "${resolution.encoded}"` +
            (resolution.characters.size > 0 ? ` for ${JSON.stringify([...resolution.characters].join(''))}.` : '.'),
          );
        }
      }
      for (const family of unavailableFamilies) {
        warnings.push(`Requested font unavailable: ${family}.`);
      }
      if (missingCharacters.size > 0) {
        warnings.push(`Missing glyphs: ${JSON.stringify([...missingCharacters].join(''))}.`);
      }

      return warnings;
    },
  };
}
