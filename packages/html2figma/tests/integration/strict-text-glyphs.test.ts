import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createFigmaFile, createHTMLSceneDocument } from '@galacean/html2figma';
import { createFigmaFileFromSceneDocuments } from '@galacean/html2figma/browser/file';
import { makeSceneNode } from '../helpers/scene-factories';

const assets = new URL('../fixtures/html/assets/', import.meta.url);
const inter = fileURLToPath(new URL('inter-latin-400-normal.woff2', assets));
const noto = fileURLToPath(new URL('noto-sans-sc-variable-subset.woff2', assets));
const roboto = fileURLToPath(new URL('roboto-latin-400-normal.woff2', assets));

function scene(text: string, sources = [inter], family = 'Inter') {
  return makeSceneNode({ children: [makeSceneNode({
    type: 'text', text, name: 'Text', fontSource: sources[0], fontSources: sources,
    ir: {
      figmaType: 'TEXT', opacity: 1, isAbsolute: false, fills: [], effects: [], clipsContent: false, flexGrow: 0,
      textProps: {
        fontFamily: family, fontSize: 16, fontWeight: 400, lineHeightPx: 20,
        letterSpacing: 0, color: { r: 0, g: 0, b: 0, a: 1 }, textAlign: 'LEFT',
      },
    },
  })] });
}

async function exportBrowser(root: ReturnType<typeof scene>, requireTextGlyphs = true) {
  const document = createHTMLSceneDocument(root, {
    viewport: { width: 320, height: 200 }, runtime: { kind: 'browser', engine: 'chromium' },
  });

  return createFigmaFileFromSceneDocuments(document, {
    compressedSchema: await fs.readFile(new URL('../../data/figma-file-schema.bin', import.meta.url)),
    fonts: [
      { family: 'Inter', bytes: await fs.readFile(inter) },
      { family: 'Noto Sans SC', bytes: await fs.readFile(noto) },
      { family: 'Roboto', bytes: await fs.readFile(roboto) },
    ],
    localFontAccess: 'disabled', requireTextGlyphs,
  });
}

describe('strict glyph coverage with real local fonts', () => {
  const absent = String.fromCodePoint(0x10ffff);

  it('preserves Node compatibility by default and rejects missing glyphs when enabled', async () => {
    const input = [{ name: 'Missing', sceneData: scene(`A${absent}`) }];
    const compatible = await createFigmaFile(input);

    expect(compatible.validation.valid).toBe(true);
    expect(compatible.validation.warnings).toContain(`Missing glyphs: ${JSON.stringify(absent)}.`);
    await expect(createFigmaFile(input, { requireTextGlyphs: true })).rejects.toThrow(`Missing characters: ${absent}`);
  });

  it('rejects the same missing character in Browser and permits the explicit escape hatch', async () => {
    await expect(exportBrowser(scene(absent))).rejects.toThrow(`Missing characters: ${absent}`);
    const compatible = await exportBrowser(scene(absent), false);

    expect(compatible.validation.warnings).toContain(`Missing glyphs: ${JSON.stringify(absent)}.`);
  });

  it('accepts real Latin/CJK fallback on both ends', async () => {
    const root = scene('A你好', [inter, noto]);
    const node = await createFigmaFile([{ name: 'Mixed', sceneData: root }], { requireTextGlyphs: true });
    const browser = await exportBrowser(scene('A你好', [inter, noto]));

    expect(node.validation.valid).toBe(true);
    expect(browser.validation.valid).toBe(true);
    for (const result of [node, browser]) {
      expect(result.validation.warnings.some(warning => warning.includes('Missing glyphs'))).toBe(false);
      expect(result.validation.warnings.some(warning => warning.includes('Noto Sans SC'))).toBe(true);
    }
  });

  it('accepts covered ligature text without equating coverage with shaping fidelity', async () => {
    const bytes = await fs.readFile(roboto);
    const face = fontkit.create(bytes);

    if ('fonts' in face) {
      throw new Error('Expected a single Roboto face.');
    }
    // This fixture genuinely exercises a font with an ffi substitution.
    expect(face.layout('ffi').glyphs).toHaveLength(1);
    const node = await createFigmaFile([{ name: 'Ligatures', sceneData: scene('office ffi', [roboto], 'Roboto') }], {
      requireTextGlyphs: true,
    });
    const browser = await exportBrowser(scene('office ffi', [roboto], 'Roboto'));

    expect(node.validation.valid).toBe(true);
    expect(browser.validation.valid).toBe(true);
  });

  it('keeps covered FIG canvas bytes identical when strict checking is enabled', async () => {
    const input = [{ name: 'Covered', sceneData: scene('Hello') }];
    const compatible = await createFigmaFile(input);
    const strict = await createFigmaFile(input, { requireTextGlyphs: true });
    const before = await JSZip.loadAsync(compatible.bytes);
    const after = await JSZip.loadAsync(strict.bytes);

    expect(await after.file('canvas.fig')?.async('uint8array'))
      .toEqual(await before.file('canvas.fig')?.async('uint8array'));
    expect(strict.blobStats).toEqual(compatible.blobStats);
  });

  it('accepts whitespace-only and empty scenes in strict mode', async () => {
    for (const text of ['', ' \n\t']) {
      const result = await createFigmaFile([{ name: 'Empty', sceneData: scene(text) }], { requireTextGlyphs: true });

      expect(result.validation.valid).toBe(true);
    }
  });
});
