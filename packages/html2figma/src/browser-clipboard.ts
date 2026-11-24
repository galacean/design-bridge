import { createFigmaClipboardWithSchema } from './core/figma-clipboard';
import type { FigmaClipboardResult } from './core/figma-clipboard';
import { decodeCompressedSchema } from './core/kiwi-archive';
import { createBrowserTextConversionRuntime } from './core/text-conversion-runtime-browser';
import type { BrowserTextConversionOptions } from './core/text-conversion-runtime-browser';
import type { HTMLSceneDocument } from './model/html-scene-document';
import type { SceneResult } from './types';

/** Font sources and optional Kiwi schema overrides for browser clipboard conversion. */
export interface BrowserFigmaClipboardOptions extends BrowserTextConversionOptions {
  /** Compressed schema bytes. Takes precedence over `schemaURL` and avoids fetching a schema. */
  compressedSchema?: Uint8Array;
  /** Schema URL; defaults to bundled clipboard or file schema according to the exporter. */
  schemaURL?: string | URL;
}

const DEFAULT_SCHEMA_URL = new URL('../data/figma-schema.bin', import.meta.url);

/**
 * Encodes named scenes into Figma clipboard data in the browser.
 *
 * @param scenes - Named scene roots; failed or absent scenes are skipped.
 * @param options - Font preparation and schema loading settings.
 * @returns Clipboard HTML, archive bytes, image entries, and blob statistics. Does not write to the clipboard.
 */
export async function createFigmaClipboardInBrowser(
  scenes: SceneResult[],
  options: BrowserFigmaClipboardOptions = {},
): Promise<FigmaClipboardResult> {
  const compressedSchema = options.compressedSchema ?? (await fetchSchema(options.schemaURL ?? DEFAULT_SCHEMA_URL));
  const { runtime } = await createBrowserTextConversionRuntime(scenes, options);

  return createFigmaClipboardWithSchema(scenes, decodeCompressedSchema(compressedSchema), { textRuntime: runtime });
}

/**
 * Creates browser clipboard data from one or more extracted scene documents.
 *
 * @param documents - Scene documents whose root names become scene names, with numbered fallbacks.
 * @param options - Font preparation and schema loading settings.
 * @returns Clipboard data suitable for passing to {@link writeFigmaClipboardHTML} via its `html` property.
 */
export async function createFigmaClipboardFromSceneDocuments(
  documents: HTMLSceneDocument | HTMLSceneDocument[],
  options: BrowserFigmaClipboardOptions = {},
): Promise<FigmaClipboardResult> {
  const list = Array.isArray(documents) ? documents : [documents];
  const scenes = list.map((document, index) => ({
    name: document.root.name || `Scene ${index + 1}`,
    sceneData: document.root,
  }));

  return createFigmaClipboardInBrowser(scenes, options);
}

/**
 * Writes generated Figma HTML to the system clipboard as `text/html`.
 *
 * @remarks
 * Call from a user gesture. Uses the Clipboard API when available, otherwise a DOM copy event.
 * Browser permissions and secure-context requirements apply to the Clipboard API.
 *
 * @param html - HTML returned by a Figma clipboard generator.
 * @throws If the browser rejects clipboard access or the copy command.
 */
export async function writeFigmaClipboardHTML(html: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write !== undefined) {
    const item = new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) });

    await navigator.clipboard.write([item]);

    return;
  }

  writeClipboardWithCopyEvent(html);
}

async function fetchSchema(schemaURL: string | URL): Promise<Uint8Array> {
  const response = await fetch(schemaURL);

  if (!response.ok) {
    throw new Error(`Failed to load Figma schema: ${response.status} ${response.statusText}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function writeClipboardWithCopyEvent(html: string): void {
  const handler = (event: ClipboardEvent) => {
    event.preventDefault();
    event.clipboardData?.setData('text/html', html);
    event.clipboardData?.setData('text/plain', '');
  };
  const selectionTarget = document.createElement('span');

  document.addEventListener('copy', handler, { once: true });
  selectionTarget.textContent = '\u200b';
  selectionTarget.style.position = 'fixed';
  selectionTarget.style.left = '-100000px';
  document.body.append(selectionTarget);

  try {
    const range = document.createRange();
    const selection = window.getSelection();

    range.selectNodeContents(selectionTarget);
    selection?.removeAllRanges();
    selection?.addRange(range);

    if (!document.execCommand('copy')) {
      throw new Error('Browser rejected the Figma clipboard copy command.');
    }

    selection?.removeAllRanges();
  } finally {
    document.removeEventListener('copy', handler);
    selectionTarget.remove();
  }
}
