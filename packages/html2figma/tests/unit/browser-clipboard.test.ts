import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decompress } from '@bokuweb/zstd-wasm';
import { describe, expect, it } from 'vitest';
import { createFigmaClipboardFromSceneDocuments } from '../../src/browser-clipboard';
import { createFigmaFileFromSceneDocuments } from '../../src/browser-figma-file';
import { compileSchema, decodeCompressedSchema, parseArchive } from '../../src/core/kiwi-archive';
import { createHTMLSceneDocument } from '../../src/model/html-scene-document';
import { makeSceneNode } from '../helpers/scene-factories';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(TEST_DIR, '../../data/figma-schema.bin');
const FILE_SCHEMA_PATH = path.resolve(TEST_DIR, '../../data/figma-file-schema.bin');

describe('browser Figma clipboard generation', () => {
  it('encodes a versioned scene document with supplied schema bytes', async () => {
    const document = createHTMLSceneDocument(makeSceneNode({ name: 'Browser Scene' }), {
      viewport: { width: 390, height: 844 },
      runtime: { kind: 'browser', engine: 'chromium' },
    });

    const result = await createFigmaClipboardFromSceneDocuments(document, {
      compressedSchema: fs.readFileSync(SCHEMA_PATH),
    });

    expect(result.html).toContain('<!--(figmeta)');
    expect(result.html).toContain('<!--(figma)');
    expect(result.blobStats).toMatchObject({ references: 0, unique: 0 });
  });

  it('creates a .fig ZIP from a versioned scene document', async () => {
    const document = createHTMLSceneDocument(makeSceneNode({ name: 'Browser Scene' }), {
      viewport: { width: 390, height: 844 },
      runtime: { kind: 'browser', engine: 'chromium' },
    });
    const result = await createFigmaFileFromSceneDocuments(document, {
      compressedSchema: fs.readFileSync(FILE_SCHEMA_PATH),
      createdAt: '2026-09-28T00:00:00.000Z',
    });
    const zip = await import('jszip').then(({ default: JSZip }) => JSZip.loadAsync(result.bytes));
    const canvas = await zip.file('canvas.fig')!.async('uint8array');

    expect(parseArchive(canvas).files).toHaveLength(2);
    expect(JSON.parse(await zip.file('meta.json')!.async('text'))).toMatchObject({
      file_name: 'Untitled',
      client_meta: { render_coordinates: { width: 100, height: 50 } },
    });
    expect(result.bytes.slice(0, 2)).toEqual(Uint8Array.from([0x50, 0x4b]));
    expect(result.validation).toMatchObject({ valid: true, errors: [], version: 106, pageCount: 1 });
  });

  it('stores image bytes only in images/ for .fig output', async () => {
    const document = createHTMLSceneDocument(makeSceneNode({
      children: [makeSceneNode({ type: 'image', image: 'data:image/png;base64,AQIDBA==' })],
    }), {
      viewport: { width: 390, height: 844 },
      runtime: { kind: 'browser', engine: 'chromium' },
    });
    const result = await createFigmaFileFromSceneDocuments(document, {
      compressedSchema: fs.readFileSync(FILE_SCHEMA_PATH),
    });
    const zip = await import('jszip').then(({ default: JSZip }) => JSZip.loadAsync(result.bytes));
    const canvas = await zip.file('canvas.fig')!.async('uint8array');
    const { files } = parseArchive(canvas);
    const compiled = compileSchema(decodeCompressedSchema(files[0]));
    const message = compiled.decodeMessage(decompress(files[1])) as { blobs?: unknown[] };
    const imageNames = Object.keys(zip.files).filter(name => /^images\/[0-9a-f]{40}$/.test(name));

    expect(message.blobs ?? []).toHaveLength(0);
    expect(imageNames).toHaveLength(1);
    expect(await zip.file(imageNames[0])!.async('uint8array')).toEqual(Uint8Array.from([1, 2, 3, 4]));
  });

  it('defaults .fig output to fixed layout and allows explicit auto-layout output', async () => {
    const document = createHTMLSceneDocument(makeSceneNode({
      name: 'Measured frame',
      children: [makeSceneNode({ x: 17, y: 23, width: 40, height: 12 })],
      ir: {
        figmaType: 'FRAME', opacity: 1, isAbsolute: false, fills: [], effects: [],
        clipsContent: false, flexGrow: 0,
        autoLayout: { stackMode: 'VERTICAL', stackSpacing: 8 },
      },
    }), {
      viewport: { width: 390, height: 844 },
      runtime: { kind: 'browser', engine: 'chromium' },
    });

    for (const layoutMode of [undefined, 'auto-layout'] as const) {
      const result = await createFigmaFileFromSceneDocuments(document, {
        compressedSchema: fs.readFileSync(FILE_SCHEMA_PATH),
        layoutMode,
        localFontAccess: 'disabled',
      });
      const zip = await import('jszip').then(({ default: JSZip }) => JSZip.loadAsync(result.bytes));
      const canvas = await zip.file('canvas.fig')!.async('uint8array');
      const { files } = parseArchive(canvas);
      const compiled = compileSchema(decodeCompressedSchema(files[0]));
      const message = compiled.decodeMessage(decompress(files[1])) as {
        nodeChanges: Array<{ name?: string; stackMode?: string }>;
      };

      expect(message.nodeChanges.find(node => node.name === 'Measured frame')?.stackMode)
        .toBe(layoutMode === undefined ? 'NONE' : 'VERTICAL');
    }
  });
});
