import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getFontFace: vi.fn() }));

vi.mock('../../src/core/font-resolution', () => ({
  getFontFace: mocks.getFontFace,
  getFontLayoutFace: mocks.getFontFace,
  getFontSourceFallbacks: () => ['fallback'],
  normalizeFontCacheKey: (...values: unknown[]) => JSON.stringify(values),
}));

import { ClipboardBlobStore } from '../../src/core/clipboard-blob-store';
import { GLYPH_BLOB_CACHE } from '../../src/core/glyph-encoding';
import { createNodeTextRuntimeDiagnostics, NODE_TEXT_CONVERSION_RUNTIME } from '../../src/core/text-conversion-runtime-node';

function face(familyName: string, missing = false) {
  return {
    familyName, unitsPerEm: 1000,
    glyphForCodePoint: (codePoint: number) => ({
      id: missing ? 0 : codePoint, name: missing ? '.notdef' : `glyph-${codePoint}`,
      path: { commands: [{ command: 'moveTo', args: [0, 0] }, { command: 'lineTo', args: [500, 700] }] },
    }),
  };
}

describe('Node text export diagnostics', () => {
  beforeEach(() => {
    GLYPH_BLOB_CACHE.clear();
    mocks.getFontFace.mockReset().mockReturnValue(face('Actual Face'));
  });

  it('records family changes without changing the encoded glyph bytes', () => {
    const diagnostics = createNodeTextRuntimeDiagnostics();
    const measured = new ClipboardBlobStore();
    const plain = new ClipboardBlobStore();

    diagnostics.runtime.resolveFontFamily('Requested Face', 'Regular', null, 400);
    diagnostics.runtime.getGlyphBlobIndex('Requested Face', 'Regular', 400, null, 'A', measured);
    GLYPH_BLOB_CACHE.clear();
    NODE_TEXT_CONVERSION_RUNTIME.getGlyphBlobIndex('Requested Face', 'Regular', 400, null, 'A', plain);

    expect(measured.blobs).toEqual(plain.blobs);
    expect(diagnostics.getWarnings()).toEqual([
      'Font resolution: requested "Requested Face", encoded "Actual Face" for "A".',
    ]);
  });

  it('reports the actual fallback face, including cache hits, without duplicating characters', () => {
    mocks.getFontFace.mockImplementation((_family, _style, source) =>
      source === 'primary' ? face('Primary', true) : face('Fallback'),
    );
    const first = createNodeTextRuntimeDiagnostics();
    const store = new ClipboardBlobStore();

    first.runtime.getGlyphBlobIndex('Primary', 'Regular', 400, 'primary', 'B', store);
    const second = createNodeTextRuntimeDiagnostics();

    second.runtime.getGlyphBlobIndex('Primary', 'Regular', 400, 'primary', 'B', store);
    second.runtime.getGlyphBlobIndex('Primary', 'Regular', 400, 'primary', 'B', store);
    expect(second.getWarnings()).toEqual(['Font resolution: requested "Primary", encoded "Fallback" for "B".']);
    expect(store.blobs).toHaveLength(1);
  });

  it('reports missing characters even when the existing encoder emits a notdef outline', () => {
    mocks.getFontFace.mockReturnValue(face('Primary', true));
    const diagnostics = createNodeTextRuntimeDiagnostics();

    expect(diagnostics.runtime.getGlyphBlobIndex('Primary', 'Regular', 400, null, 'X', new ClipboardBlobStore()))
      .not.toBeNull();
    expect(diagnostics.getWarnings()).toEqual(['Missing glyphs: "X".']);
  });

  it('reports unavailable faces and keeps reports isolated between exports', () => {
    mocks.getFontFace.mockReturnValue(null);
    const diagnostics = createNodeTextRuntimeDiagnostics();

    diagnostics.runtime.resolveFontFamily('Absent', 'Regular', null, 400);
    diagnostics.runtime.getGlyphBlobIndex('Absent', 'Regular', 400, null, 'X', new ClipboardBlobStore());
    expect(diagnostics.getWarnings()).toEqual(['Requested font unavailable: Absent.', 'Missing glyphs: "X".']);
    expect(createNodeTextRuntimeDiagnostics().getWarnings()).toEqual([]);
  });
});
