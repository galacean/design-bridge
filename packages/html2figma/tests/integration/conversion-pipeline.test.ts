import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBinarySchema, compileSchema } from 'kiwi-schema';
import pako from 'pako';
import { describe, expect, it } from 'vitest';
import { extractSceneDocument, extractSceneDocumentFromProject } from '../../src/core/extract-scene';
import { scenesToFigmaClipboard } from '../../src/core/figma-clipboard-node';
import { parseArchive } from '../../src/core/kiwi-archive';
import { isHTMLSceneDocument } from '../../src/model/html-scene-document';
import { createVirtualProject } from '../../src/model/virtual-project';
import type { SceneNode } from '../../src/types';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(TEST_DIR, '../fixtures/end-to-end/input.html');

interface DecodedClipboardMessage {
  type: string;
  nodeChanges: Array<{ type?: string; name?: string }>;
  blobs: Array<{ bytes?: number[] }>;
  pasteID: number;
}

function findNode(root: SceneNode, name: string): SceneNode | undefined {
  if (root.name === name) {
    return root;
  }

  for (const child of root.children) {
    const match = findNode(child, name);

    if (match) {
      return match;
    }
  }

  return undefined;
}

function extractFigmaBuffer(html: string): Uint8Array {
  const match = html.match(/<!--\(figma\)([\s\S]*?)\(\/figma\)-->/);

  if (!match) {
    throw new Error('Clipboard HTML is missing the figma marker.');
  }

  return Uint8Array.from(Buffer.from(match[1], 'base64'));
}

function decodeClipboardMessage(html: string): DecodedClipboardMessage {
  const archive = parseArchive(extractFigmaBuffer(html));

  expect(archive.files).toHaveLength(2);

  const schema = decodeBinarySchema(pako.inflateRaw(archive.files[0]));
  const compiled = compileSchema(schema) as { decodeMessage(input: Uint8Array): unknown };

  return compiled.decodeMessage(pako.inflateRaw(archive.files[1])) as DecodedClipboardMessage;
}

describe('HTML to Figma conversion pipeline', () => {
  it('converts a rendered HTML document into a decodable Figma clipboard message', async () => {
    const document = await extractSceneDocument(FIXTURE_PATH, false, { viewport: { width: 390, height: 844 } });
    const scene = document.root;
    const card = findNode(scene, 'Article');
    const heading = findNode(scene, 'Design Bridge');

    expect(isHTMLSceneDocument(document)).toBe(true);
    expect(document).toMatchObject({
      version: 1,
      viewport: { width: 390, height: 844 },
      runtime: { kind: 'playwright', engine: 'chromium' },
      diagnostics: [],
    });
    expect(card).toBeDefined();
    expect(card?.width).toBe(320);
    expect(card?.ir.autoLayout).toMatchObject({
      stackMode: 'VERTICAL',
      stackSpacing: 12,
    });
    expect(card?.ir.cornerRadii).toMatchObject({ tl: 16, tr: 16, bl: 16, br: 16, allSame: true });
    expect(heading).toMatchObject({
      type: 'text',
      text: 'Design Bridge',
    });
    expect(heading?.ir.textProps).toMatchObject({
      fontSize: 24,
      fontWeight: 700,
      lineHeightPx: 30,
    });

    const clipboardHTML = scenesToFigmaClipboard([{ name: 'end-to-end', sceneData: scene }]);
    const message = decodeClipboardMessage(clipboardHTML);

    expect(message.type).toBe('NODE_CHANGES');
    expect(Number.isInteger(message.pasteID)).toBe(true);
    expect(message.nodeChanges.some(node => node.type === 'DOCUMENT')).toBe(true);
    expect(message.nodeChanges.some(node => node.type === 'CANVAS')).toBe(true);
    expect(message.nodeChanges.some(node => node.type === 'FRAME' && node.name === 'Article')).toBe(true);
    expect(message.nodeChanges.some(node => node.type === 'TEXT' && node.name === 'Design Bridge')).toBe(true);
    expect(message.nodeChanges.some(node => node.type === 'FRAME' && node.name === 'check')).toBe(true);
    expect(message.blobs.length).toBeGreaterThan(0);
    expect(extractFigmaBuffer(clipboardHTML).byteLength).toBeLessThan(256 * 1024);
  });

  it('loads a virtual project with relative stylesheet resources in Node', async () => {
    const encoder = new TextEncoder();
    const project = createVirtualProject(
      [
        {
          path: 'pages/index.html',
          mimeType: 'text/html',
          bytes: encoder.encode(
            '<!doctype html><html><head><link rel="stylesheet" href="../styles/main.css"></head>' +
              '<body><main id="project-card">Virtual project</main></body></html>',
          ),
        },
        {
          path: 'styles/main.css',
          mimeType: 'text/css',
          bytes: encoder.encode('body{margin:0}#project-card{display:flex;width:280px;height:96px}'),
        },
      ],
      'pages/index.html',
    );

    const document = await extractSceneDocumentFromProject(project, { viewport: { width: 640, height: 480 } });
    const card = findNode(document.root, 'project-card');

    expect(document.viewport).toEqual({ width: 640, height: 480 });
    expect(document.runtime.kind).toBe('playwright');
    expect(card).toMatchObject({ width: 280, height: 96 });
  });
});
