import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { createFigmaFile, extractSceneDocument } from '@galacean/html2figma';
import { decodeFigmaFileNodes } from '../helpers/decode-figma-file';
import { flattenScene, isRecord, loadHTMLFixture } from '../helpers/html-fixture';

describe('browser measured text placement', () => {
  it.each(['', 'html { font-family: Arial; }'])('matches inherited metrics for root CSS %s', async rootCSS => {
    const document = await extractSceneDocument(`<!doctype html><style>${rootCSS}</style><body style="margin:0">` +
      '<article style="display:flex;flex-direction:column;width:320px">' +
      '<h2 style="font-size:24px;font-weight:700;line-height:32px">Default heading</h2>' +
      '</article></body>', true, { networkPolicy: 'offline', scriptPolicy: 'disabled' });
    const text = flattenScene(document.root).find(node => node.text === 'Default heading');

    expect(text).toBeDefined();
    expect(text?.textMetrics?.charWidths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(text!.width, 0);
    if (rootCSS !== '') {
      expect(text?.ir.textProps?.fontFamily).toBe('Arial');
    }
  });

  it('scales text metrics with positive uniform CSS transforms', async () => {
    const document = await extractSceneDocument('<!doctype html><body>' +
      '<div style="transform:scale(.9);transform-origin:0 0">' +
      '<span style="font:20px Arial">Scaled</span><div style="font:20px Arial">Mixed <b>child</b></div>' +
      '</div></body>', true, { networkPolicy: 'offline', scriptPolicy: 'disabled' });
    const texts = flattenScene(document.root).filter(node => node.type === 'text');

    expect(texts.length).toBeGreaterThan(0);
    for (const node of texts) {
      expect(node.ir.textProps?.fontSize).toBeCloseTo(18);
      expect(node.textMetrics?.charWidths.reduce((sum, width) => sum + width, 0))
        .toBeLessThanOrEqual(node.width + 1);
    }
  });

  it('measures leaf italic and bold italic text with the browser-selected font style', async () => {
    const fixture = await loadHTMLFixture('regressions/italic-text');
    const browser = await chromium.launch();

    try {
      const page = await browser.newPage({ viewport: fixture.viewport });

      await page.setContent(fixture.html);
      await page.evaluate(() => document.fonts.ready);
      const expected = await page.locator('span').evaluateAll(spans => spans.map(span => {
        const style = getComputedStyle(span);
        const context = document.createElement('canvas').getContext('2d')!;
        const text = span.textContent ?? '';

        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

        return { text, width: context.measureText(text).width };
      }));
      const sceneDocument = await extractSceneDocument(fixture.html, true, {
        viewport: fixture.viewport, networkPolicy: 'offline', scriptPolicy: 'disabled',
      });
      const texts = flattenScene(sceneDocument.root).filter(node => node.type === 'text');

      for (const measured of expected) {
        const node = texts.find(text => text.text === measured.text);

        expect(node?.textMetrics?.charWidths.reduce((sum, width) => sum + width, 0))
          .toBeCloseTo(measured.width, 3);
        expect(node?.textMetrics?.characterPositions).toHaveLength(measured.text.length);
      }
    } finally {
      await browser.close();
    }
  });

  it('keeps decorated leaf text on the existing layout path', async () => {
    const sceneDocument = await extractSceneDocument('<!doctype html><body style="font:20px Arial">' +
      '<span style="padding:4px">Padded</span><span style="border:1px solid red">Bordered</span>' +
      '<span>Plain</span></body>', true, { networkPolicy: 'offline', scriptPolicy: 'disabled' });
    const texts = flattenScene(sceneDocument.root).filter(node => node.type === 'text');

    expect(texts).toHaveLength(3);
    expect(texts[0].textMetrics?.characterPositions).toBeUndefined();
    expect(texts[1].textMetrics?.characterPositions).toBeUndefined();
    expect(texts[0].textMetrics?.baselineOffset).toBeGreaterThan(0);
    expect(texts[1].textMetrics?.baselineOffset).toBeGreaterThan(0);
    expect(texts[2].textMetrics?.characterPositions).toHaveLength(5);
  });

  it('does not measure decorated baselines through vertical text or transformed ancestors', async () => {
    const sceneDocument = await extractSceneDocument('<!doctype html><body style="font:20px Arial">' +
      '<span style="padding:4px;writing-mode:vertical-rl">Vertical</span>' +
      '<div style="transform:translateX(20px)"><span style="padding:4px">Transformed</span></div>' +
      '</body>', true, { networkPolicy: 'offline', scriptPolicy: 'disabled' });
    const texts = flattenScene(sceneDocument.root).filter(node => node.type === 'text');

    expect(texts).toHaveLength(2);
    expect(texts.every(node => node.textMetrics?.baselineOffset === undefined)).toBe(true);
  });

  it('keeps native line boundaries and baselines in the exported FIG', async () => {
    const fixture = await loadHTMLFixture('regressions/measured-text');
    const browser = await chromium.launch();

    try {
      const page = await browser.newPage({ viewport: fixture.viewport });

      await page.addInitScript({ content: 'window.__name = function(target) { return target; };' });
      await page.setContent(fixture.html);
      await page.evaluate(() => document.fonts.ready);
      const expected = await page.evaluate(() => {
        const paragraph = document.querySelector('#wrap p')!;
        const range = document.createRange();

        range.selectNodeContents(paragraph);
        const box = range.getBoundingClientRect();
        const style = getComputedStyle(paragraph);
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;

        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const ascent = context.measureText(paragraph.textContent ?? '').fontBoundingBoxAscent;

        return Array.from(range.getClientRects(), rect => ({
          x: rect.x - box.x, y: rect.y - box.y + ascent, width: rect.width,
        }));
      });
      const sceneDocument = await extractSceneDocument(fixture.html, true, {
        viewport: fixture.viewport, networkPolicy: 'offline', scriptPolicy: 'disabled',
      });
      const source = flattenScene(sceneDocument.root).find(node => node.type === 'text' && node.text?.startsWith('Measure'));

      expect(source?.textMetrics?.characterPositions).toHaveLength(source?.text?.length ?? 0);
      const result = await createFigmaFile([{ name: fixture.id, sceneData: sceneDocument.root }]);
      const nodes = await decodeFigmaFileNodes(result.bytes);
      const bold = nodes.find(node => isRecord(node.textData) && node.textData.characters === 'Bold text 700');
      const fallback = nodes.find(node => isRecord(node.textData) &&
        node.textData.characters === 'Fallback text uses the available font.');

      expect(bold?.fontName).toMatchObject({ family: 'Inter', style: 'Bold' });
      expect(fallback?.fontName).toMatchObject({ family: 'Inter', style: 'Regular' });
      const text = nodes.find(node => isRecord(node.textData) && node.textData.characters === source?.text);

      expect(text?.textAutoResize).toBe('NONE');
      if (!isRecord(text?.derivedTextData) || !Array.isArray(text.derivedTextData.baselines)) {
        throw new Error('Missing exported text baselines.');
      }
      expect(text.derivedTextData.baselines).toHaveLength(expected.length);
      text.derivedTextData.baselines.forEach((line: unknown, index: number) => {
        if (!isRecord(line) || !isRecord(line.position)) {
          throw new Error('Invalid exported baseline.');
        }
        expect(line.position.x).toBeCloseTo(expected[index].x, 2);
        expect(line.position.y).toBeCloseTo(expected[index].y, 2);
        expect(line.width).toBeCloseTo(expected[index].width, 1);
      });
    } finally {
      await browser.close();
    }
  });

  it('retains the existing fallback for RTL, vertical text, combining marks, and surrogate pairs', async () => {
    const document = await extractSceneDocument('<!doctype html><body style="font:20px Arial">' +
      '<p dir="rtl">Arabic direction</p><p style="writing-mode:vertical-rl">Vertical text</p>' +
      '<p>A𠮷B</p><p>Cafe\u0301</p><p>Ordinary text</p></body>', true, { networkPolicy: 'offline' });
    const texts = flattenScene(document.root).filter(node => node.type === 'text');

    expect(texts).toHaveLength(5);
    for (const node of texts.slice(0, 4)) {
      expect(node.textMetrics?.characterPositions, node.text ?? '').toBeUndefined();
    }
    expect(texts[4].textMetrics?.characterPositions).toHaveLength('Ordinary text'.length);
  });

  it('does not replace a preceding system font with a later web font', async () => {
    const fixture = await loadHTMLFixture('regressions/measured-text');
    const sceneDocument = await extractSceneDocument(
      fixture.html.replace("'Absent Fixture Font', Inter", 'Arial, Inter'), true,
      { viewport: fixture.viewport, networkPolicy: 'offline', scriptPolicy: 'disabled' },
    );
    const fallback = flattenScene(sceneDocument.root).find(node => node.text?.startsWith('Fallback text'));

    expect(fallback).toBeDefined();
    expect(fallback?.fontSource).toBeNull();
  });
});
