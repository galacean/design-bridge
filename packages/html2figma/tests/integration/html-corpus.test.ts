import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFigmaFile, createHTMLSceneDocument, extractSceneDocument } from '@galacean/html2figma';
import type { SceneNode } from '@galacean/html2figma';
import {
  captureHTMLReference, flattenScene, isRecord, loadHTMLFixture, normalizeText,
} from '../helpers/html-fixture';
import type { HTMLReference } from '../helpers/html-fixture';
import { decodeFigmaFileNodes } from '../helpers/decode-figma-file';

const fixtures = await Promise.all([
  'upstream/openpencil/card',
  'upstream/openpencil/form',
  'upstream/natumsol/elements',
  'upstream/natumsol/composites',
  'regressions/implicit-icon-styles',
  'regressions/icon-font-fallback',
  'regressions/short-text',
  'regressions/measured-text',
  'regressions/transparent-media',
  'regressions/snapshot-geometry',
  'regressions/gradient-direction',
  'regressions/italic-text',
  'regressions/ligature-text',
  'regressions/preserved-whitespace',
  'regressions/tab-layout',
  'regressions/business-document',
  'regressions/synthetic-fonts',
  'regressions/table-conflicts',
  'regressions/snapshot-fixed-position',
  'regressions/decorated-text',
  'regressions/modern-colors',
].map(loadHTMLFixture));

it('keeps vendored upstream inputs and assets at their recorded checksums', async () => {
  const root = fileURLToPath(new URL('../fixtures/html/', import.meta.url));
  const sources: unknown = JSON.parse(await fs.readFile(path.join(root, 'SOURCES.json'), 'utf8'));

  if (!isRecord(sources) || !isRecord(sources.checksums) || !Array.isArray(sources.upstreams)) {
    throw new Error('Invalid fixture provenance.');
  }
  const checksums: Record<string, unknown> = { ...sources.checksums };

  for (const upstream of sources.upstreams) {
    if (isRecord(upstream) && Array.isArray(upstream.files)) {
      for (const file of upstream.files) {
        if (!isRecord(file) || typeof file.file !== 'string' || typeof file.sha256 !== 'string') {
          throw new Error('Invalid vendored source checksum.');
        }
        checksums[file.file] = file.sha256;
      }
    }
  }
  for (const [file, expected] of Object.entries(checksums)) {
    const actual = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');

    expect(actual, file).toBe(expected);
  }
});

