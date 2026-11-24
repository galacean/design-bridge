import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  storeSVGCaseSelection, readSVGCaseSelection, lastSVGCaseSelection, clearSVGCaseSelection, saveSVGSelectionDraft,
  listSVGCases, readSVGCase,
} from './case-api';

beforeEach(() => {
  const values = new Map<string, string>();

  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('explicit SVG multi-selection', () => {
  it('stores a full-sized selection without putting filenames in the navigation URL', () => {
    const names = Array.from({ length: 2000 }, (_value, index) => `case-${index}.svg`);
    const id = storeSVGCaseSelection('static', names);

    expect(id.length).toBeLessThan(100);
    expect(readSVGCaseSelection(id)).toEqual({ type: 'static', names });
    expect(lastSVGCaseSelection('static')).toEqual(names);
    clearSVGCaseSelection('static');
    expect(lastSVGCaseSelection('static')).toEqual([]);
  });

  it('retains unsubmitted drafts separately for static and dynamic cases', () => {
    saveSVGSelectionDraft('static', ['a.svg', 'b.svg']);
    saveSVGSelectionDraft('dynamic', ['motion.svg']);
    expect(lastSVGCaseSelection('static')).toEqual(['a.svg', 'b.svg']);
    expect(lastSVGCaseSelection('dynamic')).toEqual(['motion.svg']);
    saveSVGSelectionDraft('static', []);
    expect(lastSVGCaseSelection('static')).toEqual([]);
    expect(lastSVGCaseSelection('dynamic')).toEqual(['motion.svg']);
  });

  it('deduplicates selections and fails closed if they expire or are malformed', () => {
    const id = storeSVGCaseSelection('dynamic', ['a.svg', 'a.svg', 'b.svg']);

    expect(readSVGCaseSelection(id).names).toEqual(['a.svg', 'b.svg']);
    expect(() => readSVGCaseSelection('missing')).toThrow('多选范围已失效');
    sessionStorage.setItem(`svg-case-selection:${id}`, '{"type":"static","names":[1]}');
    expect(() => readSVGCaseSelection(id)).toThrow('多选范围格式无效');
  });
});

describe('SVG case sources', () => {
  it('does not silently turn the static failure list into the dynamic case pool', async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);
    await expect(listSVGCases('dynamic', '', undefined, 'fail')).rejects.toThrow('静态失败名单仅支持静态 SVG');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads SVG cases with the original URL, cancellation, and error message', async () => {
    const item = { name: '素材 / 示例.svg', type: 'dynamic' as const, pool: '', tag: '', note: '' };
    const signal = new AbortController().signal;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<svg/>'))
      .mockResolvedValueOnce(new Response('', { status: 404 }));

    vi.stubGlobal('fetch', fetchMock);
    expect(await readSVGCase(item, signal)).toBe('<svg/>');
    expect(fetchMock).toHaveBeenCalledWith(`/api/svg2ge/read-input/${encodeURIComponent(item.name)}?type=dynamic`, {
      signal,
    });
    await expect(readSVGCase(item, signal)).rejects.toThrow(`读取 ${item.name} 失败：HTTP 404`);
  });
});
