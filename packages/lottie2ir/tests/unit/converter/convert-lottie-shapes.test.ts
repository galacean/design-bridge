import { describe, expect, it } from 'vitest';
import { IRLineCap, IRLineJoin, IRShapePrimitiveType } from '@galacean/animation-ir';
import type { IRSolidPaint } from '@galacean/animation-ir';
import type { LottieShapeElement } from '../../../src/common/conversion-types';
import { convertLottieShapes } from '../../../src/converter/convert-lottie-shapes';
import { expectShapePrimitive, minimalTransform, solidFill, solidStroke } from '../../helpers/shape-test-helpers';

describe('convertLottieShapes', () => {
  it('parses ellipse shape', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [{ ty: 'el', p: { k: [50, 50] }, s: { k: [100, 80] } }, solidFill([1, 0, 0, 1]), minimalTransform()],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Ellipse);

    expect(shape.xRadius).toBe(50);
    expect(shape.yRadius).toBe(40);
    expect(shape.fills).toHaveLength(1);
    expect((shape.fills[0] as IRSolidPaint).color[0]).toBe(1);
  });

  it('parses rectangle shape', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'rc', p: { k: [50, 50] }, s: { k: [200, 100] }, r: { k: 10 } },
          solidFill([0, 0, 1, 1]),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Rectangle);

    expect(shape.width).toBe(200);
    expect(shape.height).toBe(100);
    expect(shape.cornerRadius).toBe(10);
  });

  it('clamps Rectangle corner radius to half of its shorter edge', () => {
    const { shapes: result } = convertLottieShapes([{
      ty: 'gr',
      it: [
        { ty: 'rc', p: { k: [0, 0] }, s: { k: [100, 40] }, r: { k: 80 } },
        solidFill([1, 0, 0, 1]),
        minimalTransform(),
      ],
    }] as unknown as LottieShapeElement[]);
    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Rectangle);

    expect(shape.cornerRadius).toBe(20);
  });

  it('parses stroke properties', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } },
          solidStroke([0, 1, 0, 1], 3, 100, 2, 2),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result[0].strokes).toHaveLength(1);
    const stroke = result[0].strokes[0];

    expect((stroke.paint as IRSolidPaint).color[1]).toBe(1);
    expect(stroke).toMatchObject({ width: 3, cap: IRLineCap.Round, join: IRLineJoin.Round });
  });

  it('keeps independent geometry while normalizing multiple strokes to bottom-first order', () => {
    const { shapes: result } = convertLottieShapes([{
      ty: 'gr',
      it: [
        { ty: 'el', p: { k: [0, 0] }, s: { k: [100, 100] } },
        solidStroke([1, 0, 0, 1], 2, 100, 1, 1),
        solidStroke([0, 0, 1, 1], 6, 100, 3, 3),
        minimalTransform(),
      ],
    }] as unknown as LottieShapeElement[]);
    const [bottom, top] = result[0].strokes;

    expect((bottom.paint as IRSolidPaint).color).toEqual([0, 0, 1, 1]);
    expect(bottom).toMatchObject({ width: 6, cap: IRLineCap.Square, join: IRLineJoin.Bevel });
    expect((top.paint as IRSolidPaint).color).toEqual([1, 0, 0, 1]);
    expect(top).toMatchObject({ width: 2, cap: IRLineCap.Butt, join: IRLineJoin.Miter });
  });

  it('keeps group geometry order behavior stable', () => {
    const rectThenEllipse = [
      {
        ty: 'gr',
        it: [
          { ty: 'rc', p: { k: [0, 0] }, s: { k: [200, 100] }, r: { k: 0 } },
          { ty: 'el', p: { k: [0, 0] }, s: { k: [120, 60] } },
          { ty: 'fl', c: { k: [1, 0, 0, 1] }, o: { k: 100 } },
          {
            ty: 'tr',
            p: { k: [0, 0] },
            s: { k: [100, 100] },
            r: { k: 0 },
            o: { k: 100 },
            a: { k: [0, 0] },
          },
        ],
      },
    ] as unknown as LottieShapeElement[];

    const ellipseThenRect = [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { k: [0, 0] }, s: { k: [120, 60] } },
          { ty: 'rc', p: { k: [0, 0] }, s: { k: [200, 100] }, r: { k: 0 } },
          { ty: 'fl', c: { k: [1, 0, 0, 1] }, o: { k: 100 } },
          {
            ty: 'tr',
            p: { k: [0, 0] },
            s: { k: [100, 100] },
            r: { k: 0 },
            o: { k: 100 },
            a: { k: [0, 0] },
          },
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: resultA } = convertLottieShapes(rectThenEllipse);
    const { shapes: resultB } = convertLottieShapes(ellipseThenRect);

    expect(resultA).toHaveLength(1);
    expect(resultB).toHaveLength(1);
    expect(resultA[0].primitiveType).toBe(IRShapePrimitiveType.Ellipse);
    expect(resultB[0].primitiveType).toBe(IRShapePrimitiveType.Rectangle);
  });

  it('keeps parsing stable with trim-path modifier order changes', () => {
    const modifierAfterGeometry = [
      {
        ty: 'gr',
        it: [
          { ty: 'rc', p: { k: [10, 20] }, s: { k: [120, 80] }, r: { k: 12 } },
          { ty: 'tm', s: { k: 0 }, e: { k: 100 }, o: { k: 0 } },
          { ty: 'fl', c: { k: [0, 0, 1, 1] }, o: { k: 100 } },
          {
            ty: 'tr',
            p: { k: [0, 0] },
            s: { k: [100, 100] },
            r: { k: 0 },
            o: { k: 100 },
            a: { k: [0, 0] },
          },
        ],
      },
    ] as unknown as LottieShapeElement[];

    const modifierBeforeGeometry = [
      {
        ty: 'gr',
        it: [
          { ty: 'tm', s: { k: 0 }, e: { k: 100 }, o: { k: 0 } },
          { ty: 'rc', p: { k: [10, 20] }, s: { k: [120, 80] }, r: { k: 12 } },
          { ty: 'fl', c: { k: [0, 0, 1, 1] }, o: { k: 100 } },
          {
            ty: 'tr',
            p: { k: [0, 0] },
            s: { k: [100, 100] },
            r: { k: 0 },
            o: { k: 100 },
            a: { k: [0, 0] },
          },
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: resultA } = convertLottieShapes(modifierAfterGeometry);
    const { shapes: resultB } = convertLottieShapes(modifierBeforeGeometry);

    expect(resultA).toHaveLength(1);
    expect(resultB).toHaveLength(1);
    const shapeA = expectShapePrimitive(resultA[0], IRShapePrimitiveType.Rectangle);
    const shapeB = expectShapePrimitive(resultB[0], IRShapePrimitiveType.Rectangle);

    expect(shapeA.width).toBe(120);
    expect(shapeB.width).toBe(120);
    expect(shapeA.cornerRadius).toBe(12);
    expect(shapeB.cornerRadius).toBe(12);
  });

  it('does not project trim-path into normalized shape data', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          {
            ty: 'sh',
            ks: {
              k: {
                v: [
                  [0, 0],
                  [100, 0],
                  [100, 50],
                  [0, 50],
                ],
                i: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
                o: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
                c: true,
              },
            },
          },
          { ty: 'tm', s: { k: 20 }, e: { k: 80 }, o: { k: 10 } },
          solidStroke([1, 1, 1, 1], 2, 100, 2, 2),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('trimPath');
  });

  it('does not project repeater into normalized shape data', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          {
            ty: 'sh',
            ks: {
              k: {
                v: [
                  [0, 0],
                  [50, 0],
                  [50, 50],
                  [0, 50],
                ],
                i: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
                o: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
                c: true,
              },
            },
          },
          {
            ty: 'rp',
            c: { k: 3 },
            o: { k: 1 },
            tr: {
              a: { k: [8, 4] },
              p: { k: [12, -6] },
              s: { k: [90, 110] },
              r: { k: 15 },
              so: { k: 90 },
              eo: { k: 20 },
            },
          },
          solidStroke([1, 1, 1, 1], 2, 100, 2, 2),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('repeater');
  });

  it('parses star shape with innerRadius', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          {
            ty: 'sr',
            p: { k: [0, 0] },
            pt: { k: 5 },
            or: { k: 80 },
            os: { k: 0 },
            ir: { k: 30 },
            is: { k: 0 },
          },
          solidFill([1, 1, 0, 1]),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Star);

    expect(shape.pointCount).toBe(5);
    expect(shape.outerRadius).toBe(80);
    expect(shape.innerRadius).toBe(30);
    expect(shape.outerRoundness).toBe(0);
    expect(shape.innerRoundness).toBe(0);
    expect(shape.fills).toHaveLength(1);
  });

  it('preserves star roundness values', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          {
            ty: 'sr',
            p: { k: [10, 20] },
            pt: { k: 6 },
            or: { k: 50 },
            os: { k: 15 },
            ir: { k: 20 },
            is: { k: 10 },
          },
          solidFill([0, 1, 1, 1]),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Star);

    expect(shape.outerRoundness).toBe(15);
    expect(shape.innerRoundness).toBe(10);
    expect(shape.position).toEqual([10, 20]);
  });

  it('parses polygon shape when innerRadius is zero', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          {
            ty: 'sr',
            p: { k: [0, 0] },
            pt: { k: 6 },
            or: { k: 60 },
            os: { k: 5 },
            ir: { k: 0 },
            is: { k: 0 },
          },
          solidFill([0, 0, 1, 1]),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Polygon);

    expect(shape.pointCount).toBe(6);
    expect(shape.radius).toBe(60);
    expect(shape.roundness).toBe(5);
  });

  it('parses polygon when ir property is missing', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [{ ty: 'sr', p: { k: [0, 0] }, pt: { k: 3 }, or: { k: 40 } }, solidFill([1, 0, 1, 1]), minimalTransform()],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Polygon);

    expect(shape.pointCount).toBe(3);
    expect(shape.radius).toBe(40);
  });

  it('parses custom path shape (sh)', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          {
            ty: 'sh',
            ks: {
              k: {
                v: [
                  [0, 0],
                  [100, 0],
                  [100, 50],
                  [0, 50],
                ],
                i: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
                o: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
                c: true,
              },
            },
          },
          solidFill([1, 0, 0, 1]),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Custom);

    expect(shape.customPaths).toHaveLength(1);

    const path = shape.customPaths[0];

    expect(path.points).toHaveLength(4);
    expect(path.points[0]).toEqual({ x: 0, y: 0 });
    expect(path.points[1]).toEqual({ x: 100, y: 0 });
    expect(path.closed).toBe(true);
    expect(path.inTangents).toHaveLength(4);
    expect(path.outTangents).toHaveLength(4);
  });

  it('parses multiple sh paths within a single group', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          {
            ty: 'sh',
            ks: {
              k: {
                v: [
                  [0, 0],
                  [50, 0],
                  [50, 50],
                ],
                i: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
                o: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
                c: true,
              },
            },
          },
          {
            ty: 'sh',
            ks: {
              k: {
                v: [
                  [60, 0],
                  [110, 0],
                  [110, 50],
                ],
                i: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
                o: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
                c: false,
              },
            },
          },
          solidFill([0, 1, 0, 1]),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);

    expect(result).toHaveLength(1);
    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Custom);

    expect(shape.customPaths).toHaveLength(2);
    expect(shape.customPaths[0].closed).toBe(true);
    expect(shape.customPaths[1].closed).toBe(false);
  });

  it('preserves curved path tangents in custom shape', () => {
    const shapes = [
      {
        ty: 'gr',
        it: [
          {
            ty: 'sh',
            ks: {
              k: {
                v: [
                  [0, 50],
                  [50, 0],
                  [100, 50],
                  [50, 100],
                ],
                i: [
                  [0, 27.6],
                  [-27.6, 0],
                  [0, -27.6],
                  [27.6, 0],
                ],
                o: [
                  [0, -27.6],
                  [27.6, 0],
                  [0, 27.6],
                  [-27.6, 0],
                ],
                c: true,
              },
            },
          },
          solidFill([1, 0, 0, 1]),
          minimalTransform(),
        ],
      },
    ] as unknown as LottieShapeElement[];

    const { shapes: result } = convertLottieShapes(shapes);
    const shape = expectShapePrimitive(result[0], IRShapePrimitiveType.Custom);
    const path = shape.customPaths[0];

    expect(path.inTangents[0]).toEqual({ x: 0, y: 27.6 });
    expect(path.outTangents[0]).toEqual({ x: 0, y: -27.6 });
  });
});
