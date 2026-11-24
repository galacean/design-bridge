import { IRAssetSourceKind } from '../schema/asset.js';
import type { IRResourceSource } from '../schema/asset.js';

const STANDARD_BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const STANDARD_BASE64_BODY_PATTERN = /^[A-Za-z0-9+/]+$/;
const HEX_BYTE_PATTERN = /^[0-9A-Fa-f]{2}$/;

function isDataUrl(value: string): boolean {
  return value.slice(0, 5).toLowerCase() === 'data:';
}

function decodePercentEncodedBytes(value: string): Uint8Array {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  let index = 0;

  while (index < value.length) {
    if (value[index] === '%') {
      const hexadecimal = value.slice(index + 1, index + 3);

      if (!HEX_BYTE_PATTERN.test(hexadecimal)) {
        throw new TypeError('[animation-ir] Data URL contains invalid percent encoding.');
      }
      bytes.push(Number.parseInt(hexadecimal, 16));
      index += 3;
      continue;
    }

    const nextPercentIndex = value.indexOf('%', index);
    const endIndex = nextPercentIndex < 0 ? value.length : nextPercentIndex;

    for (const byte of encoder.encode(value.slice(index, endIndex))) {
      bytes.push(byte);
    }
    index = endIndex;
  }

  return Uint8Array.from(bytes);
}

function decodePercentEncodedBase64Text(value: string): string {
  let decoded = '';

  for (const byte of decodePercentEncodedBytes(value)) {
    decoded += String.fromCharCode(byte);
  }

  return decoded;
}

function encodeBytesAsBase64(bytes: Uint8Array): string {
  let result = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;

    result += STANDARD_BASE64_ALPHABET[(combined >> 18) & 63];
    result += STANDARD_BASE64_ALPHABET[(combined >> 12) & 63];
    result += index + 1 < bytes.length ? STANDARD_BASE64_ALPHABET[(combined >> 6) & 63] : '=';
    result += index + 2 < bytes.length ? STANDARD_BASE64_ALPHABET[combined & 63] : '=';
  }

  return result;
}

function normalizeBase64Data(value: string): string {
  const decoded = decodePercentEncodedBase64Text(value).replace(/\s/g, '');
  const body = decoded.replace(/=+$/, '');

  if (body === '' || !STANDARD_BASE64_BODY_PATTERN.test(body) || body.length % 4 === 1) {
    throw new TypeError('[animation-ir] Data URL contains invalid Base64 data.');
  }
  const padded = body.padEnd(Math.ceil(body.length / 4) * 4, '=');
  const paddingStart = padded.indexOf('=');

  if (paddingStart < 0) {
    return padded;
  }
  // RFC 4648 requires unused bits before padding to be zero.
  const unusedBitCount = padded.endsWith('==') ? 4 : 2;
  const lastDataIndex = paddingStart - 1;
  const alphabetIndex = STANDARD_BASE64_ALPHABET.indexOf(padded[lastDataIndex]);
  const canonicalCharacter = STANDARD_BASE64_ALPHABET[(alphabetIndex >> unusedBitCount) << unusedBitCount];

  return `${padded.slice(0, lastDataIndex)}${canonicalCharacter}${padded.slice(paddingStart)}`;
}

/** Convert a URL or Data URL to a normalized IR resource source. */
export function createIRResourceSource(url: string): IRResourceSource {
  if (!isDataUrl(url)) {
    return { kind: IRAssetSourceKind.Url, url: resolveIRResourceUrl(url) };
  }

  const commaIndex = url.indexOf(',');

  if (commaIndex < 0) {
    throw new TypeError('[animation-ir] Data URL must contain a comma-separated payload.');
  }

  const metadata = url.slice(5, commaIndex);
  const parts = metadata.split(';');
  const dataMimeType = parts[0] === '' ? 'text/plain' : parts[0];
  const isBase64 = parts.some(part => part.toLowerCase() === 'base64');
  const payload = url.slice(commaIndex + 1);
  const data = isBase64
    ? normalizeBase64Data(payload)
    : encodeBytesAsBase64(decodePercentEncodedBytes(payload));

  if (data === '') {
    throw new TypeError('[animation-ir] Data URL payload must not be empty.');
  }

  return { kind: IRAssetSourceKind.Embedded, mimeType: dataMimeType, data };
}

/** Preserve Data URLs and resolve other URLs against an optional absolute base URL. */
export function resolveIRResourceUrl(url: string, baseUrl?: string): string {
  if (isDataUrl(url)) {
    return url;
  }
  let resolved: URL;

  try {
    resolved = baseUrl == null ? new URL(url) : new URL(url, new URL(baseUrl));
  } catch {
    throw new TypeError('[animation-ir] Resource URL must be absolute or resolved against an absolute base URL.');
  }

  return resolved.href;
}

/** Serialize a resource source as a URL or Data URL. */
export function getIRResourceSourceUrl(source: IRResourceSource): string {
  if (source.kind === IRAssetSourceKind.Url) {
    return source.url;
  }

  return `data:${source.mimeType};base64,${source.data}`;
}
