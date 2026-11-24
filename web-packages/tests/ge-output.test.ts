import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveGEOutput } from '../src/features/local-inputs/save-ge-output';

afterEach(() => vi.unstubAllGlobals());

describe('GE output persistence', () => {
  it.each([500, 200])('does not write a manifest when an image save fails with HTTP %i', async status => {
    const request = vi.fn().mockResolvedValue(new Response('{"success":false}', { status }));

    vi.stubGlobal('fetch', request);
    await expect(saveGEOutput({ images: [{ url: 'https://example.test/image.png' }] }, 'tmp/output/test'))
      .rejects.toThrow('未生成 result.json');
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toBe('/api/lottie2ge/download-image');
  });

  it('writes images before the manifest without changing the preview scene', async () => {
    const request = vi.fn().mockImplementation(async () => new Response('{"success":true}'));
    const inlineSVG = 'data:image/svg+xml,%3Csvg%2F%3E';
    const scene = { images: [
      { url: 'data:image/svg+xml;base64,PHN2Zy8+' }, { url: 'https://example.test/image.png' }, { url: inlineSVG },
    ] };

    vi.stubGlobal('fetch', request);
    await saveGEOutput(scene, 'tmp/output/test');
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/api/lottie2ge/save-binary', '/api/lottie2ge/download-image', '/api/lottie2ge/save',
    ]);
    const payload = JSON.parse(request.mock.calls[2][1].body as string) as { content: string };

    expect(JSON.parse(payload.content).images).toEqual([
      { url: 'images/img_0.svg' }, { url: 'images/img_1.png' }, { url: inlineSVG },
    ]);
    expect(scene.images[0].url).toBe('data:image/svg+xml;base64,PHN2Zy8+');
  });

  it('rejects unresolved relative images instead of writing a manifest with missing files', async () => {
    const request = vi.fn();

    vi.stubGlobal('fetch', request);
    await expect(saveGEOutput({ images: [{ url: 'images/source.png' }] }, 'tmp/output/test'))
      .rejects.toThrow('无法保存关联文件');
    expect(request).not.toHaveBeenCalled();
  });

  it('reports a manifest save failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('failed', { status: 500 })));

    await expect(saveGEOutput({ images: [] }, 'tmp/output/test')).rejects.toThrow('保存失败');
  });
});
