import { describe, expect, it } from 'vitest';
import { IRPaintType, IRLineCap, IRLineJoin, IRShapePrimitiveType } from '@galacean/animation-ir';
import type { IRGradientPaint, IRSolidPaint } from '@galacean/animation-ir';
import type { LottieShapeElement } from '../../../src/common/conversion-types';
import { convertLottieShapes } from '../../../src/converter/convert-lottie-shapes';
import { expectShapePrimitive, minimalTransform, solidFill, solidStroke } from '../../helpers/shape-test-helpers';

describe('convertLottieShapes style and edge cases', () => {
  it('parses linear gradient fill', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } },
          {
            ty: 'gf',
            t: 1,
            o: { k: 100 },
            s: { k: [0, 0] },
            e: { k: [100, 0] },
            g: { p: 2, k: { k: [0, 1, 0, 0, 1, 0, 0, 1] } },
          },
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    expect(result[0].fills).toHaveLength(1);

    const fill = result[0].fills[0] as IRGradientPaint;

    expect(fill.type).toBe(IRPaintType.LinearGradient);
    expect(fill.gradientStops).toBeDefined();
    expect(fill.gradientStops).toHaveLength(2);
    expect(fill.gradientStops[0][0]).toBe(0);
    expect(fill.gradientStops[0][1]).toBe(1);
    expect(fill.gradientStops[1][0]).toBe(1);
    expect(fill.gradientStart).toEqual([0, 0]);
    expect(fill.gradientEnd).toEqual([100, 0]);
  });

  it('parses radial gradient fill', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'rc', p: { k: [0, 0] }, s: { k: [200, 200] }, r: { k: 0 } },
          {
            ty: 'gf',
            t: 2,
            o: { k: 80 },
            s: { k: [50, 50] },
            e: { k: [150, 50] },
            g: { p: 2, k: { k: [0, 0, 0, 0, 1, 1, 1, 1] } },
          },
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);
    const fill = result[0].fills[0] as IRGradientPaint;

    expect(fill.type).toBe(IRPaintType.RadialGradient);
    expect(fill.gradientStops).toHaveLength(2);
    expect(fill.gradientStart).toEqual([50, 50]);
    expect(fill.gradientEnd).toEqual([150, 50]);
  });

  it('parses gradient with alpha stops', () => {
    // Two color stops followed by two opacity stops.
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } },
          {
            ty: 'gf',
            t: 1,
            o: { k: 100 },
            s: { k: [0, 0] },
            e: { k: [100, 0] },
            g: { p: 2, k: { k: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0.5, 1, 1.0] } },
          },
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);
    const stops = (result[0].fills[0] as IRGradientPaint).gradientStops;

    expect(stops[0][4]).toBe(0.5);
    expect(stops[1][4]).toBe(1.0);
  });

  it('parses gradient stroke', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } },
          {
            ty: 'gs',
            t: 1,
            o: { k: 100 },
            w: { k: 4 },
            lc: 2,
            lj: 3,
            s: { k: [0, 0] },
            e: { k: [100, 100] },
            g: { p: 2, k: { k: [0, 1, 0, 0, 1, 0, 1, 0] } },
          },
          solidFill([1, 1, 1, 1]),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);
    const stroke = result[0].strokes[0];
    const paint = stroke.paint as IRGradientPaint;

    expect(result[0].strokes).toHaveLength(1);
    expect(paint.type).toBe(IRPaintType.LinearGradient);
    expect(paint.gradientStops).toHaveLength(2);
    expect(stroke.width).toBe(4);
  });

  it('passes top-level fill into gr group that has no fill', () => {
    const shapes = [
      solidFill([0.5, 0.5, 0.5, 1]),
      {
        ty: 'gr',
        it: [{ ty: 'el', p: { k: [0, 0] }, s: { k: [80, 80] } }, minimalTransform()],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    expect(result[0].fills).toHaveLength(1);
    expect((result[0].fills[0] as IRSolidPaint).color[0]).toBe(0.5);
  });

  it('passes top-level stroke into gr group that has no stroke', () => {
    const shapes = [
      solidStroke([0, 1, 0, 1], 5, 100, 3, 3),
      {
        ty: 'gr',
        it: [{ ty: 'el', p: { k: [0, 0] }, s: { k: [80, 80] } }, solidFill([1, 0, 0, 1]), minimalTransform()],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result[0].strokes).toHaveLength(1);
    expect((result[0].strokes[0].paint as IRSolidPaint).color[1]).toBe(1);
    expect(result[0].strokes[0].width).toBe(5);
  });

  it('does not override gr-level fill with top-level fill', () => {
    const shapes = [
      solidFill([0.1, 0.1, 0.1, 1]),
      {
        ty: 'gr',
        it: [{ ty: 'el', p: { k: [0, 0] }, s: { k: [80, 80] } }, solidFill([0.9, 0.9, 0.9, 1]), minimalTransform()],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result[0].fills).toHaveLength(1);
    expect((result[0].fills[0] as IRSolidPaint).color[0]).toBe(0.9);
  });

  it('passes top-level gradient fill into gr', () => {
    const shapes = [
      {
        ty: 'gf',
        t: 1,
        o: { k: 100 },
        s: { k: [0, 0] },
        e: { k: [50, 50] },
        g: { p: 2, k: { k: [0, 1, 0, 0, 1, 0, 0, 1] } },
      },
      {
        ty: 'gr',
        it: [{ ty: 'rc', p: { k: [0, 0] }, s: { k: [100, 100] }, r: { k: 0 } }, minimalTransform()],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result[0].fills).toHaveLength(1);
    expect(result[0].fills[0].type).toBe(IRPaintType.LinearGradient);
  });

  it('keeps a top-level NonZero fill rule implicit in IR', () => {
    const shapes = [
      { ty: 'fl', c: { k: [1, 0, 0] }, o: { k: 100 }, r: 1 },
      {
        ty: 'gr',
        it: [{ ty: 'el', p: { k: [0, 0] }, s: { k: [80, 80] } }, minimalTransform()],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result[0]).not.toHaveProperty('fillRule');
  });

  it('normalizes Lottie groups and styles from top-first to bottom-first IR order', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'rc', p: { k: [10, 0] }, s: { k: [20, 20] }, r: { k: 0 } },
          solidFill([1, 0, 0, 1]),
          solidFill([0, 0, 1, 1]),
          solidStroke([1, 0, 0, 1], 2),
          solidStroke([0, 0, 1, 1], 4),
          minimalTransform(),
        ],
      },
      {
        ty: 'gr',
        it: [
          { ty: 'rc', p: { k: [20, 0] }, s: { k: [20, 20] }, r: { k: 0 } },
          solidFill([0, 1, 0, 1]),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);
    const topShape = result[1];

    expect(result.map(shape => shape.position)).toEqual([[20, 0], [10, 0]]);
    expect(topShape.fills.map(fill => (fill as IRSolidPaint).color)).toEqual([
      [0, 0, 1, 1],
      [1, 0, 0, 1],
    ]);
    expect(topShape.strokes.map(stroke => stroke.width)).toEqual([4, 2]);
  });

  it('parses nested gr group recursively', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          {
            ty: 'gr',
            it: [{ ty: 'el', p: { k: [10, 20] }, s: { k: [60, 60] } }, solidFill([0, 0, 1, 1]), minimalTransform()],
          },
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Ellipse);

    expect(shape.xRadius).toBe(30);
    expect(shape.yRadius).toBe(30);
    expect((shape.fills[0] as IRSolidPaint).color[2]).toBe(1);
  });

  it('parses ungrouped shapes without gr wrapper', () => {
    const shapes = [
      { ty: 'el', p: { k: [0, 0] }, s: { k: [120, 80] } },
      solidFill([1, 0, 0, 1]),
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Ellipse);

    expect(shape.xRadius).toBe(60);
    expect(shape.yRadius).toBe(40);
  });

  it('parses ungrouped rectangle with stroke', () => {
    const shapes = [
      { ty: 'rc', p: { k: [0, 0] }, s: { k: [200, 100] }, r: { k: 5 } },
      solidStroke([0, 0, 1, 1], 2),
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    expect(result[0].primitiveType).toBe(IRShapePrimitiveType.Rectangle);
    expect(result[0].strokes).toHaveLength(1);
    expect(result[0].strokes[0].width).toBe(2);
  });

  it('parses ungrouped gradient fill without gr', () => {
    const shapes = [
      { ty: 'rc', p: { k: [0, 0] }, s: { k: [100, 100] }, r: { k: 0 } },
      {
        ty: 'gf',
        t: 2,
        o: { k: 100 },
        s: { k: [50, 50] },
        e: { k: [100, 50] },
        g: { p: 2, k: { k: [0, 1, 0, 0, 1, 0, 0, 1] } },
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    expect(result[0].fills[0].type).toBe(IRPaintType.RadialGradient);
  });

  it('skips hidden shapes with hd: true', () => {
    const shapes = [
      {
        ty: 'gr',
        hd: true,
        it: [{ ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } }, solidFill([1, 0, 0, 1]), minimalTransform()],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(0);
  });

  it('skips hidden elements inside gr', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] }, hd: true },
          { ty: 'rc', p: { k: [0, 0] }, s: { k: [200, 100] }, r: { k: 0 } },
          solidFill([1, 0, 0, 1]),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    expect(result[0].primitiveType).toBe(IRShapePrimitiveType.Rectangle);
  });

  it('skips hidden fill inside gr', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } },
          { ty: 'fl', c: { k: [1, 0, 0] }, o: { k: 100 }, hd: true },
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(0);
  });
  it('keeps NonZero implicit when fl.r is 1 inside gr', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } },
          { ty: 'fl', c: { k: [1, 0, 0] }, o: { k: 100 }, r: 1 },
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result[0]).not.toHaveProperty('fillRule');
  });

  it('keeps NonZero implicit on a gradient fill with r=1', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } },
          {
            ty: 'gf',
            t: 1,
            o: { k: 100 },
            r: 1,
            s: { k: [0, 0] },
            e: { k: [100, 0] },
            g: { p: 2, k: { k: [0, 1, 0, 0, 1, 0, 0, 1] } },
          },
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result[0]).not.toHaveProperty('fillRule');
  });

  it('applies transform scale to ellipse radii', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } },
          solidFill([1, 0, 0, 1]),
          minimalTransform([0, 0], [200, 50]),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Ellipse);

    expect(shape.xRadius).toBe(100);
    expect(shape.yRadius).toBe(25);
  });

  it('applies transform scale to rectangle dimensions', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'rc', p: { k: [0, 0] }, s: { k: [100, 100] }, r: { k: 0 } },
          solidFill([1, 0, 0, 1]),
          minimalTransform([0, 0], [200, 150]),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Rectangle);

    expect(shape.width).toBe(200);
    expect(shape.height).toBe(150);
  });

  it('applies transform position offset', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [10, 20] }, s: { k: [100, 100] } },
          solidFill([1, 0, 0, 1]),
          minimalTransform([30, 40], [100, 100]),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result[0].position).toEqual([40, 60]);
  });

  it('applies transform scale to star radius', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'sr', p: { k: [0, 0] }, pt: { k: 5 }, or: { k: 50 }, ir: { k: 20 } },
          solidFill([1, 1, 0, 1]),
          minimalTransform([0, 0], [200, 200]),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Star);

    expect(shape.outerRadius).toBe(100);
    expect(shape.innerRadius).toBe(40);
  });

  it('applies transform scale to gradient coordinates', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'rc', p: { k: [0, 0] }, s: { k: [100, 100] }, r: { k: 0 } },
          {
            ty: 'gf',
            t: 1,
            o: { k: 100 },
            s: { k: [10, 20] },
            e: { k: [90, 80] },
            g: { p: 2, k: { k: [0, 1, 0, 0, 1, 0, 0, 1] } },
          },
          minimalTransform([0, 0], [200, 50]),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);
    const fill = result[0].fills[0] as IRGradientPaint;

    expect(fill.gradientStart).toEqual([20, 10]);
    expect(fill.gradientEnd).toEqual([180, 40]);
  });

  it('filters out shapes without fills or strokes', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [{ ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } }, minimalTransform()],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    const { shapes: result } = convertLottieShapes([]);

    expect(result).toHaveLength(0);
  });

  it('handles fill opacity correctly', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } },
          { ty: 'fl', c: { k: [1, 0, 0] }, o: { k: 50 } },
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect((result[0].fills[0] as IRSolidPaint).color[3]).toBe(0.5);
  });

  it('handles both fill and stroke on same shape', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } },
          solidFill([1, 0, 0, 1]),
          solidStroke([0, 0, 1, 1], 2),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result[0].fills).toHaveLength(1);
    expect(result[0].strokes).toHaveLength(1);
    expect((result[0].fills[0] as IRSolidPaint).color[0]).toBe(1);
    expect((result[0].strokes[0].paint as IRSolidPaint).color[2]).toBe(1);
  });

  it('maps lineCap and lineJoin values correctly', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } },
          solidStroke([0, 0, 0, 1], 1, 100, 3, 3),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result[0].strokes[0]).toMatchObject({ cap: IRLineCap.Square, join: IRLineJoin.Bevel });
  });
});
