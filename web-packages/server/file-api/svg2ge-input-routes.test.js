import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSVG2GEInputRoutes } from './svg2ge-input-routes.js';
import { registerSVG2GETagsRoutes } from './svg2ge-tags-routes.js';
import { registerSVG2GEStorageRoutes } from './svg2ge-storage-routes.js';

let root;
let handlers;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>';

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'svg-cases-'));
  handlers = new Map();
  const server = { middlewares: { use: (route, handler) => handlers.set(route, handler) } };

  registerSVG2GEInputRoutes(server, root);
  registerSVG2GETagsRoutes(server, root);
  registerSVG2GEStorageRoutes(server, root);
});
afterEach(async () => rm(root, { recursive: true, force: true }));

function response() { return { setHeader: vi.fn(), end: vi.fn() }; }

it('lists the original static and dynamic pools and preserves relative image references', async () => {
  await mkdir(path.join(root, 'tmp/svg_input'), { recursive: true });
  await writeFile(path.join(root, 'tmp/svg_input/static.svg'), svg);
  await mkdir(path.join(root, 'tmp/svg_input/images'), { recursive: true });
  await writeFile(path.join(root, 'tmp/svg_input/images/test.png'), 'png');
  await writeFile(path.join(root, 'tmp/svg_input/local-image.svg'), '<svg><image href="images/test.png"/></svg>');
  await mkdir(path.join(root, 'tmp/svg_dynamic_tests/spec'), { recursive: true });
  await mkdir(path.join(root, 'tmp/svg_dynamic_tests/images'), { recursive: true });
  await writeFile(path.join(root, 'tmp/svg_dynamic_tests/images/test.png'), 'png');
  await writeFile(path.join(root, 'tmp/svg_dynamic_tests/spec/animated.svg'),
    '<svg><image href="../images/test.png"/><a href="../images/test.png"/></svg>');
  const res = response();

  handlers.get('/api/svg2ge/list-input')({ url: '/' }, res);
  expect(JSON.parse(res.end.mock.lastCall[0]).files).toEqual(['local-image.svg', 'static.svg']);
  handlers.get('/api/svg2ge/read-input/')({ url: '/local-image.svg' }, res);
  expect(res.end.mock.lastCall[0]).toContain('href="/tmp/svg_input/images/test.png"');
  handlers.get('/api/svg2ge/list-input')({ url: '/?type=dynamic&pool=dspec' }, res);
  expect(JSON.parse(res.end.mock.lastCall[0])).toMatchObject({
    files: ['animated.svg'], meta: { 'animated.svg': { pool: 'dspec', type: 'dynamic' } },
  });
  handlers.get('/api/svg2ge/read-input/')({ url: '/animated.svg?type=dynamic' }, res);
  expect(res.end.mock.lastCall[0]).toContain('<image href="/tmp/svg_dynamic_tests/images/test.png"/>');
  expect(res.end.mock.lastCall[0]).toContain('<a href="../images/test.png"/>');
  handlers.get('/api/svg2ge/read-input/')({ url: '/..%2F..%2Foutside.svg' }, res);
  expect(res.statusCode).toBe(403);
});

it('keeps case classifications and notes in the original tag file', async () => {
  const handler = handlers.get('/api/svg2ge/tags');
  const res = response();
  const request = Object.assign(Readable.from([JSON.stringify({ name: 'static.svg', tag: 'pass', note: 'Verified' })]), {
    method: 'POST', url: '/',
  });

  await handler(request, res);
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(await readFile(path.join(root, 'tmp/svg2ge-case-tags.json'), 'utf8')))
    .toMatchObject({ version: 1, tags: { 'static.svg': { tag: 'pass', note: 'Verified' } } });
  await handler({ method: 'GET', url: '/' }, res);
  expect(JSON.parse(res.end.mock.lastCall[0]).tags['static.svg'].note).toBe('Verified');
});

it('saves conversion results under tmp and rejects writes outside it', async () => {
  const handler = handlers.get('/api/svg2ge/save');
  const res = response();
  const request = filePath => Object.assign(Readable.from([JSON.stringify({ filePath, content: '{"type":"ge"}' })]), {
    method: 'POST', url: '/',
  });

  await handler(request('tmp/output/scene.json'), res);
  expect(res.statusCode).toBe(200);
  expect(await readFile(path.join(root, 'tmp/output/scene.json'), 'utf8')).toBe('{"type":"ge"}');
  await handler(request('../outside.json'), res);
  expect(res.statusCode).toBe(403);
});
