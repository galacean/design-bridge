import { describe, expect, expectTypeOf, it } from 'vitest';
import type { IRComposition } from '@galacean/animation-ir';
import * as dslIR from '../src';
import { createTestIRScene } from './fixtures/ir';

const { convertDSLToIR, convertIRToDSL, DSLValidationError, validateDSL } = dslIR;

const composition: IRComposition = {
  id: 'entry',
  name: 'Public API contract',
  width: 100,
  height: 100,
  frameRate: 30,
  inPoint: 0,
  outPoint: 30,
  endBehavior: 'freeze',
  layers: [],
};

describe('@galacean/dsl-ir result contracts', () => {
  it('always returns editable DSL with its IR-owned preserved data', () => {
    const result = convertIRToDSL(createTestIRScene(composition));

    expect(Object.keys(result).sort()).toEqual(['diagnostics', 'dsl', 'preservedData']);
  });

  it('validates Animation IR before projecting it into DSL', () => {
    const scene = createTestIRScene(structuredClone(composition));

    scene.compositions[0].frameRate = 0;

    expect(() => convertIRToDSL(scene)).toThrow(/IR_COMPOSITION_FRAME_RATE_INVALID/);
  });

  it('projects a valid zero-duration IR layer as warning-bearing DSL', () => {
    const zeroDurationComposition: IRComposition = {
      ...composition,
      layers: [{ id: 'zero-duration', type: 'null', time: { inFrame: 10, outFrame: 10 }, visible: true }],
    };
    const result = convertIRToDSL(createTestIRScene(zeroDurationComposition));
    const validation = validateDSL(result.dsl);

    expect(validation.result).toBe('pass');
    expect(validation.warnings).toContainEqual(expect.objectContaining({ code: 'L020' }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'L020' }));
  });

  it('stores an isolated baseline snapshot in preserved data', () => {
    const scene = createTestIRScene(composition);
    const result = convertIRToDSL(scene);

    scene.compositions[0].name = 'mutated after conversion';

    expect(result.preservedData.baselineScene.compositions[0].name).toBe('Public API contract');
  });

  it('returns JSON-stable preserved data that can reconstruct an unchanged IR scene', () => {
    const scene = createTestIRScene(composition);
    const result = convertIRToDSL(scene);

    expect(Object.keys(result).sort()).toEqual(['diagnostics', 'dsl', 'preservedData']);
    expect(Object.keys(result.preservedData).sort()).toEqual(['baselineScene', 'layerMapping']);
    expect(JSON.parse(JSON.stringify(result.preservedData))).toStrictEqual(result.preservedData);
    expect(convertDSLToIR(result.dsl, { preservedData: result.preservedData }).scene).toStrictEqual(scene);
  });

  it('preserves an omitted optional IR composition name on no-op writeback', () => {
    const unnamedComposition = structuredClone(composition);

    delete unnamedComposition.name;
    const scene = createTestIRScene(unnamedComposition);
    const result = convertIRToDSL(scene);

    expect(result.dsl.meta.name).toBe(composition.id);
    expect(convertDSLToIR(result.dsl, { preservedData: result.preservedData }).scene).toStrictEqual(scene);
  });

  it('rejects invalid preserved data structure', () => {
    const result = convertIRToDSL(createTestIRScene(composition));

    expect(() => convertDSLToIR(result.dsl, {
      preservedData: {
        ...result.preservedData,
        layerMapping: null as unknown as typeof result.preservedData.layerMapping,
      },
    })).toThrow(/Invalid IR-to-DSL layer mapping/);
  });

  it('rejects preserved-data mappings that reference a missing IR layer', () => {
    const result = convertIRToDSL(createTestIRScene(composition));

    expect(() => convertDSLToIR(result.dsl, {
      preservedData: {
        ...result.preservedData,
        layerMapping: {
          layers: {
            ghost: {
              irCompositionId: composition.id,
              irLayerId: 'missing-layer',
            },
          },
        },
      },
    })).toThrow(/Invalid mapping entry for DSL layer 'ghost'/);
  });

  it('validates DSL before inspecting preserved data', () => {
    const result = convertIRToDSL(createTestIRScene(composition));
    const invalidDSL = structuredClone(result.dsl);

    invalidDSL.meta.fps = 0;

    expect(() => convertDSLToIR(invalidDSL, {
      preservedData: {
        ...result.preservedData,
        layerMapping: null as unknown as typeof result.preservedData.layerMapping,
      },
    })).toThrow(DSLValidationError);
  });
});

describe('@galacean/dsl-ir public entry', () => {
  it('keeps shared animation fields optional and position required', () => {
    type Fields = 'time_range' | 'rotation' | 'scale' | 'anchor' | 'opacity';

    expectTypeOf<Pick<dslIR.Layer, Fields>>().toEqualTypeOf<Partial<Pick<dslIR.Layer, Fields>>>();
    expectTypeOf<dslIR.Layer['position']>().toEqualTypeOf<dslIR.AnimatedProperty<[number, number, number]>>();
    expectTypeOf<dslIR.Layer['opacity']>().toEqualTypeOf<dslIR.AnimatedProperty<number> | undefined>();
    expectTypeOf<dslIR.Layer['anchor']>().toEqualTypeOf<{ a: false; value: [number, number, number] } | undefined>();
    expectTypeOf<Extract<dslIR.Layer, { type: 'text' }>['text']>().toEqualTypeOf<dslIR.TextProperties>();
    expectTypeOf<Extract<dslIR.Layer, { type: 'particle' }>['particle']>().toEqualTypeOf<dslIR.ParticleProperties>();
  });

  it('exports expression tags for constructing particle parameters', () => {
    const lifetime: dslIR.NumberExpression = [dslIR.ValueType.RANDOM, [1, 2]];
    const rate: dslIR.NumberExpression = [dslIR.ValueType.CONSTANT, 10];

    expect(lifetime).toEqual([4, [1, 2]]);
    expect(rate).toEqual([0, 10]);
  });

  it('exposes only source-neutral DSL and Animation IR runtime APIs', () => {
    expect(Object.keys(dslIR).sort()).toEqual([
      'DSLValidationError',
      'ValueType',
      'convertDSLToIR',
      'convertIRToDSL',
      'parseParticleShape',
      'validateDSL',
    ]);
  });
});
