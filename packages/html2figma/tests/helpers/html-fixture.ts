import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright';
import type { SceneNode } from '@galacean/html2figma';

const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/html/', import.meta.url));

export interface HTMLFixtureTarget {
  id: string;
  selector: string;
  sceneName: string;
  requiresImage: boolean;
  knownLoss?: string;
}

export interface HTMLFixture {
  id: string;
  html: string;
  viewport: { width: number; height: number };
  scriptPolicy: 'trusted' | 'disabled';
  targets: HTMLFixtureTarget[];
}

export interface HTMLReference {
  origin: { x: number; y: number };
  targets: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    texts: string[];
    textRegions: Array<{ x: number; y: number; width: number; height: number }>;
  }>;
  screenshot: Buffer;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringField(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Fixture fields must be non-empty strings.');
  }

  return value;
}

function positiveDimension(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Fixture viewport dimensions must be positive integers.');
  }

  return value;
}

export async function loadHTMLFixture(relativePath: string): Promise<HTMLFixture> {
  const directory = path.join(FIXTURE_ROOT, relativePath);
  const config: unknown = JSON.parse(await fs.readFile(path.join(directory, 'case.json'), 'utf8'));

  if (!isRecord(config) || !isRecord(config.viewport) || !Array.isArray(config.targets)) {
    throw new Error('Invalid HTML fixture manifest.');
  }
  if (config.scriptPolicy !== 'trusted' && config.scriptPolicy !== 'disabled') {
    throw new Error('Fixture script policy must be explicit.');
  }
  let html = await fs.readFile(path.join(directory, 'index.html'), 'utf8');

  if (isRecord(config.resources)) {
    for (const [url, resourcePath] of Object.entries(config.resources)) {
      const file = await fs.readFile(path.join(FIXTURE_ROOT, stringField(resourcePath)));

      const mimeType = path.extname(stringField(resourcePath)) === '.png' ? 'image/png' : 'font/woff2';

      html = html.replaceAll(url, `data:${mimeType};base64,${file.toString('base64')}`);
    }
  }
  const targets = config.targets.map((target: unknown): HTMLFixtureTarget => {
    if (!isRecord(target)) {
      throw new Error('Invalid fixture target.');
    }

    return {
      id: stringField(target.id),
      selector: stringField(target.selector),
      sceneName: stringField(target.sceneName),
      requiresImage: target.requiresImage === true,
      knownLoss: target.knownLoss === undefined ? undefined : stringField(target.knownLoss),
    };
  });

  return {
    id: stringField(config.id),
    scriptPolicy: config.scriptPolicy,
    html,
    viewport: {
      width: positiveDimension(config.viewport.width),
      height: positiveDimension(config.viewport.height),
    },
    targets,
  };
}

export async function captureHTMLReference(browser: Browser, fixture: HTMLFixture): Promise<HTMLReference> {
  const page = await browser.newPage({
    viewport: fixture.viewport, serviceWorkers: 'block', javaScriptEnabled: fixture.scriptPolicy === 'trusted',
  });
  const externalRequests: string[] = [];

  try {
    await page.route(/^https?:/, async route => {
      externalRequests.push(route.request().url());
      await route.abort('blockedbyclient');
    });
    await page.addInitScript({ content: 'window.__name = function(target) { return target; };' });
    await page.setContent(fixture.html);
    await page.evaluate(async allowFrames => {
      document.body.getBoundingClientRect();
      await document.fonts.ready;
      const failedFonts = Array.from(document.fonts).filter(font => font.status === 'error');

      if (failedFonts.length !== 0) {
        throw new Error(`Fixture fonts failed to load: ${failedFonts.map(font => font.family).join(', ')}`);
      }
      await Promise.all(Array.from(document.images).map(image => image.decode()));
      for (const canvas of document.querySelectorAll('canvas')) {
        if (canvas.width > 0 && canvas.height > 0) {
          canvas.getContext('2d')?.getImageData(0, 0, 1, 1);
        }
      }
      // Let a complete paint occur after media buffers and web fonts are ready.
      if (allowFrames) {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
    }, fixture.scriptPolicy === 'trusted');
    const reference = await page.evaluate(targets => {
      const body = document.body.getBoundingClientRect();

      return {
        origin: { x: body.x, y: body.y },
        targets: targets.map(target => {
          const element = document.querySelector<HTMLElement>(target.selector);

          if (element === null) {
            throw new Error(`Missing fixture target ${target.selector}`);
          }
          const rect = element.getBoundingClientRect();
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const texts: string[] = [];
          const textRegions: Array<{ x: number; y: number; width: number; height: number }> = [];
          let textNode = walker.nextNode();

          while (textNode !== null) {
            const parent = textNode.parentElement;
            const text = textNode.textContent?.trim() ?? '';

            if (parent !== null && parent.closest('svg,canvas,style,script') === null && text !== '') {
              const style = getComputedStyle(parent);

              if (style.display !== 'none' && style.visibility !== 'hidden') {
                const range = document.createRange();

                range.selectNodeContents(textNode);
                for (const line of Array.from(range.getClientRects())) {
                  let left = Math.max(0, line.left);
                  let top = Math.max(0, line.top);
                  let right = Math.min(document.documentElement.scrollWidth, line.right);
                  let bottom = Math.min(document.documentElement.scrollHeight, line.bottom);
                  let ancestor: Element | null = parent;

                  while (ancestor !== null) {
                    const ancestorStyle = getComputedStyle(ancestor);
                    const bounds = ancestor.getBoundingClientRect();

                    if (ancestorStyle.overflowX !== 'visible') {
                      left = Math.max(left, bounds.left + ancestor.clientLeft);
                      right = Math.min(right, bounds.left + ancestor.clientLeft + ancestor.clientWidth);
                    }
                    if (ancestorStyle.overflowY !== 'visible') {
                      top = Math.max(top, bounds.top + ancestor.clientTop);
                      bottom = Math.min(bottom, bounds.top + ancestor.clientTop + ancestor.clientHeight);
                    }
                    ancestor = ancestor.parentElement;
                  }
                  if (right > left && bottom > top) {
                    textRegions.push({ x: left, y: top, width: right - left, height: bottom - top });
                  }
                }
                texts.push(style.textTransform === 'uppercase' ? text.toUpperCase()
                  : style.textTransform === 'lowercase' ? text.toLowerCase()
                    : style.textTransform === 'capitalize' ? text.replace(/\b\w/g, c => c.toUpperCase()) : text);
              }
            }
            textNode = walker.nextNode();
          }
          for (const input of element.querySelectorAll<HTMLInputElement>('input')) {
            if (['checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden'].includes(input.type)) {
              continue;
            }
            const text = input.value || input.placeholder;

            if (text !== '') {
              texts.push(text);
            }
          }

          return { id: target.id, x: rect.x, y: rect.y, width: rect.width, height: rect.height, texts, textRegions };
        }),
      };
    }, fixture.targets);

    if (externalRequests.length !== 0) {
      throw new Error(`Fixture attempted external requests: ${externalRequests.join(', ')}`);
    }

    return { ...reference, screenshot: await page.screenshot({ fullPage: true }) };
  } finally {
    await page.close();
  }
}

export function flattenScene(root: SceneNode): SceneNode[] {
  return [root, ...root.children.flatMap(flattenScene)];
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, '');
}
