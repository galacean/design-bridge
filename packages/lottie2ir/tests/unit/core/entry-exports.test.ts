import { describe, expect, it } from 'vitest';
import * as api from '@galacean/lottie2ir';

describe('entry exports', () => {
  it('exposes the Lottie to IR runtime contract from the root entry', () => {
    expect(Object.keys(api).sort()).toEqual([
      'LOTTIE_CONVERTER_ERROR_CODES', 'LottieConverterError',
      'convertLottieToIR', 'extractLottieFromZip',
    ]);
  });
});
