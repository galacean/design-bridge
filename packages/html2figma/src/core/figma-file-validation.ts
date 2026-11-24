import JSZip from 'jszip';
import { decompress } from '@bokuweb/zstd-wasm';
import { compileSchema, decodeCompressedSchema, parseArchive, pako } from './kiwi-archive';
import { ensureZstdInitialized } from './zstd-runtime';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZSTD_SIGNATURE = [0x28, 0xb5, 0x2f, 0xfd];

/** Structural validation results for a `.fig` ZIP archive; does not measure visual fidelity. */
export interface FigmaFileValidationReport {
  /** Whether structural checks completed without errors. Warnings do not invalidate the archive. */
  valid: boolean;
  /** Structural errors, including archive decoding failures. */
  errors: string[];
  /** Non-fatal observations; exporters may also append font and rasterization warnings. */
  warnings: string[];
  /** Decoded `canvas.fig` protocol version, or null when unavailable. */
  version: number | null;
  /** Number of decoded content nodes, excluding document and canvas nodes. */
  nodeCount: number;
  /** Number of decoded canvas nodes that are not marked internal-only. */
  pageCount: number;
  /** Number of decoded text nodes. */
  textCount: number;
  /** Number of embedded binary blobs. */
  blobCount: number;
  /** Number of external image entries. */
  imageCount: number;
}

/**
 * Checks a `.fig` ZIP archive without rendering it or opening Figma.
 *
 * @param input - Complete `.fig` archive bytes.
 * @returns Structural checks of ZIP entries, metadata, Kiwi messages, node references, blobs, images, and glyphs.
 * Invalid input and decoding errors are recorded in the report rather than thrown.
 */
export async function validateFigmaFile(
  input: Uint8Array | ArrayBuffer,
): Promise<FigmaFileValidationReport> {
  const report: FigmaFileValidationReport = {
    valid: false,
    errors: [],
    warnings: [],
    version: null,
    nodeCount: 0,
    pageCount: 0,
    textCount: 0,
    blobCount: 0,
    imageCount: 0,
  };

  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const zip = await JSZip.loadAsync(bytes);
    const canvasEntry = zip.file('canvas.fig');
    const thumbnailEntry = zip.file('thumbnail.png');
    const metadataEntry = zip.file('meta.json');

    if (canvasEntry === null) {
      report.errors.push('Missing canvas.fig.');
    }
    if (thumbnailEntry === null) {
      report.errors.push('Missing thumbnail.png.');
    }
    if (metadataEntry === null) {
      report.errors.push('Missing meta.json.');
    }
    if (canvasEntry === null || thumbnailEntry === null || metadataEntry === null) {
      return finalizeReport(report);
    }

    const imageNames = Object.keys(zip.files).filter(name => /^images\/[0-9a-f]{40}$/.test(name));

    report.imageCount = imageNames.length;
    validateMetadata(JSON.parse(await metadataEntry.async('text')) as unknown, report);
    validateThumbnail(await thumbnailEntry.async('uint8array'), report);

    const canvas = await canvasEntry.async('uint8array');
    const { header, files } = parseArchive(canvas);

    report.version = header.version;
    if (!Number.isInteger(header.version) || header.version <= 0) {
      report.errors.push(`Invalid fig-kiwi version ${String(header.version)}.`);
    }
    if (files.length !== 2) {
      report.errors.push(`Expected 2 fig-kiwi chunks, received ${files.length}.`);

      return finalizeReport(report);
    }
    if (!hasSignature(files[1], ZSTD_SIGNATURE)) {
      report.warnings.push('canvas.fig message is not Zstandard-compressed.');
    }

    const schema = decodeCompressedSchema(files[0]);
    const compiled = compileSchema(schema) as { decodeMessage(bytes: Uint8Array): unknown };

    await ensureZstdInitialized();
    const messageBytes = hasSignature(files[1], ZSTD_SIGNATURE) ? decompress(files[1]) : pako.inflateRaw(files[1]);
    const message = compiled.decodeMessage(messageBytes);

    validateMessage(message, new Set(imageNames), report);
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }

  return finalizeReport(report);
}

