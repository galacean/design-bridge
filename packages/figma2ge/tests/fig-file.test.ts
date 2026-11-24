import { describe, expect, it } from 'vitest';
import { convertFigmaToEffects, decodeFigFile } from '@galacean/figma2ge';
import { expectAllImageUrlsBlob, expectBlobOnlyImageUrls, expectNoErrorIssues } from './helpers/assertions';
import { decodedMessage, figBytes } from './helpers/fig-fixture';

describe('decodeFigFile (.fig file)', () => {
  it('decodes canvas.fig and returns nodeChanges', () => {
    const { message } = decodeFigFile(figBytes);

    expect(Array.isArray(message.nodeChanges)).toBe(true);
    expect((message.nodeChanges as unknown[]).length).toBeGreaterThan(0);
  });

  it('parses meta.json', () => {
    const { meta } = decodeFigFile(figBytes);

    expect(meta).toBeDefined();
    expect(typeof meta).toBe('object');
  });

  it('extracts images from images directory', () => {
    const { images } = decodeFigFile(figBytes);

    expect(images.size).toBeGreaterThan(0);
    for (const [hash] of images) {
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('image bytes have valid magic headers', () => {
    const { images } = decodeFigFile(figBytes);

    for (const [, bytes] of images) {
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const isGif = bytes[0] === 0x47 && bytes[1] === 0x49;
      const isWebp = bytes.length > 11 && bytes[0] === 0x52 && bytes[1] === 0x49;

      expect(isPng || isJpeg || isGif || isWebp).toBe(true);
    }
  });

  it('produces a valid GE scene with images resolved via hash map', () => {
    const { message, images } = decodeFigFile(figBytes);
    const result = convertFigmaToEffects(message, {}, images);

    expect(result.scene.items.length).toBeGreaterThan(0);
    expectBlobOnlyImageUrls(result.scene.images);
    expectNoErrorIssues(result.issues);
  });

  it('message is self-contained: images resolve without imagesByHash', () => {
    const { message, images } = decodeFigFile(figBytes);
    const result = convertFigmaToEffects(message);
    const withHashMap = convertFigmaToEffects(message, {}, images);

    expect(result.scene.images.length).toBe(withHashMap.scene.images.length);
    const blobUrls = result.scene.images.map(img => img.url).filter(url => url.startsWith('blob:'));

    expect(blobUrls.length).toBe(result.scene.images.length);
  });

  it('message images survive JSON round-trip', () => {
    const { message, images } = decodeFigFile(figBytes);
    const roundTripped = JSON.parse(JSON.stringify(message));
    const result = convertFigmaToEffects(roundTripped);
    const withHashMap = convertFigmaToEffects(message, {}, images);

    expect(result.scene.images.length).toBe(withHashMap.scene.images.length);
    const blobUrls = result.scene.images.map(img => img.url).filter(url => url.startsWith('blob:'));

    expect(blobUrls.length).toBe(result.scene.images.length);
  });
});

describe('baseline.fig vs decoded JSON image parity', () => {
  it('both paths produce images with blob URLs', () => {
    const { message, images } = decodeFigFile(figBytes);
    const figResult = convertFigmaToEffects(message, {}, images);
    const jsonResult = convertFigmaToEffects(decodedMessage);

    expect(figResult.scene.images.length).toBeGreaterThan(0);
    expect(jsonResult.scene.images.length).toBeGreaterThan(0);

    expectAllImageUrlsBlob(figResult.scene.images);
    expectAllImageUrlsBlob(jsonResult.scene.images);
  });

  it('both paths produce matching image and texture counts', () => {
    const { message, images } = decodeFigFile(figBytes);
    const figResult = convertFigmaToEffects(message, {}, images);
    const jsonResult = convertFigmaToEffects(decodedMessage);

    expect(figResult.scene.images.length).toBe(jsonResult.scene.images.length);
    expect(figResult.scene.textures?.length ?? 0).toBe(jsonResult.scene.textures?.length ?? 0);
  });

  it('both paths produce matching item and component counts', () => {
    const { message, images } = decodeFigFile(figBytes);
    const figResult = convertFigmaToEffects(message, {}, images);
    const jsonResult = convertFigmaToEffects(decodedMessage);

    expect(figResult.scene.items.length).toBe(jsonResult.scene.items.length);
    expect(figResult.scene.components.length).toBe(jsonResult.scene.components.length);
  });

  it('image-referencing items have texture in both paths', () => {
    const { message, images } = decodeFigFile(figBytes);
    const figResult = convertFigmaToEffects(message, {}, images);
    const jsonResult = convertFigmaToEffects(decodedMessage);

    const figTextured = figResult.scene.components.filter(
      c => (c as { renderer?: Record<string, unknown> }).renderer?.texture !== undefined,
    );
    const jsonTextured = jsonResult.scene.components.filter(
      c => (c as { renderer?: Record<string, unknown> }).renderer?.texture !== undefined,
    );

    expect(figTextured.length).toBeGreaterThan(0);
    expect(figTextured.length).toBe(jsonTextured.length);
  });
});
