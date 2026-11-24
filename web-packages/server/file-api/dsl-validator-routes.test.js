import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { validateDSL } from '@galacean/dsl-ir';
import { registerDSLValidatorRoutes } from './dsl-validator-routes.js';

describe('DSL validation endpoint', () => {
  it.each([
    { duration: 1, result: 'pass', issueField: 'warnings' },
    { duration: -1, result: 'fail', issueField: 'errors' },
  ])('returns $result with $issueField for duration=$duration', async ({ duration, result, issueField }) => {
    const use = vi.fn();
    const server = { middlewares: { use }, ssrLoadModule: async () => ({ validateDSL }) };

    registerDSLValidatorRoutes(server, fileURLToPath(new URL('../../', import.meta.url)));
    const [, handler] = use.mock.calls.find(([route]) => route === '/api/dsl-validator/check');
    const input = {
      meta: { name: 'test', duration, fps: 30, width: 100, height: 100, loop: false },
      layers: [{
        id: 'layer', name: 'Layer', type: 'null', width: 0, height: 0,
        description: { self: '', composite: '' }, parent: null,
        position: { a: false, value: [0, 0, 0] }, time_range: [0, 2],
      }],
    };
    const request = Object.assign(Readable.from([JSON.stringify(input)]), { method: 'POST', url: '/' });
    const response = { setHeader: vi.fn(), end: vi.fn() };

    await handler(request, response);
    const payload = JSON.parse(response.end.mock.calls[0][0]);

    expect(response.statusCode).toBe(200);
    expect(payload.check.result).toBe(result);
    expect(payload.check[issueField].length).toBeGreaterThan(0);
    if (result === 'pass') {
      expect(payload.check.errors).toEqual([]);
    }
  });
});
