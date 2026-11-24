import { describe, expect, it } from 'vitest';
import { convertSVGToIR } from '@galacean/svg2ir';
import { SVG_CONVERTER_ERROR_CODES, type SVGConverterError } from '../../../src/common/errors';

describe('SVG conversion error branches', () => {
  it('throws INVALID_SVG for empty/whitespace string', () => {
    expect(() => convertSVGToIR('   ')).toThrowError(expect.objectContaining({
      name: 'SVGConverterError',
      code: SVG_CONVERTER_ERROR_CODES.INVALID_SVG,
    } satisfies Partial<SVGConverterError>));
  });

  // PARSE_FAIL 的错误归一化由 unit/core/errors.test.ts 覆盖。
});