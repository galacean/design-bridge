import * as fontkit from 'fontkit';
import decompress from 'woff2-encoder/decompress';

const normalizedFonts = new WeakMap<ArrayBuffer | Uint8Array, Promise<Uint8Array>>();

/** Fontkit 2.0.4 cannot instantiate variable WOFF2 faces; retain SFNT variation tables instead. */
export function normalizeFontBytes(bytes: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  let result = normalizedFonts.get(bytes);

  if (result === undefined) {
    result = normalizeVariableFontBytes(bytes);
    normalizedFonts.set(bytes, result);
  }

  return result;
}

async function normalizeVariableFontBytes(bytes: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  if (data.length < 48 || new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0) !== 0x774f4632) {
    return data;
  }
  const declaredSize = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(16);

  if (declaredSize > 30 * 1024 * 1024) {
    throw new Error('Variable WOFF2 exceeds the 30 MB decompressed font limit.');
  }
  const face = fontkit.create(data as unknown as Parameters<typeof fontkit.create>[0]);

  if ('fonts' in face || Object.keys(face.variationAxes).length === 0) {
    return data;
  }

  return decompress(data);
}