describe.each(fixtures)('HTML corpus: $id', fixture => {
  let reference: HTMLReference;
  let scene: SceneNode;
  let nodes: Array<Record<string, unknown>>;

  beforeAll(async () => {
    const browser = await chromium.launch({ headless: true });

    try {
      const [captured, document] = await Promise.all([
        captureHTMLReference(browser, fixture),
        extractSceneDocument(fixture.html, true, {
          viewport: fixture.viewport, networkPolicy: 'offline', scriptPolicy: fixture.scriptPolicy,
        }),
      ]);

      reference = captured;
      scene = document.root;
      const file = await createFigmaFile([{ name: fixture.id, sceneData: scene }]);

      expect(file.validation.valid, file.validation.errors.join('\n')).toBe(true);
      if (fixture.id.startsWith('natumsol-')) {
        expect(file.blobStats.byKind.glyph.references).toBeGreaterThan(0);
      }
      nodes = await decodeFigmaFileNodes(file.bytes);
      const artifactDirectory = process.env.HTML2FIGMA_TEST_ARTIFACTS;

      if (artifactDirectory !== undefined && artifactDirectory !== '') {
        const directory = path.resolve(artifactDirectory, fixture.id);

        await fs.mkdir(directory, { recursive: true });
        await Promise.all([
          fs.writeFile(path.join(directory, 'input.html'), fixture.html),
          fs.writeFile(path.join(directory, 'reference.png'), reference.screenshot),
          fs.writeFile(path.join(directory, 'output.fig'), file.bytes),
          fs.writeFile(path.join(directory, 'scene.json'), JSON.stringify(document, null, 2)),
          fs.writeFile(path.join(directory, 'reference.json'), JSON.stringify({
            viewport: fixture.viewport, scriptPolicy: fixture.scriptPolicy,
            targets: reference.targets, origin: reference.origin,
            validation: file.validation, visualAcceptance: 'not-run',
            knownLosses: fixture.targets.filter(target => target.knownLoss !== undefined),
          }, null, 2)),
        ]);
      }
    } finally {
      await browser.close();
    }
  }, 30000);

  for (const target of fixture.targets) {
    it(`${target.id}: retains the browser-measured target geometry`, () => {
      const measured = reference.targets.find(item => item.id === target.id);
      const extracted = flattenScene(scene).find(node => node.name === target.sceneName);

      expect(measured).toBeDefined();
      expect(extracted).toBeDefined();
      if (measured === undefined || extracted === undefined) {
        throw new Error('Missing HTML target or extracted scene node.');
      }
      expect(extracted.width).toBeCloseTo(measured.width, 2);
      expect(extracted.height).toBeCloseTo(measured.height, 2);
      expect(extracted.x).toBeCloseTo(measured.x - reference.origin.x, 2);
      expect(extracted.y).toBeCloseTo(measured.y - reference.origin.y, 2);
    });

    if (target.requiresImage) {
      const testImage = target.knownLoss === undefined ? it : it.fails;

      testImage(`${target.id}: captures visible image pixels${target.knownLoss === undefined ? '' : ' (known loss)'}`, () => {
        const extracted = flattenScene(scene).find(node => node.name === target.sceneName);

        expect(extracted).toBeDefined();
        expect(flattenScene(extracted!).some(node =>
          (node.image !== undefined && node.image !== null && node.image !== '') ||
          (node.backgroundImage !== undefined && node.backgroundImage !== null && node.backgroundImage !== ''),
        ), target.knownLoss).toBe(true);
      });
    }
  }

  it('retains visible DOM text and input values in the decoded FIG', () => {
    const exportedText = nodes.flatMap(node => isRecord(node.textData) && typeof node.textData.characters === 'string'
      ? [normalizeText(node.textData.characters)] : []);

    for (const target of reference.targets) {
      for (const text of target.texts) {
        expect(exportedText.some(value => value.includes(normalizeText(text))),
          `Missing FIG text in ${target.id}: ${text}`).toBe(true);
      }
    }
  });

  if (fixture.id === 'transparent-media') {
    it.each(fixture.targets)('$id: keeps the CSS background below image pixels in the FIG', target => {
      const exported = nodes.find(node => node.name === target.sceneName);

      expect(exported?.fillPaints).toMatchObject([
        { type: 'SOLID', color: { r: 1, g: expect.closeTo(0.8, 6), b: 0, a: 1 }, opacity: 1 },
        { type: 'IMAGE', opacity: 1 },
      ]);
    });
  }

  if (fixture.id === 'snapshot-geometry') {
    it('keeps section geometry, child offsets and button clipping in the exported FIG', () => {
      const section = nodes.find(node => node.name === 'offset');
      const child = nodes.find(node => node.name === 'block');
      const button = nodes.find(node => node.name === 'Clipped button');

      expect(section?.size).toMatchObject({ x: 360, y: 100 });
      expect(child?.transform).toMatchObject({ m02: 20, m12: 20 });
      expect(button?.frameMaskDisabled).toBe(false);
      expect(button?.size).toMatchObject({ x: 100, y: 50 });
    });
  }

  if (fixture.id === 'gradient-direction') {
    it('preserves equivalent zero-degree background and mask directions in the FIG', () => {
      const matrix = (node: unknown): Record<string, unknown> => {
        if (!isRecord(node) || !Array.isArray(node.fillPaints) || !isRecord(node.fillPaints[0]) ||
          !isRecord(node.fillPaints[0].transform)) {
          throw new Error('Missing gradient transform.');
        }

        return node.fillPaints[0].transform;
      };
      const full = matrix(nodes.find(node => node.name === 'full'));
      const zero = matrix(nodes.find(node => node.name === 'zero'));
      const top = matrix(nodes.find(node => node.name === 'top'));
      const masks = nodes.filter(node => node.mask === true);

      expect(masks).toHaveLength(2);
      const maskZero = matrix(masks[0]);
      const maskFull = matrix(masks[1]);

      for (const key of ['m00', 'm01', 'm02', 'm10', 'm11', 'm12']) {
        expect(zero[key]).toBeCloseTo(Number(full[key]), 6);
        expect(top[key]).toBeCloseTo(Number(full[key]), 6);
        expect(maskZero[key]).toBeCloseTo(Number(maskFull[key]), 6);
      }
    });
  }

  if (fixture.id === 'italic-text') {
    it.each([
      ['Regular AV', 'Regular'], ['Italic AV', 'Italic'],
      ['Bold AV', 'Bold Italic'], ['Italic words', 'Italic'],
    ])('retains the %s font style as %s', (prefix, style) => {
      const text = nodes.find(node => isRecord(node.textData) && typeof node.textData.characters === 'string' &&
        node.textData.characters.startsWith(prefix));

      expect(text?.fontName).toMatchObject({ family: 'Roboto', style });
    });
  }

  if (fixture.id === 'decorated-text') {
    it.each(fixture.targets)('$id: puts decoration on the frame and insets the text once', target => {
      const section = nodes.find(node => node.name === target.sceneName);

      expect(section).toBeDefined();
      const frame = nodes.find(node => node.name === 'Overlay' && isRecord(node.parentIndex) &&
        JSON.stringify(node.parentIndex.guid) === JSON.stringify(section?.guid));
      const text = nodes.find(node => node.type === 'TEXT' && isRecord(node.parentIndex) &&
        JSON.stringify(node.parentIndex.guid) === JSON.stringify(frame?.guid));
      const border = target.id === 'shadow' ? 2 : 0;

      expect(frame?.opacity).toBe(target.id === 'translucent' ? 0.5 : 1);
      expect(text?.opacity).toBe(1);
      expect(text?.transform).toMatchObject({ m02: 16 + border, m12: 6 + border });
      if (target.id === 'shadow') {
        expect(frame?.strokeWeight).toBe(2);
        expect(frame?.effects).toHaveLength(1);
      }
      expect(text?.effects ?? []).toHaveLength(0);
      expect(text?.strokePaints ?? []).toHaveLength(0);
    });
  }

  if (fixture.id === 'modern-colors') {
    it('matches native screenshot colors for modern fills, alpha, and borders', async () => {
      const targets = reference.targets.filter(target => !['text', 'label'].includes(target.id));
      const browser = await chromium.launch();
      let expected: number[][];

      try {
        const page = await browser.newPage();

        expected = await page.evaluate(async ({ source, points }) => {
          const image = new Image();

          image.src = source;
          await image.decode();
          const canvas = document.createElement('canvas');

          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d')!;

          context.drawImage(image, 0, 0);

          return points.map(point => Array.from(context.getImageData(point.x, point.y, 1, 1).data).slice(0, 3));
        }, {
          source: `data:image/png;base64,${reference.screenshot.toString('base64')}`,
          points: targets.map(target => ({ x: target.x + (target.id === 'border' ? 4 : 80), y: target.y + 50 })),
        });
      } finally {
        await browser.close();
      }
      for (const [index, target] of targets.entries()) {
        const node = nodes.find(node => node.name === `${target.id}-target`);
        const paints = target.id === 'border' ? node?.strokePaints : node?.fillPaints;
        const paint: unknown = Array.isArray(paints) ? paints[0] : undefined;
        let actual = [255, 255, 255];

        if (isRecord(paint) && isRecord(paint.color)) {
          const { r, g, b } = paint.color;

          if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') {
            throw new Error('Invalid solid color.');
          }
          const opacity = typeof paint.opacity === 'number' ? paint.opacity : 1;

          actual = [r, g, b].map(channel => Math.round(255 * (channel * opacity + 1 - opacity)));
        }
        actual.forEach((channel, component) => {
          expect(Math.abs(channel - expected[index][component]), `${target.id}, channel ${component}`)
            .toBeLessThanOrEqual(2);
        });
      }
    });

    it('retains modern text colors and the background of a rounded label', () => {
      const text = nodes.find(node => isRecord(node.textData) && node.textData.characters === 'Modern CSS');
      const paints: unknown = text?.fillPaints;

      expect(Array.isArray(paints) && isRecord(paints[0]) && isRecord(paints[0].color) &&
        Number(paints[0].color.r) > 0.1).toBe(true);
      const section = nodes.find(node => node.name === 'label');
      const outer = nodes.find(node => node.name === 'Overlay' && isRecord(node.parentIndex) &&
        JSON.stringify(node.parentIndex.guid) === JSON.stringify(section?.guid));

      expect(outer?.fillPaints).toMatchObject([{ type: 'SOLID', opacity: 1 }]);
    });
  }

  if (fixture.id === 'business-document') {
    it('exports the business document through the Browser file API using local font bytes', async () => {
      const { createFigmaFileFromSceneDocuments } = await import('@galacean/html2figma/browser/file');
      const document = createHTMLSceneDocument(scene, {
        viewport: fixture.viewport, runtime: { kind: 'browser', engine: 'chromium' },
      });
      const result = await createFigmaFileFromSceneDocuments(document, {
        compressedSchema: await fs.readFile(new URL('../../data/figma-file-schema.bin', import.meta.url)),
        localFontAccess: 'disabled', fonts: await Promise.all([
          ['Inter', 'inter-latin-400-normal.woff2'], ['Roboto', 'roboto-latin-400-normal.woff2'],
        ].map(async ([family, file]) => ({
          family, bytes: await fs.readFile(new URL(`../fixtures/html/assets/${file}`, import.meta.url)),
        }))),
      });
      const browserNodes = await decodeFigmaFileNodes(result.bytes);
      const text = browserNodes.filter(node => node.type === 'TEXT').map(node =>
        isRecord(node.textData) ? node.textData.characters : '',
      ).join(' ');

      expect(result.validation.valid).toBe(true);
      expect(result.blobStats.byKind.glyph.references).toBeGreaterThan(0);
      expect(text).toContain('$1,260.00');
      expect(text).toContain('Total due');
      expect(text).toContain('Step\tStatus\nExport\tReady\n\n  Keep indentation and blank rows.');
    });
  }
  if (fixture.id === 'implicit-icon-styles') {
    it('keeps the measured 16px host while capturing missing-font fallback text', () => {
      const host = flattenScene(scene).find(node => node.tagName === 'SPAN');

      expect(host?.width).toBe(16);
      expect(host?.height).toBe(16);
      expect(flattenScene(scene).filter(node => node.type === 'icon')).toHaveLength(0);
      expect(host?.children.some(child => child.type === 'text' && child.text === 'star')).toBe(true);
    });

    it('does not invent background blur when the HTML has none', () => {
      expect(flattenScene(scene).flatMap(node => node.ir.effects)
        .some(effect => effect.type === 'BACKGROUND_BLUR')).toBe(false);
      expect(nodes.some(node => Array.isArray(node.effects) && node.effects.some((effect: unknown) =>
        isRecord(effect) && effect.type === 'BACKGROUND_BLUR',
      ))).toBe(false);
    });

    it('exports measured text without inventing an SVG icon', () => {
      const host = flattenScene(scene).find(node => node.tagName === 'SPAN');
      const exported = nodes.find(node => node.name === host?.name);

      expect(exported?.size).toMatchObject({ x: 16, y: 16 });
      expect(nodes.some(node => node.name === 'star' && node.type === 'TEXT')).toBe(true);
    });
  }
  if (fixture.id === 'short-text') {
    it('keeps small digits, letters and symbols as text regardless of icon-like class names', () => {
      expect(flattenScene(scene).filter(node => node.type === 'icon')).toHaveLength(0);
      expect(flattenScene(scene).filter(node => node.type === 'text').map(node => node.text))
        .toEqual(['1', 'A', 'B', '+']);
    });
  }
});
