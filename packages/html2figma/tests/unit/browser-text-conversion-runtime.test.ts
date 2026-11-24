import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('fontkit', () => ({
  create: mocks.create,
}));

import { createFigmaFileFromSceneDocuments } from '../../src/browser-figma-file';
import { createBrowserTextConversionRuntime } from '../../src/core/text-conversion-runtime-browser';
import { createHTMLSceneDocument } from '../../src/model/html-scene-document';
import { makeSceneNode } from '../helpers/scene-factories';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FILE_SCHEMA_PATH = path.resolve(TEST_DIR, '../../data/figma-file-schema.bin');

function fixtureFont() {
  return {
    familyName: 'Fixture Sans',
    subfamilyName: 'Regular',
    unitsPerEm: 1000,
    layout: (text: string) => ({
      glyphs: Array.from(text, character => ({
        advanceWidth: character === ' ' ? 250 : 500,
      })),
      positions: Array.from(text, character => ({
        xAdvance: character === ' ' ? 250 : 500,
      })),
    }),
    glyphForCodePoint: (codePoint: number) => ({
      id: codePoint,
      name: `glyph-${codePoint}`,
      advanceWidth: 500,
      path: {
        commands: [
          { command: 'moveTo', args: [0, 0] },
          { command: 'lineTo', args: [500, 0] },
          { command: 'lineTo', args: [500, 700] },
          { command: 'closePath', args: [] },
        ],
      },
    }),
  };
}

function textDocument() {
  return createHTMLSceneDocument(makeSceneNode({
    name: 'Browser text scene',
    children: [makeSceneNode({
      type: 'text',
      name: 'Hello',
      text: 'Hello',
      styles: {
        fontFamily: 'Fixture Sans',
        fontStyle: 'normal',
        fontWeight: '400',
        fontSize: '16px',
      },
      ir: {
        figmaType: 'TEXT',
        opacity: 1,
        isAbsolute: false,
        fills: [],
        effects: [],
        clipsContent: false,
        flexGrow: 0,
        textProps: {
          fontFamily: 'Fixture Sans',
          fontSize: 16,
          fontWeight: 400,
          lineHeightPx: 20,
          letterSpacing: 0,
          color: { r: 0, g: 0, b: 0, a: 1 },
          textAlign: 'LEFT',
        },
      },
    })],
  }), {
    viewport: { width: 390, height: 844 },
    runtime: { kind: 'browser', engine: 'chromium' },
  });
}

