import { describe, expect, it } from 'vitest';

import type { IRComposition, IRMask, IRScene, IRShape } from '@galacean/animation-ir';
import {
  IREndBehavior, IRPaintType, IRMaskMode, IRMatteMode, IRShapePrimitiveType,
  IRTextureScaleMode,
} from '@galacean/animation-ir';
import { createIRScene } from '@galacean/animation-ir/adapter';
import { assertIRScene, validateIRScene } from '@galacean/animation-ir/validator';
import { makeComposition, makeLayer } from './test-scene';

function createValidationScene(
  composition: IRComposition,
  additionalAssets: IRScene['assets'] = [],
): IRScene {
  const hasBodyFontReference = composition.layers.some(
    layer => layer.type === 'text' && layer.content.fontAssetId === 'font:body',
  );
  const assets = [...additionalAssets];

  if (hasBodyFontReference && !assets.some(asset => asset.id === 'font:body')) {
    assets.push({
      id: 'font:body', type: 'font', family: 'Arial', style: 'normal', weight: 400,
      source: { kind: 'system' },
    });
  }

  return {
    format: 'animation-ir',
    schemaVersion: '1.0.0',
    entryCompositionId: 'composition',
    compositions: [composition],
    assets,
  };
}

function assertComposition(composition: IRComposition, additionalAssets: IRScene['assets'] = []): void {
  assertIRScene(createValidationScene(composition, additionalAssets));
}

function validateComposition(composition: IRComposition, additionalAssets: IRScene['assets'] = []) {
  return validateIRScene(createValidationScene(composition, additionalAssets));
}

