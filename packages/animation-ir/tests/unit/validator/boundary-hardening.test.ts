import { describe, expect, it } from 'vitest';

import type { IRComposition } from '@galacean/animation-ir';
import { createIRScene } from '@galacean/animation-ir/adapter';
import { IRValidationError, isIRId, validateIRScene, assertIRScene } from '@galacean/animation-ir/validator';
import {
  asUnknownRecord, errorCodes, errorPaths, firstLayer, issueKeys,
  makeHardeningComposition as makeComposition, validateComposition,
} from './test-scene';

describe('runtime boundary hardening', () => {
  it.each([{ input: null }, { input: [] }])('reports a diagnostic for a malformed Composition: $input', ({ input }) => {
    expect(issueKeys(input)).toEqual(['IR_COMPOSITION_INVALID:$']);
  });

  it('requires a Scene object wrapping the entry Composition and assets', () => {
    expect(validateIRScene(null).errors.map(issue => `${issue.code}:${issue.path}`)).toEqual([
      'IR_SCENE_INVALID:$',
    ]);
    expect(validateIRScene(makeComposition()).errors.map(issue => `${issue.code}:${issue.path}`)).toEqual([
      'IR_SCENE_FORMAT_INVALID:format',
      'IR_SCENE_SCHEMA_VERSION_INVALID:schemaVersion',
      'IR_SCENE_ASSETS_INVALID:assets',
      'IR_SCENE_ENTRY_COMPOSITION_ID_INVALID:entryCompositionId',
      'IR_SCENE_COMPOSITIONS_INVALID:compositions',
    ]);
  });

  it('rejects unsupported wire schema versions', () => {
    const scene = createIRScene(makeComposition()) as unknown as Record<string, unknown>;

    scene['schemaVersion'] = '1.1.0';

    expect(validateIRScene(scene).errors).toContainEqual(expect.objectContaining({
      code: 'IR_SCENE_SCHEMA_VERSION_INVALID',
      path: 'schemaVersion',
    }));
  });

  it('validates optional Layer end behavior with source-neutral values', () => {
    const composition = makeComposition();
    const layer = firstLayer(composition);

    layer['endBehavior'] = 'restart';

    expect(issueKeys(composition)).toContain('IR_LAYER_END_BEHAVIOR_INVALID:layers[0].endBehavior');
  });

  it('ignores additional fields throughout Scene, Layer, Transform, and Property objects', () => {
    const composition = makeComposition();
    const layer = firstLayer(composition);

    layer['transform'] = {
      customTransform: true,
      rotation: {
        customRotation: true,
        z: { type: 'static', value: 0 },
      },
      opacity: {
        customProperty: true,
        type: 'keyframed',
        keyframes: [
          { frame: 0, value: 1, outTangent: { x: 0.25, y: 0, customHandle: true } },
          { frame: 30, value: 0, customKeyframe: true },
        ],
      },
    };
    (layer['time'] as Record<string, unknown>)['customTime'] = true;
    layer['fidelity'] = {};

    const scene = createIRScene(composition) as unknown as Record<string, unknown>;

    scene['customScene'] = true;
    const compositionRecord = (scene['compositions'] as Array<Record<string, unknown>>)[0];

    compositionRecord['specific'] = {};

    expect(validateIRScene(scene)).toMatchObject({ valid: true, errors: [] });
  });

  it('accepts multiple unreferenced Compositions and reports unreachable entries', () => {
    const entry = makeComposition();
    const secondary: IRComposition = {
      ...structuredClone(entry),
      id: 'secondary',
      name: 'secondary',
    };
    const document = createIRScene(entry);

    document.compositions.push(secondary);

    const result = validateIRScene(document);

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([
      {
        code: 'IR_COMPOSITION_UNREACHABLE',
        path: 'compositions[1]',
        message: "Composition 'secondary' is not reachable from entry",
      },
    ]);
  });

  it('rejects duplicate Composition IDs and a missing entry target', () => {
    const duplicate = createIRScene(makeComposition());

    duplicate.compositions.push(structuredClone(duplicate.compositions[0]));

    expect(validateIRScene(duplicate).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'IR_COMPOSITION_ID_DUPLICATE', path: 'compositions[1].id' }),
      ]),
    );

    const missing = createIRScene(makeComposition());

    missing.entryCompositionId = 'missing';

    expect(validateIRScene(missing).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'IR_SCENE_ENTRY_COMPOSITION_MISSING',
          path: 'entryCompositionId',
        }),
      ]),
    );
  });

  it('collects multiple root issues and reports structured paths', () => {
    const result = validateComposition({});

    expect(result.valid).toBe(false);
    expect(result.errors.map(issue => `${issue.code}:${issue.path}`)).toEqual([
      'IR_COMPOSITION_ID_INVALID:id',
      'IR_COMPOSITION_WIDTH_INVALID:width',
      'IR_COMPOSITION_HEIGHT_INVALID:height',
      'IR_COMPOSITION_FRAME_RATE_INVALID:frameRate',
      'IR_COMPOSITION_IN_POINT_INVALID:inPoint',
      'IR_COMPOSITION_OUT_POINT_INVALID:outPoint',
      'IR_COMPOSITION_END_BEHAVIOR_INVALID:endBehavior',
      'IR_COMPOSITION_LAYERS_INVALID:layers',
    ]);
  });

  it('accepts omitted names and rejects present non-string names', () => {
    const unnamed = makeComposition();

    delete unnamed.name;
    delete unnamed.layers[0].name;

    expect(validateComposition(unnamed).valid).toBe(true);

    const invalidCompositionName = asUnknownRecord(unnamed);

    invalidCompositionName['name'] = null;
    expect(errorPaths(invalidCompositionName, 'IR_COMPOSITION_NAME_INVALID')).toEqual(['name']);

    const invalidLayerName = asUnknownRecord(unnamed);
    const layers = invalidLayerName['layers'] as unknown[];

    layers[0] = { ...(layers[0] as Record<string, unknown>), name: 1 };
    expect(errorPaths(invalidLayerName, 'IR_LAYER_NAME_INVALID')).toEqual(['layers[0].name']);
  });

  it.each(['', '  '])(
    'rejects empty stable composition id %j',
    id => {
      const composition = asUnknownRecord();

      composition['id'] = id;

      expect(errorPaths(composition, 'IR_COMPOSITION_ID_INVALID')).toEqual(['id']);
    },
  );

  it.each([' root ', '片段/场景'])(
    'accepts opaque IR ID %j',
    id => {
      expect(isIRId(id)).toBe(true);
    },
  );

  it.each(['', '  '])('rejects empty IR ID %j', id => {
    expect(isIRId(id)).toBe(false);
  });

  it('throws a concrete IRValidationError for invalid unknown input', () => {
    let caughtError: unknown;

    try {
      assertIRScene(null);
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IRValidationError);
    expect((caughtError as IRValidationError).code).toBe('IR_SCENE_INVALID');
    expect((caughtError as IRValidationError).path).toBe('$');
    expect((caughtError as IRValidationError).issues).toHaveLength(1);
  });

  it('reports null entries and holes in the Layer array', () => {
    const layers = new Array<unknown>(2);

    layers[0] = null;

    const composition = { ...makeComposition(), layers };

    expect(issueKeys(composition)).toEqual(['IR_LAYER_INVALID:layers[0]', 'IR_LAYER_INVALID:layers[1]']);
  });

  it.each([
    {
      position: { type: 'static', value: new Array<unknown>(3) },
      issue: 'IR_ANIMATED_PROPERTY_INVALID:layers[0].transform.position.value',
    },
    {
      position: {
        type: 'keyframed',
        keyframes: [{ frame: 0, value: [0, 0, 0], spatialOut: new Array<unknown>(2) }],
      },
      issue: 'IR_KEYFRAME_INVALID:layers[0].transform.position.keyframes[0].spatialOut',
    },
  ])('rejects holes in a numeric position tuple ($issue)', ({ position, issue }) => {
    const composition = makeComposition();

    firstLayer(composition)['transform'] = { position };
    expect(issueKeys(composition)).toEqual([issue]);
  });

  it.each([{ time: undefined }, { time: [] }])('reports an invalid time object for $time', ({ time }) => {
    const composition = makeComposition();

    firstLayer(composition)['time'] = time;
    expect(validateComposition(composition).errors).toEqual([{
      code: 'IR_LAYER_TIME_INVALID',
      path: 'layers[0].time',
      message: 'must be an object containing inFrame and outFrame',
      layerId: 'root',
    }]);
  });

  it('reports malformed layer scalar fields at exact paths', () => {
    const composition = makeComposition();

    Object.assign(firstLayer(composition), {
      type: 'invalid',
      time: { inFrame: 0, outFrame: 'later', offsetFrame: 'later' },
      blendMode: 'invalid',
    });

    expect(issueKeys(composition)).toEqual(
      expect.arrayContaining([
        'IR_LAYER_TYPE_INVALID:layers[0].type',
        'IR_LAYER_TIME_END_INVALID:layers[0].time.outFrame',
        'IR_LAYER_BLEND_MODE_INVALID:layers[0].blendMode',
      ]),
    );
  });

  it.each(['', '  '])(
    'rejects empty stable layer id %j',
    id => {
      const composition = makeComposition();

      firstLayer(composition)['id'] = id;

      expect(errorPaths(composition, 'IR_LAYER_ID_INVALID')).toEqual(['layers[0].id']);
    },
  );

  it('rejects duplicate stable layer ids', () => {
    const composition = makeComposition();

    composition.layers.push({ ...composition.layers[0] });

    expect(errorPaths(composition, 'IR_LAYER_ID_DUPLICATE')).toEqual(['layers[1].id']);
  });

  it('reports each distinct parent and matte cycle when IDs contain colons', () => {
    const composition = makeComposition();
    const references = [['a', 'b:c'], ['b:c', 'a'], ['a:b', 'c'], ['c', 'a:b']] as const;

    composition.layers = references.map(([id, targetId]) => ({
      ...composition.layers[0], id, parentId: targetId, matte: { mode: 'alpha', sourceLayerId: targetId },
    }));

    expect(issueKeys(composition)).toEqual([
      'IR_LAYER_PARENT_CYCLE:layers[1].parentId',
      'IR_LAYER_PARENT_CYCLE:layers[3].parentId',
      'IR_LAYER_MATTE_CYCLE:layers[1].matte',
      'IR_LAYER_MATTE_CYCLE:layers[3].matte',
    ]);
  });

  it('reports each distinct Precomp cycle when Composition IDs contain colons', () => {
    const references = [['a', 'b:c'], ['b:c', 'a'], ['a:b', 'c'], ['c', 'a:b']] as const;
    const compositions = references.map(([id, targetId]): IRComposition => ({
      ...makeComposition(),
      id,
      layers: [{
        id: 'precomp', type: 'precomp', time: { inFrame: 0, outFrame: 1 }, visible: true,
        content: { compositionId: targetId, clipToBounds: false },
      }],
    }));
    const { errors } = validateIRScene({ ...createIRScene(compositions[0]), compositions });

    expect(errors.map(({ code, path }) => `${code}:${path}`)).toEqual([
      'IR_COMPOSITION_REFERENCE_CYCLE:compositions[1]',
      'IR_COMPOSITION_REFERENCE_CYCLE:compositions[3]',
    ]);
  });

  it('rejects malformed and unresolved parent references', () => {
    const malformed = makeComposition();
    const unresolved = makeComposition();

    firstLayer(malformed)['parentId'] = { index: 0 };
    firstLayer(unresolved)['parentId'] = 'missing';

    expect(errorPaths(malformed, 'IR_LAYER_PARENT_INVALID')).toEqual(['layers[0].parentId']);
    expect(errorPaths(unresolved, 'IR_LAYER_PARENT_OUT_OF_RANGE')).toEqual(['layers[0].parentId']);
  });

  it.each([
    { x: 0, y: 0, width: -1, height: 10 },
    { x: 0, y: 0, width: 10, height: Number.POSITIVE_INFINITY },
    { x: 'left', y: 0, width: 10, height: 10 },
    null,
  ])('rejects invalid local bounds %j', localBounds => {
    const composition = makeComposition();

    firstLayer(composition)['localBounds'] = localBounds;

    expect(errorCodes(composition)).toContain('IR_LAYER_LOCAL_BOUNDS_INVALID');
  });

  it('enforces normalized colors and required Solid payload and bounds', () => {
    const background = makeComposition();
    const malformedSolid = makeComposition();
    const missingSolid = makeComposition();
    const missingSolidBounds = makeComposition();
    const localBounds = { x: 0, y: 0, width: 100, height: 100 };

    asUnknownRecord(background)['backgroundColor'] = [-1, 0, 0, 2];
    Object.assign(firstLayer(malformedSolid), {
      type: 'solid', content: { color: [1, 0, 'bad', 1] }, localBounds,
    });
    Object.assign(firstLayer(missingSolid), { type: 'solid', localBounds });
    Object.assign(firstLayer(missingSolidBounds), { type: 'solid', content: { color: [1, 0, 0, 1] } });

    expect(errorCodes(background)).toContain('IR_COMPOSITION_BACKGROUND_COLOR_INVALID');
    expect(errorCodes(malformedSolid)).toContain('IR_LAYER_SOLID_COLOR_INVALID');
    expect(errorCodes(missingSolid)).toContain('IR_LAYER_SOLID_COLOR_MISSING');
    expect(errorPaths(missingSolidBounds, 'IR_LAYER_LOCAL_BOUNDS_INVALID')).toContain('layers[0].localBounds');
  });

  it('reports missing Image content and malformed Asset IDs before resolving references', () => {
    const composition = makeComposition();
    const layer = firstLayer(composition);

    Object.assign(layer, {
      type: 'image', asset: { url: 'image.png' }, localBounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    expect(issueKeys(composition)).toEqual(['IR_LAYER_IMAGE_CONTENT_INVALID:layers[0].content']);

    layer['content'] = { assetId: '  ' };
    expect(issueKeys(composition)).toEqual(['IR_LAYER_IMAGE_CONTENT_INVALID:layers[0].content.assetId']);
  });
});
