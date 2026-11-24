import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerInputRoutes } from './lottie2ge-input-routes.js';
import { registerOutputRoutes } from './lottie2ge-output-routes.js';
import { registerDSL2GEInputRoutes } from './dsl2ge-input-routes.js';
import { registerGE2IRInputRoutes } from './ge2ir-input-routes.js';
import { registerGE2DSLBatchRoutes } from './ge2dsl-batch-routes.js';
import { registerDSLValidatorRoutes } from './dsl-validator-routes.js';

describe('page URL inputs and local outputs', () => {
  let temporaryRoot;
  let rootDir;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'design-bridge-inputs-'));
    rootDir = path.join(temporaryRoot, 'web-packages');
    await mkdir(rootDir);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  describe.each([
    { format: 'lottie', route: 'lottie2ge', register: registerInputRoutes },
    { format: 'ge', route: 'ge2ir', register: registerGE2IRInputRoutes },
    { format: 'dsl', route: 'dsl2ge', register: registerDSL2GEInputRoutes },
  ])('$format shared CDN inputs', ({ format, route, register }) => {
    it.each([true, false])('lists URLs with local inputs present: %s', async withLocalInputs => {
      const inputDirectory = path.join(rootDir, 'tmp', `${format}-input`);
      const fixtureDirectory = path.join(rootDir, 'tests/fixtures', format);
      const urls = ['https://cdn.example.com/second', 'https://cdn.example.com/first?id=1'];
      const use = vi.fn();

      if (withLocalInputs) {
        await mkdir(inputDirectory, { recursive: true });
        await writeFile(path.join(inputDirectory, 'local.json'), '{}');
      }
      await mkdir(fixtureDirectory, { recursive: true });
      await writeFile(path.join(fixtureDirectory, 'urls.txt'), `\uFEFF ${urls[0]} \r\n\r\n${urls[1]}\r\n${urls[0]}\r\n`);
      register({ middlewares: { use } }, rootDir);
      const handler = use.mock.calls.find(([url]) => url === `/api/${route}/list-input`)[1];
      const response = { setHeader: vi.fn(), end: vi.fn() };

      await handler({}, response);
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.end.mock.lastCall[0]).files).toEqual(urls);
      expect(use.mock.calls.some(([url]) => url.includes('/read-input/'))).toBe(false);
    });

    it.each(['not-a-url', 'file:///tmp/animation.json'])('rejects invalid manifest URL %s', async url => {
      const fixtureDirectory = path.join(rootDir, 'tests/fixtures', format);
      const use = vi.fn();

      await mkdir(fixtureDirectory, { recursive: true });
      await writeFile(path.join(fixtureDirectory, 'urls.txt'), url);
      register({ middlewares: { use } }, rootDir);
      const handler = use.mock.calls.find(([prefix]) => prefix === `/api/${route}/list-input`)[1];
      const response = { setHeader: vi.fn(), end: vi.fn() };

      await handler({}, response);
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.end.mock.lastCall[0]).error).toContain('urls.txt');
    });
  });

  it.each([
    { directory: 'output', route: 'lottie2ge', kind: 'output', register: registerOutputRoutes },
  ])('lists and reads $directory through the existing API', async ({ directory, route, kind, register }) => {
    const inputDirectory = path.join(rootDir, 'tmp', directory);
    const input = { name: '测试素材' };
    const use = vi.fn();

    await mkdir(inputDirectory, { recursive: true });
    await writeFile(path.join(inputDirectory, '测试.json'), JSON.stringify(input));
    register({ middlewares: { use } }, rootDir);

    const listHandler = use.mock.calls.find(([url]) => url === `/api/${route}/list-${kind}`)[1];
    const readHandler = use.mock.calls.find(([url]) => url === `/api/${route}/read-${kind}/`)[1];
    const response = { setHeader: vi.fn(), end: vi.fn() };

    await listHandler({}, response);
    expect(JSON.parse(response.end.mock.lastCall[0]).files).toEqual(['测试.json']);
    readHandler({ url: `/${encodeURIComponent('测试.json')}` }, response);
    expect(JSON.parse(response.end.mock.lastCall[0])).toEqual(input);
    expect(response.statusCode).toBe(200);
  });

  it('converts remote GE to local output and validates only DSL manifest inputs', async () => {
    const validatorDirectory = path.join(temporaryRoot, 'packages/dsl-ir/src/dsl/validator');
    const source = { name: 'GE input' };
    const sourceUrl = 'https://cdn.example.com/scene.json';
    const outputFile = `${createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16)}.dsl.json`;
    const dsl = { meta: { name: 'Converted DSL' }, layers: [] };
    const validateDSL = vi.fn(() => ({ result: 'pass', errors: [], warnings: [] }));
    const convertGEToDSL = vi.fn(() => ({ dsl }));
    const use = vi.fn();
    const server = {
      middlewares: { use },
      ssrLoadModule: async () => ({ convertGEToDSL, validateDSL }),
    };

    await mkdir(validatorDirectory, { recursive: true });
    await mkdir(path.join(rootDir, 'tests/fixtures/ge'), { recursive: true });
    await writeFile(path.join(rootDir, 'tests/fixtures/ge/urls.txt'), sourceUrl);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(source))));
    await Promise.all(['validation.ts', 'labels.ts', 'types.ts'].map(name =>
      writeFile(path.join(validatorDirectory, name), 'export {};')));
    registerGE2DSLBatchRoutes(server, rootDir);
    registerDSLValidatorRoutes(server, rootDir);
    registerDSL2GEInputRoutes(server, rootDir);

    const batchHandler = use.mock.calls.find(([url]) => url === '/api/ge2dsl/batch-validate')[1];
    const validationHandler = use.mock.calls.find(([url]) => url === '/api/dsl-validator/check')[1];
    const request = Object.assign(Readable.from(['{"frameRate":30}']), {
      method: 'POST', headers: { host: 'workbench.test:8443' }, socket: { encrypted: true },
    });
    const response = { setHeader: vi.fn(), end: vi.fn() };

    await batchHandler(request, response);
    expect(response.statusCode).toBe(202);
    await vi.waitFor(async () => {
      await batchHandler({ method: 'GET' }, response);
      expect(JSON.parse(response.end.mock.lastCall[0]).status).toBe('completed');
    });
    expect(convertGEToDSL).toHaveBeenCalledWith(source, {
      frameRate: 30,
      resourceBaseUrl: sourceUrl,
    });
    expect(JSON.parse(await readFile(path.join(rootDir, 'tmp/dsl-input', outputFile), 'utf8')))
      .toEqual(dsl);

    const dslUrl = 'https://cdn.example.com/input.dsl.json';

    await mkdir(path.join(rootDir, 'tests/fixtures/dsl'), { recursive: true });
    await writeFile(path.join(rootDir, 'tests/fixtures/dsl/urls.txt'), dslUrl);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(`${JSON.stringify(dsl, null, 2)}\n`)));
    const listHandler = use.mock.calls.find(([url]) => url === '/api/dsl2ge/list-input')[1];

    await listHandler({}, response);
    expect(JSON.parse(response.end.mock.lastCall[0]).files).toEqual([dslUrl]);
    await validationHandler({ method: 'GET' }, response);
    const result = JSON.parse(response.end.mock.lastCall[0]);

    expect(response.statusCode).toBe(200);
    expect(result.manifest).toBe(path.join(rootDir, 'tests/fixtures/dsl/urls.txt'));
    expect(result.summary).toMatchObject({ total: 1, passed: 1 });
    expect(result.files[0].file).toBe(dslUrl);
    expect(result.files[0].modifiedAt).toBeNull();
    expect(fetch).toHaveBeenCalledWith(dslUrl, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(validateDSL).toHaveBeenLastCalledWith(`${JSON.stringify(dsl, null, 2)}\n`);
  });

  it.each([
    { directory: 'lottie-input', route: 'lottie2ge', register: registerInputRoutes },
    { directory: 'ge-input', route: 'ge2ir', register: registerGE2IRInputRoutes },
    { directory: 'dsl-input', route: 'dsl2ge', register: registerDSL2GEInputRoutes },
  ])('reports a missing manifest instead of scanning $directory', async ({ directory, route, register }) => {
    const inputDirectory = path.join(rootDir, 'tmp', directory);
    const use = vi.fn();

    await mkdir(path.join(inputDirectory, 'group'), { recursive: true });
    await mkdir(path.join(inputDirectory, 'directory.json'));
    await writeFile(path.join(inputDirectory, 'group/测试.JSON'), '{}');
    await writeFile(path.join(inputDirectory, 'ignored.txt'), '{}');
    register({ middlewares: { use } }, rootDir);
    const handler = use.mock.calls.find(([url]) => url === `/api/${route}/list-input`)[1];
    const response = { setHeader: vi.fn(), end: vi.fn() };

    await handler({}, response);
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.end.mock.lastCall[0]).error).toContain('urls.txt');
  });
});
