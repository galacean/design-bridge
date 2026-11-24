import { collectResourceDiagnostics } from './core/collect-resource-diagnostics';
import type { BrowserFigmaClipboardOptions } from './browser-clipboard';
import { createFigmaClipboardWithSchema } from './core/figma-clipboard';
import { createFigmaFileFromClipboardResult, inferFigmaFileRenderBounds } from './core/figma-file';
import type { FigmaFileOptions, FigmaFileResult } from './core/figma-file';
import { decodeCompressedSchema } from './core/kiwi-archive';
import { createBrowserTextConversionRuntime } from './core/text-conversion-runtime-browser';
import type { HTMLSceneDocument } from './model/html-scene-document';
import type { SceneResult } from './types';

/** Browser `.fig` export settings, combining file metadata, schema loading, and font preparation. */
export interface BrowserFigmaFileOptions extends BrowserFigmaClipboardOptions, FigmaFileOptions {
  /** Reject missing visible glyphs. Defaults to true; false permits an editable-text fallback. */
  requireTextGlyphs?: boolean;
}

const DEFAULT_FILE_SCHEMA_URL = new URL('../data/figma-file-schema.bin', import.meta.url);

/**
 * Creates and structurally validates a `.fig` archive from named scenes in the browser.
 *
 * @remarks
 * Uses snapshot layout and requires glyph coverage for visible text by default.
 * Provide font bytes or accessible font URLs when Local Font Access is unavailable.
 * Structural validation does not guarantee visual fidelity or acceptance by every Figma version.
 *
 * @param scenes - Named scene roots; failed or absent scenes are skipped.
 * @param options - Layout, font, schema, and document metadata settings.
 * @returns Archive bytes, blob statistics, image count, and validation diagnostics.
 * @throws If required fonts or glyphs are unavailable, schema loading fails, or archive validation fails.
 */
export async function createFigmaFileInBrowser(
  scenes: SceneResult[],
  options: BrowserFigmaFileOptions = {},
): Promise<FigmaFileResult> {
  const { compressedSchema, schemaURL, fonts, localFontAccess, requireTextGlyphs = true, ...fileOptions } = options;
  const schemaBytes = compressedSchema ?? await fetchSchema(schemaURL ?? DEFAULT_FILE_SCHEMA_URL);
  const preparation = await createBrowserTextConversionRuntime(scenes, { fonts, localFontAccess });
  const { runtime, glyphCoverage } = preparation;
  const clipboard = createFigmaClipboardWithSchema(scenes, decodeCompressedSchema(schemaBytes), {
    textRuntime: runtime,
    layoutMode: options.layoutMode ?? 'snapshot',
  });

  if (requireTextGlyphs && hasVisibleText(scenes) &&
      (glyphCoverage.resolved === 0 || glyphCoverage.missingCharacters.length > 0)) {
    const missing = glyphCoverage.missingCharacters.length > 0
      ? ` Missing characters: ${glyphCoverage.missingCharacters.join('')}.`
      : '';
    const missingFonts = preparation.missingFontFamilies.length > 0
      ? ` Missing fonts: ${preparation.missingFontFamilies.join(', ')}.`
      : '';
    const loadErrors = preparation.fontLoadErrors.length > 0
      ? ` Font errors: ${preparation.fontLoadErrors.join('; ')}.`
      : '';

    throw new Error(
      `Browser Figma export could not generate glyphs for visible text.${missing}${missingFonts}${loadErrors} ` +
      `Loaded fonts: ${preparation.loadedFontCount}.`,
    );
  }

  const result = await createFigmaFileFromClipboardResult(clipboard, {
    ...fileOptions,
    renderBounds: fileOptions.renderBounds ?? inferFigmaFileRenderBounds(scenes),
  });

  for (const resolution of glyphCoverage.fontResolutions) {
    if (resolution.requestedFamily.toLowerCase() !== resolution.resolvedFamily.toLowerCase()) {
      result.validation.warnings.push(
        `Font resolution: requested "${resolution.requestedFamily}", encoded "${resolution.resolvedFamily}"` +
        (resolution.characters.length > 0 ? ` for ${JSON.stringify(resolution.characters.join(''))}.` : '.'),
      );
    }
  }
  for (const family of preparation.missingFontFamilies) {
    result.validation.warnings.push(`Requested font unavailable: ${family}.`);
  }
  for (const error of preparation.fontLoadErrors) {
    result.validation.warnings.push(`Font load error: ${error}`);
  }
  if (glyphCoverage.missingCharacters.length > 0) {
    result.validation.warnings.push(`Missing glyphs: ${JSON.stringify(glyphCoverage.missingCharacters.join(''))}.`);
  }

  for (const scene of scenes) {
    if (scene.sceneData !== undefined) {
      result.validation.warnings.push(...collectResourceDiagnostics(scene.sceneData)
        .filter(diagnostic => diagnostic.code === 'TEXT_RASTERIZED').map(diagnostic => diagnostic.message));
    }
  }

  return result;
}

function hasVisibleText(scenes: SceneResult[]): boolean {
  const containsText = (node: NonNullable<SceneResult['sceneData']>): boolean =>
    (node.type === 'text' && (node.text ?? '').trim() !== '') || node.children.some(containsText);

  return scenes.some(scene => scene.sceneData !== undefined && containsText(scene.sceneData));
}

/**
 * Creates a browser `.fig` archive from one or more extracted scene documents.
 *
 * @param documents - Scene documents whose root names become scene names, with numbered fallbacks.
 * @param options - Layout, font, schema, and document metadata settings; glyph coverage is required by default.
 * @returns A validated archive ready to save with {@link downloadFigmaFile}.
 *
 * @example
 * ```ts
 * import { extractSceneDocumentFromHTML } from '@galacean/html2figma/browser';
 * import { createFigmaFileFromSceneDocuments, downloadFigmaFile } from '@galacean/html2figma/browser/file';
 *
 * const scene = await extractSceneDocumentFromHTML('<div style="background:red;width:100px;height:100px"></div>');
 * const result = await createFigmaFileFromSceneDocuments(scene, { documentName: 'Page' });
 * downloadFigmaFile(result.bytes, 'page.fig');
 * ```
 */
export async function createFigmaFileFromSceneDocuments(
  documents: HTMLSceneDocument | HTMLSceneDocument[],
  options: BrowserFigmaFileOptions = {},
): Promise<FigmaFileResult> {
  const list = Array.isArray(documents) ? documents : [documents];
  const scenes = list.map((document, index) => ({
    name: document.root.name || `Scene ${index + 1}`,
    sceneData: document.root,
  }));

  return createFigmaFileInBrowser(scenes, options);
}

async function fetchSchema(schemaURL: string | URL): Promise<Uint8Array> {
  const response = await fetch(schemaURL);

  if (!response.ok) {
    throw new Error(`Failed to load Figma file schema: ${response.status} ${response.statusText}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Starts a browser download of generated `.fig` bytes using a temporary object URL.
 *
 * @param bytes - Complete `.fig` archive, such as `FigmaFileResult.bytes`.
 * @param fileName - Download name. Defaults to `design.fig`; appends `.fig` when missing.
 */
export function downloadFigmaFile(bytes: Uint8Array, fileName = 'design.fig'): void {
  const data = new Uint8Array(bytes.byteLength);

  data.set(bytes);
  const blob = new Blob([data.buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName.toLowerCase().endsWith('.fig') ? fileName : `${fileName}.fig`;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
