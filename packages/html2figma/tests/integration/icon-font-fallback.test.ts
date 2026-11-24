import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { extractSceneDocument } from '@galacean/html2figma';
import { flattenScene } from '../helpers/html-fixture';

// Identical font bytes and CSS must not change semantics when their labels change.
describe('font and class name independence', () => {
  it.each(['OrdinaryFace', 'Material Icons', 'Lexicon Symbols'])('%s remains editable text', async family => {
    const font = await fs.readFile(new URL('../fixtures/html/assets/inter-latin-400-normal.woff2', import.meta.url));
    const html = `<style>@font-face{font-family:'${family}';` +
      `src:url(data:font/woff2;base64,${font.toString('base64')})}` +
      `body{margin:0}span{font:20px '${family}';display:inline-block;width:100px;height:24px}</style>` +
      '<span class="material-icons icon symbol">A</span>';
    const document = await extractSceneDocument(html, true, {
      networkPolicy: 'offline', scriptPolicy: 'disabled',
    });
    const nodes = flattenScene(document.root);
    const text = nodes.find(node => node.text === 'A');

    expect(text?.type).toBe('text');
    expect(text?.width).toBe(100);
    expect(nodes.filter(node => node.type === 'icon' || node.type === 'image')).toHaveLength(0);
  });

  it('retains mixed content and supplementary private-use characters regardless of classes', async () => {
    const glyph = String.fromCodePoint(0xf0001);
    const document = await extractSceneDocument('<div class="material-icons">home ' +
      `<span class="material-symbols">${glyph}</span><b>tail</b></div>`, true, {
      networkPolicy: 'offline', scriptPolicy: 'disabled',
    });
    const nodes = flattenScene(document.root);
    const text = nodes.filter(node => node.type === 'text').map(node => node.text).join(' ');

    expect(text).toContain('home');
    expect(text).toContain(glyph);
    expect(text).toContain('tail');
    expect(nodes.some(node => node.type === 'icon')).toBe(false);
  });
});

describe('measured text overflow', () => {
  it.each(['visible', 'hidden'])('preserves the host and measured text bounds with overflow:%s', async overflow => {
    const document = await extractSceneDocument('<style>body{margin:0}</style>' +
      `<span id="host" style="display:inline-block;width:8px;height:24px;overflow:${overflow};` +
      'font:20px Arial">overflow</span>', true, {
      networkPolicy: 'offline', scriptPolicy: 'disabled',
    });
    const host = flattenScene(document.root).find(node => node.name === 'host');

    expect(host?.type).toBe('frame');
    expect(host?.width).toBe(8);
    expect(host?.ir.clipsContent).toBe(overflow === 'hidden');
    expect(host?.children[0].type).toBe('text');
    expect(host?.children[0].text).toBe('overflow');
    expect(host?.children[0].width).toBeGreaterThan(8);
  });
});
