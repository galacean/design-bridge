import { describe, expect, it } from 'vitest';
import { convertLottieToIR, LOTTIE_CONVERTER_ERROR_CODES } from '@galacean/lottie2ir';
import type { LottieJSON, LottieConverterError } from '@galacean/lottie2ir';

describe('convertLottieToIR error branches', () => {
  it('throws INVALID_LOTTIE_JSON for invalid json string', () => {
    expect(() => convertLottieToIR('{ this is invalid json')).toThrowError(expect.objectContaining({
      name: 'LottieConverterError',
      code: LOTTIE_CONVERTER_ERROR_CODES.INVALID_LOTTIE_JSON,
    } satisfies Partial<LottieConverterError>));
  });

  it('throws INVALID_LOTTIE_JSON for an object without Composition fields', () => {
    expect(() => convertLottieToIR({ foo: 'bar' } as unknown as LottieJSON)).toThrowError(expect.objectContaining({
      name: 'LottieConverterError',
      code: LOTTIE_CONVERTER_ERROR_CODES.INVALID_LOTTIE_JSON,
    } satisfies Partial<LottieConverterError>));
  });

  it('tags conversion errors with stage=convert', () => {
    const brokenJson = {
      v: '5.7.0',
      fr: 24,
      ip: 0,
      op: 24,
      w: 100,
      h: 100,
      layers: [null],
      assets: [],
    } as unknown as LottieJSON;

    expect(() => convertLottieToIR(brokenJson)).toThrowError(expect.objectContaining({
      name: 'LottieConverterError',
      code: LOTTIE_CONVERTER_ERROR_CODES.CONVERT_PIPELINE_FAILED,
      details: {
        stage: 'convert',
        cause: expect.any(String),
      },
    } satisfies Partial<LottieConverterError>));
  });

  it('drops image layers with missing Asset references', async () => {
    const missingAssetJson = {
      v: '5.7.0',
      fr: 24,
      ip: 0,
      op: 24,
      w: 100,
      h: 100,
      nm: 'missing-asset-for-ir-validate',
      layers: [
        {
          ty: 2,
          nm: 'img-missing-asset',
          ind: 1,
          ip: 0,
          op: 24,
          st: 0,
          sr: 1,
          ks: {
            a: { a: 0, k: [50, 50, 0] },
            p: { a: 0, k: [50, 50, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
          w: 100,
          h: 100,
        },
      ],
      assets: [],
    } as unknown as LottieJSON;

    const result = convertLottieToIR(missingAssetJson);

    expect(result.scene.compositions[0].layers).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'LOTTIE_MISSING_IMAGE_ASSET',
      action: 'dropped',
      sourceId: '1',
      feature: 'missing-image-asset',
    }));
  });
});
