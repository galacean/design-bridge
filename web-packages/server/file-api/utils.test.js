import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readRequestBody } from './utils.js';

describe('request body decoding', () => {
  it('preserves UTF-8 characters split across network chunks', async () => {
    const body = JSON.stringify({ name: '金币' });
    const bytes = Buffer.from(body);
    const split = bytes.indexOf(Buffer.from('金')) + 1;
    const request = Readable.from([bytes.subarray(0, split), bytes.subarray(split)]);

    expect(await readRequestBody(request)).toBe(body);
  });
});
