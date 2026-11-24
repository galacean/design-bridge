import { describe, expect, it } from 'vitest';
import { LottieConverterError, LOTTIE_CONVERTER_ERROR_CODES } from '@galacean/lottie2ir';
import { normalizeToConverterError } from '../../../src/common/converter-error';

describe('LottieConverterError', () => {
  it('keeps code, message and details fields', () => {
    const error = new LottieConverterError('INVALID_LOTTIE_JSON', 'invalid json', { line: 12 });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('LottieConverterError');
    expect(error.code).toBe('INVALID_LOTTIE_JSON');
    expect(error.message).toBe('invalid json');
    expect(error.details).toEqual({ line: 12 });
  });

  it('supports creating without details', () => {
    const error = new LottieConverterError('INVALID_LOTTIE_JSON', 'invalid json');

    expect(error.details).toBeUndefined();
    expect(error.code).toBe('INVALID_LOTTIE_JSON');
  });

  it('exports stable error code constants', () => {
    expect(Object.values(LOTTIE_CONVERTER_ERROR_CODES).sort()).toEqual([
      'CONVERT_PIPELINE_FAILED', 'INVALID_LOTTIE_JSON', 'IR_VALIDATION_FAILED',
      'ZIP_JSON_NOT_FOUND', 'ZIP_PARSE_FAILED',
    ]);
  });

  it('preserves the internal code for IR validation failures', () => {
    const error = Object.assign(new Error('ir failed'), { code: 'IR_SHAPE_FEATURE_UNSUPPORTED' });
    const normalized = normalizeToConverterError(
      error,
      LOTTIE_CONVERTER_ERROR_CODES.IR_VALIDATION_FAILED,
      'fallback',
    );

    expect(normalized).toBeInstanceOf(LottieConverterError);
    expect(normalized.code).toBe(LOTTIE_CONVERTER_ERROR_CODES.IR_VALIDATION_FAILED);
    expect(normalized.details).toMatchObject({
      internalErrorCode: 'IR_SHAPE_FEATURE_UNSUPPORTED',
      cause: 'ir failed',
    });
  });

  it('keeps the caller-selected public code for conversion failures', () => {
    const error = Object.assign(new Error('conversion failed'), { code: 'IR_SHAPE_FEATURE_UNSUPPORTED' });
    const normalized = normalizeToConverterError(
      error,
      LOTTIE_CONVERTER_ERROR_CODES.CONVERT_PIPELINE_FAILED,
      'fallback',
    );

    expect(normalized.code).toBe(LOTTIE_CONVERTER_ERROR_CODES.CONVERT_PIPELINE_FAILED);
    expect(normalized.details).toEqual({
      internalErrorCode: 'IR_SHAPE_FEATURE_UNSUPPORTED',
      cause: 'conversion failed',
    });
  });

  it('returns original converter error directly', () => {
    const original = new LottieConverterError('INVALID_LOTTIE_JSON', 'invalid json');
    const normalized = normalizeToConverterError(
      original,
      LOTTIE_CONVERTER_ERROR_CODES.CONVERT_PIPELINE_FAILED,
      'fallback',
    );

    expect(normalized).toBe(original);
  });

  it('normalizes structural lookalikes into real converter errors', () => {
    const lookalike = {
      name: 'LottieConverterError',
      code: LOTTIE_CONVERTER_ERROR_CODES.INVALID_LOTTIE_JSON,
    };
    const normalized = normalizeToConverterError(
      lookalike,
      LOTTIE_CONVERTER_ERROR_CODES.CONVERT_PIPELINE_FAILED,
      'fallback',
    );

    expect(lookalike).not.toBeInstanceOf(LottieConverterError);
    expect(normalized).toBeInstanceOf(LottieConverterError);
    expect(normalized).not.toBe(lookalike);
    expect(normalized.message).toBe('fallback');
  });
});