function validateMetadata(value: unknown, report: FigmaFileValidationReport): void {
  if (!isRecord(value)) {
    report.errors.push('meta.json must contain an object.');

    return;
  }
  if (typeof value.file_name !== 'string' || value.file_name.length === 0) {
    report.errors.push('meta.json file_name must be a non-empty string.');
  }
  if (typeof value.exported_at !== 'string' || !Number.isFinite(Date.parse(value.exported_at))) {
    report.errors.push('meta.json exported_at must be an ISO date string.');
  }
  if (!isRecord(value.client_meta)) {
    report.errors.push('meta.json client_meta must contain an object.');

    return;
  }
  const renderCoordinates = value.client_meta.render_coordinates;

  if (!isRecord(renderCoordinates) || !isPositiveNumber(renderCoordinates.width) ||
      !isPositiveNumber(renderCoordinates.height)) {
    report.errors.push('meta.json render_coordinates must have positive width and height.');
  }
}

function validateThumbnail(bytes: Uint8Array, report: FigmaFileValidationReport): void {
  if (!hasSignature(bytes, PNG_SIGNATURE)) {
    report.errors.push('thumbnail.png does not have a valid PNG signature.');
  }
}

function validateMessage(
  value: unknown,
  imageNames: Set<string>,
  report: FigmaFileValidationReport,
): void {
  if (!isRecord(value)) {
    report.errors.push('Decoded canvas message must be an object.');

    return;
  }
  if (value.type !== 'NODE_CHANGES') {
    report.errors.push(`Expected NODE_CHANGES message, received ${String(value.type)}.`);
  }
  if (!Array.isArray(value.nodeChanges)) {
    report.errors.push('NODE_CHANGES message must contain nodeChanges.');

    return;
  }
  if (!Array.isArray(value.blobs)) {
    report.errors.push('NODE_CHANGES message must contain blobs.');

    return;
  }

  const nodes: unknown[] = value.nodeChanges;
  const blobs: unknown[] = value.blobs;
  const guids = new Set<string>();
  const parentReferences: Array<{ node: string; parent: string }> = [];
  const referencedImages = new Set<string>();
  let documentCount = 0;
  let internalCanvasCount = 0;

  report.blobCount = blobs.length;
  for (let index = 0; index < blobs.length; index++) {
    const blob = blobs[index];

    if (!isRecord(blob) || !isByteArray(blob.bytes)) {
      report.errors.push(`Blob ${index} must contain byte values.`);
    }
  }

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];

    if (!isRecord(node)) {
      report.errors.push(`Node change ${index} must be an object.`);
      continue;
    }
    const guid = guidKey(node.guid);

    if (guid === null) {
      report.errors.push(`Node change ${index} has an invalid guid.`);
      continue;
    }
    if (guids.has(guid)) {
      report.errors.push(`Duplicate node guid ${guid}.`);
    }
    guids.add(guid);
    if (node.type === 'DOCUMENT') {
      documentCount += 1;
    } else if (node.type === 'CANVAS') {
      if (node.internalOnly === true) {
        internalCanvasCount += 1;
      } else {
        report.pageCount += 1;
      }
    } else {
      report.nodeCount += 1;
    }
    if (node.type === 'TEXT') {
      report.textCount += 1;
      validateTextNode(node, guid, blobs.length, report);
    }

    if (isRecord(node.parentIndex)) {
      const parent = guidKey(node.parentIndex.guid);

      if (parent === null) {
        report.errors.push(`Node ${guid} has an invalid parent guid.`);
      } else {
        parentReferences.push({ node: guid, parent });
      }
    } else if (node.type !== 'DOCUMENT') {
      report.errors.push(`Node ${guid} is missing parentIndex.`);
    }

    if (isRecord(node.vectorData)) {
      validateBlobReference(node.vectorData.vectorNetworkBlob, blobs.length, `Node ${guid} vector`, report);
    }
    for (const paintList of [node.fillPaints, node.strokePaints]) {
      validatePaints(paintList, guid, imageNames, referencedImages, report);
    }
  }

  for (const reference of parentReferences) {
    if (reference.node === reference.parent) {
      report.errors.push(`Node ${reference.node} cannot parent itself.`);
    } else if (!guids.has(reference.parent)) {
      report.errors.push(`Node ${reference.node} references missing parent ${reference.parent}.`);
    }
  }
  if (documentCount !== 1) {
    report.errors.push(`Expected exactly 1 DOCUMENT node, received ${documentCount}.`);
  }
  if (report.pageCount === 0) {
    report.errors.push('Expected at least 1 public CANVAS node.');
  }
  if (internalCanvasCount === 0) {
    report.warnings.push('No internal-only CANVAS node was found.');
  }
  for (const name of imageNames) {
    if (!referencedImages.has(name)) {
      report.warnings.push(`Unreferenced image entry ${name}.`);
    }
  }
}

