import { describe, expect, it } from 'vitest';
import type { IRGradientColorStop, IRGradientPaint } from '@galacean/animation-ir';
import { validateIRScene } from '@galacean/animation-ir/validator';
import { makeComposition, makeScene } from './test-scene';

const stops: IRGradientColorStop[] = [[0, 1, 0, 0, 1], [1, 0, 0, 1, 0.5]];
const gradient: IRGradientPaint = {
  type: 'linear-gradient', gradientStops: { type: 'static', value: stops },
  gradientStart: { type: 'static', value: [0, 0] }, gradientEnd: { type: 'static', value: [10, 10] },
};

function validatePaint(paint: unknown, width: unknown = { type: 'static', value: 1 }) {
  return validateIRScene({
    ...makeScene([{ id: 'image', type: 'image', source: { kind: 'url', url: 'https://example.com/image.png' } }]),
    compositions: [{
      ...makeComposition(),
      layers: [{
        id: 'shape', type: 'shape', visible: true, time: { inFrame: 0, outFrame: 60 },
        content: { shapes: [{
          primitiveType: 'rectangle',
          width: { type: 'static', value: 10 }, height: { type: 'static', value: 10 },
          position: { type: 'static', value: [0, 0] },
          fills: [paint], strokes: [{ paint, width, cap: 'round', join: 'round' }],
        }] },
      }],
    }],
  });
}

function validateColor(color: unknown) {
  return validatePaint({ type: 'solid', color });
}

describe('paint animation contract', () => {
  it('accepts animated RGBA with segment endpoints and temporal easing', () => {
    expect(validateColor({
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: [1, 0, 0, 1], endValue: [0, 0, 1, 0.5], outTangent: { x: 0.2, y: 0 } },
        { frame: 30, value: [0, 1, 0, 0], inTangent: { x: 0.8, y: 1 }, hold: true },
        { frame: 60, value: [1, 0, 0, 1] },
      ],
    }).valid).toBe(true);
  });

  it.each([
    undefined,
    [1, 0, 0, 1],
    { type: 'static', value: [1, 0, 0] },
    { type: 'keyframed', keyframes: [] },
    { type: 'keyframed', keyframes: [{ frame: 0, value: [1, 0, 0, 2] }] },
    { type: 'keyframed', keyframes: [{ frame: 0, value: [1, 0, 0, 1], endValue: [0, 0, 0, -1] }] },
    { type: 'keyframed', keyframes: [{ frame: 0, value: [1, 0, 0, 1], spatialOut: [1, 0] }] },
  ].map(color => ({ color })))('rejects invalid color properties: $color', ({ color }) => {
    expect(validateColor(color).valid).toBe(false);
  });

  it.each([
    { type: 'solid', color: { type: 'static', value: [1, 0, 0, 0.5] } },
    gradient,
    { type: 'texture', assetId: 'image' },
  ])('supports independent animated opacity for fills and strokes: $type', paint => {
    const opacity = { type: 'keyframed', keyframes: [{ frame: 0, value: 0.2 }, { frame: 30, value: 0.8 }] };

    expect(validatePaint({ ...paint, opacity }).errors).toEqual([]);
    const invalid = validatePaint({ ...paint, opacity: { type: 'static', value: 2 } });

    expect(invalid.errors.map(issue => issue.path)).toEqual([
      'compositions[0].layers[0].content.shapes[0].fills[0].opacity.value',
      'compositions[0].layers[0].content.shapes[0].strokes[0].paint.opacity.value',
    ]);
  });

  it('accepts animated gradient positions, colors and stroke width', () => {
    const paint: IRGradientPaint = {
      ...gradient,
      gradientStops: { type: 'keyframed', keyframes: [
        { frame: 0, value: stops, outTangent: { x: 0.2, y: 0 } },
        { frame: 30, value: [[0.2, 0, 1, 0, 0.5], [0.8, 1, 0, 0, 1]], inTangent: { x: 0.8, y: 1 } },
      ] },
      gradientStart: { type: 'keyframed', keyframes: [{ frame: 0, value: [0, 0] }, { frame: 30, value: [10, 10] }] },
      gradientEnd: { type: 'keyframed', keyframes: [{ frame: 0, value: [10, 10] }, { frame: 30, value: [20, 20] }] },
    };
    const width = { type: 'keyframed', keyframes: [{ frame: 0, value: 0, endValue: 4 }, { frame: 30, value: 2 }] };

    expect(validatePaint(paint, width).errors).toEqual([]);
    expect(validatePaint(paint, {
      type: 'keyframed', keyframes: [{ frame: 0, value: 1, endValue: -1 }],
    }).errors).toContainEqual(expect.objectContaining({
      path: 'compositions[0].layers[0].content.shapes[0].strokes[0].width.keyframes[0].endValue',
    }));
  });

  it('requires equal stop counts only for continuous segments and respects explicit endValue', () => {
    const first = { frame: 0, value: stops };
    const next = { frame: 30, value: [[0, 1, 1, 1, 1]] };
    const validateStops = (keyframes: unknown[]) => validatePaint({
      ...gradient, gradientStops: { type: 'keyframed', keyframes },
    });

    expect(validateStops([first, next]).errors).toContainEqual(expect.objectContaining({
      code: 'IR_SHAPE_PAINT_INVALID',
      path: 'compositions[0].layers[0].content.shapes[0].fills[0].gradientStops.keyframes[0]',
    }));
    expect(validateStops([{ ...first, hold: true }, next]).valid).toBe(true);
    expect(validateStops([{ ...first, endValue: stops }, next]).valid).toBe(true);
    expect(validateStops([{ ...first, endValue: next.value }, { ...next, value: stops }]).valid).toBe(false);
  });

  it.each([
    [], [[0, 1, 0, 0]], [[0, 1, 0, 0, 2]], [[0.8, 1, 0, 0, 1], [0.2, 0, 1, 0, 1]],
  ].map(value => ({ value })))('validates animated gradient endValue: $value', ({ value }) => {
    expect(validatePaint({
      ...gradient,
      gradientStops: { type: 'keyframed', keyframes: [{ frame: 0, value: stops, endValue: value }] },
    }).errors).toContainEqual(expect.objectContaining({ code: 'IR_SHAPE_PAINT_INVALID' }));
  });
});
