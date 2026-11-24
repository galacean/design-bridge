import JSZip from 'jszip';
import { decompress } from '@bokuweb/zstd-wasm';
import { compileSchema, decodeBinarySchema } from 'kiwi-schema';
import pako from 'pako';
import { isRecord } from './html-fixture';

/** Independently inspect the public file output after its public validator has run. */
export async function decodeFigmaFileNodes(bytes: Uint8Array): Promise<Array<Record<string, unknown>>> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('canvas.fig');

  if (entry === null) {
    throw new Error('Missing canvas.fig.');
  }
  const canvas = await entry.async('uint8array');
  const view = new DataView(canvas.buffer, canvas.byteOffset, canvas.byteLength);
  const chunks: Uint8Array[] = [];
  let offset = 12;

  if (new TextDecoder().decode(canvas.subarray(0, 8)) !== 'fig-kiwi') {
    throw new Error('Unexpected FIG archive signature.');
  }
  while (offset + 4 <= canvas.length) {
    const length = view.getUint32(offset, true);

    offset += 4;
    if (offset + length > canvas.length) {
      throw new Error('Truncated FIG archive chunk.');
    }
    chunks.push(canvas.subarray(offset, offset + length));
    offset += length;
  }
  if (chunks.length !== 2 || offset !== canvas.length) {
    throw new Error('Unexpected FIG archive chunks.');
  }
  const compiled = compileSchema(decodeBinarySchema(pako.inflateRaw(chunks[0]))) as {
    decodeMessage(input: Uint8Array): unknown;
  };
  // createFigmaFile() has already initialized Zstandard while validating this file.
  const message: unknown = compiled.decodeMessage(decompress(chunks[1]));

  if (!isRecord(message) || !Array.isArray(message.nodeChanges) || !message.nodeChanges.every(isRecord)) {
    throw new Error('Invalid decoded FIG node changes.');
  }

  return message.nodeChanges;
}
