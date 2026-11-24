import { collectResourceDiagnostics } from './collect-resource-diagnostics';
import { createFigmaClipboardWithSchema } from './figma-clipboard';
import { hydrateSceneFontSources } from './extract-scene';
import { createFigmaFileFromClipboardResult, inferFigmaFileRenderBounds } from './figma-file';
import type { FigmaFileOptions, FigmaFileResult } from './figma-file';
import { FONT_LAYOUT_FACE_CACHE } from './font-resolution';
import { GLYPH_BLOB_CACHE } from './glyph-encoding';
import { loadFileSchema } from './kiwi-schema-node';
import { createNodeTextRuntimeDiagnostics } from './text-conversion-runtime-node';
import type { SceneResult } from '../types';

/**
 * Creates and structurally validates a `.fig` ZIP archive in Node.js.
 *
 * @remarks
 * Defaults to snapshot layout, preserving measured positions. Set `layoutMode: 'auto-layout'` to infer flow layout.
 * Missing glyphs produce warnings by default; `requireTextGlyphs: true` rejects missing visible characters.
 * Structural validation does not guarantee visual fidelity or acceptance by every Figma version.
 *
 * @param scenes - Named scenes. Font sources on their text nodes are hydrated and updated in place.
 * @param options - Layout, glyph coverage, document metadata, and thumbnail settings.
 * @returns Archive bytes, blob statistics, image count, and validation diagnostics.
 * @throws If strict glyph checking fails or the generated archive fails structural validation.
 */
export async function createFigmaFile(
  scenes: SceneResult[],
  options: FigmaFileOptions = {},
): Promise<FigmaFileResult> {
  const { requireTextGlyphs = false, ...fileOptions } = options;

  for (const scene of scenes) {
    if (scene.sceneData !== undefined) {
      await hydrateSceneFontSources(scene.sceneData);
    }
  }

  GLYPH_BLOB_CACHE.clear();
  FONT_LAYOUT_FACE_CACHE.clear();

  const diagnostics = createNodeTextRuntimeDiagnostics();
  const clipboard = createFigmaClipboardWithSchema(scenes, loadFileSchema(), {
    textRuntime: diagnostics.runtime,
    layoutMode: options.layoutMode ?? 'snapshot',
  });

  const missingCharacters = diagnostics.getMissingCharacters();

  if (requireTextGlyphs && missingCharacters.length > 0) {
    throw new Error(
      `Node Figma export could not generate glyphs for visible text. ` +
      `Missing characters: ${missingCharacters.join('')}. ${diagnostics.getWarnings().join(' ')}`,
    );
  }

  const result = await createFigmaFileFromClipboardResult(clipboard, {
    ...fileOptions,
    renderBounds: options.renderBounds ?? inferFigmaFileRenderBounds(scenes),
  });

  result.validation.warnings.push(...diagnostics.getWarnings());

  for (const scene of scenes) {
    if (scene.sceneData !== undefined) {
      result.validation.warnings.push(...collectResourceDiagnostics(scene.sceneData)
        .filter(diagnostic => diagnostic.code === 'TEXT_RASTERIZED').map(diagnostic => diagnostic.message));
    }
  }

  return result;
}
