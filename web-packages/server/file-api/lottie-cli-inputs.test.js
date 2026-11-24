import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
let root;
let server;
let sourceUrl;
let requests;
const imageBytes = Buffer.from('test image bytes');

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'lottie-url-cli-'));
  for (const directory of ['scripts', 'server/file-api', 'tests/fixtures/lottie', 'tmp/lottie-input']) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(root, 'tmp/lottie-input/local.json'), '{"mustNotBeLoaded":true}');
  for (const name of ['scripts/batch-convert.js', 'scripts/local-convert.js', 'scripts/save-ge-artifacts.js',
    'server/file-api/input-sources.js']) {
    await copyFile(new URL(`../../${name}`, import.meta.url), path.join(root, name));
  }
  const modules = {
    'lottie2ir': `export async function convertLottieToIR(text, options) {
      const input = JSON.parse(text);
      if (input.mustNotBeLoaded) throw new Error('Local input was read');
      return { scene: { images: input.images.map(url => ({ url: new URL(url, options.resourceBaseUrl).href })) },
        diagnostics: [] };
    }`,
    'ge-ir': 'export function convertIRToGE(scene) { return { scene, diagnostics: [] }; }',
  };
  for (const [name, code] of Object.entries(modules)) {
    const directory = path.join(root, 'node_modules/@galacean', name);

    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), '{"type":"module","exports":"./index.js"}');
    await writeFile(path.join(directory, 'index.js'), code);
  }
  requests = [];
  server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/scene?id=1') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ images: ['./image.png', `data:image/png;base64,${imageBytes.toString('base64')}`] }));
    } else if (req.url === '/image.png') {
      res.setHeader('Content-Type', 'image/png');
      res.end(imageBytes);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  sourceUrl = `http://127.0.0.1:${server.address().port}/scene?id=1`;
  await writeFile(path.join(root, 'tests/fixtures/lottie/urls.txt'), sourceUrl);
});

afterEach(async () => {
  if (server != null) {
    await new Promise(resolve => server.close(resolve));
  }
  await rm(root, { recursive: true, force: true });
});

describe.each(['batch-convert', 'local-convert'])('%s URL manifest inputs', script => {
  it('downloads JSON URLs without extensions and preserves local outputs', async () => {
    await run(process.execPath, [path.join(root, `scripts/${script}.js`)], { cwd: root });
    const hash = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16);
    const output = path.join(root, 'tmp/output', script === 'batch-convert' ? `${hash}.json` : `${hash}/result.json`);
    const scene = JSON.parse(await readFile(output, 'utf8'));

    expect(requests.filter(url => url === '/scene?id=1')).toHaveLength(1);
    if (script === 'batch-convert') {
      expect(scene.images[0].url).toBe(new URL('./image.png', sourceUrl).href);
      expect(requests).toEqual(['/scene?id=1']);
    } else {
      expect(requests).toEqual(['/scene?id=1', '/image.png']);
      for (const image of scene.images) {
        expect(image.url).toMatch(/^images\//);
        expect(await readFile(path.join(path.dirname(output), image.url))).toEqual(imageBytes);
      }
    }
  });

  it('fails when the manifest is absent and rejects a local file argument', async () => {
    await rm(path.join(root, 'tests/fixtures/lottie/urls.txt'));
    await expect(run(process.execPath, [path.join(root, `scripts/${script}.js`)], { cwd: root }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('urls.txt') });
    await expect(run(process.execPath, [path.join(root, `scripts/${script}.js`), 'tmp/lottie-input/local.json'],
      { cwd: root })).rejects.toMatchObject({ code: 1 });
    expect(requests).toEqual([]);
  });
});
