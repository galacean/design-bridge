import { describe, it, expect } from 'vitest';
import { parseColor, makeSolidPaint, dataUrlToBytes, makeImageFillPaint } from '@galacean/html2figma';
import type { FigmaBlob } from '@galacean/html2figma';
import { mapIRFillPaint } from '../../src/core/paint-helpers';

describe('gradient direction', () => {
  it.each([
    { angleDeg: 0, start: [0.5, 1], end: [0.5, 0] },
    { angleDeg: 90, start: [0, 0.5], end: [1, 0.5] },
    { angleDeg: 180, start: [0.5, 0], end: [0.5, 1] },
    { angleDeg: 270, start: [1, 0.5], end: [0, 0.5] },
    { angleDeg: 135, start: [0.125, -0.25], end: [0.875, 1.25], size: { width: 200, height: 100 } },
  ])('maps CSS $angleDeg degrees to the expected Kiwi start and end', ({ angleDeg, start, end, size }) => {
    const paint = mapIRFillPaint({ type: 'GRADIENT_LINEAR', angleDeg, stops: [] }, size);
    const transform = paint.transform!;

    expect(transform.m00 + transform.m02).toBeCloseTo(start[0]);
    expect(transform.m10 + transform.m12).toBeCloseTo(start[1]);
    expect(transform.m02).toBeCloseTo(end[0]);
    expect(transform.m12).toBeCloseTo(end[1]);
  });

  it('treats zero degrees as a full rotation rather than the opposite direction', () => {
    const fill = { type: 'GRADIENT_LINEAR' as const, angleDeg: 0, stops: [
      { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
    ] };
    const zero = mapIRFillPaint(fill).transform!;
    const full = mapIRFillPaint({ ...fill, angleDeg: 360 }).transform!;
    const opposite = mapIRFillPaint({ ...fill, angleDeg: 180 }).transform!;

    for (const key of ['m00', 'm01', 'm02', 'm10', 'm11', 'm12'] as const) {
      expect(zero[key]).toBeCloseTo(full[key], 6);
    }
    expect(zero.m01).not.toBeCloseTo(opposite.m01, 6);
  });
});

// ---- parseColor ----

describe('parseColor', () => {
  it('rgb() string → normalized RGBA', () => {
    const c = parseColor('rgb(255, 0, 128)');

    expect(c).not.toBeNull();
    expect(c!.r).toBeCloseTo(1, 4);
    expect(c!.g).toBeCloseTo(0, 4);
    expect(c!.b).toBeCloseTo(0.502, 2);
    expect(c!.a).toBe(1);
  });

  it('rgba() string preserves alpha', () => {
    const c = parseColor('rgba(0, 0, 255, 0.5)');

    expect(c!.r).toBe(0);
    expect(c!.b).toBeCloseTo(1, 4);
    expect(c!.a).toBeCloseTo(0.5, 4);
  });

  it('"rgb(0,0,0)" with no spaces → parsed correctly', () => {
    const c = parseColor('rgb(0,0,0)');

    expect(c).not.toBeNull();
    expect(c!.r).toBe(0);
    expect(c!.g).toBe(0);
    expect(c!.b).toBe(0);
    expect(c!.a).toBe(1);
  });

  it('#rrggbb hex → correct RGBA', () => {
    const c = parseColor('#ff0000');

    expect(c!.r).toBeCloseTo(1, 4);
    expect(c!.g).toBe(0);
    expect(c!.b).toBe(0);
    expect(c!.a).toBe(1);
  });

  it('#rgb shorthand hex → expanded correctly', () => {
    const c = parseColor('#f0f');

    expect(c!.r).toBeCloseTo(1, 4);
    expect(c!.g).toBe(0);
    expect(c!.b).toBeCloseTo(1, 4);
  });

  it('#rrggbbaa hex → parses alpha', () => {
    const c = parseColor('#ff000080');

    expect(c!.r).toBeCloseTo(1, 4);
    expect(c!.a).toBeCloseTo(0.502, 2);
  });

  it('null input → null', () => {
    expect(parseColor(null)).toBeNull();
  });

  it('undefined input → null', () => {
    expect(parseColor(undefined)).toBeNull();
  });

  it('invalid string → null', () => {
    expect(parseColor('not-a-color')).toBeNull();
    expect(parseColor('hsl(120, 100%, 50%)')).toBeNull();
    expect(parseColor('transparent')).toBeNull();
  });

  it('rgb(0, 0, 0) alpha defaults to 1', () => {
    const c = parseColor('rgb(0, 0, 0)');

    expect(c!.a).toBe(1);
  });
});

// ---- makeSolidPaint ----

describe('makeSolidPaint', () => {
  it('creates SOLID paint with correct color', () => {
    const paint = makeSolidPaint({ r: 0.5, g: 0.25, b: 1, a: 1 });

    expect(paint.type).toBe('SOLID');
    expect(paint.color!.r).toBeCloseTo(0.5, 4);
    expect(paint.color!.g).toBeCloseTo(0.25, 4);
    expect(paint.color!.b).toBeCloseTo(1, 4);
  });

  it('visible = true and blendMode = NORMAL', () => {
    const paint = makeSolidPaint({ r: 0, g: 0, b: 0, a: 1 });

    expect(paint.visible).toBe(true);
    expect(paint.blendMode).toBe('NORMAL');
  });

  it('applies CSS alpha once through paint opacity', () => {
    const paint = makeSolidPaint({ r: 1, g: 0, b: 0, a: 0.5 });

    expect(paint.opacity).toBeCloseTo(0.5, 4);
    expect(paint.color!.a).toBe(1);
  });

  it('fully transparent paint has opacity 0', () => {
    const paint = makeSolidPaint({ r: 0, g: 0, b: 0, a: 0 });

    expect(paint.opacity).toBe(0);
  });
});

// ---- dataUrlToBytes ----

describe('dataUrlToBytes', () => {
  it('valid data URL → Buffer with correct content', () => {
    const original = Buffer.from('hello png');
    const dataUrl = `data:image/png;base64,${original.toString('base64')}`;
    const result = dataUrlToBytes(dataUrl);

    expect(result).not.toBeNull();
    expect(result!.equals(original)).toBe(true);
  });

  it('null input → null', () => {
    expect(dataUrlToBytes(null)).toBeNull();
  });

  it('undefined input → null', () => {
    expect(dataUrlToBytes(undefined)).toBeNull();
  });

  it('non-data-url string → null', () => {
    expect(dataUrlToBytes('https://example.com/image.png')).toBeNull();
  });

  it('empty string → null', () => {
    expect(dataUrlToBytes('')).toBeNull();
  });

  it('jpeg data URL also parsed', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff]);
    const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
    const result = dataUrlToBytes(dataUrl)!;

    expect(result[0]).toBe(0xff);
    expect(result[1]).toBe(0xd8);
  });
});

