import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertSVGToLayers, convertSVGToGE } from '@galacean/svg2ir';

const base64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const bytes = Uint8Array.from(atob(base64.split(',')[1]), character => character.charCodeAt(0));
const wrap = (url: string) => '<svg width="200" height="100">'
  + `<image href="${url}" width="40" height="30" preserveAspectRatio="none"/></svg>`;

afterEach(() => vi.unstubAllGlobals());

describe('layers image resources', () => {
  it('loads an external image and returns only its inline bytes', async () => {
    const fetchImage = vi.fn().mockResolvedValue(new Response(bytes, {
      headers: { 'Content-Type': 'image/png' },
    }));

    vi.stubGlobal('fetch', fetchImage);
    const result = await convertSVGToLayers(wrap('https://example.com/a.png'), {});

    expect(result.data[0]).toMatchObject({ url: base64, bbox: [0, 0, 40, 30], width: 40, height: 30 });
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  it('keeps GE output synchronous without fetching image resources', () => {
    const fetchImage = vi.fn();

    vi.stubGlobal('fetch', fetchImage);
    const result = convertSVGToGE(wrap('https://example.com/a.png'));

    expect(result.data.type).toBe('ge');
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('rejects unreadable images rather than emitting external URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(convertSVGToLayers(wrap('https://example.com/missing.png'), {}))
      .rejects.toThrow(/404/);
  });

  it('reads local files through the supplied loader and caches repeated resources', async () => {
    const loadImage = vi.fn().mockResolvedValue({ data: bytes, mimeType: 'image/png' });
    const source = '<svg width="200" height="100">'
      + '<image href="./a.png" width="40" height="30"/>'
      + '<image href="./a.png" x="50" width="40" height="30"/></svg>';
    const result = await convertSVGToLayers(source, {
      resourceBaseUrl: 'file:///fixtures/source.svg', loadImage,
    });

    expect(loadImage).toHaveBeenCalledExactlyOnceWith('file:///fixtures/a.png');
    expect(result.data.filter(layer => layer.type === 'image').map(layer => layer.url))
      .toEqual([base64, base64]);
  });

  it('resolves relative resources before loading them', async () => {
    const loadImage = vi.fn().mockResolvedValue({ data: bytes, mimeType: 'image/png' });
    const result = await convertSVGToLayers(wrap('./a.png'), {
      resourceBaseUrl: 'https://example.com/assets/source.svg', loadImage,
    });

    expect(loadImage).toHaveBeenCalledExactlyOnceWith('https://example.com/assets/a.png');
    expect(result.data[0]).toMatchObject({ url: base64 });
  });

  it('reads temporary blob URLs and never returns them', async () => {
    const fetchImage = vi.fn().mockResolvedValue(new Response(bytes, {
      headers: { 'Content-Type': 'image/png; charset=binary' },
    }));

    vi.stubGlobal('fetch', fetchImage);
    const result = await convertSVGToLayers(wrap('blob:https://example.com/temporary'), {});

    expect(result.data[0]).toMatchObject({ url: base64 });
    expect(fetchImage).toHaveBeenCalledExactlyOnceWith('blob:https://example.com/temporary');
  });

  it('preserves valid base64 without fetching it', async () => {
    const fetchImage = vi.fn();

    vi.stubGlobal('fetch', fetchImage);
    const result = await convertSVGToLayers(wrap(base64), {});

    expect(result.data[0]).toMatchObject({ url: base64 });
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it.each([
    ['empty data', 'data:image/png;base64,'],
    ['corrupt base64', 'data:image/png;base64,???'],
    ['non-image MIME', 'data:text/plain;base64,aGVsbG8='],
    ['corrupt percent encoding', 'data:image/svg+xml,%ZZ'],
  ])('rejects %s instead of emitting unusable data', async (_name, url) => {
    await expect(convertSVGToLayers(wrap(url), {})).rejects.toThrow();
  });

  it.each([
    ['text/html', bytes], ['image/png', new Uint8Array()], ['', bytes],
  ])('rejects invalid loader output (%s)', async (mimeType, data) => {
    const loadImage = () => Promise.resolve({ mimeType, data });

    await expect(convertSVGToLayers(wrap('file:///fixtures/a.png'), { loadImage })).rejects.toThrow();
  });

  it('rejects inaccessible resources even when strict mode is disabled', async () => {
    const loadImage = () => Promise.reject(new Error('Permission denied'));

    await expect(convertSVGToLayers(wrap('file:///fixtures/a.png'), { strict: false, loadImage }))
      .rejects.toThrow(/Permission denied/);
  });

  it('normalizes percent-encoded SVG image data to base64', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>中文</text></svg>';
    const result = await convertSVGToLayers(wrap(`data:image/svg+xml,${encodeURIComponent(svg)}`), {
      });
    const image = result.data[0];

    if (image.type !== 'image') { throw new Error('Missing image layer'); }
    expect(image.url).toMatch(/^data:image\/svg\+xml;base64,/);
    const encoded = image.url.split(',')[1];
    const decoded = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));

    expect(new TextDecoder().decode(decoded)).toBe(svg);
  });
});