function validateTextNode(
  node: Record<string, unknown>,
  guid: string,
  blobCount: number,
  report: FigmaFileValidationReport,
): void {
  const textData = isRecord(node.textData) ? node.textData : null;
  const derivedTextData = isRecord(node.derivedTextData) ? node.derivedTextData : null;
  const characters = textData?.characters;

  if (typeof characters !== 'string') {
    report.errors.push(`Text node ${guid} is missing textData.characters.`);
  }
  if (derivedTextData === null) {
    report.warnings.push(`Text node ${guid} is missing derivedTextData.`);

    return;
  }
  const glyphValue = derivedTextData.glyphs;

  if (!Array.isArray(glyphValue)) {
    return;
  }
  const glyphs: unknown[] = glyphValue;

  for (let index = 0; index < glyphs.length; index++) {
    const glyph = glyphs[index];

    if (!isRecord(glyph)) {
      report.errors.push(`Text node ${guid} glyph ${index} must be an object.`);
      continue;
    }
    if (glyph.commandsBlob !== undefined) {
      validateBlobReference(glyph.commandsBlob, blobCount, `Text node ${guid} glyph ${index}`, report);
    }
    if (glyph.firstCharacter !== undefined &&
        (!Number.isInteger(glyph.firstCharacter) || Number(glyph.firstCharacter) < 0 ||
         (typeof characters === 'string' && Number(glyph.firstCharacter) >= characters.length))) {
      report.errors.push(`Text node ${guid} glyph ${index} has an invalid firstCharacter.`);
    }
  }
}

function validatePaints(
  value: unknown,
  guid: string,
  imageNames: Set<string>,
  referencedImages: Set<string>,
  report: FigmaFileValidationReport,
): void {
  if (!Array.isArray(value)) {
    return;
  }
  const paints: unknown[] = value;

  for (let index = 0; index < paints.length; index++) {
    const paint = paints[index];

    if (!isRecord(paint) || !isRecord(paint.image)) {
      continue;
    }
    if (paint.image.dataBlob !== undefined) {
      report.errors.push(`Node ${guid} image paint ${index} still contains dataBlob.`);
    }
    const hash = byteArray(paint.image.hash);

    if (hash === null || hash.length !== 20) {
      report.errors.push(`Node ${guid} image paint ${index} must contain a 20-byte hash.`);
      continue;
    }
    const name = `images/${Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')}`;

    referencedImages.add(name);
    if (!imageNames.has(name)) {
      report.errors.push(`Node ${guid} references missing image entry ${name}.`);
    }
  }
}

function validateBlobReference(
  value: unknown,
  blobCount: number,
  label: string,
  report: FigmaFileValidationReport,
): void {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) >= blobCount) {
    report.errors.push(`${label} references invalid blob index ${String(value)}.`);
  }
}

function guidKey(value: unknown): string | null {
  if (!isRecord(value) || !Number.isInteger(value.sessionID) || !Number.isInteger(value.localID)) {
    return null;
  }

  return `${String(value.sessionID)}:${String(value.localID)}`;
}

function byteArray(value: unknown): Uint8Array | number[] | null {
  if (value instanceof Uint8Array && value.every(isByte)) {
    return value;
  }
  if (Array.isArray(value) && value.every(isByte)) {
    return value;
  }

  return null;
}

function isByteArray(value: unknown): boolean {
  return byteArray(value) !== null;
}

function isByte(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}

function hasSignature(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finalizeReport(report: FigmaFileValidationReport): FigmaFileValidationReport {
  report.valid = report.errors.length === 0;

  return report;
}
