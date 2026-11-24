import { describe, expect, it } from 'vitest';
import { saveGEArtifacts } from '../scripts/save-ge-artifacts.js';

describe('GE image artifacts', () => {
  const images = {
    'a/images/same.png': new Uint8Array([1]),
    'b/images/same.png': new Uint8Array([2]),
  };

  it('resolves an exact ZIP path before matching duplicate basenames', async () => {
    const artifacts = await saveGEArtifacts({ images: [{ url: 'images/same.png' }] }, images, 'b');

    expect(artifacts.imageFiles).toMatchObject([{ sourcePath: 'b/images/same.png', bytes: new Uint8Array([2]) }]);
  });

  it('rejects ambiguous fallback matches instead of silently replacing an image', async () => {
    await expect(saveGEArtifacts({ images: [{ url: 'same.png' }] }, images, 'missing'))
      .rejects.toThrow('Ambiguous image path: same.png');
  });

  it('retains a unique basename fallback for archives with a different image directory', async () => {
    const artifacts = await saveGEArtifacts(
      { images: [{ url: 'source/picture.png' }] }, { 'assets/picture.png': new Uint8Array([3]) }, '',
    );

    expect(JSON.parse(artifacts.jsonText).images).toEqual([{ url: 'images/img_0.png' }]);
  });
});
