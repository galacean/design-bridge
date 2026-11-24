import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listInputFiles, readInputFile } from './input-sources.js';

let root;

afterEach(async () => {
  vi.unstubAllGlobals();
  if (root != null) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

describe('URL input manifests', () => {
  it('keeps an explicitly empty manifest empty instead of restoring local inputs', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'input-manifest-'));
    await mkdir(path.join(root, 'tests/fixtures/ge'), { recursive: true });
    await mkdir(path.join(root, 'tmp/ge-input'), { recursive: true });
    await writeFile(path.join(root, 'tests/fixtures/ge/urls.txt'), '');
    await writeFile(path.join(root, 'tmp/ge-input/local.json'), '{}');
    expect(await listInputFiles(root, 'ge')).toEqual([]);
  });

  it.each(['scene.json', '/tmp/ge-input/scene.json', 'file:///tmp/scene.json'])('rejects local source %s', async source => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(readInputFile(source)).rejects.toThrow('HTTP(S) URL');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a failed remote download instead of parsing an error page as an input', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not found', { status: 404 })));
    await expect(readInputFile('https://cdn.example.com/missing'))
      .rejects.toThrow('Input download failed: HTTP 404');
  });
});
