import { decodeBinarySchema, compileSchema } from 'kiwi-schema';
import pako from 'pako';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArchive, parseClipboardHTML } from './kiwi-archive';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

function resolvePackageDataPath(fileName: string): string {
  const candidates = [
    path.resolve(CURRENT_DIR, '..', 'data', fileName),
    path.resolve(CURRENT_DIR, '..', '..', 'data', fileName),
  ];

  return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0];
}

export const SCHEMA_PATH = resolvePackageDataPath('figma-schema.bin');
export const FILE_SCHEMA_PATH = resolvePackageDataPath('figma-file-schema.bin');

export function extractAndSaveSchema(clipboardHTML: string): {
  schema: ReturnType<typeof decodeBinarySchema>;
  message: unknown;
  meta: Record<string, unknown>;
} {
  const { meta, figma } = parseClipboardHTML(clipboardHTML);
  const { files } = parseArchive(figma);

  if (files.length < 2) {
    throw new Error('Invalid fig-kiwi archive: missing schema/data files.');
  }

  const schemaCompressed = files[0];
  const schema = decodeBinarySchema(pako.inflateRaw(schemaCompressed));

  fs.writeFileSync(SCHEMA_PATH, schemaCompressed);
  console.info('Figma schema saved to', SCHEMA_PATH);

  const compiled = compileSchema(schema) as {
    decodeMessage: (input: Uint8Array) => unknown;
  };
  const message = compiled.decodeMessage(pako.inflateRaw(files[1]));

  return { schema, message, meta };
}

export function loadSchema(): ReturnType<typeof decodeBinarySchema> {
  if (fs.existsSync(SCHEMA_PATH)) {
    return decodeBinarySchema(pako.inflateRaw(fs.readFileSync(SCHEMA_PATH)));
  }

  throw new Error('figma-schema.bin not found. Please extract a schema from a real Figma clipboard first.');
}

export function loadFileSchema(): ReturnType<typeof decodeBinarySchema> {
  if (fs.existsSync(FILE_SCHEMA_PATH)) {
    return decodeBinarySchema(pako.inflateRaw(fs.readFileSync(FILE_SCHEMA_PATH)));
  }

  throw new Error('figma-file-schema.bin not found. Extract a schema from a current Figma .fig file first.');
}
