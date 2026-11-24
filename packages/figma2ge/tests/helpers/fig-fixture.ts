import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeFigFile } from '@galacean/figma2ge';

const figRaw = readFileSync(resolve(__dirname, '../fixtures/baseline-enjoy.fig'));

export const figBytes = new Uint8Array(figRaw.buffer, figRaw.byteOffset, figRaw.byteLength);

// Simulate the "upload decoded JSON" path by forcing a JSON round-trip.
export const decodedMessage = JSON.parse(JSON.stringify(decodeFigFile(figBytes).message));
