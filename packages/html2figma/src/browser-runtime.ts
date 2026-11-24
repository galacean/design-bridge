import { extractSceneFromDocument } from './core/extract-scene-from-document';
import { rebaseScene } from './core/rebase-scene';
import { createHTMLSceneDocument } from './model/html-scene-document';
import type { HTMLSceneDocument } from './model/html-scene-document';
import type { SceneNode } from './types';

/** Viewport, script policy, and cancellation settings for browser iframe extraction. */
export interface BrowserExtractSceneOptions {
  /** Capture unsupported synthetic webfont styles as local text images. Defaults to false (editable text). */
  rasterizeSyntheticText?: boolean;
  /** Viewport size in CSS pixels. Defaults to 390 by 844. */
  viewport?: { width: number; height: number };
  /** Defaults to `sandboxed`. `disabled` blocks input scripts; `trusted` grants normal document permissions. */
  scriptPolicy?: 'disabled' | 'sandboxed' | 'trusted';
  /** Extraction deadline, including scripts, fonts, and images. Defaults to 60 seconds. */
  timeoutMs?: number;
  /** Aborts extraction and removes its iframe when signaled. */
  signal?: AbortSignal;
}

const DEFAULT_VIEWPORT = { width: 390, height: 844 };
const DEFAULT_TIMEOUT_MS = 60_000;
const SANDBOX_CLEANUPS = new WeakMap<HTMLIFrameElement, () => void>();

/**
 * Renders an HTML string in a temporary browser iframe and extracts its scene root.
 *
 * @param html - HTML source, including any styles and resource references.
 * @param options - Viewport, script policy, timeout, and cancellation settings.
 * @returns The measured scene tree. Use {@link extractSceneDocumentFromHTML} to retain diagnostics.
 */
export async function extractSceneFromHTML(
  html: string,
  options: BrowserExtractSceneOptions = {},
): Promise<SceneNode> {
  return (await extractSceneDocumentFromHTML(html, options)).root;
}

/**
 * Renders HTML in a temporary browser iframe and returns a versioned scene document.
 *
 * @remarks
 * Defaults to sandboxed scripts without same-origin access. Sandboxing does not block network requests.
 * The iframe is removed after success, failure, timeout, or cancellation.
 *
 * @param html - HTML source, including any styles and resource references.
 * @param options - Viewport, script policy, timeout, and cancellation settings.
 * @returns The scene root, viewport, runtime metadata, and resource diagnostics.
 * @throws If rendering or extraction fails, times out, or is aborted.
 *
 * @example
 * ```ts
 * import { extractSceneDocumentFromHTML } from '@galacean/html2figma/browser';
 *
 * const scene = await extractSceneDocumentFromHTML('<main>Hello</main>', {
 *   scriptPolicy: 'disabled',
 *   viewport: { width: 1280, height: 720 },
 * });
 * ```
 */
