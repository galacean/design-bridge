import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractSceneFromDocument } from './extract-scene-from-document';
import { registerFontSourceFallbacks } from './font-resolution';
import { normalizeFontBytes } from './normalize-font-bytes';
import { rebaseScene } from './rebase-scene';
import { createHTMLSceneDocument } from '../model/html-scene-document';
import type { HTMLSceneDocument } from '../model/html-scene-document';
import type { VirtualProject } from '../model/virtual-project';
import type { SceneNode } from '../types';

const FONT_CACHE_DIR = path.join(os.tmpdir(), 'html2figma-font-cache');
const FONT_SOURCE_CACHE = new Map<string, string | null>();
const NORMALIZED_FONT_SOURCES = new Map<string, Promise<string>>();

function normalizeFontSource(source: string): Promise<string> {
  const cached = NORMALIZED_FONT_SOURCES.get(source);

  if (cached !== undefined) {
    return cached;
  }
  const operation = (async () => {
    const bytes = await fs.readFile(source);
    const normalized = await normalizeFontBytes(bytes);

    if (normalized === bytes) {
      return source;
    }
    await fs.mkdir(FONT_CACHE_DIR, { recursive: true });
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    const target = path.join(FONT_CACHE_DIR, `${hash}.sfnt`);

    await fs.writeFile(target, normalized);

    return target;
  })().catch((error: unknown) => {
    console.warn('Font normalization failed; retaining source font:', error);

    return source;
  });

  NORMALIZED_FONT_SOURCES.set(source, operation);

  return operation;
}

/** Browser rendering policies and limits for Node.js extraction with Playwright. */
export interface ExtractSceneOptions {
  /** Capture unsupported synthetic webfont styles as local text images. Defaults to false (editable text). */
  rasterizeSyntheticText?: boolean;
  /** Viewport size in CSS pixels. Defaults to 390 by 844. */
  viewport?: { width: number; height: number };
  /** Whether input scripts run. Defaults to trusted; disabled still allows extraction code. */
  scriptPolicy?: 'trusted' | 'disabled';
  /** Defaults to `allow`; `offline` blocks HTTP(S) requests and skips font hydration during extraction. */
  networkPolicy?: 'allow' | 'offline';
  /** Overall extraction deadline, including browser startup. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Maximum HTML input size in bytes. Defaults to 10 MiB. */
  maxInputBytes?: number;
}

/**
 * Extracts a scene tree from an HTML file or string using Node.js and Playwright Chromium.
 *
 * @param htmlPathOrContent - Local HTML file path, or HTML source when `isContent` is true.
 * @param isContent - Whether the first argument is HTML source. Defaults to false.
 * @param options - Rendering policies, viewport, and extraction limits.
 * @returns The measured scene root. Use {@link extractSceneDocument} to retain diagnostics and runtime metadata.
 *
 * @example
 * ```ts
 * const root = await extractScene('<main>Hello</main>', true, { scriptPolicy: 'disabled' });
 * const result = await createFigmaFile([{ name: 'Page', sceneData: root }]);
 * ```
 */
export async function extractScene(
  htmlPathOrContent: string,
  isContent = false,
  options: ExtractSceneOptions = {},
): Promise<SceneNode> {
  return (await extractSceneDocument(htmlPathOrContent, isContent, options)).root;
}

/**
 * Extracts a versioned scene document from a local HTML file or string in Node.js.
 *
 * @remarks
 * Requires Playwright Chromium. Input scripts run by default; use `scriptPolicy: 'disabled'` to disable them.
 * Offline mode blocks HTTP(S) during extraction but does not isolate local files or later export operations.
 *
 * @param htmlPathOrContent - Local HTML file path, or HTML source when `isContent` is true.
 * @param isContent - Whether the first argument is HTML source. Defaults to false.
 * @param options - Rendering policies, viewport, and extraction limits.
 * @returns The scene root, viewport, runtime metadata, and resource diagnostics.
 * @throws If input limits are invalid or exceeded, Chromium cannot render the input, or extraction times out.
 */