describe('assertComposition', () => {
  it('accepts a minimal Composition with a fractional frame rate', () => {
    expect(() => assertComposition(makeComposition({ frameRate: 29.97 }))).not.toThrow();
  });

  it('throws when composition.endBehavior is missing or invalid', () => {
    expect(() => assertComposition(makeComposition({ endBehavior: IREndBehavior.Continue }))).not.toThrow();
    for (const endBehavior of [undefined, 'forward']) {
      expect(() => assertComposition(makeComposition({ endBehavior } as never))).toThrowError(
        /IR_COMPOSITION_END_BEHAVIOR_INVALID/,
      );
    }
  });

  it('throws when composition.width is invalid', () => {
    expect(() => assertComposition(makeComposition({ width: 0 }))).toThrowError(
      /IR_COMPOSITION_WIDTH_INVALID/,
    );
  });

  it('throws when composition.frameRate is invalid', () => {
    for (const frameRate of [0, -1, Number.POSITIVE_INFINITY, '30']) {
      expect(() => assertComposition(makeComposition({ frameRate: frameRate as never }))).toThrowError(
        /IR_COMPOSITION_FRAME_RATE_INVALID/,
      );
    }
  });

  it('throws when composition time range is inverted', () => {
    expect(() => assertComposition(makeComposition({ inPoint: 60, outPoint: 0 }))).toThrowError(
      /IR_COMPOSITION_TIME_RANGE_INVALID/,
    );
  });

  it('accepts an empty Layer interval but rejects an empty Composition interval', () => {
    const layer = makeLayer({ time: { inFrame: 10, outFrame: 10 } });

    expect(() => assertComposition(makeComposition({ layers: [layer] }))).not.toThrow();
    expect(() => assertComposition(makeComposition({ inPoint: 10, outPoint: 10 }))).toThrowError(
      /IR_COMPOSITION_TIME_RANGE_INVALID/,
    );
  });

  it('throws when composition background color is not RGBA', () => {
    expect(() => assertComposition(makeComposition({ backgroundColor: [1, 1, 1] as never }))).toThrowError(
      /IR_COMPOSITION_BACKGROUND_COLOR_INVALID/,
    );
  });

  it('throws when a layer has an invalid time range', () => {
    const layer = makeLayer({ time: { inFrame: 60, outFrame: 0 } });

    expect(() => assertComposition(makeComposition({ layers: [layer] }))).toThrowError(
      /IR_LAYER_TIME_RANGE_INVALID/,
    );
  });

  it('still requires inFrame when additional startFrame metadata is present', () => {
    const layer = makeLayer({ time: { startFrame: 0, outFrame: 60 } as never });

    expect(() => assertComposition(makeComposition({ layers: [layer] }))).toThrowError(
      /IR_LAYER_TIME_START_INVALID.*layers\[0\]\.time\.inFrame/s,
    );
  });

  it('still requires outFrame when additional endFrame metadata is present', () => {
    const layer = makeLayer({ time: { inFrame: 0, endFrame: 60 } as never });

    expect(() => assertComposition(makeComposition({ layers: [layer] }))).toThrowError(
      /IR_LAYER_TIME_END_INVALID.*layers\[0\]\.time\.outFrame/s,
    );
  });

  it('requires a boolean visible field', () => {
    const hiddenLayer = makeLayer({ visible: false });
    const invalidLayer = makeLayer({ visible: 'yes' as never });

    expect(() => assertComposition(makeComposition({ layers: [hiddenLayer] }))).not.toThrow();
    expect(() => assertComposition(makeComposition({ layers: [invalidLayer] }))).toThrowError(
      /IR_LAYER_VISIBILITY_INVALID/,
    );
  });

  it('throws when a layer parents itself', () => {
    const layer = makeLayer({
      parentId: 'layer-0',
    });

    expect(() => assertComposition(makeComposition({ layers: [layer] }))).toThrowError(
      /IR_LAYER_PARENT_SELF_REFERENCE/,
    );
  });

  it('resolves a Transform Parent that comes after its child and has a separate active interval', () => {
    const parent = makeLayer({ time: { inFrame: 30, outFrame: 60 } });
    const child = makeLayer({
      id: 'layer-1',
      parentId: 'layer-0',
      time: { inFrame: 0, outFrame: 10 },
    });

    expect(() => assertComposition(makeComposition({ layers: [child, parent] }))).not.toThrow();
  });

  it('validates Layer matte references and channels', () => {
    const source = makeLayer({ id: 'matte-source', name: 'matte-source' });
    const mask: IRMask = {
      mode: IRMaskMode.Add,
      path: {
        points: [{ x: 0, y: 0 }],
        inTangents: [{ x: 0, y: 0 }],
        outTangents: [{ x: 0, y: 0 }],
        closed: true,
      },
    };
    const target = makeLayer({
      id: 'matte-target',
      masks: [mask],
      matte: { sourceLayerId: source.id, mode: IRMatteMode.Alpha, inverted: true },
    });

    expect(() => assertComposition(makeComposition({ layers: [source, target] }))).not.toThrow();

    const self = makeLayer({
      id: 'matte-self',
      matte: { sourceLayerId: 'matte-self', mode: IRMatteMode.Geometry },
    });
    const missing = makeLayer({
      id: 'matte-missing',
      matte: { sourceLayerId: 'absent', mode: IRMatteMode.Alpha },
    });
    const invalid = makeLayer({
      id: 'matte-invalid',
      matte: { sourceLayerId: source.id, mode: 'red', inverted: 1 } as never,
    });

    expect(() => assertComposition(makeComposition({ layers: [self] }))).toThrowError(
      /IR_LAYER_MATTE_SELF_REFERENCE/,
    );
    expect(() => assertComposition(makeComposition({ layers: [missing] }))).toThrowError(
      /IR_LAYER_MATTE_SOURCE_OUT_OF_RANGE/,
    );
    expect(() => assertComposition(makeComposition({ layers: [source, invalid] }))).toThrowError(
      /IR_LAYER_MATTE_INVALID/,
    );
  });

  it('throws when transform tuple dimensions are invalid', () => {
    const layer = makeLayer({
      transform: {
        position: {
          type: 'static',
          value: [0, 0] as never,
        },
      },
    });

    expect(() => assertComposition(makeComposition({ layers: [layer] }))).toThrowError(
      /IR_ANIMATED_PROPERTY_INVALID/,
    );
  });

  it('throws when keyframe endValue dimensions are invalid', () => {
    const layer = makeLayer({
      transform: {
        position: {
          type: 'keyframed',
          keyframes: [
            { frame: 0, value: [0, 0, 0], endValue: [10, 10] as never },
            { frame: 30, value: [10, 10, 0] },
          ],
        },
      },
    });

    expect(() => assertComposition(makeComposition({ layers: [layer] }))).toThrowError(
      /IR_ANIMATED_PROPERTY_INVALID/,
    );
  });

  it('rejects a keyframed anchor', () => {
    const layer = makeLayer({
      transform: {
        anchor: {
          type: 'keyframed',
          keyframes: [{ frame: 0, value: [0, 0, 0] }],
        } as never,
      },
    });

    expect(() => assertComposition(makeComposition({ layers: [layer] }))).toThrowError(/static-only/);
  });

  it('throws when rotation has no axis channels', () => {
    const layer = makeLayer({
      transform: {
        rotation: {},
      },
    });

    expect(() => assertComposition(makeComposition({ layers: [layer] }))).toThrowError(
      /IR_TRANSFORM_INVALID/,
    );
  });

  it('requires Image localBounds instead of deriving display geometry from the Asset', () => {
    const missingBoundsDocument = createIRScene(makeComposition({
      layers: [makeLayer({ type: 'image', content: { assetId: 'image:hero' } })],
    }), [{
      id: 'image:hero',
      type: 'image',
      source: { kind: 'url', url: 'https://example.com/hero.png' },
    }]);
    const validDocument = structuredClone(missingBoundsDocument);

    expect(() => assertIRScene(missingBoundsDocument)).toThrowError(/IR_LAYER_LOCAL_BOUNDS_INVALID/);
    validDocument.compositions[0].layers[0].localBounds = { x: 0, y: 0, width: 320, height: 180 };

    expect(() => assertIRScene(validDocument)).not.toThrow();
    expect(validDocument.compositions[0]?.layers[0]?.localBounds).toEqual({ x: 0, y: 0, width: 320, height: 180 });
  });

  it('throws when text data has invalid color', () => {
    const layer = makeLayer({
      type: 'text',
      content: {
        color: [1, 1, 1] as never,
        text: 'hello',
        fontAssetId: 'font:body',
        fontSize: 24,
        letterSpacing: 0,
        lineHeight: 28,
        textAlign: 'center',
      },
    });

    expect(() => assertComposition(makeComposition({ layers: [layer] }))).toThrowError(
      /IR_TEXT_COLOR_INVALID/,
    );
  });

  it('rejects missing Shape content and warns about an empty Shape list', () => {
    const missing = makeLayer({ type: 'shape' });
    const empty = makeLayer({ id: 'layer-1', type: 'shape', content: { shapes: [] } });

    expect(() => assertComposition(makeComposition({ layers: [missing] }))).toThrowError(
      /IR_SHAPE_DATA_MISSING/,
    );
    expect(validateComposition(makeComposition({ layers: [empty] })).warnings).toEqual([
      expect.objectContaining({
        code: 'IR_SHAPE_DATA_EMPTY',
        path: 'compositions[0].layers[0].content.shapes',
      }),
    ]);
  });

  it('accepts valid shape data and rejects invalid shape paint', () => {
    const validShape: IRShape = {
      primitiveType: IRShapePrimitiveType.Rectangle,
      width: { type: 'static', value: 10 },
      height: { type: 'static', value: 10 },
      fills: [{ type: IRPaintType.Solid, color: { type: 'static', value: [1, 0, 0, 1] } }],
      strokes: [],
      position: { type: 'static', value: [0, 0] },
    };
    const invalidShape = {
      ...validShape,
      fills: [{ type: IRPaintType.Solid }],
    };

    expect(() =>
      assertComposition(
        makeComposition({
          layers: [makeLayer({ type: 'shape', content: { shapes: [validShape] } })],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertComposition(
        makeComposition({
          layers: [makeLayer({ type: 'shape', content: { shapes: [invalidShape as never] } })],
        }),
      ),
    ).toThrowError(/IR_SHAPE_PAINT_INVALID/);
  });

  it('validates texture paint through an Image Asset ID', () => {
    const validShape: IRShape = {
      primitiveType: IRShapePrimitiveType.Rectangle,
      width: { type: 'static', value: 10 },
      height: { type: 'static', value: 10 },
      fills: [
        {
          type: IRPaintType.Texture,
          assetId: 'image:texture',
        },
      ],
      strokes: [{
        paint: { type: IRPaintType.Texture, assetId: 'image:texture' },
        width: { type: 'static', value: 1 },
        cap: 'butt',
        join: 'miter',
      }],
      position: { type: 'static', value: [0, 0] },
    };
    const invalidShape = {
      ...validShape,
      fills: [],
      strokes: [{
        paint: { type: IRPaintType.Texture, assetId: 'image:missing' },
        width: { type: 'static', value: 1 },
        cap: 'butt',
        join: 'miter',
      }],
    };
    const textureAsset: IRScene['assets'][number] = {
      id: 'image:texture',
      type: 'image',
      source: { kind: 'url', url: 'https://example.com/texture.png' },
    };

    expect(() =>
      assertComposition(
        makeComposition({
          layers: [makeLayer({ type: 'shape', content: { shapes: [validShape] } })],
        }),
        [textureAsset],
      ),
    ).not.toThrow();
    expect(() =>
      assertComposition(
        makeComposition({
          layers: [makeLayer({ type: 'shape', content: { shapes: [invalidShape] as never } })],
        }),
      ),
    ).toThrowError(/IR_SHAPE_TEXTURE_ASSET_MISSING/);
  });

  it('validates Rectangle cornerRadius in local pixels', () => {
    const makeRectangle = (cornerRadius: number): IRShape => ({
      primitiveType: IRShapePrimitiveType.Rectangle,
      width: { type: 'static', value: 100 },
      height: { type: 'static', value: 40 },
      cornerRadius: { type: 'static', value: cornerRadius },
      fills: [],
      strokes: [],
      position: { type: 'static', value: [0, 0] },
    });

    expect(() => assertComposition(makeComposition({
      layers: [makeLayer({ type: 'shape', content: { shapes: [makeRectangle(20)] } })],
    }))).not.toThrow();
    expect(() => assertComposition(makeComposition({
      layers: [makeLayer({ type: 'shape', content: { shapes: [makeRectangle(21)] } })],
    }))).toThrowError(/cornerRadius.*half of the shorter edge/s);
  });

  it('rejects a Font Asset used as a shape texture', () => {
    const shape = {
      primitiveType: IRShapePrimitiveType.Rectangle,
      width: { type: 'static', value: 10 },
      height: { type: 'static', value: 10 },
      fills: [{ type: IRPaintType.Texture, assetId: 'font:texture' }],
      strokes: [],
      position: { type: 'static', value: [0, 0] },
    } as IRShape;
    const composition = makeComposition({
      layers: [makeLayer({ type: 'shape', content: { shapes: [shape] } })],
    });

    expect(() =>
      assertComposition(composition, [{
        id: 'font:texture', type: 'font', family: 'Arial', style: 'normal', weight: 400,
        source: { kind: 'system' },
      }]),
    ).toThrowError(/IR_SHAPE_TEXTURE_ASSET_TYPE_INVALID/);
  });

  it('enforces primitive-specific shape geometry', () => {
    const common = { fills: [], strokes: [], position: { type: 'static', value: [0, 0] } };
    const invalidShapes = [
      { ...common, primitiveType: IRShapePrimitiveType.Custom, customPaths: { type: 'static', value: [] } },
      {
        ...common,
        primitiveType: IRShapePrimitiveType.Custom,
        customPaths: { type: 'static', value: [{ points: [], inTangents: [], outTangents: [], closed: true }] },
      },
      { ...common, primitiveType: IRShapePrimitiveType.Rectangle, width: { type: 'static', value: 10 } },
      { ...common, primitiveType: IRShapePrimitiveType.Ellipse, xRadius: { type: 'static', value: 5 } },
      { ...common, primitiveType: IRShapePrimitiveType.Polygon, pointCount: 2.5, radius: { type: 'static', value: 5 } },
      { ...common, primitiveType: IRShapePrimitiveType.Star, pointCount: 5, outerRadius: { type: 'static', value: 5 } },
    ];

    for (const shape of invalidShapes) {
      expect(() =>
        assertComposition(
          makeComposition({
            layers: [makeLayer({ type: 'shape', content: { shapes: [shape] as never } })],
          }),
        ),
      ).toThrowError(/IR_SHAPE_DATA_INVALID/);
    }
  });

  it('accepts semantic texture scale modes and rejects GE wire values', () => {
    const textureAssets: IRScene['assets'] = [{
      id: 'image:texture',
      type: 'image',
      source: { kind: 'url', url: 'https://example.com/texture.png' },
    }];
    const makeTextureShape = (scaleMode: unknown): IRShape => ({
      primitiveType: IRShapePrimitiveType.Rectangle,
      width: { type: 'static', value: 10 },
      height: { type: 'static', value: 10 },
      fills: [
        {
          type: IRPaintType.Texture,
          assetId: 'image:texture',
          scaleMode: scaleMode as never,
        },
      ],
      strokes: [],
      position: { type: 'static', value: [0, 0] },
    });

    for (const scaleMode of Object.values(IRTextureScaleMode)) {
      expect(() =>
        assertComposition(
          makeComposition({
            layers: [makeLayer({ type: 'shape', content: { shapes: [makeTextureShape(scaleMode)] } })],
          }),
          textureAssets,
        ),
      ).not.toThrow();
    }
    for (const scaleMode of [0, 3, 'cover']) {
      expect(() =>
        assertComposition(
          makeComposition({
            layers: [makeLayer({ type: 'shape', content: { shapes: [makeTextureShape(scaleMode)] } })],
          }),
          textureAssets,
        ),
      ).toThrowError(/IR_SHAPE_PAINT_INVALID/);
    }
  });

  it('rejects empty and open mask paths', () => {
    const path: IRMask['path'] = {
      points: [{ x: 0, y: 0 }],
      inTangents: [{ x: 0, y: 0 }],
      outTangents: [{ x: 0, y: 0 }],
      closed: true,
    };
    const empty = makeLayer({
      masks: [{
        mode: IRMaskMode.Add,
        path: { points: [], inTangents: [], outTangents: [], closed: true },
      }],
    });
    const open = makeLayer({ masks: [{ mode: IRMaskMode.Add, path: { ...path, closed: false } }] });

    expect(() => assertComposition(makeComposition({ layers: [empty] }))).toThrowError(
      /IR_MASK_DATA_INVALID/,
    );
    expect(() => assertComposition(makeComposition({ layers: [open] }))).toThrowError(
      /IR_MASK_DATA_INVALID/,
    );
  });

  it('validates authored mask stacks and optional inversion', () => {
    const path: IRMask['path'] = {
      points: [{ x: 0, y: 0 }],
      inTangents: [{ x: 0, y: 0 }],
      outTangents: [{ x: 0, y: 0 }],
      closed: true,
    };

    expect(() => assertComposition(makeComposition({
      layers: [makeLayer({
        masks: [
          { mode: IRMaskMode.Add, path },
          { mode: IRMaskMode.Subtract, inverted: true, path },
          { mode: IRMaskMode.Intersect, path },
        ],
      })],
    }))).not.toThrow();
    const invalid = makeLayer({ masks: [
      { mode: 'exclude', path } as never,
      { mode: IRMaskMode.Add, inverted: 1, path } as never,
    ] });

    expect(validateComposition(makeComposition({ layers: [invalid] })).errors.map(issue => issue.path)).toEqual([
      'compositions[0].layers[0].masks[0].mode',
      'compositions[0].layers[0].masks[1].inverted',
    ]);
  });
});
