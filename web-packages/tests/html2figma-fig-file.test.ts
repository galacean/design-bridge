import { describe, expect, it } from 'vitest';
import { createFigmaFile } from '@galacean/html2figma';
import { decodeFigFile } from '@galacean/figma2ge';
import type { SceneResult } from '@galacean/html2figma';

describe('html2figma .fig file integration', () => {
  it('round-trips a generated file through the public figma2ge decoder', async () => {
    const scenes: SceneResult[] = [{
      name: 'Generated page',
      sceneData: {
        type: 'frame',
        name: 'Root',
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        text: null,
        svg: null,
        image: null,
        backgroundImage: null,
        styles: {},
        children: [],
        ir: {
          figmaType: 'FRAME',
          opacity: 1,
          isAbsolute: false,
          fills: [],
          effects: [],
          clipsContent: false,
          flexGrow: 0,
        },
      },
    }];
    const file = await createFigmaFile(scenes, {
      createdAt: '2026-09-28T00:00:00.000Z',
      documentName: 'Round trip',
    });
    const decoded = decodeFigFile(file.bytes);
    const nodeChanges = decoded.message.nodeChanges;

    expect(Object.keys(decoded.message)).toEqual(['type', 'sessionID', 'ackID', 'nodeChanges', 'blobs']);
    expect(decoded.meta).toEqual({
      client_meta: {
        background_color: { r: 0, g: 0, b: 0, a: 0 },
        thumbnail_size: { width: 1, height: 1 },
        render_coordinates: { x: 0, y: 0, width: 320, height: 240 },
      },
      file_name: 'Round trip',
      developer_related_links: [],
      exported_at: '2026-09-28T00:00:00.000Z',
    });
    expect(Array.isArray(nodeChanges)).toBe(true);
    expect(file.validation).toMatchObject({ valid: true, errors: [], version: 106, pageCount: 1 });
    expect(nodeChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'DOCUMENT' }),
      expect.objectContaining({ type: 'CANVAS', name: 'Page 1' }),
      expect.objectContaining({ type: 'FRAME', name: 'Root' }),
    ]));
  });
});