export async function extractSceneDocument(
  htmlPathOrContent: string,
  isContent = false,
  options: ExtractSceneOptions = {},
): Promise<HTMLSceneDocument> {
  const viewport = options.viewport ?? { width: 390, height: 844 };
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxInputBytes = options.maxInputBytes ?? 10 * 1024 * 1024;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxInputBytes) || maxInputBytes <= 0) {
    throw new TypeError('HTML extraction limits must be positive finite values.');
  }
  const inputBytes = isContent ? Buffer.byteLength(htmlPathOrContent) : (await fs.stat(htmlPathOrContent)).size;

  if (inputBytes > maxInputBytes) {
    throw new RangeError(`HTML input exceeds ${maxInputBytes} bytes.`);
  }
  const deadline = Date.now() + timeoutMs;
  const browser = await chromium.launch({ headless: true, channel: 'chromium', timeout: timeoutMs });
  let timeoutID: ReturnType<typeof setTimeout> | undefined;
  const extraction = async (): Promise<HTMLSceneDocument> => {
    const page = await browser.newPage({
      viewport,
      javaScriptEnabled: options.scriptPolicy !== 'disabled',
      serviceWorkers: 'block',
    });

    page.setDefaultTimeout(Math.max(1, deadline - Date.now()));
    if (options.networkPolicy === 'offline') {
      await page.route('**/*', async route => {
        if (/^https?:/.test(route.request().url())) {
          await route.abort('blockedbyclient');
        } else {
          await route.continue();
        }
      });
    }
    // esbuild keepNames injects __name() calls into page.evaluate closures.
    await page.addInitScript({ content: 'window.__name = function(target) { return target; };' });
    if (isContent) {
      await page.setContent(htmlPathOrContent);
    } else {
      await page.goto('file://' + path.resolve(htmlPathOrContent));
    }
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      // Make the reported initial family explicit: locale-specific browser defaults
      // can otherwise shape DOM text with a different face than Canvas font metrics.
      const family = getComputedStyle(document.documentElement).fontFamily;
      const defaults = new CSSStyleSheet();

      defaults.replaceSync(`:where(html) { font-family: ${family}; }`);
      document.adoptedStyleSheets = [defaults, ...document.adoptedStyleSheets];
    });
    const scene: SceneNode = await page.evaluate(extractSceneFromDocument, {
      rasterizeSyntheticText: options.rasterizeSyntheticText ?? false,
    });

    if (options.networkPolicy !== 'offline') {

      await hydrateSceneFontSources(scene);
    }
    const origin = rebaseScene(scene);

    console.info(`Extracted scene: ${scene.width}x${scene.height}, bounds: (${origin.minX}, ${origin.minY})`);

    return createHTMLSceneDocument(scene, {
      viewport,
      runtime: {
        kind: 'playwright',
        engine: 'chromium',
        engineVersion: browser.version(),
        userAgent: await page.evaluate(() => navigator.userAgent),
      },
    });
  };

  try {
    return await Promise.race([
      extraction(),
      new Promise<never>((_resolve, reject) => {
        timeoutID = setTimeout(() => reject(new Error(`HTML extraction timed out after ${timeoutMs}ms.`)), Math.max(1, deadline - Date.now()));
      }),
    ]);
  } finally {
    clearTimeout(timeoutID);
    await browser.close();
  }
}

/**
 * Extracts a virtual project's entry HTML using Playwright in Node.js.
 *
 * @param project - Entry path and resource bytes to write into a temporary directory, removed after extraction.
 * @param options - Rendering policies and limits; the HTML size limit applies to the entry file.
 * @returns A scene document with runtime metadata and resource diagnostics.
 */
export async function extractSceneDocumentFromProject(
  project: VirtualProject,
  options: ExtractSceneOptions = {},
): Promise<HTMLSceneDocument> {
  const projectDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'html2figma-project-'));

  try {
    for (const file of project.files.values()) {
      const filePath = path.join(projectDirectory, file.path);

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.bytes);
    }

    return await extractSceneDocument(path.join(projectDirectory, project.entryPath), false, options);
  } finally {
    await fs.rm(projectDirectory, { recursive: true, force: true });
  }
}

async function cacheFontSource(source: string | null | undefined): Promise<string | null> {
  if (!source) {
    return null;
  }
  if (source.startsWith('file://')) {
    return source.slice('file://'.length);
  }
  if (!/^https?:\/\//i.test(source) && !source.startsWith('data:')) {
    return source;
  }

  if (FONT_SOURCE_CACHE.has(source)) {
    return FONT_SOURCE_CACHE.get(source) || null;
  }

  try {
    await fs.mkdir(FONT_CACHE_DIR, { recursive: true });
    const hash = crypto.createHash('sha1').update(source).digest('hex');
    const extension = source.startsWith('data:') ? '.font' : path.extname(new URL(source).pathname) || '.font';
    const filePath = path.join(FONT_CACHE_DIR, `${hash}${extension}`);

    try {
      await fs.access(filePath);
      FONT_SOURCE_CACHE.set(source, filePath);

      return filePath;
    } catch {
      // Cache miss, fetch the font file below.
    }

    const response = await fetch(source);

    if (!response.ok) {
      FONT_SOURCE_CACHE.set(source, null);

      return null;
    }

    await fs.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
    FONT_SOURCE_CACHE.set(source, filePath);

    return filePath;
  } catch (error) {
    console.info(`⚠️ Failed to cache font source: ${source}`, (error as Error).message);
    FONT_SOURCE_CACHE.set(source, null);

    return null;
  }
}

export async function hydrateSceneFontSources(node: SceneNode): Promise<void> {
  if (node.type === 'text') {
    const sources = node.fontSources?.length ? node.fontSources : node.fontSource ? [node.fontSource] : [];
    const cachedSources = (await Promise.all(sources.map(cacheFontSource))).filter(
      (source): source is string => source !== null,
    );

    const normalizedSources = await Promise.all(cachedSources.map(normalizeFontSource));

    node.fontSources = normalizedSources;
    node.fontSource = normalizedSources[0] ?? null;
    if (node.fontSource !== null) {
      registerFontSourceFallbacks(node.fontSource, normalizedSources);
    }
  }
  for (const child of node.children) {
    await hydrateSceneFontSources(child);
  }
}
