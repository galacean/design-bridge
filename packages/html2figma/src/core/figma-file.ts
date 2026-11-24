import JSZip from 'jszip';
import { compress } from '@bokuweb/zstd-wasm';
import { decodeBase64 } from './base64-codec';
import type { ClipboardBlobStats } from './clipboard-blob-store';
import type { FigmaClipboardResult } from './figma-clipboard';
import { validateFigmaFile } from './figma-file-validation';
import type { FigmaFileValidationReport } from './figma-file-validation';
import { parseArchive, pako, writeArchive } from './kiwi-archive';
import { ensureZstdInitialized } from './zstd-runtime';
import type { SceneResult } from '../types';

const DEFAULT_THUMBNAIL_PNG = decodeBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
);
const FIG_KIWI_FILE_VERSION = 106;

/** Layout, glyph validation, and metadata options for `.fig` file generation. */
export interface FigmaFileOptions {
  /** Reject missing visible glyphs. Node defaults to false; Browser defaults to true. */
  requireTextGlyphs?: boolean;
  /** Preserve measured positions by default; auto-layout reconstructs editable flow. */
  layoutMode?: 'snapshot' | 'auto-layout';
  /** Export timestamp written to metadata as an ISO date string. Defaults to the current time. */
  createdAt?: string;
  /** Document name in archive metadata. Defaults to `Untitled`. */
  documentName?: string;
  /** Render bounds in scene pixels. High-level exporters infer these from the scenes when omitted. */
  renderBounds?: { x: number; y: number; width: number; height: number };
  /** Thumbnail dimensions recorded in metadata. Defaults to 1 by 1; does not resize the supplied PNG. */
  thumbnailSize?: { width: number; height: number };
  /** RGBA background color in metadata, with components from 0 to 1. Defaults to transparent black. */
  backgroundColor?: { r: number; g: number; b: number; a: number };
  /** PNG thumbnail bytes. Defaults to a bundled 1 by 1 placeholder; no scene preview is rendered. */
  thumbnailPNG?: Uint8Array;
}

/** Generated `.fig` archive and its structural validation results. */
export interface FigmaFileResult {
  /** Complete ZIP archive bytes, ready to save or download as a `.fig` file. */
  bytes: Uint8Array;
  /** Glyph, image, and vector blob deduplication statistics. */
  blobStats: ClipboardBlobStats;
  /** Number of external image entries stored in the archive. */
  imageCount: number;
  /** Structural checks and export-time warnings, including font observations. */
  validation: FigmaFileValidationReport;
}

export async function createFigmaFileFromClipboardResult(
  clipboard: FigmaClipboardResult,
  options: FigmaFileOptions = {},
  shouldValidate = true,
): Promise<FigmaFileResult> {
  const zip = new JSZip();
  const canvasData = await upgradeFigmaArchiveProtocol(clipboard.archiveData);
  const metadata = {
    client_meta: {
      background_color: options.backgroundColor ?? { r: 0, g: 0, b: 0, a: 0 },
      thumbnail_size: options.thumbnailSize ?? { width: 1, height: 1 },
      render_coordinates: options.renderBounds ?? { x: 0, y: 0, width: 1, height: 1 },
    },
    file_name: options.documentName ?? 'Untitled',
    developer_related_links: [],
    exported_at: options.createdAt ?? new Date().toISOString(),
  };

  zip.file('canvas.fig', canvasData, { compression: 'STORE' });
  zip.file('thumbnail.png', options.thumbnailPNG ?? DEFAULT_THUMBNAIL_PNG, { compression: 'STORE' });
  zip.file('meta.json', JSON.stringify(metadata));

  for (const image of clipboard.imageEntries) {
    zip.file(image.name, image.data, { compression: 'STORE' });
  }

  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  const validation = shouldValidate ? await validateFigmaFile(bytes) : emptyValidationReport();

  if (!validation.valid && shouldValidate) {
    throw new Error(`Generated Figma file failed validation: ${validation.errors.join(' ')}`);
  }

  return {
    bytes,
    blobStats: clipboard.blobStats,
    imageCount: clipboard.imageEntries.length,
    validation,
  };
}

export async function upgradeFigmaArchiveProtocol(archiveData: Uint8Array): Promise<Uint8Array> {
  const { files } = parseArchive(archiveData);

  if (files.length < 2) {
    throw new Error('Figma file canvas requires schema and message chunks.');
  }

  await ensureZstdInitialized();

  const message = pako.inflateRaw(files[1]);

  return writeArchive([files[0], compress(message)], FIG_KIWI_FILE_VERSION);
}

function emptyValidationReport(): FigmaFileValidationReport {
  return {
    valid: true,
    errors: [],
    warnings: ['Validation skipped by the low-level caller.'],
    version: null,
    nodeCount: 0,
    pageCount: 0,
    textCount: 0,
    blobCount: 0,
    imageCount: 0,
  };
}

export function inferFigmaFileRenderBounds(
  scenes: SceneResult[],
): { x: number; y: number; width: number; height: number } {
  let width = 0;
  let height = 0;
  let validIndex = 0;

  for (const scene of scenes) {
    if (scene.error !== undefined || scene.sceneData === undefined) {
      continue;
    }

    const sceneWidth = positiveFiniteOr(scene.sceneData.width, 375);
    const sceneHeight = positiveFiniteOr(scene.sceneData.height, 812);
    const x = validIndex * (sceneWidth + 100);

    width = Math.max(width, x + sceneWidth);
    height = Math.max(height, sceneHeight);
    validIndex += 1;
  }

  return { x: 0, y: 0, width: width || 1, height: height || 1 };
}

function positiveFiniteOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
