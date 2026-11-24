import { describe, expect, it } from 'vitest';
import {
  SVGConverterError,
  SVG_CONVERTER_ERROR_CODES,
  isSVGConverterErrorCode,
} from '../../../src/common/errors';
import { normalizeToConverterError } from '@svg2ir/internal-debug';

describe('SVGConverterError', () => {
  it('keeps code, message and details fields', () => {
    const error = new SVGConverterError('INVALID_SVG', 'invalid svg', { line: 12 });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SVGConverterError');
    expect(error.code).toBe('INVALID_SVG');
    expect(error.message).toBe('invalid svg');
    expect(error.details).toEqual({ line: 12 });
  });

  it('supports creating without details', () => {
    const error = new SVGConverterError('PARSE_FAIL', 'parse failed');

    expect(error.details).toBeUndefined();
    expect(error.code).toBe('PARSE_FAIL');
  });

  it('exports stable error code constants', () => {
    expect(SVG_CONVERTER_ERROR_CODES.INVALID_SVG).toBe('INVALID_SVG');
    expect(SVG_CONVERTER_ERROR_CODES.PARSE_FAIL).toBe('PARSE_FAIL');
    expect(SVG_CONVERTER_ERROR_CODES.IR_VALIDATION_FAILED).toBe('IR_VALIDATION_FAILED');
  });

  it('provides error code type guard', () => {
    expect(isSVGConverterErrorCode('INVALID_SVG')).toBe(true);
    expect(isSVGConverterErrorCode('NOT_A_REAL_CODE')).toBe(false);
    expect(isSVGConverterErrorCode(123)).toBe(false);
  });

  it('normalizes unknown IR internal code to IR_VALIDATION_FAILED', () => {
    const error = Object.assign(new Error('ir failed'), { code: 'IR_SHAPE_PAINT_INVALID' });
    const normalized = normalizeToConverterError(
      error,
      SVG_CONVERTER_ERROR_CODES.IR_VALIDATION_FAILED,
      'fallback',
    );

    expect(normalized).toBeInstanceOf(SVGConverterError);
    expect(normalized.code).toBe(SVG_CONVERTER_ERROR_CODES.IR_VALIDATION_FAILED);
    expect(normalized.details).toMatchObject({
      internalErrorCode: 'IR_SHAPE_PAINT_INVALID',
      validationCode: 'IR_SHAPE_PAINT_INVALID',
      cause: 'ir failed',
    });
  });

  it('adds projectionErrorCode for IR projection internal errors', () => {
    const error = Object.assign(new Error('projection failed'), { code: 'IR_PROJECTION_SHAPE_PAYLOAD_MISSING' });
    const normalized = normalizeToConverterError(
      error,
      SVG_CONVERTER_ERROR_CODES.IR_VALIDATION_FAILED,
      'fallback',
    );

    expect(normalized.code).toBe(SVG_CONVERTER_ERROR_CODES.IR_VALIDATION_FAILED);
    expect(normalized.details).toMatchObject({
      internalErrorCode: 'IR_PROJECTION_SHAPE_PAYLOAD_MISSING',
      projectionErrorCode: 'IR_PROJECTION_SHAPE_PAYLOAD_MISSING',
      cause: 'projection failed',
    });
  });

  it('returns original converter error directly', () => {
    const original = new SVGConverterError('INVALID_SVG', 'bad svg');
    const normalized = normalizeToConverterError(
      original,
      SVG_CONVERTER_ERROR_CODES.IR_VALIDATION_FAILED,
      'fallback',
    );

    expect(normalized).toBe(original);
  });
});
