import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { extractSceneFromDocument } from '../../src/core/extract-scene-from-document';
import { flattenScene } from '../helpers/html-fixture';

describe('color emoji extraction', () => {
  it('keeps transformed emoji bounds stable when CSS transitions are enabled', async () => {
    const browser = await chromium.launch();

    try {
      const page = await browser.newPage();

      await page.addInitScript({ content: 'window.__name = function(target) { return target; };' });
      await page.setContent('<!doctype html><body style="font:48px Arial">' +
        '<div style="display:inline-block;transform:rotate(-12deg);transition:transform 1s">🍗</div></body>');
      const expected = await page.locator('div').evaluate(element => {
        const range = document.createRange();

        range.selectNodeContents(element);
        const box = range.getBoundingClientRect();

        return { width: box.width, height: box.height };
      });
      const original = await page.locator('body').innerHTML();
      const scene = await page.evaluate(extractSceneFromDocument);
      const image = flattenScene(scene).find(node => node.tagName === 'CANVAS');

      expect(image?.width).toBeCloseTo(expected.width, 0);
      expect(image?.height).toBeCloseTo(expected.height, 0);
      expect(await page.locator('body').innerHTML()).toBe(original);
    } finally {
      await browser.close();
    }
  });

  it('captures rotated and scaled emoji without retaining unencodable text', async () => {
    const browser = await chromium.launch();

    try {
      const page = await browser.newPage();

      await page.addInitScript({ content: 'window.__name = function(target) { return target; };' });
      await page.setContent('<!doctype html><body style="font:48px Arial">' +
        '<div style="display:inline-block;transform:rotate(-12deg)">🍗</div>' +
        '<div style="transform:translate(12px,8px) scale(1.5);transform-origin:0 0">' +
        '<span>🍟</span></div></body>');
      const original = await page.locator('body').innerHTML();
      const scene = await page.evaluate(extractSceneFromDocument);
      const nodes = flattenScene(scene);
      const images = nodes.filter(node => node.tagName === 'CANVAS');

      expect(images).toHaveLength(2);
      expect(images.every(node => node.image?.startsWith('data:image/png;base64,'))).toBe(true);
      expect(nodes.filter(node => node.type === 'text')).toHaveLength(0);
      const paintedPixels = await page.evaluate(async urls => Promise.all(urls.map(async url => {
        const image = new Image();

        image.src = url!;
        await image.decode();
        const canvas = document.createElement('canvas');

        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;

        context.drawImage(image, 0, 0);

        return context.getImageData(0, 0, image.width, image.height).data
          .filter((alpha, index) => index % 4 === 3 && alpha > 0).length;
      })), images.map(node => node.image));

      expect(paintedPixels.every(count => count > 100)).toBe(true);
      expect(await page.locator('body').innerHTML()).toBe(original);
    } finally {
      await browser.close();
    }
  });

  it('captures complete emoji graphemes as images, retains editable text, and restores the source DOM', async () => {
    const browser = await chromium.launch();

    try {
      const page = await browser.newPage();

      await page.addInitScript({ content: 'window.__name = function(target) { return target; };' });
      await page.setContent('<!doctype html><body style="font:24px Arial">' +
        '<p>Before 🍟 after</p><p>❤️</p><p>👩🏽‍💻</p><p>🇨🇳</p><p>1️⃣</p>' +
        '<script type="application/json">{"emoji":"🍟"}</script></body>');
      const originalHTML = await page.locator('body').innerHTML();
      const originalBoxes = await page.locator('p').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect();

        return { y: rect.y, height: rect.height };
      }));
      const scene = await page.evaluate(extractSceneFromDocument);
      const nodes = flattenScene(scene);
      const images = nodes.filter(node => node.tagName === 'CANVAS');

      expect(images).toHaveLength(5);
      expect(images.every(node => node.image?.startsWith('data:image/png;base64,'))).toBe(true);
      expect(nodes.filter(node => node.type === 'text').map(node => node.text).join('')).toBe('Before  after');
      expect(await page.locator('body').innerHTML()).toBe(originalHTML);
      const paragraphs = nodes.filter(node => node.tagName === 'P' && node.type === 'frame');

      expect(paragraphs).toHaveLength(originalBoxes.length);
      for (const [index, node] of paragraphs.entries()) {
        expect(node.y).toBeCloseTo(originalBoxes[index].y, 0);
        expect(node.height).toBeCloseTo(originalBoxes[index].height, 0);
      }
    } finally {
      await browser.close();
    }
  });
});
