import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createFigmaFileFromSceneDocuments } from '../../src/browser-figma-file';
import { createFigmaClipboardWithSchema } from '../../src/core/figma-clipboard';
import { createFigmaFileFromClipboardResult } from '../../src/core/figma-file';
import { validateFigmaFile } from '../../src/core/figma-file-validation';
import { decodeCompressedSchema } from '../../src/core/kiwi-archive';
import type { TextConversionRuntime } from '../../src/core/text-conversion-runtime';
import { createHTMLSceneDocument } from '../../src/model/html-scene-document';
import { makeSceneNode } from '../helpers/scene-factories';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FILE_SCHEMA_PATH = path.resolve(TEST_DIR, '../../data/figma-file-schema.bin');

async function createFixture(): Promise<Uint8Array> {
  const document = createHTMLSceneDocument(makeSceneNode({
    name: 'Validation fixture',
    children: [
      makeSceneNode({ type: 'image', image: 'data:image/png;base64,AQIDBA==' }),
      makeSceneNode({
        type: 'text',
        name: 'Hello',
        text: 'Hello',
        styles: {
          fontFamily: 'Inter',
          fontStyle: 'normal',
          fontWeight: '400',
          fontSize: '16px',
        },
      }),
    ],
  }), {
    viewport: { width: 390, height: 844 },
    runtime: { kind: 'browser', engine: 'chromium' },
  });

  return (await createFigmaFileFromSceneDocuments(document, {
    compressedSchema: fs.readFileSync(FILE_SCHEMA_PATH),
    createdAt: '2026-09-29T00:00:00.000Z',
    documentName: 'Validation fixture',
    requireTextGlyphs: false,
  })).bytes;
}

describe('Figma file validation', () => {
  it('validates generated ZIP, node graph, images, text, and blob references', async () => {
    const report = await validateFigmaFile(await createFixture());

    expect(report).toMatchObject({
      valid: true,
      errors: [],
      version: 106,
      pageCount: 1,
      textCount: 1,
      imageCount: 1,
    });
    expect(report.nodeCount).toBeGreaterThanOrEqual(3);
  });

  it('remaps derived glyph blobs when an earlier image blob moves into images/', async () => {
    const runtime: TextConversionRuntime = {
      resolveFontFamily: () => 'Inter',
      computeCharWidths: (_family, _style, _weight, _source, text) => Array.from(text, () => 8),
      getGlyphBlobIndex: (_family, _style, _weight, _source, character, blobStore) =>
        blobStore.add('glyph', Uint8Array.from([1, 2, character.codePointAt(0) ?? 0])),
    };
    const scene = makeSceneNode({
      children: [
        makeSceneNode({ type: 'image', image: 'data:image/png;base64,AQIDBA==' }),
        makeSceneNode({
          type: 'text',
          text: 'AB',
          styles: { fontFamily: 'Inter', fontStyle: 'normal', fontWeight: '400', fontSize: '16px' },
        }),
      ],
    });
    const clipboard = createFigmaClipboardWithSchema(
      [{ name: 'Blob remap', sceneData: scene }],
      decodeCompressedSchema(fs.readFileSync(FILE_SCHEMA_PATH)),
      { textRuntime: runtime },
    );
    const file = await createFigmaFileFromClipboardResult(clipboard);

    expect(file.validation).toMatchObject({ valid: true, errors: [], blobCount: 2, imageCount: 1 });
  });

  it('reports a missing external image instead of accepting a partially valid archive', async () => {
    const zip = await JSZip.loadAsync(await createFixture());
    const imageName = Object.keys(zip.files).find(name => name.startsWith('images/'));

    expect(imageName).toBeDefined();
    zip.remove(imageName!);
    const report = await validateFigmaFile(await zip.generateAsync({ type: 'uint8array' }));

    expect(report.valid).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('references missing image entry'),
    ]));
  });

  it('rejects bytes that are not a .fig ZIP archive', async () => {
    const report = await validateFigmaFile(Uint8Array.from([1, 2, 3]));

    expect(report.valid).toBe(false);
    expect(report.errors).not.toHaveLength(0);
  });
});
