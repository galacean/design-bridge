import { describe, expect, it } from 'vitest';
import { readGESceneMetadata } from '../src/features/ge-preview/read-scene-metadata';

describe('GE preview metadata', () => {
  it('reads the selected composition, top-level version, and actual pool counts', () => {
    expect(readGESceneMetadata({
      version: '3.6', compositionId: 'main',
      compositions: [
        { id: 'child', duration: 1, previewSize: [20, 20] },
        { id: 'main', duration: 2.5, previewSize: [640, 360] },
      ],
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    })).toEqual({
      version: '3.6', duration: 2.5, previewSize: { width: 640, height: 360 },
      compositions: 2, items: 3, nestedLayers: 0,
    });
  });

  it.each([[Infinity, 100], [100, NaN], [-1, 100], ['100', 100], [0, 100]])(
    'rejects invalid preview dimensions %j × %j', (width, height) => {
      expect(readGESceneMetadata({ compositions: [{ previewSize: [width, height] }] }).previewSize).toBeNull();
    },
  );

  it('uses the first composition when there is no entry ID and tolerates malformed metadata', () => {
    expect(readGESceneMetadata({ compositions: [{ duration: 4, previewSize: [100, 200] }] }))
      .toMatchObject({ duration: 4, previewSize: { width: 100, height: 200 } });
    expect(readGESceneMetadata(null)).toMatchObject({ duration: null, previewSize: null, items: 0 });
    expect(readGESceneMetadata({ compositions: [null], items: [null, { content: { items: [1] } }] }))
      .toMatchObject({ duration: null, previewSize: null, nestedLayers: 1 });
  });
});
