import { Buffer } from 'node:buffer';
import { dataUrlToUint8Array } from './paint-helpers';

export function dataUrlToBytes(dataUrl: string | null | undefined): Buffer | null {
  const bytes = dataUrlToUint8Array(dataUrl);

  return bytes === null ? null : Buffer.from(bytes);
}
