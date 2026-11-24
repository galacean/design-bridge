import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { extractScene } from '../../src/core/extract-scene';
import { extractSceneFromDocument } from '../../src/core/extract-scene-from-document';
import { rebaseScene } from '../../src/core/rebase-scene';
import type { FigmaIRGradientFill, SceneNode } from '../../src/types';

const HTML = `<!doctype html>
<html>
  <head>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; min-height: 100%; font-family: Arial, sans-serif; }
      body { padding: 24px; background: #f4f5f7; }
      main { display: flex; width: 320px; flex-direction: column; gap: 12px; padding: 20px; }
      .row { display: flex; align-items: center; justify-content: space-between; }
      .stripe { width: 260px; height: 120px; background: repeating-linear-gradient(90deg, #f00 0 20px, #00f 20px 40px); }
      h1 { margin: 0; font-size: 24px; line-height: 30px; }
    </style>
  </head>
  <body>
    <main id="parity-card">
      <h1>Runtime parity</h1>
      <div class="row"><span>Browser</span><span>Node</span></div>
      <div id="stripe" class="stripe"></div>
    </main>
  </body>
</html>`;

describe('Browser and Node runtime parity', () => {
  it('captures SVG and original tiny image bytes with input scripts disabled', async () => {
    const source = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8AQMAAACXY+zr' +
      'AAAAA1BMVEUAZv+53x52AAAAEUlEQVQoz2NgGAWjYBQMVQAAA8AAAXZcbLQAAAAASUVORK5CYII=';
    const scene = await extractScene('<!doctype html><body>' +
      `<img id="tiny" alt="tiny" src="${source}" style="width:2px;height:2px;background:red">` +
      '<svg id="vector" xmlns="http://www.w3.org/2000/svg" width="40" height="40">' +
      '<rect width="40" height="40" fill="blue"/></svg>' +
      '<script>document.body.dataset.executed="yes"</script></body>', true, {
      networkPolicy: 'offline', scriptPolicy: 'disabled', timeoutMs: 8000,
    });

    expect(scene.children.find(node => node.name === 'tiny')?.image).toBe(source);
    expect(scene.children.find(node => node.name === 'vector')?.image).toMatch(/^data:image\/png;base64,/);
  });

  it('does not turn non-text input values into visible text', async () => {
    const scene = await extractScene('<!doctype html><body>' +
      '<input id="agree" type="checkbox" value="not-visible-checkbox-value">' +
      '<input id="option" type="radio" value="not-visible-radio-value">' +
      '<input id="range" type="range" value="42">' +
      '<input id="color" type="color" value="#ff0000">' +
      '<input id="search" value="Visible search">' +
      '</body>', true, { networkPolicy: 'offline' });

    for (const name of ['agree', 'option', 'range', 'color']) {
      const node = scene.children.find(child => child.name === name);

      expect(node).toMatchObject({ type: 'frame', text: '' });
    }
    expect(scene.children.find(child => child.name === 'search')).toMatchObject({ type: 'text', text: 'Visible search' });
  });

  it('captures Canvas pixels and video posters while excluding media fallback text', async () => {
    const poster = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">' +
      '<path fill="red" d="M0 0h20v20H0z"/><path fill="blue" d="M20 0h20v20H20z"/></svg>',
    );
    const scene = await extractScene('<!doctype html><body style="margin:0">' +
      '<canvas width="40" height="20" style="width:20px;height:20px;object-fit:contain">Hidden Canvas text</canvas>' +
      `<video poster="${poster}" style="width:20px;height:20px;object-fit:cover;object-position:right center">` +
      'Hidden video text</video><video id="empty-video" style="width:20px;height:20px">Hidden fallback</video>' +
      '<script>const canvas=document.querySelector("canvas");const c=canvas.getContext("2d");' +
      'c.fillStyle="red";c.fillRect(0,0,40,20);' +
      'canvas.setAttribute("aria-label","painted-"+Array.from(c.getImageData(0,0,1,1).data).join("-"));' +
      '</script></body>', true, { networkPolicy: 'offline' });
    const browser = await chromium.launch({ headless: true });

    try {
      const images = scene.children.filter(node => node.type === 'image');
      const page = await browser.newPage();
      const pixels = await page.evaluate(async sources => Promise.all(sources.map(async source => {
        const image = new Image();

        image.src = source;
        await image.decode();
        const canvas = document.createElement('canvas');

        canvas.width = 20;
        canvas.height = 20;
        const context = canvas.getContext('2d')!;

        context.drawImage(image, 0, 0, 20, 20);

        return [2, 10].map(y => Array.from(context.getImageData(10, y, 1, 1).data));
      })), images.map(node => node.image ?? ''));

      expect(images).toHaveLength(2);
      expect(images[0].name).toBe('painted-255-0-0-255');
      expect(pixels).toEqual([[[0, 0, 0, 0], [255, 0, 0, 255]], [[0, 0, 255, 255], [0, 0, 255, 255]]]);
      expect(scene.children.find(node => node.name === 'empty-video')).toMatchObject({ type: 'frame', children: [] });
      expect(JSON.stringify(scene)).not.toContain('Hidden');
    } finally {
      await browser.close();
    }
  });

  it('measures a direct text range baseline without adding line-box leading', async () => {
    const scene = await extractScene('<!doctype html><div style="font:16px Arial;line-height:40px">Baseline</div>', true);
    const findText = (node: SceneNode): SceneNode | undefined => node.type === 'text'
      ? node : node.children.map(findText).find(child => child !== undefined);
    const text = findText(scene);

    expect(text?.textMetrics?.baselineOffset).toBeGreaterThan(0);
    expect(text?.textMetrics?.baselineOffset).toBe(text?.textMetrics?.ascent);
  });

  it('preserves inherited SVG colors and stylesheet strokes in standalone images', async () => {
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();

      await page.addInitScript({ content: 'window.__name = function(target) { return target; };' });
      await page.setContent('<style>.icon{color:rgb(255,0,0);opacity:.5} .icon rect{fill:currentColor;' +
        'stroke:rgb(0,0,255);stroke-width:10px}</style><svg class="icon" width="100" height="100" ' +
        'xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="90" height="90"/></svg>');
      const scene = await page.evaluate(extractSceneFromDocument);
      const icon = scene.children.find(node => node.type === 'svg');
      const pixels = await page.evaluate(async source => {
        const image = new Image();

        image.src = source;
        await image.decode();
        const canvas = document.createElement('canvas');

        canvas.width = 100;
        canvas.height = 100;
        const context = canvas.getContext('2d')!;

        context.drawImage(image, 0, 0, 100, 100);

        return [50, 5].map(x => Array.from(context.getImageData(x, 50, 1, 1).data));
      }, icon?.image ?? '');

      expect(pixels).toEqual([[255, 0, 0, 255], [0, 0, 255, 255]]);
      expect(icon?.ir.opacity).toBe(0.5);
      expect(await page.locator('svg').getAttribute('style')).toBeNull();
    } finally {
      await browser.close();
    }
  });

  it('bakes object-fit and object-position without stretching the source image', async () => {
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
        '<path fill="red" d="M0 0h100v100H0z"/><path fill="blue" d="M100 0h100v100H100z"/></svg>';
      const source = `data:image/svg+xml,${encodeURIComponent(svg)}`;

      await page.addInitScript({ content: 'window.__name = function(target) { return target; };' });
      await page.setContent(`<html><body style="margin:0">` +
        `<img id="crop" src="${source}" style="width:100px;height:100px;object-fit:cover;object-position:right center">` +
        `<img id="contain" src="${source}" style="width:100px;height:100px;object-fit:contain">` +
        '</body></html>');
      const scene = await page.evaluate(extractSceneFromDocument);
      const images = scene.children.filter(node => node.type === 'image');
      const pixels = await page.evaluate(async sources => Promise.all(sources.map(async url => {
        const image = new Image();

        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');

        canvas.width = 100;
        canvas.height = 100;
        const context = canvas.getContext('2d')!;

        context.drawImage(image, 0, 0);

        return Array.from(context.getImageData(25, 10, 1, 1).data);
      })), images.map(node => node.image ?? ''));

      expect(pixels[0]).toEqual([0, 0, 255, 255]);
      expect(pixels[1]).toEqual([0, 0, 0, 0]);
    } finally {
      await browser.close();
    }
  });

  it('produces the same normalized Scene IR in the same Chromium version', async () => {
    const nodeScene = await extractScene(HTML, true, { viewport: { width: 390, height: 844 } });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

      await page.addInitScript({ content: 'window.__name = function(target) { return target; };' });
      await page.setContent(HTML);
      await page.waitForLoadState('networkidle');

      const browserScene = await page.evaluate(extractSceneFromDocument);
      const stripe = findNode(browserScene, 'stripe');
      const gradient = stripe?.ir.fills.find(
        (fill): fill is FigmaIRGradientFill => fill.type === 'GRADIENT_LINEAR',
      );

      rebaseScene(browserScene);

      expect(gradient?.type).toBe('GRADIENT_LINEAR');
      expect(gradient?.stops.length).toBeGreaterThan(20);
      expect(gradient?.stops.at(-1)?.position).toBe(1);
      expect(normalizeSceneValue(browserScene)).toEqual(normalizeSceneValue(nodeScene));
    } finally {
      await browser.close();
    }
  });
});

function findNode(root: SceneNode, name: string): SceneNode | undefined {
  if (root.name === name) {
    return root;
  }
  for (const child of root.children) {
    const match: SceneNode | undefined = findNode(child, name);

    if (match !== undefined) {
      return match;
    }
  }

  return undefined;
}

function normalizeSceneValue(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 1_000) / 1_000 : value;
  }
  if (typeof value === 'string' && value.startsWith('data:')) {
    return value.slice(0, value.indexOf(','));
  }
  if (Array.isArray(value)) {
    return value.map(normalizeSceneValue);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, normalizeSceneValue(entry)]),
    );
  }

  return value;
}
