import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { extractScene } from '@galacean/html2figma';

describe('in-memory Canvas capture', () => {
  it('freezes Canvas pixels before temporary DOM mutations can invalidate the source bitmap', async () => {
    const scene = await extractScene('<!doctype html><body style="margin:0"><span>🍟</span>' +
      '<canvas id="painted" aria-label="painted" width="20" height="20"></canvas><script>' +
      'const canvas=document.querySelector("canvas"),c=canvas.getContext("2d");' +
      'c.fillStyle="blue";c.fillRect(0,0,20,20);' +
      'new MutationObserver(()=>c.clearRect(0,0,20,20)).observe(document.body,{childList:true,subtree:true});' +
      '</script></body>', true, { networkPolicy: 'offline' });
    const image = scene.children.find(node => node.name === 'painted')?.image;

    expect(image?.startsWith('data:image/png;base64,')).toBe(true);
    const browser = await chromium.launch();

    try {
      const page = await browser.newPage();
      const pixel = await page.evaluate(async source => {
        const image = new Image();

        image.src = source!;
        await image.decode();
        const canvas = document.createElement('canvas');

        canvas.width = 20;
        canvas.height = 20;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;

        context.drawImage(image, 0, 0);

        return Array.from(context.getImageData(10, 10, 1, 1).data);
      }, image);

      expect(pixel).toEqual([0, 0, 255, 255]);
    } finally {
      await browser.close();
    }
  });

  it('copies pixels and object-fit without fetching or decoding the Canvas as an image resource', async () => {
    const scene = await extractScene('<!doctype html><head>' +
      '<meta http-equiv="Content-Security-Policy" content="connect-src \'none\'">' +
      '</head><body style="margin:0">' +
      '<canvas id="contained" width="40" height="20" style="width:20px;height:20px;object-fit:contain"></canvas>' +
      '<canvas id="covered" width="40" height="20" style="width:20px;height:20px;' +
      'object-fit:cover;object-position:right center;opacity:.5"></canvas>' +
      '<script>for(const canvas of document.querySelectorAll("canvas")){' +
      'const c=canvas.getContext("2d");c.fillStyle="red";c.fillRect(0,0,20,20);' +
      'c.fillStyle="blue";c.fillRect(20,0,20,20);}</script></body>', true, { networkPolicy: 'offline' });
    const images = scene.children.filter(node => node.type === 'image');

    expect(images).toHaveLength(2);
    expect(images.every(node => node.image?.startsWith('data:image/png;base64,'))).toBe(true);
    expect(images[1].ir.opacity).toBe(0.5);
    const browser = await chromium.launch();

    try {
      const page = await browser.newPage();
      const pixels = await page.evaluate(async sources => Promise.all(sources.map(async source => {
        const image = new Image();

        image.src = source!;
        await image.decode();
        const canvas = document.createElement('canvas');

        canvas.width = 20;
        canvas.height = 20;
        const context = canvas.getContext('2d')!;

        context.drawImage(image, 0, 0);

        return [[2, 2], [2, 10], [18, 10]].map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
      })), images.map(node => node.image));

      expect(pixels).toEqual([
        [[0, 0, 0, 0], [255, 0, 0, 255], [0, 0, 255, 255]],
        [[0, 0, 255, 255], [0, 0, 255, 255], [0, 0, 255, 255]],
      ]);
    } finally {
      await browser.close();
    }
  });
});
