import type * as fontkit from 'fontkit';
import { encodeGlyphCommandsBlob } from './glyph-path-encoding';
import type { ClipboardBlobStore } from './clipboard-blob-store';

// Preserve only ordered, zero-offset substitutions whose code points map exactly to the input.
// Reordered scripts and positioned marks need full shaping support and retain the existing path.
export function shapeFontLigatures(face: fontkit.Font | null | undefined, text: string, store: ClipboardBlobStore): Array<{
  firstCharacter: number; characterCount: number; commandsBlob: number;
}> {
  if (face === null || face === undefined) {
    return [];
  }
  try {
    const run = face.layout(text);

    if (run.direction !== 'ltr' || run.glyphs.length !== run.positions.length ||
        run.glyphs.some(glyph => glyph.id === 0) ||
        run.positions.some(position => position.xOffset !== 0 || position.yOffset !== 0 || position.yAdvance !== 0)) {
      return [];
    }
    const sequences = run.glyphs.map(glyph => String.fromCodePoint(...glyph.codePoints));

    if (sequences.join('') !== text) {
      return [];
    }
    const result: Array<{ firstCharacter: number; characterCount: number; commandsBlob: number }> = [];
    let offset = 0;

    for (let index = 0; index < run.glyphs.length; index++) {
      const sequence = sequences[index];

      if (Array.from(sequence).length > 1) {
        result.push({
          firstCharacter: offset, characterCount: sequence.length,
          commandsBlob: store.add('glyph', encodeGlyphCommandsBlob(run.glyphs[index].path, face.unitsPerEm)),
        });
      }
      offset += sequence.length;
    }

    return result;
  } catch {
    // Fonts with unsupported layout tables retain per-character glyph conversion.
    return [];
  }
}
