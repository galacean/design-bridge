import { describe, expect, it } from 'vitest';
import { composeClipboardHTML, parseArchive, parseClipboardHTML, writeArchive } from '../../src/core/kiwi-archive';

function decodeBase64(value: string): string {
  return Buffer.from(value, 'base64').toString();
}

describe('kiwi archive format', () => {
  it('writeArchive + parseArchive round trip preserves files', () => {
    const inputFiles = [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5, 6, 7])];

    const archive = writeArchive(inputFiles);
    const parsed = parseArchive(archive);

    expect(parsed.header.prelude).toBe('fig-kiwi');
    expect(parsed.header.version).toBe(20);
    expect(parsed.files).toHaveLength(2);
    expect(Array.from(parsed.files[0])).toEqual([1, 2, 3]);
    expect(Array.from(parsed.files[1])).toEqual([4, 5, 6, 7]);
  });

  it('parseArchive throws on invalid prelude', () => {
    const invalid = Uint8Array.from([0, 1, 2, 3, 4]);

    expect(() => parseArchive(invalid)).toThrow('Invalid fig-kiwi prelude');
  });
});

describe('clipboard HTML composition', () => {
  it('composeClipboardHTML embeds figmeta and figma markers', () => {
    const meta = { fileKey: '设计稿', pasteID: 123, dataType: 'scene' };
    const html = composeClipboardHTML(meta, Uint8Array.from([8, 9]));

    const metaMatch = html.match(/<!--\(figmeta\)([\s\S]*?)\(\/figmeta\)-->/);
    const figmaMatch = html.match(/<!--\(figma\)([\s\S]*?)\(\/figma\)-->/);

    expect(metaMatch).not.toBeNull();
    expect(figmaMatch).not.toBeNull();
    expect(decodeBase64(metaMatch![1])).toContain('"fileKey":"设计稿"');
    expect(Array.from(Buffer.from(figmaMatch![1], 'base64'))).toEqual([8, 9]);
    expect(parseClipboardHTML(html)).toEqual({ meta, figma: Uint8Array.from([8, 9]) });
  });
});
