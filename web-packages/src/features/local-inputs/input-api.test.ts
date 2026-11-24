import { afterEach, describe, expect, it, vi } from 'vitest';
import { listInputFiles, readInputText } from './input-api';

afterEach(() => vi.unstubAllGlobals());

describe('URL input requests', () => {
  it.each([
    { format: 'lottie', protocol: 'https' },
    { format: 'lottie', protocol: 'http' },
    { format: 'ge', protocol: 'https' },
    { format: 'dsl', protocol: 'https' },
  ] as const)('reads $format CDN inputs directly over $protocol with cancellation', async ({ format, protocol }) => {
    const url = `${protocol}://cdn.example.com/animation?id=123`;
    const signal = new AbortController().signal;
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"layers":[]}'));

    vi.stubGlobal('fetch', fetchMock);
    expect(await readInputText(format, url, signal)).toBe('{"layers":[]}');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url, { signal });
  });

  it.each(['ge', 'dsl', 'lottie'] as const)('lists %s manifest URLs with cancellation', async format => {
    const urls = ['https://cdn.example.com/scene'];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ files: urls })));
    const signal = new AbortController().signal;

    vi.stubGlobal('fetch', fetchMock);
    expect(await listInputFiles(format, signal)).toEqual(urls);
    expect(fetchMock.mock.calls[0][1]).toEqual({ signal });
  });

  it.each(['ge', 'dsl', 'lottie'] as const)('rejects %s local paths before making a request', async format => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(readInputText(format, '素材 / 1.json')).rejects.toThrow('HTTP(S) URL');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([null, { files: [1] }, { files: 'not-an-array' }, { files: ['local.json'] }])('rejects invalid file lists: %j', async payload => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(listInputFiles('ge')).rejects.toThrow('文件列表格式无效');
  });

  it('reports HTTP failures instead of showing an empty directory', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    await expect(listInputFiles('dsl')).rejects.toThrow('HTTP 500');
    await expect(readInputText('dsl', 'https://cdn.example.com/scene.json')).rejects.toThrow('HTTP 500');
  });
});
