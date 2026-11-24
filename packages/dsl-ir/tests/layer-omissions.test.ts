import { describe, expect, it } from 'vitest';
import { convertDSLToIR, convertIRToDSL, validateDSL, type Composition, type Layer } from '../src';
import { createTestLayer } from './fixtures/dsl';

const optionalFields = ['time_range', 'rotation', 'scale', 'anchor', 'opacity'] as const;
const layerTypes = ['null', 'layer', 'text', 'particle'] as const;

function createDocument(type: Layer['type']): Composition {
  const layer = createTestLayer('subject', 'Subject', type);

  if (type === 'layer') {
    layer.asset = { source: 'user', url: 'https://example.com/image.png', prompt: '' };
  }

  return {
    meta: { name: 'Optional fields', width: 400, height: 300, fps: 30, duration: 2, loop: false },
    layers: [layer],
  };
}

describe.each(layerTypes)('%s layer omissions', type => {
  it('uses defaults for fresh conversion without completing the input DSL', () => {
    const dsl = createDocument(type);

    for (const field of optionalFields) {
      Reflect.deleteProperty(dsl.layers[0], field);
    }
    const snapshot = structuredClone(dsl);

    expect(validateDSL(dsl).result).toBe('pass');
    const result = convertDSLToIR(dsl).scene.compositions[0].layers[0];

    expect(result.time).toEqual({ inFrame: 0, outFrame: 60 });
    expect(result.transform).toMatchObject({
      rotation: { x: { value: 0 }, y: { value: 0 }, z: { value: 0 } },
      scale: { type: 'static', value: [1, 1, 1] },
      anchor: { type: 'static', value: [0, 0, 0] },
      opacity: { type: 'static', value: 1 },
    });
    expect(dsl).toEqual(snapshot);
  });

  it('retains source timing and animated transforms when omitted during preserved write-back', () => {
    const scene = convertDSLToIR(createDocument(type)).scene;
    const source = scene.compositions[0].layers[0];

    source.time = { inFrame: 3, outFrame: 48 };
    source.transform = {
      rotation: { z: { type: 'keyframed', keyframes: [{ frame: 0, value: 20 }, { frame: 60, value: 90 }] } },
      scale: { type: 'static', value: [2, 3, 1] },
      anchor: { type: 'static', value: [10, 20, 0] },
      opacity: { type: 'static', value: 0.5 },
    };
    const { dsl, preservedData } = convertIRToDSL(scene);

    for (const field of optionalFields) {
      Reflect.deleteProperty(dsl.layers[0], field);
    }
    const snapshot = structuredClone(dsl);

    expect(convertDSLToIR(dsl, { preservedData }).scene).toEqual(scene);
    expect(dsl).toEqual(snapshot);

    dsl.layers[0].opacity = { a: false, value: 1 };
    const reset = convertDSLToIR(dsl, { preservedData }).scene.compositions[0].layers[0];

    expect(reset.transform?.opacity).toEqual({ type: 'static', value: 1 });
    expect(reset.transform?.scale).toEqual(source.transform.scale);
  });

  it('still rejects malformed explicit values and a missing position', () => {
    for (const field of optionalFields) {
      for (const value of [null, 'invalid']) {
        const dsl = createDocument(type);

        Reflect.set(dsl.layers[0], field, value);
        expect(validateDSL(dsl).result, `${field}: ${String(value)}`).toBe('fail');
      }
    }
    const dsl = createDocument(type);

    Reflect.deleteProperty(dsl.layers[0], 'position');
    expect(validateDSL(dsl).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'P001', path: 'layers[0].position' }),
    ]));
  });
});
