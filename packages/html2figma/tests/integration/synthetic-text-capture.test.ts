import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createFigmaFile, extractSceneDocument } from '@galacean/html2figma';
import { flattenScene, loadHTMLFixture } from '../helpers/html-fixture';

describe('explicit synthetic text capture', () => {
  it('keeps editable text by default and only rasterizes missing synthetic styles when requested', async () => {
    const fixture = await loadHTMLFixture('regressions/synthetic-fonts');
    const base = { viewport: fixture.viewport, networkPolicy: 'offline', scriptPolicy: 'disabled' } as const;
    const editable = await extractSceneDocument(fixture.html, true, base);
    const captured = await extractSceneDocument(fixture.html, true, { ...base, rasterizeSyntheticText: true });
    const ordinary = flattenScene(editable.root);
    const images = flattenScene(captured.root).filter(node => node.type === 'image');

    expect(ordinary.filter(node => node.type === 'text')).toHaveLength(6);
    expect(ordinary.filter(node => node.type === 'image')).toHaveLength(0);
    expect(images.map(node => node.text)).toEqual([
      'Bold office AV 123', 'Italic office AV 123', 'Bold italic office 123',
    ]);
    expect(images.every(node => node.image?.startsWith('data:image/png;base64,') && node.width > 0)).toBe(true);
    expect(flattenScene(captured.root).filter(node => node.type === 'text')).toHaveLength(3);
    expect(captured.diagnostics.filter(diagnostic => diagnostic.code === 'TEXT_RASTERIZED')).toHaveLength(3);
    const result = await createFigmaFile([{ name: 'Synthesis', sceneData: captured.root }]);

    expect(result.validation.valid).toBe(true);
    expect(result.imageCount).toBe(3);
    expect(result.validation.warnings.filter(warning => warning.includes('not editable text'))).toHaveLength(3);
  });

  it('detects synthetic weight even when reported ink bounds do not expand', async () => {
    const bytes = await fs.readFile(new URL('../fixtures/html/assets/roboto-latin-400-normal.woff2', import.meta.url));
    const html = '<style>@font-face{font-family:Pixels;src:url(data:font/woff2;base64,' +
      bytes.toString('base64') + ');font-weight:400}span{font:700 16px Pixels}</style><span>Amount</span>';
    const document = await extractSceneDocument(html, true, {
      networkPolicy: 'offline', scriptPolicy: 'disabled', rasterizeSyntheticText: true,
    });

    expect(flattenScene(document.root).filter(node => node.type === 'image')).toHaveLength(1);
    expect(document.diagnostics.some(diagnostic => diagnostic.code === 'TEXT_RASTERIZED')).toBe(true);
  });

  it('selects style and weight before deciding whether an available family needs capture', async () => {
    const regular = await fs.readFile(new URL('../fixtures/html/assets/inter-latin-400-normal.woff2', import.meta.url));
    const italic = await fs.readFile(new URL('../fixtures/html/assets/roboto-latin-400-italic.woff2', import.meta.url));
    const html = '<style>@font-face{font-family:Mixed;src:url(data:font/woff2;base64,' +
      regular.toString('base64') + ');font-style:normal;font-weight:400}' +
      '@font-face{font-family:Mixed;src:url(data:font/woff2;base64,' + italic.toString('base64') +
      ');font-style:italic;font-weight:400}p{font:24px Mixed}</style>' +
      '<p style="font-weight:700">Synthetic bold</p><p style="font-style:italic">Actual italic</p>';
    const document = await extractSceneDocument(html, true, {
      networkPolicy: 'offline', scriptPolicy: 'disabled', rasterizeSyntheticText: true,
    });
    const nodes = flattenScene(document.root);

    expect(nodes.filter(node => node.type === 'image').map(node => node.text)).toEqual(['Synthetic bold']);
    expect(nodes.some(node => node.type === 'text' && node.text === 'Actual italic')).toBe(true);
  });

  it('does not infer synthesis from family labels', async () => {
    const fixture = await loadHTMLFixture('regressions/synthetic-fonts');
    const options = { viewport: fixture.viewport, networkPolicy: 'offline', scriptPolicy: 'disabled',
      rasterizeSyntheticText: true } as const;
    const first = await extractSceneDocument(fixture.html, true, options);
    const renamed = await extractSceneDocument(fixture.html.replaceAll('Proof Face', 'Company Display'), true, options);
    const images = (root: typeof first.root) => flattenScene(root)
      .filter(node => node.type === 'image').map(node => node.image);

    expect(images(renamed.root)).toEqual(images(first.root));
  });
});
