import * as spec from '@galacean/effects-specification';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DURATION,
  DEFAULT_PREVIEW_SIZE,
  normalizeConversionOptions,
} from '../../src/converter/normalize-conversion-options';

describe('normalizeConversionOptions', () => {
  it('should preserve valid scene options', () => {
    const result = normalizeConversionOptions({
      sceneName: 'ValidScene',
      duration: 8,
      previewSize: [1280, 720],
      endBehavior: spec.EndBehavior.freeze,
    });

    expect(result.options).toEqual({
      sceneName: 'ValidScene',
      duration: 8,
      previewSize: [1280, 720],
      endBehavior: spec.EndBehavior.freeze,
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('should replace invalid scene options with safe defaults', () => {
    const result = normalizeConversionOptions({
      duration: Number.NaN,
      previewSize: [0, Number.POSITIVE_INFINITY],
      endBehavior: 999 as spec.EndBehavior,
    });

    expect(result.options.duration).toBe(DEFAULT_DURATION);
    expect(result.options.previewSize).toEqual(DEFAULT_PREVIEW_SIZE);
    expect(result.options.endBehavior).toBe(spec.EndBehavior.restart);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'OPTION_DURATION_INVALID',
      'OPTION_PREVIEW_SIZE_INVALID',
      'OPTION_END_BEHAVIOR_INVALID',
    ]);
  });
});
