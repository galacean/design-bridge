import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneResult } from '../../src/types';
import { makeSceneNode } from '../helpers/scene-factories';

const {
  encodeMessageMock,
  compileSchemaMock,
  loadSchemaMock,
  encodeBinarySchemaMock,
  deflateRawMock,
  writeArchiveMock,
  composeClipboardHTMLMock,
} = vi.hoisted(() => {
  const encodeMessage = vi.fn((message: unknown) => {
    void message;

    return Uint8Array.from([9, 9]);
  });
  const compileSchema = vi.fn((schema: unknown) => {
    void schema;

    return { encodeMessage };
  });
  const loadSchema = vi.fn(() => ({ mock: true }));
  const encodeBinarySchema = vi.fn((schema: unknown) => {
    void schema;

    return Uint8Array.from([1, 2, 3]);
  });
  const deflateRaw = vi.fn((input: Uint8Array) => input);
  const writeArchive = vi.fn((files: Uint8Array[]) => {
    void files;

    return Uint8Array.from([7, 7, 7]);
  });
  const composeClipboardHTML = vi.fn((meta: unknown, archive: Uint8Array) => {
    void meta;
    void archive;

    return 'mock-clipboard-html';
  });

  return {
    encodeMessageMock: encodeMessage,
    compileSchemaMock: compileSchema,
    loadSchemaMock: loadSchema,
    encodeBinarySchemaMock: encodeBinarySchema,
    deflateRawMock: deflateRaw,
    writeArchiveMock: writeArchive,
    composeClipboardHTMLMock: composeClipboardHTML,
  };
});

vi.mock('../../src/core/kiwi-archive', () => ({
  compileSchema: compileSchemaMock,
  encodeBinarySchema: encodeBinarySchemaMock,
  pako: { deflateRaw: deflateRawMock },
  writeArchive: writeArchiveMock,
  composeClipboardHTML: composeClipboardHTMLMock,
}));

vi.mock('../../src/core/kiwi-schema-node', () => ({
  loadSchema: loadSchemaMock,
}));

import { createFigmaClipboard, scenesToFigmaClipboard } from '../../src/core/figma-clipboard-node';

describe('scenesToFigmaClipboard orchestration', () => {
  beforeEach(() => {
    loadSchemaMock.mockClear();
    compileSchemaMock.mockClear();
    encodeMessageMock.mockClear();
    encodeBinarySchemaMock.mockClear();
    deflateRawMock.mockClear();
    writeArchiveMock.mockClear();
    composeClipboardHTMLMock.mockClear();
  });

  it('builds NODE_CHANGES message and returns composed clipboard HTML', () => {
    const scenes: SceneResult[] = [
      { name: 'valid', sceneData: makeSceneNode({ name: 'Screen A' }) },
      { name: 'invalid', error: 'failed to parse' },
    ];

    const html = scenesToFigmaClipboard(scenes);

    expect(html).toBe('mock-clipboard-html');
    expect(loadSchemaMock).toHaveBeenCalledTimes(1);
    expect(compileSchemaMock).toHaveBeenCalledTimes(1);
    expect(encodeBinarySchemaMock).toHaveBeenCalledTimes(1);
    expect(encodeMessageMock).toHaveBeenCalledTimes(3);
    expect(writeArchiveMock).toHaveBeenCalledTimes(3);
    expect(composeClipboardHTMLMock).toHaveBeenCalledTimes(1);

    const messageCall = encodeMessageMock.mock.calls[0];

    expect(messageCall).toBeDefined();
    const message = messageCall[0] as {
      type: string;
      nodeChanges: Array<{ type: string }>;
      blobs: unknown[];
      pasteID: number;
    };

    expect(message.type).toBe('NODE_CHANGES');
    expect(message.blobs).toEqual([]);
    expect(Number.isInteger(message.pasteID)).toBe(true);

    const frameCount = message.nodeChanges.filter(node => node.type === 'FRAME').length;

    expect(frameCount).toBe(1);
    expect(message.nodeChanges[0].type).toBe('DOCUMENT');

    const composeCall = composeClipboardHTMLMock.mock.calls[0];

    expect(composeCall).toBeDefined();
    const metaArg = composeCall[0] as { dataType: string; fileKey: string };

    expect(metaArg.dataType).toBe('scene');
    expect(metaArg.fileKey).toBe('0');
  });

  it('deduplicates repeated image blobs and reports saved bytes', () => {
    const imageData = 'data:image/png;base64,AQIDBA==';
    const root = makeSceneNode({
      children: [
        makeSceneNode({ type: 'image', image: imageData }),
        makeSceneNode({ type: 'image', image: imageData }),
      ],
    });

    const result = createFigmaClipboard([{ name: 'images', sceneData: root }]);
    const message = encodeMessageMock.mock.calls[0][0] as { blobs: unknown[] };

    expect(result.html).toBe('mock-clipboard-html');
    expect(message.blobs).toHaveLength(1);
    expect(result.blobStats).toMatchObject({
      references: 2,
      unique: 1,
      bytes: 8,
      deduplicatedBytes: 4,
      byKind: {
        image: { references: 2, unique: 1, bytes: 8, deduplicatedBytes: 4 },
      },
    });
    expect(result.archiveData).toEqual(Uint8Array.from([7, 7, 7]));
    expect(result.imageEntries).toHaveLength(1);
    expect(result.imageEntries[0].name).toMatch(/^images\/[0-9a-f]{40}$/);
    expect(result.imageEntries[0].data).toEqual(Uint8Array.from([1, 2, 3, 4]));
  });
});