describe('browser text conversion runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockReturnValue(fixtureFont());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reuses font candidate matching within a runtime and keeps style selection independent', async () => {
    const styleRead = vi.fn(() => 'Regular');
    const nameRead = vi.fn(() => 'Fixture Sans');
    const regular = {
      ...fixtureFont(),
      get subfamilyName() { return styleRead(); },
      get familyName() { return nameRead(); },
    };
    const bold = {
      ...fixtureFont(),
      subfamilyName: 'Bold',
      layout: () => ({ glyphs: [{ advanceWidth: 1000 }], positions: [{ xAdvance: 1000 }] }),
    };

    mocks.create.mockReturnValueOnce(regular).mockReturnValueOnce(bold);
    const { runtime } = await createBrowserTextConversionRuntime([], {
      fonts: [
        { family: 'Fixture Sans', bytes: Uint8Array.from([1]) },
        { family: 'Fixture Sans', style: 'Bold', bytes: Uint8Array.from([2]) },
      ],
      localFontAccess: 'disabled',
    });

    expect(runtime.computeCharWidths('Fixture Sans', 'Regular', 400, null, 'A', 16)).toEqual([8]);
    expect(runtime.resolveFontFamily('Fixture Sans', 'Regular', null, 400)).toBe('Fixture Sans');
    const reads = styleRead.mock.calls.length;
    const names = nameRead.mock.calls.length;

    for (let index = 0; index < 20; index++) {
      expect(runtime.computeCharWidths('Fixture Sans', 'Regular', 400, null, 'B', 16)).toEqual([8]);
      expect(runtime.resolveFontFamily('Fixture Sans', 'Regular', null, 400)).toBe('Fixture Sans');
    }
    expect(styleRead).toHaveBeenCalledTimes(reads);
    expect(nameRead).toHaveBeenCalledTimes(names);
    expect(runtime.computeCharWidths('Fixture Sans', 'Bold', 700, null, 'A', 16)).toEqual([16]);
  });

  it('reports the actual encoded family without changing successful export', async () => {
    mocks.create.mockReturnValue({ ...fixtureFont(), familyName: 'Actual Face' });
    const result = await createFigmaFileFromSceneDocuments(textDocument(), {
      compressedSchema: fs.readFileSync(FILE_SCHEMA_PATH),
      fonts: [{ family: 'Fixture Sans', bytes: Uint8Array.from([1]) }],
      localFontAccess: 'disabled',
    });

    expect(result.validation.valid).toBe(true);
    expect(result.validation.warnings).toContain(
      'Font resolution: requested "Fixture Sans", encoded "Actual Face".',
    );
  });

  it('identifies characters encoded with a fallback face', async () => {
    const primary = fixtureFont();
    const original = primary.glyphForCodePoint;

    primary.glyphForCodePoint = codePoint => codePoint === 66
      ? { ...original(codePoint), id: 0, name: '.notdef' } : original(codePoint);
    mocks.create.mockReturnValueOnce(primary).mockReturnValue({ ...fixtureFont(), familyName: 'Fallback Face' });
    const document = textDocument();

    document.root.children[0].text = 'AB';
    const result = await createFigmaFileFromSceneDocuments(document, {
      compressedSchema: fs.readFileSync(FILE_SCHEMA_PATH),
      fonts: [
        { family: 'Fixture Sans', bytes: Uint8Array.from([1]) },
        { family: 'Inter', bytes: Uint8Array.from([2]) },
      ],
      localFontAccess: 'disabled',
    });

    expect(result.validation.valid).toBe(true);
    expect(result.validation.warnings).toContain(
      'Font resolution: requested "Fixture Sans", encoded "Fallback Face" for "B".',
    );
  });

  it('does not warn when the requested and encoded families match', async () => {
    const result = await createFigmaFileFromSceneDocuments(textDocument(), {
      compressedSchema: fs.readFileSync(FILE_SCHEMA_PATH),
      fonts: [{ family: 'Fixture Sans', bytes: Uint8Array.from([1]) }],
      localFontAccess: 'disabled',
    });

    expect(result.validation.warnings.some(warning => warning.startsWith('Font resolution:'))).toBe(false);
  });

  it.each([[400, 'Italic'], [700, 'Bold Italic']] as const)(
    'selects the requested local face for weight %s and style %s', async (weight, style) => {
      const document = textDocument();
      const node = document.root.children[0];

      node.ir.textProps!.fontStyle = 'italic';
      node.ir.textProps!.fontWeight = weight;
      const regularBlob = vi.fn(async () => new Blob([Uint8Array.from([1])]));
      const italicBlob = vi.fn(async () => new Blob([Uint8Array.from([2])]));

      vi.stubGlobal('queryLocalFonts', async () => [
        { family: 'Fixture Sans', style: 'Regular', fullName: 'Fixture Sans Regular',
          postscriptName: 'FixtureSans-Regular', blob: regularBlob },
        { family: 'Fixture Sans', style, fullName: `Fixture Sans ${style}`,
          postscriptName: 'FixtureSans-Italic', blob: italicBlob },
      ]);
      await createBrowserTextConversionRuntime([{ name: 'Local font', sceneData: document.root }], {
        localFontAccess: 'required',
      });

      expect(italicBlob).toHaveBeenCalledOnce();
      expect(regularBlob).not.toHaveBeenCalled();
    },
  );

  it('uses supplied browser font bytes for metrics and glyph blobs', async () => {
    const { runtime } = await createBrowserTextConversionRuntime(
      [{ name: 'Browser text scene', sceneData: textDocument().root }],
      {
        fonts: [{
          family: 'Fixture Sans',
          style: 'Regular',
          bytes: Uint8Array.from([1, 2, 3]),
        }],
        localFontAccess: 'disabled',
      },
    );
    const result = await createFigmaFileFromSceneDocuments(textDocument(), {
      compressedSchema: fs.readFileSync(FILE_SCHEMA_PATH),
      fonts: [{
        family: 'Fixture Sans',
        style: 'Regular',
        bytes: Uint8Array.from([1, 2, 3]),
      }],
      localFontAccess: 'disabled',
    });

    expect(runtime.resolveFontFamily('Fixture Sans', 'Regular', null, 400)).toBe('Fixture Sans');
    expect(runtime.computeCharWidths('Fixture Sans', 'Regular', 400, null, 'AB', 16)).toEqual([8, 8]);
    expect(result.blobStats.byKind.glyph.references).toBe(4);
    expect(result.blobStats.byKind.glyph.unique).toBe(1);
  });

  it('uses and caches the requested variable weight for glyphs and advances', async () => {
    const varied = fixtureFont();

    varied.layout = (text: string) => ({
      glyphs: Array.from(text, () => ({ advanceWidth: 750 })),
      positions: Array.from(text, () => ({ xAdvance: 750 })),
    });
    const getVariation = vi.fn(() => varied);

    mocks.create.mockReturnValue({
      ...fixtureFont(), variationAxes: { wght: { min: 100, max: 900 } }, getVariation,
    });
    const { runtime } = await createBrowserTextConversionRuntime([], {
      fonts: [{ family: 'Fixture Sans', bytes: Uint8Array.from([1]) }],
      localFontAccess: 'disabled',
    });

    expect(runtime.computeCharWidths('Fixture Sans', 'SemiBold', 600, null, 'A', 16)).toEqual([12]);
    expect(runtime.computeCharWidths('Fixture Sans', 'SemiBold', 600, null, 'B', 16)).toEqual([12]);
    expect(getVariation).toHaveBeenCalledExactlyOnceWith({ wght: 600 });
  });

  it('rejects portable .fig output when visible text has no glyphs', async () => {
    mocks.create.mockImplementation(() => {
      throw new Error('Unsupported font');
    });

    await expect(createFigmaFileFromSceneDocuments(textDocument(), {
      compressedSchema: fs.readFileSync(FILE_SCHEMA_PATH),
      localFontAccess: 'disabled',
    })).rejects.toThrow('Browser Figma export could not generate glyphs for visible text');
  });

  it('encodes supplementary characters once without requesting surrogate glyphs', async () => {
    const document = textDocument();
    const requested: number[] = [];
    const font = fixtureFont();
    const original = font.glyphForCodePoint;

    font.glyphForCodePoint = codePoint => {
      requested.push(codePoint);

      return original(codePoint);
    };
    mocks.create.mockReturnValue(font);
    document.root.children[0].text = 'A𠮷B';
    const result = await createFigmaFileFromSceneDocuments(document, {
      compressedSchema: fs.readFileSync(FILE_SCHEMA_PATH),
      fonts: [{ family: 'Fixture Sans', bytes: Uint8Array.from([1]) }],
      localFontAccess: 'disabled',
    });

    expect(result.validation.valid).toBe(true);
    expect(requested).toContain(0x20bb7);
    expect(requested.some(code => code >= 0xd800 && code <= 0xdfff)).toBe(false);
  });

  it('rejects portable .fig output when only part of the text has glyphs', async () => {
    const font = fixtureFont();

    font.glyphForCodePoint = (codePoint: number) => codePoint === 'o'.codePointAt(0)
      ? {
          id: 0,
          name: '.notdef',
          advanceWidth: 500,
          path: { commands: [] },
        }
      : fixtureFont().glyphForCodePoint(codePoint);
    mocks.create.mockReturnValue(font);

    await expect(createFigmaFileFromSceneDocuments(textDocument(), {
      compressedSchema: fs.readFileSync(FILE_SCHEMA_PATH),
      fonts: [{
        family: 'Fixture Sans',
        bytes: Uint8Array.from([1, 2, 3]),
      }],
      localFontAccess: 'disabled',
    })).rejects.toThrow('Missing characters: o.');
  });

  it('allows callers to opt into editable-text fallback without glyphs', async () => {
    const result = await createFigmaFileFromSceneDocuments(textDocument(), {
      compressedSchema: fs.readFileSync(FILE_SCHEMA_PATH),
      localFontAccess: 'disabled',
      requireTextGlyphs: false,
    });

    expect(result.validation.valid).toBe(true);
    expect(result.blobStats.byKind.glyph.references).toBe(0);
  });
});
