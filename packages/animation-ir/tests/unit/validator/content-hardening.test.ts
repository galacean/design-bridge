import { describe, expect, it } from 'vitest';

import { IRPaintType, IRShapePrimitiveType, type IRComposition } from '@galacean/animation-ir';
import { createIRScene } from '@galacean/animation-ir/adapter';
import { validateIRScene } from '@galacean/animation-ir/validator';
import {
  asUnknownRecord, errorCodes, errorPaths, firstLayer, issueKeys,
  makeHardeningComposition as makeComposition, validateComposition,
} from './test-scene';

describe('animation and content invariants', () => {
  it('rejects impossible static and keyframed property states', () => {
    const staticMissingValue = makeComposition();
    const staticWithKeyframes = makeComposition();
    const keyframedMissingFrames = makeComposition();
    const legacyBooleanDiscriminator = makeComposition();

    firstLayer(staticMissingValue)['transform'] = { opacity: { type: 'static' } };
    firstLayer(staticWithKeyframes)['transform'] = {
      opacity: { type: 'static', value: 1, keyframes: [{ frame: 0, value: 1 }] },
    };
    firstLayer(keyframedMissingFrames)['transform'] = { opacity: { type: 'keyframed' } };
    firstLayer(legacyBooleanDiscriminator)['transform'] = { opacity: { keyframed: false, value: 1 } };

    expect(errorCodes(staticMissingValue)).toContain('IR_ANIMATED_PROPERTY_INVALID');
    expect(errorCodes(staticWithKeyframes)).toContain('IR_ANIMATED_PROPERTY_INVALID');
    expect(errorCodes(keyframedMissingFrames)).toContain('IR_ANIMATED_PROPERTY_INVALID');
    expect(errorPaths(legacyBooleanDiscriminator, 'IR_ANIMATED_PROPERTY_INVALID')).toEqual([
      'layers[0].transform.opacity.type',
    ]);
  });

  it('reports only the forbidden stray value on keyframed properties', () => {
    const composition = makeComposition();

    firstLayer(composition)['transform'] = {
      position: {
        type: 'keyframed',
        keyframes: [{ frame: 0, value: [0, 0, 0] }],
        value: [9, 9],
      },
    };

    const issues = validateComposition(composition).errors.filter(
      issue => issue.path === 'layers[0].transform.position.value',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe("must be omitted when type is 'keyframed'");
  });

  it.each([
    { label: 'zero', stretch: 0 },
    { label: 'Infinity', stretch: Number.POSITIVE_INFINITY },
  ])('rejects unsupported stretch ratio $label', ({ stretch }) => {
    const composition = makeComposition();

    firstLayer(composition)['type'] = 'precomp';
    firstLayer(composition)['content'] = { compositionId: 'child', clipToBounds: false };
    firstLayer(composition)['time'] = { inFrame: 0, outFrame: 60, stretch };

    expect(errorCodes(composition)).toContain('IR_LAYER_TIME_STRETCH_INVALID');
  });

  it('requires Precomp clipToBounds and validates its optional endBehavior override', () => {
    const missingClip = makeComposition();
    const invalidEndBehavior = makeComposition();

    Object.assign(firstLayer(missingClip), {
      type: 'precomp',
      content: { compositionId: 'child' },
    });
    Object.assign(firstLayer(invalidEndBehavior), {
      type: 'precomp',
      content: { compositionId: 'child', clipToBounds: true, endBehavior: 'reverse' },
    });

    expect(errorPaths(missingClip, 'IR_LAYER_PRECOMP_CONTENT_INVALID')).toContain(
      'layers[0].content.clipToBounds',
    );
    expect(errorPaths(invalidEndBehavior, 'IR_LAYER_PRECOMP_CONTENT_INVALID')).toContain(
      'layers[0].content.endBehavior',
    );
  });

  it('restricts sourceStartFrame and stretch to Precomp layers', () => {
    const composition = makeComposition();

    firstLayer(composition)['time'] = {
      inFrame: 0,
      outFrame: 60,
      sourceStartFrame: 12,
      stretch: 2,
    };

    expect(issueKeys(composition)).toEqual(expect.arrayContaining([
      'IR_LAYER_TIME_SOURCE_START_INVALID:layers[0].time.sourceStartFrame',
      'IR_LAYER_TIME_STRETCH_INVALID:layers[0].time.stretch',
    ]));
  });

  it('rejects content on a Null layer', () => {
    const composition = makeComposition();

    firstLayer(composition)['content'] = {};

    expect(issueKeys(composition)).toEqual(['IR_LAYER_CONTENT_INVALID:layers[0].content']);
  });

  it('accepts a reachable Precomp at a fractional stretch and rejects a missing target', () => {
    const entry = makeComposition();
    const child: IRComposition = { ...makeComposition(), id: 'child', layers: [] };
    const document = createIRScene(entry);

    Object.assign(firstLayer(entry), {
      type: 'precomp',
      content: { compositionId: 'child', clipToBounds: false },
      time: { inFrame: 0, outFrame: 60, stretch: 0.5 },
    });
    document.compositions.push(child);

    expect(validateIRScene(document)).toMatchObject({ valid: true, warnings: [] });

    (firstLayer(entry)['content'] as Record<string, unknown>)['compositionId'] = 'missing';
    expect(validateIRScene(document).errors).toContainEqual(expect.objectContaining({
      code: 'IR_LAYER_PRECOMP_COMPOSITION_MISSING',
      path: 'compositions[0].layers[0].content.compositionId',
    }));
  });

  it('validates keyframe ordering, flags, handles, and spatial tangents', () => {
    const composition = makeComposition();

    firstLayer(composition)['transform'] = {
      position: {
        type: 'keyframed',
        keyframes: [
          { frame: 10, value: [0, 0, 0], hold: 'yes', outTangent: { x: 2, y: 0 }, spatialOut: [] },
          { frame: 5, value: [1, 1, 1] },
        ],
      },
    };

    expect(errorPaths(composition, 'IR_KEYFRAME_INVALID')).toEqual([
      'layers[0].transform.position.keyframes[0].hold',
      'layers[0].transform.position.keyframes[0].outTangent.x',
      'layers[0].transform.position.keyframes[0].spatialOut',
      'layers[0].transform.position.keyframes[1].frame',
    ]);
  });

  it('only allows spatial tangents on position keyframes', () => {
    const composition = makeComposition();

    firstLayer(composition)['transform'] = {
      position: {
        type: 'keyframed',
        keyframes: [
          { frame: 0, value: [0, 0, 0], spatialOut: [10, 0] },
          { frame: 10, value: [10, 0, 0], spatialIn: [-10, 0] },
        ],
      },
      scale: {
        type: 'keyframed',
        keyframes: [{ frame: 0, value: [1, 1, 1], spatialOut: [1, 0] }],
      },
      opacity: {
        type: 'keyframed',
        keyframes: [{ frame: 0, value: 1, spatialIn: [-1, 0] }],
      },
    };

    const spatialIssues = validateComposition(composition).errors.filter(
      issue => issue.path.endsWith('.spatialIn') || issue.path.endsWith('.spatialOut'),
    );

    expect(spatialIssues).toEqual([
      expect.objectContaining({
        code: 'IR_KEYFRAME_INVALID',
        path: 'layers[0].transform.scale.keyframes[0].spatialOut',
        message: 'is only valid for position animation',
      }),
      expect.objectContaining({
        code: 'IR_KEYFRAME_INVALID',
        path: 'layers[0].transform.opacity.keyframes[0].spatialIn',
        message: 'is only valid for position animation',
      }),
    ]);
  });

  it('accepts inert segment fields on boundary and single keyframes', () => {
    const composition = makeComposition();

    firstLayer(composition)['transform'] = {
      position: {
        type: 'keyframed',
        keyframes: [{
          frame: 0,
          value: [10, 20, 0],
          endValue: [30, 40, 0],
          hold: true,
          inTangent: { x: 0, y: 0 },
          outTangent: { x: 1, y: 1 },
          spatialIn: [-1, 0],
          spatialOut: [1, 0],
        }],
      },
    };

    expect(validateComposition(composition)).toMatchObject({ valid: true, errors: [] });
  });

  it('enforces normalized opacity for static and keyframed values', () => {
    const staticOpacity = makeComposition();
    const keyframedOpacity = makeComposition();

    firstLayer(staticOpacity)['transform'] = { opacity: { type: 'static', value: 2 } };
    firstLayer(keyframedOpacity)['transform'] = {
      opacity: { type: 'keyframed', keyframes: [{ frame: 0, value: -1 }] },
    };

    expect(errorCodes(staticOpacity)).toContain('IR_ANIMATED_PROPERTY_INVALID');
    expect(errorCodes(keyframedOpacity)).toContain('IR_ANIMATED_PROPERTY_INVALID');
  });

  it.each([undefined, 0, Number.POSITIVE_INFINITY])(
    'requires a positive finite text lineHeight: %s',
    lineHeight => {
      const composition = makeComposition();

      Object.assign(firstLayer(composition), {
        type: 'text',
        content: {
          color: [1, 1, 1, 1],
          text: 'hello',
          fontAssetId: 'font:body',
          fontSize: 12,
          letterSpacing: 0,
          lineHeight,
          textAlign: 'left',
        },
      });

      expect(errorPaths(composition, 'IR_TEXT_DATA_INVALID')).toEqual(['layers[0].content.lineHeight']);
    },
  );

  it('requires a Font Asset ID even when a legacy font family is present', () => {
    const composition = makeComposition();

    Object.assign(firstLayer(composition), {
      type: 'text',
      content: {
        color: [1, 1, 1, 1], text: 'hello', fontFamily: 'sans-serif', fontSize: 12,
        letterSpacing: 0, lineHeight: 14, textAlign: 'left',
      },
    });

    expect(issueKeys(composition)).toEqual(['IR_TEXT_DATA_INVALID:layers[0].content.fontAssetId']);
  });

  it('requires a Text layer payload', () => {
    const composition = makeComposition();

    Object.assign(firstLayer(composition), { type: 'text' });

    expect(validateComposition(composition).errors).toContainEqual(expect.objectContaining({
      code: 'IR_TEXT_DATA_MISSING',
      path: 'layers[0].content',
      layerId: 'root',
    }));
  });

  it('validates matching path handles and handle values', () => {
    const composition = makeComposition();

    firstLayer(composition)['masks'] = [{
      mode: 'add',
      path: {
        points: [{ x: 0, y: 0 }],
        inTangents: ['bad'],
        outTangents: [],
        closed: true,
      },
    }];

    expect(errorPaths(composition, 'IR_MASK_DATA_INVALID')).toEqual([
      'layers[0].masks[0].path.outTangents',
      'layers[0].masks[0].path.inTangents[0]',
    ]);
  });

  it('ignores additional auto-mask metadata', () => {
    const composition = makeComposition();

    firstLayer(composition)['masks'] = [{
      mode: 'add',
      isAutoMask: 1,
      path: {
        points: [{ x: 0, y: 0 }],
        inTangents: [{ x: 0, y: 0 }],
        outTangents: [{ x: 0, y: 0 }],
        closed: true,
      },
    }];

    expect(validateComposition(composition).valid).toBe(true);
  });

  it('validates shape enums and numeric fields', () => {
    const composition = makeComposition();

    Object.assign(firstLayer(composition), {
      type: 'shape',
      content: {
        shapes: [
          {
            primitiveType: IRShapePrimitiveType.Star,
            fills: [],
            strokes: [{
              paint: { type: IRPaintType.Solid, color: { type: 'static', value: [1, 1, 1, 1] } },
              width: { type: 'static', value: -1 },
              cap: 'invalid',
              join: 'invalid',
            }],
            position: { type: 'static', value: [0, 0] },
            pointCount: 1,
            innerRoundness: { type: 'static', value: 101 },
            outerRoundness: { type: 'static', value: -1 },
          },
        ],
      },
    });

    expect(errorPaths(composition, 'IR_SHAPE_DATA_INVALID')).toEqual([
      'layers[0].content.shapes[0].strokes[0].width.value',
      'layers[0].content.shapes[0].strokes[0].cap',
      'layers[0].content.shapes[0].strokes[0].join',
      'layers[0].content.shapes[0].pointCount',
      'layers[0].content.shapes[0].innerRadius',
      'layers[0].content.shapes[0].outerRadius',
      'layers[0].content.shapes[0].innerRoundness.value',
      'layers[0].content.shapes[0].outerRoundness.value',
    ]);
  });

  it('validates gradient stop ranges and ordering', () => {
    const composition = makeComposition();

    Object.assign(firstLayer(composition), {
      type: 'shape',
      content: {
        shapes: [
          {
            primitiveType: IRShapePrimitiveType.Rectangle,
            fills: [
              {
                type: IRPaintType.LinearGradient,
                gradientStops: { type: 'static', value: [
                  [0.8, 1, 1, 1, 1],
                  [0.2, 2, 1, 1, 1],
                ] },
                gradientStart: { type: 'static', value: [0, 0] },
                gradientEnd: { type: 'static', value: [100, 0] },
              },
            ],
            strokes: [],
            position: { type: 'static', value: [0, 0] },
          },
        ],
      },
    });

    expect(errorPaths(composition, 'IR_SHAPE_PAINT_INVALID')).toEqual([
      'layers[0].content.shapes[0].fills[0].gradientStops.value[1]',
      'layers[0].content.shapes[0].fills[0].gradientStops.value[1][0]',
    ]);
  });

  it('requires both gradient endpoints', () => {
    const composition = makeComposition();

    Object.assign(firstLayer(composition), {
      type: 'shape',
      content: {
        shapes: [{
          primitiveType: IRShapePrimitiveType.Rectangle,
          width: { type: 'static', value: 100 },
          height: { type: 'static', value: 100 },
          fills: [
            {
              type: IRPaintType.LinearGradient,
              gradientStops: { type: 'static', value: [[0, 1, 1, 1, 1], [1, 0, 0, 0, 1]] },
              gradientStart: { type: 'static', value: [0, 0] },
            },
            {
              type: IRPaintType.RadialGradient,
              gradientStops: { type: 'static', value: [[0, 1, 1, 1, 1], [1, 0, 0, 0, 1]] },
              gradientEnd: { type: 'static', value: [100, 0] },
            },
          ],
          strokes: [],
          position: { type: 'static', value: [0, 0] },
        }],
      },
    });

    expect(errorPaths(composition, 'IR_ANIMATED_PROPERTY_INVALID')).toEqual([
      'layers[0].content.shapes[0].fills[0].gradientEnd',
      'layers[0].content.shapes[0].fills[1].gradientStart',
    ]);
  });

  it('ignores additional and former contract fields throughout Layer content', () => {
    const composition = asUnknownRecord();
    const base = { time: { inFrame: 0, outFrame: 60 }, visible: true };

    composition['source'] = 'lottie';
    composition['extensions'] = { source: 'private' };
    composition['layers'] = [
      {
        ...base,
        id: 'image',
        type: 'image',
        time: { ...base.time, offsetFrame: 12 },
        content: { assetId: 'image:hero', cacheKey: 'hero' },
        localBounds: { x: 0, y: 0, width: 10, height: 10, units: 'px' },
        parent: { layerId: 'root' },
        asset: { url: 'https://example.com/legacy.png' },
        extensions: { source: 'private' },
      },
      {
        ...base,
        id: 'text',
        type: 'text',
        content: {
          text: 'hello',
          fontAssetId: 'font:body',
          fontSize: 12,
          color: [0, 0, 0, 1],
          textAlign: 'left',
          letterSpacing: 0,
          lineHeight: 14,
          content: 'legacy text',
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal',
          autoWidth: true,
          width: 100,
          height: 14,
          anchorAdjust: [0, 0],
          layoutHint: 'source',
        },
        text: { value: 'legacy text' },
      },
      {
        ...base,
        id: 'solid',
        type: 'solid',
        content: { color: [1, 0, 0, 1], opacity: 1 },
        localBounds: { x: 0, y: 0, width: 10, height: 10 },
        solidColor: [1, 0, 0, 1],
      },
      {
        ...base,
        id: 'shape',
        type: 'shape',
        content: {
          sourceGroup: 'group',
          shapes: [{
            primitiveType: 'custom',
            customPaths: { type: 'static', value: [{
              points: [{ x: 0, y: 0, tag: 'start' }],
              inTangents: [{ x: 0, y: 0 }],
              outTangents: [{ x: 0, y: 0 }],
              closed: true,
              winding: 'clockwise',
            }] },
            fills: [
              {
                type: 'linear-gradient',
                gradientStops: { type: 'static', value: [[0, 1, 1, 1, 1], [1, 0, 0, 0, 1]] },
                gradientStart: { type: 'static', value: [0, 0] },
                gradientEnd: { type: 'static', value: [10, 0] },
                color: [1, 1, 1, 1],
              },
              {
                type: 'texture',
                assetId: 'image:hero',
                texture: { url: 'https://example.com/legacy.png' },
              },
            ],
            strokes: [],
            position: { type: 'static', value: [0, 0] },
            size: [10, 10],
            fillRule: 'even-odd',
            trimPath: { start: 0, end: 100 },
            repeater: { copies: 2 },
            specific: {},
          }],
        },
        shapes: [],
      },
      {
        ...base,
        id: 'precomp',
        type: 'precomp',
        content: { compositionId: 'child', clipToBounds: true, sourceRef: 'child' },
      },
    ];
    const child = makeComposition();

    child.id = 'child';
    child.layers = [];
    const document = createIRScene(composition as unknown as IRComposition, [
      { id: 'image:hero', type: 'image', source: { kind: 'url', url: 'https://example.com/hero.png' } },
      {
        id: 'font:body', type: 'font', family: 'Inter', style: 'normal', weight: 400,
        source: { kind: 'url', url: 'https://example.com/Inter.woff2' },
      },
    ]);

    document.compositions.push(child);
    expect(validateIRScene(document)).toMatchObject({ valid: true, errors: [] });
  });

  it('collects malformed optional structures without throwing', () => {
    const composition = asUnknownRecord();

    composition['endBehavior'] = 'reverse';
    composition['layers'] = [
      {
        id: 'malformed',
        name: 1,
        type: 'invalid',
        time: { inFrame: 'now', outFrame: null, stretch: 0, offsetFrame: 'later' },
        visible: null,
        parent: 'root',
        transform: 'invalid',
        asset: null,
        text: null,
        shapes: 'invalid',
        masks: null,
        blendMode: 'invalid',
        localBounds: { x: 0, y: 0, width: -10, height: 10 },
      },
      {
        id: 'text',
        name: 'text',
        type: 'text',
        time: { inFrame: 0, outFrame: 1 },
        visible: true,
        transform: { rotation: null },
        content: {
          text: 1,
          fontAssetId: 'font:body',
          fontFamily: null,
          fontSize: 0,
          color: null,
          autoWidth: 'yes',
          textAlign: 'justify',
          fontStyle: 'bold',
          fontWeight: 0,
          letterSpacing: Number.NaN,
          lineHeight: 0,
          width: 0,
          height: 0,
        },
        masks: [{ path: null }],
      },
      {
        id: 'shape',
        name: 'shape',
        type: 'shape',
        time: { inFrame: 0, outFrame: 1 },
        visible: true,
        content: {
          shapes: [
            null,
            {
              primitiveType: 'invalid',
              fills: [
                null,
                { type: 'invalid' },
                { type: IRPaintType.LinearGradient, gradientStops: { type: 'static', value: [] } },
                {
                  type: IRPaintType.RadialGradient,
                  gradientStops: { type: 'static', value: [['bad'], [0, 1, 1, 1, 1]] },
                  gradientStart: { type: 'static', value: [0] },
                  gradientEnd: { type: 'static', value: null },
                  color: [2, 0, 0, 1],
                },
                { type: IRPaintType.Texture, assetId: null, texture: {}, scaleMode: 'fit' },
              ],
              strokes: null,
              position: { type: 'static', value: null },
              size: null,
              strokeJoin: 'invalid',
              customPaths: { type: 'static', value: [null] },
            },
          ],
        },
      },
    ];

    const result = validateComposition(composition);

    expect(result.valid).toBe(false);
    expect(result.errors.map(issue => `${issue.code}:${issue.path}`)).toEqual(
      expect.arrayContaining([
        'IR_COMPOSITION_END_BEHAVIOR_INVALID:endBehavior',
        'IR_LAYER_VISIBILITY_INVALID:layers[0].visible',
        'IR_TRANSFORM_INVALID:layers[0].transform',
        'IR_MASK_DATA_INVALID:layers[0].masks',
        'IR_MASK_DATA_INVALID:layers[1].masks[0].mode',
        'IR_MASK_DATA_INVALID:layers[1].masks[0].path',
        'IR_LAYER_LOCAL_BOUNDS_INVALID:layers[0].localBounds.width',
        'IR_TEXT_DATA_INVALID:layers[1].content.text',
        'IR_TEXT_COLOR_INVALID:layers[1].content.color',
        'IR_SHAPE_DATA_INVALID:layers[2].content.shapes[0]',
        'IR_SHAPE_PAINT_INVALID:layers[2].content.shapes[1].fills[0]',
      ]),
    );
  });

  it('reports malformed animated properties, keyframes and easing handles', () => {
    const composition = makeComposition();

    firstLayer(composition)['transform'] = {
      position: null,
      scale: {
        type: 'keyframed',
        keyframes: [
          null,
          { frame: 'first' },
          {
            frame: 0,
            value: [1, 1, 1],
            inTangent: 'invalid',
            outTangent: { x: 0.5, y: 'invalid' },
          },
        ],
      },
    };

    expect(issueKeys(composition)).toEqual([
      'IR_ANIMATED_PROPERTY_INVALID:layers[0].transform.position',
      'IR_KEYFRAME_INVALID:layers[0].transform.scale.keyframes[0]',
      'IR_KEYFRAME_INVALID:layers[0].transform.scale.keyframes[1].frame',
      'IR_KEYFRAME_INVALID:layers[0].transform.scale.keyframes[1].value',
      'IR_KEYFRAME_INVALID:layers[0].transform.scale.keyframes[2].inTangent',
      'IR_KEYFRAME_INVALID:layers[0].transform.scale.keyframes[2].outTangent.y',
    ]);
  });
});
