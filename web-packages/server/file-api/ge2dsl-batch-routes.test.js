import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { DataType, EndBehavior, ItemType, ValueType } from '@galacean/effects-specification';
import { registerGE2DSLBatchRoutes } from './ge2dsl-batch-routes.js';

function createSource() {
  return {
    version: '3.6', type: 'ge', compositionId: 'root',
    compositions: [{
      id: 'root', name: 'IR editing', duration: 2, startTime: 0,
      endBehavior: EndBehavior.restart, previewSize: [400, 300],
      components: [{ id: 'composition-component' }],
    }],
    items: [{
      id: 'particle', name: 'Particle', type: ItemType.particle,
      duration: 2, delay: 0, visible: true, endBehavior: EndBehavior.restart,
      components: [{ id: 'particle-component' }],
      transform: { position: { x: 0, y: 0, z: 0 } },
    }],
    components: [
      {
        id: 'composition-component', dataType: DataType.CompositionComponent,
        item: { id: 'root' }, items: [{ id: 'particle' }], sceneBindings: [],
      },
      {
        id: 'particle-component', dataType: DataType.ParticleSystem, item: { id: 'particle' },
        options: { maxCount: 17, startLifetime: [ValueType.CONSTANT, 1], startSize: [ValueType.CONSTANT, 0.5] },
        renderer: { renderMode: 1 }, shape: { type: 1, radius: 0.5, arc: 360 },
        emission: { rateOverTime: [ValueType.CONSTANT, 5] },
      },
    ],
    images: [], textures: [], fonts: [], plugins: [], miscs: [],
  };
}

describe('GE batch module integration', () => {
  it('reserves the batch slot before asynchronous initialization and releases it after an error', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'ge-batch-start-'));
    let rejectInitialization;
    const initialization = new Promise((_resolve, reject) => { rejectInitialization = reject; });
    const use = vi.fn();
    const loadModule = vi.fn(() => initialization);
    const response = () => ({ setHeader: vi.fn(), end: vi.fn() });
    const request = () => Object.assign(Readable.from(['{"frameRate":30}']), {
      method: 'POST', headers: { host: 'workbench.test:8080' },
    });

    try {
      await mkdir(path.join(rootDir, 'tests/fixtures/ge'), { recursive: true });
      await writeFile(path.join(rootDir, 'tests/fixtures/ge/urls.txt'), '');
      registerGE2DSLBatchRoutes({ middlewares: { use }, ssrLoadModule: loadModule }, rootDir);
      const handler = use.mock.calls[0][1];
      const first = response();
      const firstRun = handler(request(), first);

      await vi.waitFor(() => expect(loadModule).toHaveBeenCalled());
      const second = response();

      const secondRun = handler(request(), second);

      rejectInitialization(new Error('Module unavailable'));
      await Promise.all([firstRun, secondRun]);
      expect(second.statusCode).toBe(409);
      expect(first.statusCode).toBe(500);

      loadModule.mockResolvedValue({ convertGEToDSL: vi.fn(), validateDSL: vi.fn() });
      const retry = response();

      await handler(request(), retry);
      expect(retry.statusCode).toBe(202);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('loads the real converter and validator through Vite', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'ge-batch-integration-'));
    const vite = await createServer({
      configFile: fileURLToPath(new URL('../../vite.config.js', import.meta.url)),
      server: { middlewareMode: true, hmr: false },
      logLevel: 'silent',
    });
    try {
      const source = createSource();

      source.items[0].type = ItemType.sprite;
      source.items[0].transform.size = { x: 1, y: 1 };
      source.components[1].dataType = DataType.SpriteComponent;
      source.components[1].renderer.texture = { id: 'texture' };
      source.images.push({ id: 'image', url: './images/sprite.png' });
      source.textures.push({ id: 'texture', dataType: DataType.Texture, source: { id: 'image' } });
      await mkdir(path.join(rootDir, 'tests/fixtures/ge'), { recursive: true });
      await writeFile(path.join(rootDir, 'tests/fixtures/ge/urls.txt'), 'https://cdn.example.com/bundle/scene.json');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(source))));
      const use = vi.fn();

      registerGE2DSLBatchRoutes({ middlewares: { use }, ssrLoadModule: vite.ssrLoadModule.bind(vite) }, rootDir);
      const handler = use.mock.calls[0][1];
      const response = { setHeader: vi.fn(), end: vi.fn() };
      const request = Object.assign(Readable.from(['{"frameRate":30}']), {
        method: 'POST', headers: { host: 'workbench.test:8080' },
      });

      await handler(request, response);
      expect(JSON.parse(response.end.mock.lastCall[0]).error).toBeNull();
      expect(response.statusCode).toBe(202);
      await vi.waitFor(async () => {
        await handler({ method: 'GET' }, response);
        expect(JSON.parse(response.end.mock.lastCall[0]).status).toBe('completed');
      });
      const result = JSON.parse(response.end.mock.lastCall[0]);

      expect(result.summary, JSON.stringify(result.files)).toMatchObject({
        total: 1, processed: 1, passed: 1, conversionErrors: 0,
      });
    } finally {
      vi.unstubAllGlobals();
      await vite.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