export async function extractSceneDocumentFromHTML(
  html: string,
  options: BrowserExtractSceneOptions = {},
): Promise<HTMLSceneDocument> {
  const iframe = createExtractionIframe(options);
  const host = document.body ?? document.documentElement;
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const scriptPolicy = options.scriptPolicy ?? 'sandboxed';

  try {
    let operation: Promise<SceneNode>;

    if (scriptPolicy === 'sandboxed') {
      const sandboxToken = createMessageToken();
      const extractionHTML = createSandboxedExtractionHTML(html, sandboxToken, options.rasterizeSyntheticText ?? false);

      operation = loadAndExtractSandboxed(iframe, host, extractionHTML, sandboxToken);
    } else {
      operation = loadAndExtractSameOrigin(iframe, host, html, options.rasterizeSyntheticText ?? false);
    }

    const scene = await withCancellationAndTimeout(
      operation,
      options.signal,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    rebaseScene(scene);

    return createHTMLSceneDocument(scene, {
      viewport,
      runtime: {
        kind: 'browser',
        engine: 'chromium',
        userAgent: navigator.userAgent,
      },
    });
  } finally {
    cleanupSandboxExtraction(iframe);
    iframe.remove();
  }
}

function createExtractionIframe(options: BrowserExtractSceneOptions): HTMLIFrameElement {
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const iframe = document.createElement('iframe');

  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '-100000px';
  iframe.style.top = '0';
  iframe.style.width = `${viewport.width}px`;
  iframe.style.height = `${viewport.height}px`;
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  iframe.style.pointerEvents = 'none';

  const scriptPolicy = options.scriptPolicy ?? 'sandboxed';

  if (scriptPolicy === 'disabled') {
    iframe.setAttribute('sandbox', 'allow-same-origin');
  } else if (scriptPolicy === 'sandboxed') {
    iframe.setAttribute('sandbox', 'allow-scripts');
  }

  return iframe;
}

async function loadAndExtractSameOrigin(
  iframe: HTMLIFrameElement, host: Element, html: string, rasterizeSyntheticText: boolean,
): Promise<SceneNode> {
  const loaded = new Promise<void>((resolve, reject) => {
    iframe.addEventListener('load', () => resolve(), { once: true });
    iframe.addEventListener('error', () => reject(new Error('Failed to load the HTML extraction iframe.')), {
      once: true,
    });
  });

  iframe.srcdoc = html;
  host.append(iframe);
  await loaded;

  const sourceDocument = iframe.contentDocument;

  if (sourceDocument === null) {
    throw new Error('The HTML extraction iframe did not expose a document.');
  }

  disableMotion(sourceDocument);
  await sourceDocument.fonts.ready;
  await waitForImages(sourceDocument);
  await waitForRendering(sourceDocument);

  return extractSceneFromDocument(sourceDocument, { rasterizeSyntheticText });
}

async function loadAndExtractSandboxed(
  iframe: HTMLIFrameElement,
  host: Element,
  preparedHTML: string,
  token: string,
): Promise<SceneNode> {
  return new Promise<SceneNode>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
      SANDBOX_CLEANUPS.delete(iframe);
    };
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframe.contentWindow || !isSandboxMessageForToken(event.data, token)) {
        return;
      }

      cleanup();
      const message = parseSandboxMessage(event.data);

      if (message === null) {
        reject(new Error('Sandbox returned an invalid or oversized Scene payload.'));
      } else if (message.ok) {
        resolve(message.scene);
      } else {
        reject(new Error(message.error));
      }
    };

    SANDBOX_CLEANUPS.set(iframe, cleanup);
    window.addEventListener('message', handleMessage);
    iframe.addEventListener(
      'error',
      () => {
        cleanup();
        reject(new Error('Failed to load the sandboxed HTML extraction iframe.'));
      },
      { once: true },
    );
    iframe.srcdoc = preparedHTML;
    host.append(iframe);
  });
}

function cleanupSandboxExtraction(iframe: HTMLIFrameElement): void {
  SANDBOX_CLEANUPS.get(iframe)?.();
}

interface SandboxSuccessMessage {
  channel: 'html2figma-extract';
  token: string;
  ok: true;
  scene: SceneNode;
}

interface SandboxErrorMessage {
  channel: 'html2figma-extract';
  token: string;
  ok: false;
  error: string;
}

type SandboxMessage = SandboxSuccessMessage | SandboxErrorMessage;

function isSandboxMessageForToken(value: unknown, token: string): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return value.channel === 'html2figma-extract' && value.token === token;
}

function createMessageToken(): string {
  const values = new Uint32Array(4);

  crypto.getRandomValues(values);

  return Array.from(values, value => value.toString(16).padStart(8, '0')).join('');
}

export function createSandboxedExtractionHTML(
  html: string,
  token: string,
  rasterizeSyntheticText = false,
): string {
  const parser = new DOMParser();
  const sourceDocument = parser.parseFromString(html, 'text/html');
  const motionStyle = sourceDocument.createElement('style');
  const bootstrap = sourceDocument.createElement('script');
  const extractorSource = extractSceneFromDocument.toString().replace(/<\/script/gi, '<\\/script');

  sourceDocument.querySelectorAll('meta[http-equiv="content-security-policy" i]').forEach(element => element.remove());
  motionStyle.dataset.html2figma = 'disable-motion';
  motionStyle.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;}';
  sourceDocument.head.append(motionStyle);
  bootstrap.type = 'module';
  bootstrap.dataset.html2figma = 'sandbox-extractor';
  bootstrap.textContent = createSandboxBootstrap(extractorSource, token, rasterizeSyntheticText);
  sourceDocument.body.append(bootstrap);

  return `<!doctype html>\n${sourceDocument.documentElement.outerHTML}`;
}

const MAX_SANDBOX_SCENE_NODES = 100_000;
const MAX_SANDBOX_SCENE_DEPTH = 512;
const MAX_SANDBOX_STRING_BYTES = 200 * 1024 * 1024;
const MAX_SANDBOX_COLLECTION_ENTRIES = 1_000_000;

function parseSandboxMessage(value: Record<string, unknown>): SandboxMessage | null {
  if (value.ok === false) {
    return typeof value.error === 'string' && value.error.length <= 10_000
      ? (value as unknown as SandboxErrorMessage)
      : null;
  }
  if (value.ok !== true) {
    return null;
  }

  const budget = {
    nodes: 0,
    stringBytes: 0,
    collectionEntries: 0,
    seen: new WeakSet<object>(),
  };

  return isSandboxStructuredValue(value.scene, budget, 0) && isSandboxSceneNode(value.scene, budget, 0)
    ? (value as unknown as SandboxSuccessMessage)
    : null;
}