// ---- makeImageFillPaint ----

describe('makeImageFillPaint', () => {
  it('creates IMAGE paint and pushes blob', () => {
    const blobs: FigmaBlob[] = [];
    const imgBytes = Buffer.from([1, 2, 3, 4]);
    const paint = makeImageFillPaint(imgBytes, blobs);

    expect(paint.type).toBe('IMAGE');
    expect(blobs).toHaveLength(1);
    expect(blobs[0].bytes).toEqual([1, 2, 3, 4]);
  });

  it('image.dataBlob matches blob index (first)', () => {
    const blobs: FigmaBlob[] = [];
    const paint = makeImageFillPaint(Buffer.from([10, 20]), blobs);

    expect(paint.image?.dataBlob).toBe(0);
  });

  it('image.dataBlob increments for subsequent images', () => {
    const blobs: FigmaBlob[] = [];

    makeImageFillPaint(Buffer.from([1]), blobs);
    const paint2 = makeImageFillPaint(Buffer.from([2]), blobs);

    expect(paint2.image?.dataBlob).toBe(1);
    expect(blobs).toHaveLength(2);
  });

  it('image has a non-empty hash (SHA1 of bytes)', () => {
    const blobs: FigmaBlob[] = [];
    const paint = makeImageFillPaint(Buffer.from([1, 2, 3]), blobs);

    expect(paint.image?.hash).toHaveLength(20); // SHA1 = 20 bytes
  });

  it('imageScaleMode = STRETCH', () => {
    const blobs: FigmaBlob[] = [];
    const paint = makeImageFillPaint(Buffer.from([0]), blobs);

    expect(paint.imageScaleMode).toBe('STRETCH');
  });
});
