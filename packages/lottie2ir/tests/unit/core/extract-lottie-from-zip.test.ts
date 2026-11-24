import JSZip from '@progress/jszip-esm';
import { describe, expect, it } from 'vitest';
import { extractLottieFromZip, LOTTIE_CONVERTER_ERROR_CODES } from '@galacean/lottie2ir';

describe('extractLottieFromZip', () => {
  it('returns JSON, its directory, and embeddable resources', async () => {
    if (typeof globalThis.btoa === 'undefined') {
      globalThis.btoa = (input: string): string => Buffer.from(input, 'binary').toString('base64');
    }

    const zip = new JSZip();

    zip.file('pack/data.json', JSON.stringify({ v: '5.7.0' }));
    zip.file('pack/images/a.png', new Uint8Array([1, 2, 3]));
    zip.file('pack/fonts/a.woff2', new Uint8Array([4, 5, 6]));
    zip.file('_MACOSX/pack/images/ignored.png', new Uint8Array([9]));

    const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });
    const result = await extractLottieFromZip(zipBuffer);

    expect(result.dirPath).toBe('pack');
    expect(result.json).toContain('5.7.0');
    expect(Object.keys(result.resources).sort()).toEqual(['pack/fonts/a.woff2', 'pack/images/a.png']);
    expect(result.resources['pack/images/a.png'].startsWith('data:image/png;base64,')).toBe(true);
    expect(result.resources['pack/fonts/a.woff2'].startsWith('data:font/woff2;base64,')).toBe(true);
  });

  it('throws when the archive contains no JSON file', async () => {
    const zip = new JSZip();

    zip.file('pack/images/a.png', new Uint8Array([1, 2, 3]));
    const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });

    await expect(extractLottieFromZip(zipBuffer)).rejects.toMatchObject({
      code: LOTTIE_CONVERTER_ERROR_CODES.ZIP_JSON_NOT_FOUND,
    });
  });
});