function isSandboxSceneNode(
  value: unknown,
  budget: { nodes: number },
  depth: number,
): value is SceneNode {
  if (!isRecord(value) || depth > MAX_SANDBOX_SCENE_DEPTH) {
    return false;
  }

  budget.nodes += 1;
  if (budget.nodes > MAX_SANDBOX_SCENE_NODES) {
    return false;
  }

  const validType = value.type === 'frame' || value.type === 'text' || value.type === 'image' ||
    value.type === 'svg' || value.type === 'icon';
  const requiredNumbers = [value.x, value.y, value.width, value.height];

  if (
    !validType || typeof value.name !== 'string' || !requiredNumbers.every(isFiniteNumber) ||
    !isRecord(value.styles) || !isRecord(value.ir) || !Array.isArray(value.children)
  ) {
    return false;
  }

  return value.children.every(child => isSandboxSceneNode(child, budget, depth + 1));
}

function isSandboxStructuredValue(
  value: unknown,
  budget: {
    stringBytes: number;
    collectionEntries: number;
    seen: WeakSet<object>;
  },
  depth: number,
): boolean {
  if (depth > MAX_SANDBOX_SCENE_DEPTH) {
    return false;
  }
  if (value === null || value === undefined || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'string') {
    budget.stringBytes += value.length * 2;

    return budget.stringBytes <= MAX_SANDBOX_STRING_BYTES;
  }
  if (typeof value !== 'object' || budget.seen.has(value)) {
    return false;
  }

  budget.seen.add(value);

  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);

  for (const [key, entry] of entries) {
    budget.collectionEntries += 1;
    if (budget.collectionEntries > MAX_SANDBOX_COLLECTION_ENTRIES) {
      return false;
    }
    if (typeof key === 'string') {
      budget.stringBytes += key.length * 2;
    }
    if (budget.stringBytes > MAX_SANDBOX_STRING_BYTES || !isSandboxStructuredValue(entry, budget, depth + 1)) {
      return false;
    }
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function createSandboxBootstrap(extractorSource: string, token: string, rasterizeSyntheticText: boolean): string {
  return `
const extractScene = ${extractorSource};
const token = ${JSON.stringify(token)};
const send = payload => window.parent.postMessage({ channel: 'html2figma-extract', token, ...payload }, '*');
window.parent.postMessage({ channel: 'html2figma-extract-ready', token }, '*');
const waitForImages = () => Promise.all(Array.from(document.images).map(async image => {
  if (!image.complete) {
    await new Promise(resolve => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  }
  try { await image.decode(); } catch {}
}));
const run = async () => {
  try {
    await document.fonts.ready;
    await waitForImages();
    document.documentElement.getBoundingClientRect();
    await new Promise(resolve => setTimeout(resolve, 0));
    const scene = await extractScene(document, {
      rasterizeSyntheticText: ${JSON.stringify(rasterizeSyntheticText === true)}
    });
    send({ ok: true, scene });
  } catch (error) {
    send({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
if (document.readyState === 'complete') {
  void run();
} else {
  window.addEventListener('load', () => void run(), { once: true });
}
`;
}

function disableMotion(sourceDocument: Document): void {
  const style = sourceDocument.createElement('style');

  style.dataset.html2figma = 'disable-motion';
  style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;}';
  sourceDocument.head.append(style);
}

async function waitForImages(sourceDocument: Document): Promise<void> {
  const images = Array.from(sourceDocument.images);

  await Promise.all(
    images.map(async image => {
      if (!image.complete) {
        await new Promise<void>(resolve => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        });
      }

      try {
        await image.decode();
      } catch {
        // Failed images remain available to the extractor as unresolved resources.
      }
    }),
  );
}

async function waitForRendering(sourceDocument: Document): Promise<void> {
  const view = sourceDocument.defaultView;

  if (view === null) {
    return;
  }

  await new Promise<void>(resolve => view.requestAnimationFrame(() => resolve()));
  await new Promise<void>(resolve => view.requestAnimationFrame(() => resolve()));
}

async function withCancellationAndTimeout<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  if (signal?.aborted === true) {
    throw createAbortError();
  }

  let timeoutID: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutID = setTimeout(() => reject(new Error(`HTML extraction timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal === undefined) {
      return;
    }

    abortHandler = () => reject(createAbortError());
    signal.addEventListener('abort', abortHandler, { once: true });
  });

  try {
    return await Promise.race([operation, timeout, aborted]);
  } finally {
    if (timeoutID !== undefined) {
      clearTimeout(timeoutID);
    }
    if (signal !== undefined && abortHandler !== undefined) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

function createAbortError(): DOMException {
  return new DOMException('HTML extraction was aborted.', 'AbortError');
}
