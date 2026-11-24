import { describe, expect, it } from 'vitest';
import { IRBlendMode } from '@galacean/animation-ir';
import { BlendingMode } from '@galacean/effects-specification';
import { convert2dTo3dPoint, convert3dTo2dPoint } from '../../src/common/coordinate-mapping';
import { mapBlendModeToIR } from '../../src/ge2ir/mapping';
import { mapBlendModeToGE } from '../../src/ir2ge/mapping';

describe('GE coordinate mapping', () => {
  it('inverts perspective-adjusted non-zero z points', () => {
    const width = 720;
    const height = 1280;
    const source: [number, number, number] = [123, 456, 2.5];
    const GEPoint = convert2dTo3dPoint(source[0], source[1], source[2], width, height);
    const restored = convert3dTo2dPoint(GEPoint[0], GEPoint[1], GEPoint[2], width, height);

    expect(restored[0]).toBeCloseTo(source[0], 6);
    expect(restored[1]).toBeCloseTo(source[1], 6);
    expect(restored[2]).toBeCloseTo(source[2], 6);
  });
});

describe('GE blend mode mapping', () => {
  const supportedPairs = [
    [BlendingMode.ADD, IRBlendMode.Add],
    [BlendingMode.MULTIPLY, IRBlendMode.Multiply],
    [BlendingMode.BRIGHTNESS, IRBlendMode.Lighten],
    [BlendingMode.SUBTRACTION, IRBlendMode.Difference],
    [BlendingMode.STRONG_LIGHT, IRBlendMode.HardLight],
    [BlendingMode.WEAK_LIGHT, IRBlendMode.SoftLight],
    [BlendingMode.SUPERPOSITION, IRBlendMode.Overlay],
  ] as const;

  it.each(supportedPairs)('round-trips GE mode %s through %s', (GEBlendMode, IRMode) => {
    expect(mapBlendModeToIR(GEBlendMode)).toBe(IRMode);
    expect(mapBlendModeToGE(IRMode)).toBe(GEBlendMode);
  });

  it('uses the default GE alpha blend for normalized normal mode', () => {
    expect(mapBlendModeToIR(BlendingMode.ALPHA)).toBeUndefined();
    expect(mapBlendModeToGE(IRBlendMode.Normal)).toBeUndefined();
  });

  it.each([8, 9, 10, 11, 12, 13, 14, 15, 16])('rejects out-of-spec GE mode %s', GEBlendMode => {
    expect(mapBlendModeToIR(GEBlendMode)).toBeUndefined();
  });

  it.each([
    IRBlendMode.Screen,
    IRBlendMode.Darken,
    IRBlendMode.ColorDodge,
    IRBlendMode.ColorBurn,
    IRBlendMode.Exclusion,
    IRBlendMode.Hue,
    IRBlendMode.Saturation,
    IRBlendMode.Color,
    IRBlendMode.Luminosity,
  ])('does not emit an invalid GE value for unsupported IR mode %s', IRMode => {
    expect(mapBlendModeToGE(IRMode)).toBeUndefined();
  });
});
