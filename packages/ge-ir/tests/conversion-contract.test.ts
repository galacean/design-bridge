import { describe, expectTypeOf, it } from 'vitest';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import type {
  GEToIRResult, IRToGEOptions, IRToGEResult,
} from '../src';

describe('conversion contracts', () => {
  it('uses the shared adapter diagnostic in GE-owned result types', () => {
    expectTypeOf<GEToIRResult['diagnostics']>().toEqualTypeOf<ConversionDiagnostic[]>();
    expectTypeOf<IRToGEResult['diagnostics']>().toEqualTypeOf<ConversionDiagnostic[]>();
    expectTypeOf<GEToIRResult>().toHaveProperty('scene');
    expectTypeOf<GEToIRResult>().toHaveProperty('preservedData');
    expectTypeOf<GEToIRResult['preservedData']>().toHaveProperty('particleSourceData');
    expectTypeOf<IRToGEOptions>().toHaveProperty('preservedData');

  });
});
