import { createFigmaClipboardWithSchema } from './figma-clipboard';
import type { FigmaClipboardResult } from './figma-clipboard';
import { hydrateSceneFontSources } from './extract-scene';
import { upgradeFigmaArchiveProtocol } from './figma-file';
import { FONT_LAYOUT_FACE_CACHE } from './font-resolution';
import { GLYPH_BLOB_CACHE } from './glyph-encoding';
import { composeClipboardHTML, parseClipboardHTML } from './kiwi-archive';
import { loadFileSchema, loadSchema } from './kiwi-schema-node';
import { NODE_TEXT_CONVERSION_RUNTIME } from './text-conversion-runtime-node';
import type { SceneResult } from '../types';

export { extractAndSaveSchema, SCHEMA_PATH } from './kiwi-schema-node';

/**
 * Creates Figma clipboard HTML synchronously in Node.js.
 *
 * @param scenes - Named scene roots; failed or absent scenes are skipped.
 * @returns The HTML from {@link createFigmaClipboard}, ready to place on the clipboard as `text/html`.
 */
export function scenesToFigmaClipboard(scenes: SceneResult[]): string {
  return createFigmaClipboard(scenes).html;
}

/**
 * Encodes scenes into Figma clipboard HTML and archive data synchronously in Node.js.
 *
 * @remarks
 * Explicit font sources are read as local files. This function does not download or normalize fonts;
 * use {@link createCurrentFigmaClipboard} for asynchronous font hydration and the current file schema.
 * Clipboard conversion infers Auto Layout and can change the measured layout.
 *
 * @param scenes - Named scene roots; failed or absent scenes are skipped.
 * @returns Clipboard HTML, archive bytes, image entries, and blob deduplication statistics.
 */
export function createFigmaClipboard(scenes: SceneResult[]): FigmaClipboardResult {
  GLYPH_BLOB_CACHE.clear();
  FONT_LAYOUT_FACE_CACHE.clear();

  return createFigmaClipboardWithSchema(scenes, loadSchema(), {
    textRuntime: NODE_TEXT_CONVERSION_RUNTIME,
  });
}

/**
 * Creates Node.js clipboard data with the bundled file schema and version 106 archive protocol.
 *
 * @param scenes - Named scenes. Font sources on their text nodes are hydrated and updated in place.
 * @returns Clipboard HTML and archive data after font preparation and protocol conversion.
 */
export async function createCurrentFigmaClipboard(scenes: SceneResult[]): Promise<FigmaClipboardResult> {
  for (const scene of scenes) {
    if (scene.sceneData !== undefined) {
      await hydrateSceneFontSources(scene.sceneData);
    }
  }

  GLYPH_BLOB_CACHE.clear();
  FONT_LAYOUT_FACE_CACHE.clear();

  const result = createFigmaClipboardWithSchema(scenes, loadFileSchema(), {
    textRuntime: NODE_TEXT_CONVERSION_RUNTIME,
  });
  const archiveData = await upgradeFigmaArchiveProtocol(result.currentClipboardArchiveData);
  const { meta } = parseClipboardHTML(result.html);

  return {
    ...result,
    html: composeClipboardHTML(meta, archiveData),
    currentClipboardArchiveData: archiveData,
  };
}
