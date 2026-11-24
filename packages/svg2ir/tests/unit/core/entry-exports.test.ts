import { describe, expect, it } from 'vitest';
import * as api from '@galacean/svg2ir';
import * as debugApi from '@svg2ir/internal-debug';

describe('entry exports', () => {
  it('exports the SVG conversion entry points without internal stages', () => {
    expect(Object.keys(api).sort()).toEqual([
      'convertSVGToGE',
      'convertSVGToIR',
      'convertSVGToLayers',
      'inferNumericWeightFromFamily',
      'splitSVG',
    ]);
  });

  it('does not expose diagnostics or removed adapter helpers from the root entry', () => {
    const rootApi = api as Record<string, unknown>;

    expect(rootApi['SVGConverterError']).toBeUndefined();
    expect(rootApi['SVG_CONVERTER_ERROR_CODES']).toBeUndefined();
    expect(rootApi['SVG2IR_WARNING_CODES']).toBeUndefined();
    expect(rootApi['isSVGConverterErrorCode']).toBeUndefined();
    expect(rootApi['parseSVGToIRScene']).toBeUndefined();
    expect(rootApi['assembleSVGGE']).toBeUndefined();
    expect(rootApi['convertGEToStaticLayers']).toBeUndefined();
    expect(rootApi['convertSVGToEffects']).toBeUndefined();
    expect(rootApi['splitSVGToIR']).toBeUndefined();
  });

  it('exports only debugging helpers from the debug entry', () => {
    expect(typeof debugApi.parseSVGToIRScene).toBe('function');
    expect((debugApi as Record<string, unknown>)['convertSVGToIR']).toBeUndefined();
    expect((debugApi as Record<string, unknown>)['splitSVG']).toBeUndefined();
    expect((debugApi as Record<string, unknown>)['convertSVGToGE']).toBeUndefined();
    expect((debugApi as Record<string, unknown>)['convertSVGToEffects']).toBeUndefined();
    expect((debugApi as Record<string, unknown>)['generateEffectsJsonFromIR']).toBeUndefined();
    expect(typeof debugApi.normalizeToConverterError).toBe('function');
  });
});
