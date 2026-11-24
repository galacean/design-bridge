import { compileSchema, decodeBinarySchema, encodeBinarySchema } from 'kiwi-schema';
import pako from 'pako';
import { decodeBase64, decodeBase64Text, encodeBase64, encodeBase64Text } from './base64-codec';

const FIG_KIWI_PRELUDE = 'fig-kiwi';
const FIG_KIWI_VERSION = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ---- Archive Parser/Writer ----

export function parseArchive(buffer: Uint8Array) {
  const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;

  const prelude = new TextDecoder().decode(buffer.subarray(0, FIG_KIWI_PRELUDE.length));

  if (prelude !== FIG_KIWI_PRELUDE) {
    throw new Error('Invalid fig-kiwi prelude: ' + prelude);
  }
  offset = FIG_KIWI_PRELUDE.length;

  const version = data.getUint32(offset, true);

  offset += 4;

  const files: Uint8Array[] = [];

  while (offset + 4 <= buffer.length) {
    const size = data.getUint32(offset, true);

    offset += 4;
    files.push(buffer.slice(offset, offset + size));
    offset += size;
  }

  return { header: { prelude, version }, files };
}

export function writeArchive(files: Uint8Array[], version = FIG_KIWI_VERSION): Uint8Array {
  const headerSize = FIG_KIWI_PRELUDE.length + 4;
  const totalSize = files.reduce((sz, f) => sz + 4 + f.byteLength, headerSize);
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  for (let i = 0; i < FIG_KIWI_PRELUDE.length; i++) {
    buffer[offset++] = FIG_KIWI_PRELUDE.charCodeAt(i);
  }

  view.setUint32(offset, version, true);
  offset += 4;

  for (const file of files) {
    view.setUint32(offset, file.byteLength, true);
    offset += 4;
    buffer.set(file, offset);
    offset += file.byteLength;
  }

  return buffer;
}

// ---- HTML clipboard format ----

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractClipboardMarkers(html: string): { figmeta: string; figma: string } | null {
  const metaMatch = html.match(/<!--\(figmeta\)([\s\S]*?)\(\/figmeta\)-->/);
  const figmaMatch = html.match(/<!--\(figma\)([\s\S]*?)\(\/figma\)-->/);

  if (metaMatch && figmaMatch) {
    return { figmeta: metaMatch[1], figma: figmaMatch[1] };
  }

  const dataMetaMatch = html.match(/data-metadata\s*=\s*"([^"]+)"/);
  const dataBufferMatch = html.match(/data-buffer\s*=\s*"([^"]+)"/);

  if (dataMetaMatch && dataBufferMatch) {
    const decodedMetaAttr = decodeHtmlEntities(dataMetaMatch[1]);
    const decodedBufferAttr = decodeHtmlEntities(dataBufferMatch[1]);
    const derivedMeta = decodedMetaAttr.match(/<!--\(figmeta\)([\s\S]*?)\(\/figmeta\)-->/);
    const derivedFigma = decodedBufferAttr.match(/<!--\(figma\)([\s\S]*?)\(\/figma\)-->/);

    if (derivedMeta && derivedFigma) {
      return { figmeta: derivedMeta[1], figma: derivedFigma[1] };
    }
  }

  return null;
}

export function parseClipboardHTML(html: string): { meta: Record<string, unknown>; figma: Uint8Array } {
  const direct = extractClipboardMarkers(html);
  const normalized = direct ? html : decodeHtmlEntities(html);
  const markers = direct || extractClipboardMarkers(normalized);

  if (!markers) {
    throw new Error('Invalid Figma clipboard HTML');
  }

  const parsedMeta: unknown = JSON.parse(decodeBase64Text(markers.figmeta));

  if (!isRecord(parsedMeta)) {
    throw new Error('Invalid Figma figmeta payload.');
  }

  const meta = parsedMeta;
  const figma = decodeBase64(markers.figma);

  return { meta, figma };
}

export function composeClipboardHTML(meta: Record<string, unknown>, figmaBuffer: Uint8Array): string {
  const metaB64 = encodeBase64Text(JSON.stringify(meta));
  const figB64 = encodeBase64(figmaBuffer);

  return (
    '<meta charset="utf-8" /><span\n  data-metadata="<!--(figmeta)' +
    metaB64 +
    '(/figmeta)-->"\n></span\n><span\n  data-buffer="<!--(figma)' +
    figB64 +
    '(/figma)-->"\n></span\n><span style="white-space: pre-wrap"></span>'
  );
}

export function decodeCompressedSchema(bytes: Uint8Array): ReturnType<typeof decodeBinarySchema> {
  return decodeBinarySchema(pako.inflateRaw(bytes));
}

export { compileSchema, decodeBinarySchema, encodeBinarySchema, pako };
