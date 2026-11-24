import { describe, expect, it } from 'vitest';
import {
  IREndBehavior, type IRAnimatedProperty, type IRComposition, type IRKeyframe, type IRPropertyValue,
} from '@galacean/animation-ir';
import { getIRResourceSourceUrl, getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import { assertIRScene } from '@galacean/animation-ir/validator';
import {
  convertDSLToIR as convertDSLDocumentToIR, convertIRToDSL, validateDSL,
  type Composition, type Layer,
} from '../src';
import { createTestAnimatedProperty, createTestLayer } from './fixtures/dsl';
import {
  createTestIRScene, getTestImageAsset, rememberTestIRSceneAssets,
} from './fixtures/ir';
import { colorToHex, isHexEqual, isValidHexColor, normalizeHex } from '../src/common/utils';

function createComposition(layers: Layer[] = []): Composition {
  return {
    meta: {
      name: 'adapter-test',
      duration: 3,
      fps: 30,
      width: 720,
      height: 1280,
      loop: true,
      background_color: '#336699',
    },
    layers,
  };
}

function convertDSLToIRScene(composition: Composition): ReturnType<typeof convertDSLDocumentToIR>['scene'] {
  return convertDSLDocumentToIR(composition).scene;
}

function convertDSLToIR(composition: Composition): IRComposition {
  const document = convertDSLToIRScene(composition);

  rememberTestIRSceneAssets(document);

  return getIRSceneEntryComposition(document);
}

function getKeyframes<T extends IRPropertyValue>(
  property: IRAnimatedProperty<T> | undefined,
): IRKeyframe<T>[] {
  if (property?.type !== 'keyframed') {
    throw new Error('Expected a keyframed IR property.');
  }

  return property.keyframes;
}

function validateCompositionOrThrow(composition: IRComposition): void {
  assertIRScene(createTestIRScene(composition));
}

describe('convertDSLToIR', () => {
  it.each([false, true])('accepts omitted children with preservedData=%s', usePreservedData => {
    const parent = createTestLayer('parent', 'Parent', 'null');
    const child = createTestLayer('child', 'Child', 'null');
    const sibling = createTestLayer('sibling', 'Sibling', 'null');

    child.parent = parent.id;
    parent.children = [child];
    const baselineScene = convertDSLToIRScene(createComposition([parent, sibling]));
    const { dsl, preservedData } = convertIRToDSL(baselineScene);
    const omitLeafChildren = (layer: Layer): void => {
      if (layer.children == null || layer.children.length === 0) {
        delete layer.children;
      } else {
        layer.children.forEach(omitLeafChildren);
      }
    };

    dsl.layers.forEach(omitLeafChildren);
    const originalDSL = structuredClone(dsl);
    const result = convertDSLDocumentToIR(dsl, {
      ...(usePreservedData && { preservedData }),
    });
    const resultLayers = getIRSceneEntryComposition(result.scene).layers;

    expect(resultLayers.map(layer => ({ id: layer.id, parentId: layer.parentId }))).toEqual(
      getIRSceneEntryComposition(baselineScene).layers.map(layer => ({ id: layer.id, parentId: layer.parentId })),
    );
    expect(dsl).toEqual(originalDSL);
  });

  it('returns the generated Composition in an IRScene root', () => {
    const document = convertDSLToIRScene(createComposition());

    expect(document.format).toBe('animation-ir');
    expect(document.schemaVersion).toBe('1.0.0');
    expect(document.entryCompositionId).toBe(document.compositions[0].id);
  });

  it('preserves opaque non-empty DSL layer ids while generating Composition ids', () => {
    const layer = createTestLayer('layer with/中文', 'Layer', 'null');

    layer.time_range = [0, 3];

    const first = convertDSLToIR(createComposition([layer]));
    const repeated = convertDSLToIR(createComposition([structuredClone(layer)]));

    expect(repeated.id).not.toBe(first.id);
    expect(first.id).toMatch(/^[0-9a-f]{32}$/);
    expect(first.layers[0].id).toBe(layer.id);
    expect(repeated.layers[0].id).toBe(layer.id);
  });

  it('allows recoverable DSL warnings during conversion', () => {
    const layer = createTestLayer('warning-layer', 'Warning layer', 'null');
    const warnings: string[] = [];

    layer.time_range = [0, 4];

    const result = convertDSLDocumentToIR(createComposition([layer]), {
      onWarning: warning => warnings.push(warning.code),
    });

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(warnings);
    expect(warnings.length).toBeGreaterThan(0);
    expect(getIRSceneEntryComposition(result.scene).layers[0].time).toEqual({ inFrame: 0, outFrame: 120 });
    expect(() => assertIRScene(result.scene)).not.toThrow();
  });

  it('applies supported edits while skipping unsupported edits without mutating preserved data', () => {
    const baselineScene = convertDSLToIRScene(createComposition([createTestLayer('layer', 'Layer', 'null')]));
    const { dsl, preservedData } = convertIRToDSL(baselineScene);
    const originalPreservedData = structuredClone(preservedData);

    dsl.layers[0].description.self = 'Edited description';
    dsl.layers[0].opacity = { a: false, value: 0.4 };
    dsl.layers.push({ ...structuredClone(dsl.layers[0]), id: 'invented', name: 'Invented layer' });
    const result = convertDSLDocumentToIR(dsl, { preservedData });
    const layers = getIRSceneEntryComposition(result.scene).layers;

    expect(layers).toHaveLength(1);
    expect(layers[0].transform?.opacity).toEqual({ type: 'static', value: 0.4 });
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(expect.arrayContaining([
      'LAYER_DESCRIPTION_CHANGE_IGNORED', 'INVENTED_LAYER',
    ]));
    expect(preservedData).toEqual(originalPreservedData);
    expect(() => assertIRScene(result.scene)).not.toThrow();
  });

  it('rejects invalid edits while leaving the retained scene available for recovery', () => {
    const baselineScene = convertDSLToIRScene(createComposition([createTestLayer('layer', 'Layer', 'null')]));
    const { dsl, preservedData } = convertIRToDSL(baselineScene);
    const originalPreservedData = structuredClone(preservedData);

    dsl.layers[0].opacity = { a: false, value: 0.4 };
    dsl.layers[0].parent = 'missing-parent';

    expect(() => convertDSLDocumentToIR(dsl, { preservedData })).toThrow(/X004/);
    expect(preservedData).toEqual(originalPreservedData);
    expect(baselineScene).toEqual(originalPreservedData.baselineScene);
  });

  it('converts the editable particle surface to Animation IR', () => {
    const layer = createTestLayer('particle', 'Particle', 'particle');

    layer.width = 320;
    layer.height = 180;
    layer.particle = {
      options: { maxCount: 80, startLifetime: [4, [1, 2]] },
      emission: {
        rateOverTime: [0, 12],
        bursts: [{ time: 0.5, count: 20, cycles: 2, interval: 0.25 }],
      },
    };

    const particleLayer = convertDSLToIR(createComposition([layer])).layers[0];

    expect(particleLayer).toMatchObject({
      id: 'particle',
      type: 'particle',
      localBounds: { x: 0, y: 0, width: 320, height: 180 },
      content: {
        maxParticles: 80,
        startLifetime: { type: 'randomBetweenConstants', min: 30, max: 60 },
        emission: {
          rateOverTime: { type: 'constant', value: 12 },
          bursts: [{ frameOffset: 15, count: 20, cycleCount: 2, repeatIntervalFrames: 7.5 }],
        },
      },
    });
  });

  it('reports preserved-mode DSL validation warnings once with their original paths', () => {
    const layer = createTestLayer('warning-layer', 'Warning layer', 'null');

    layer.time_range = [0, 3];
    const baselineResult = convertDSLDocumentToIR(createComposition([layer]));
    const converted = convertIRToDSL(baselineResult.scene);
    const editedDSL = structuredClone(converted.dsl);

    editedDSL.layers[0].time_range = [0, 4];
    const validationResult = validateDSL(editedDSL);
    const warningCodes: string[] = [];
    const result = convertDSLDocumentToIR(editedDSL, {
      preservedData: converted.preservedData,
      onWarning: warning => warningCodes.push(warning.code),
    });

    expect(validationResult.warnings.length).toBeGreaterThan(0);
    expect(warningCodes).toEqual(validationResult.warnings.map(warning => warning.code));
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(warningCodes);
    expect(result.diagnostics.map(diagnostic => diagnostic.path))
      .toEqual(validationResult.warnings.map(warning => `$.${warning.path}`));
  });

  it('ignores source-specific fields while writing preserved DSL back to IR', () => {
    const layer = createTestLayer('source-field-layer', 'Source field layer', 'null');
    const baselineResult = convertDSLDocumentToIR(createComposition([layer]));
    const converted = convertIRToDSL(baselineResult.scene);
    const editedDSL = structuredClone(converted.dsl);

    Object.assign(editedDSL.layers[0], { mask: {} });
    const result = convertDSLDocumentToIR(editedDSL, {
      preservedData: converted.preservedData,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.scene).toStrictEqual(baselineResult.scene);
  });

  it('maps composition metadata and a static image layer', () => {
    const layer = createTestLayer('img-1', 'Image', 'layer');

    layer.width = 320;
    layer.height = 180;
    layer.time_range = [0.5, 2];
    layer.position = createTestAnimatedProperty([100, 200, 0]);
    layer.scale = createTestAnimatedProperty([0.5, 0.5, 1]);
    layer.anchor = createTestAnimatedProperty([160, 90, 0]);
    layer.description = {
      self: 'A test image',
      composite: 'A test image in the scene',
    };
    layer.asset = {
      url: 'https://example.com/image.png',
      source: 'user',
      prompt: '',
    };

    const animationIR = convertDSLToIR(createComposition([layer]));

    validateCompositionOrThrow(animationIR);
    expect(animationIR.frameRate).toBe(30);
    expect(animationIR.outPoint).toBe(90);
    expect(animationIR).not.toHaveProperty('loop');
    expect(animationIR.endBehavior).toBe(IREndBehavior.Loop);
    expect(animationIR.backgroundColor).toEqual([0x33 / 255, 0x66 / 255, 0x99 / 255, 1]);

    const convertedLayer = animationIR.layers[0];
    const imageAsset = getTestImageAsset(convertedLayer);

    expect(convertedLayer.type).toBe('image');
    expect(convertedLayer.time).toEqual({ inFrame: 15, outFrame: 60 });
    expect(convertedLayer.type === 'image' ? convertedLayer.content.assetId : undefined).toBe(imageAsset?.id);
    expect(imageAsset?.id).toMatch(/^[0-9a-f]{32}$/);
    expect(imageAsset?.source).toEqual({
      kind: 'url',
      url: 'https://example.com/image.png',
    });
    expect(convertedLayer.transform?.position).toEqual({ type: 'static', value: [100, 200, 0] });
    expect(convertedLayer.transform?.scale).toEqual({ type: 'static', value: [0.5, 0.5, 1] });
    expect(convertedLayer).not.toHaveProperty('extensions');
    expect(convertedLayer.localBounds).toEqual({ x: 0, y: 0, width: 320, height: 180 });
  });

  it.each([undefined, ''])('materializes inline SVG with url=%s as a data URL', urlValue => {
    const layer = createTestLayer('svg-1', 'Generated SVG', 'layer');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="5"/></svg>';

    layer.width = 10;
    layer.height = 10;
    layer.time_range = [0, 3];
    layer.asset = { source: 'llm_svg', format: 'svg', svg, prompt: 'a circle', url: urlValue };
    const animationIR = convertDSLToIR(createComposition([layer]));
    const imageAsset = getTestImageAsset(animationIR.layers[0]);
    const url = imageAsset == null ? undefined : getIRResourceSourceUrl(imageAsset.source);

    validateCompositionOrThrow(animationIR);
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(imageAsset?.source).toEqual(expect.objectContaining({ kind: 'embedded', mimeType: 'image/svg+xml' }));
    expect(animationIR.layers[0]).not.toHaveProperty('extensions');
  });

  it('preserves a segment endpoint separately from the next segment start', () => {
    const layer = createTestLayer('repeat', 'Repeating light', 'null');

    layer.time_range = [0, 3];
    layer.position = {
      a: true,
      animation: [
        { t: [0, 1.5], start: [20, 10, 0], end: [80, 10, 0], easing: [0, 0, 1, 1] },
        { t: [1.5, 3], start: [20, 10, 0], end: [80, 10, 0], easing: [0, 0, 1, 1] },
      ],
    };
    const dsl = createComposition([layer]);
    const result = convertDSLDocumentToIR(dsl);
    const position = getIRSceneEntryComposition(result.scene).layers[0].transform?.position;

    expect(result.diagnostics).toEqual([]);
    expect(getKeyframes(position)).toMatchObject([
      { frame: 0, value: [20, 10, 0], endValue: [80, 10, 0] },
      { frame: 45, value: [20, 10, 0], endValue: [80, 10, 0] },
      { frame: 90, value: [80, 10, 0] },
    ]);
    expect(convertIRToDSL(result.scene).dsl.layers[0].position).toEqual(layer.position);
  });

  it('maps nested parent relationships and text data', () => {
    const parent = createTestLayer('group', 'Group', 'null');
    const child = createTestLayer('title', 'Title', 'text');

    parent.time_range = [0, 3];
    child.time_range = [0, 3];
    child.parent = parent.id;
    child.width = 200;
    child.height = 40;
    child.text = {
      content: 'Hello',
      font: 'Arial',
      size: 24,
      color: '#ff0000',
      align: 'center',
      line_height: 1.2,
      letter_spacing: 2,
    };
    parent.children = [child];

    const document = convertDSLToIRScene(createComposition([parent]));
    const animationIR = getIRSceneEntryComposition(document);
    const convertedText = animationIR.layers[1].type === 'text' ? animationIR.layers[1].content : undefined;
    const fontAsset = document.assets.find(asset => asset.id === convertedText?.fontAssetId);

    expect(() => assertIRScene(document)).not.toThrow();
    expect(animationIR.layers).toHaveLength(2);
    expect(animationIR.layers[1].parentId).toBe(animationIR.layers[0].id);
    expect(convertedText).toMatchObject({
      text: 'Hello',
      fontSize: 24,
      color: [1, 0, 0, 1],
      textAlign: 'center',
      lineHeight: 1.2,
    });
    expect(animationIR.layers[1].localBounds).toEqual({ x: -100, y: -16.4, width: 200, height: 40 });
    expect(convertedText).not.toHaveProperty('fontFamily');
    expect(fontAsset).toMatchObject({
      type: 'font', family: 'Arial', style: 'normal', weight: 400, source: { kind: 'system' },
    });
  });

  it('defaults omitted line height to 1.2 times the font size', () => {
    const layer = createTestLayer('title', 'Title', 'text');

    layer.width = 200;
    layer.height = 40;
    layer.time_range = [0, 3];
    layer.text = {
      content: 'Hello',
      font: 'Arial',
      size: 24,
      color: '#ff0000',
    };

    const document = convertDSLToIRScene(createComposition([layer]));
    const convertedLayer = getIRSceneEntryComposition(document).layers[0];
    const convertedText = convertedLayer.type === 'text' ? convertedLayer.content : undefined;

    expect(convertedText?.lineHeight).toBeCloseTo(28.8);
    expect(() => assertIRScene(document)).not.toThrow();
  });

  it.each([
    ['', 'sans-serif'],
    ['   ', 'sans-serif'],
    ['  Arial  ', 'Arial'],
  ])('normalizes DSL font family %j to %j', (fontFamily, expectedFamily) => {
    const layer = createTestLayer('title', 'Title', 'text');

    layer.width = 200;
    layer.height = 40;
    layer.time_range = [0, 3];
    layer.text = {
      content: 'Hello',
      font: fontFamily,
      size: 24,
      color: '#000000',
    };

    const document = convertDSLToIRScene(createComposition([layer]));
    const convertedLayer = getIRSceneEntryComposition(document).layers[0];
    const fontAssetId = convertedLayer.type === 'text' ? convertedLayer.content.fontAssetId : undefined;
    const fontAsset = document.assets.find(asset => asset.id === fontAssetId);

    expect(fontAsset).toMatchObject({ type: 'font', family: expectedFamily });
    expect(() => assertIRScene(document)).not.toThrow();
  });

  it('materializes deterministic text localBounds when DSL dimensions are not positive', () => {
    const layer = createTestLayer('title', 'Title', 'text');

    layer.width = 0;
    layer.height = 0;
    layer.time_range = [0, 3];
    layer.text = {
      content: 'Hello',
      size: 20,
      color: '#000000',
      letter_spacing: 2,
    };

    const document = convertDSLToIRScene(createComposition([layer]));
    const convertedLayer = getIRSceneEntryComposition(document).layers[0];

    expect(convertedLayer.localBounds).toMatchObject({ x: 0, width: 68, height: 24 });
    expect(convertedLayer.localBounds?.y).toBeCloseTo(-21.333333333333332);
    expect(() => assertIRScene(document)).not.toThrow();
  });

  it('maps animation curves to shared IR keyframes', () => {
    const layer = createTestLayer('img-1', 'Animated', 'layer');

    layer.width = 320;
    layer.height = 180;
    layer.time_range = [0, 3];
    layer.asset = {
      url: 'https://example.com/image.png',
      source: 'user',
      prompt: '',
    };
    layer.position = {
      a: true,
      animation: [
        {
          t: [0, 1],
          start: [0, 0, 0],
          end: [30, 60, 0],
          easing: [0.42, 0, 0.58, 1],
          in: [-5, -5, 0],
          out: [5, 5, 0],
        },
      ],
    };
    layer.opacity = {
      a: true,
      animation: [
        {
          t: [0, 1],
          start: [0],
          end: [1],
          easing: [0, 0, 1, 1],
        },
      ],
    };
    layer.rotation = {
      a: true,
      animation: [
        {
          t: [0, 1],
          start: [10, 20, 30],
          end: [40, 50, 60],
          easing: [0.42, 0, 0.58, 1],
        },
      ],
    };

    const animationIR = convertDSLToIR(createComposition([layer]));

    validateCompositionOrThrow(animationIR);
    expect(getKeyframes(animationIR.layers[0].transform?.position)).toEqual([
      {
        frame: 0,
        value: [0, 0, 0],
        endValue: [30, 60, 0],
        outTangent: { x: 0.42, y: 0 },
        spatialOut: [5, 5, 0],
      },
      {
        frame: 30,
        value: [30, 60, 0],
        inTangent: { x: 0.58, y: 1 },
        spatialIn: [-5, -5, 0],
      },
    ]);
    expect(getKeyframes(animationIR.layers[0].transform?.opacity)).toEqual([
      {
        frame: 0,
        value: 0,
        endValue: 1,
        outTangent: { x: 0, y: 0 },
      },
      {
        frame: 30,
        value: 1,
        inTangent: { x: 1, y: 1 },
      },
    ]);
    expect(getKeyframes(animationIR.layers[0].transform?.rotation?.x)).toEqual([
      {
        frame: 0,
        value: 10,
        endValue: 40,
        outTangent: { x: 0.42, y: 0 },
      },
      {
        frame: 30,
        value: 40,
        inTangent: { x: 0.58, y: 1 },
      },
    ]);
    expect(getKeyframes(animationIR.layers[0].transform?.rotation?.y)).toEqual([
      {
        frame: 0,
        value: 20,
        endValue: 50,
        outTangent: { x: 0.42, y: 0 },
      },
      {
        frame: 30,
        value: 50,
        inTangent: { x: 0.58, y: 1 },
      },
    ]);
    expect(getKeyframes(animationIR.layers[0].transform?.rotation?.z)).toEqual([
      {
        frame: 0,
        value: 30,
        endValue: 60,
        outTangent: { x: 0.42, y: 0 },
      },
      {
        frame: 30,
        value: 60,
        inTangent: { x: 0.58, y: 1 },
      },
    ]);
  });

  it('uses initial Z to order sibling groups and keeps their positions in the 2D plane', () => {
    const background = createTestLayer('background', 'Background', 'null');
    const group = createTestLayer('group', 'Group', 'null');
    const child = createTestLayer('child', 'Child', 'null');
    const foreground = createTestLayer('foreground', 'Foreground', 'null');
    const tied = createTestLayer('tied', 'Tied', 'null');

    group.position = createTestAnimatedProperty([100, 200, 5]);
    child.position = createTestAnimatedProperty([10, 20, 100]);
    child.parent = group.id;
    group.children = [child];
    foreground.position = {
      a: true,
      animation: [{ t: [0, 1], start: [20, 30, 8], end: [40, 50, 8], easing: [0, 0, 1, 1] }],
    };
    tied.position = createTestAnimatedProperty([0, 0, 8]);
    const dsl = createComposition([group, foreground, background, tied]);
    const original = structuredClone(dsl);
    const result = convertDSLToIR(dsl);

    expect(result.layers.map(layer => layer.id)).toEqual(['background', 'group', 'child', 'foreground', 'tied']);
    expect(result.layers[1].transform?.position).toEqual({ type: 'static', value: [100, 200, 0] });
    expect(result.layers[2].parentId).toBe('group');
    expect(result.layers[2].transform?.position).toEqual({ type: 'static', value: [10, 20, 0] });
    expect(getKeyframes(result.layers[3].transform?.position)).toMatchObject([
      { value: [20, 30, 0], endValue: [40, 50, 0] },
      { value: [40, 50, 0] },
    ]);
    expect(dsl).toEqual(original);
    dsl.layers.reverse();
    expect(convertDSLToIR(dsl).layers.map(layer => layer.id)).toEqual(result.layers.map(layer => layer.id));
  });

  it('preserves spatial Z and painter order when editing an imported IR scene with its sidecar', () => {
    const baseline = convertDSLToIRScene(createComposition([
      createTestLayer('front', 'Front', 'null'),
      createTestLayer('back', 'Back', 'null'),
    ]));
    const layers = getIRSceneEntryComposition(baseline).layers;

    layers[0].transform!.position = { type: 'static', value: [20, 30, 5] };
    layers[1].transform!.position = { type: 'static', value: [40, 50, -2] };
    const { dsl, preservedData } = convertIRToDSL(baseline);
    const result = convertDSLDocumentToIR(dsl, { preservedData });
    const updated = getIRSceneEntryComposition(result.scene).layers;

    expect(updated.map(layer => layer.id)).toEqual(layers.map(layer => layer.id));
    expect(updated.map(layer => layer.transform?.position)).toEqual(layers.map(layer => layer.transform?.position));
    dsl.layers.reverse();
    expect(getIRSceneEntryComposition(convertDSLDocumentToIR(dsl, { preservedData }).scene).layers).toEqual(updated);
    dsl.layers[0].position = { a: false, value: [20, 30, 100] };
    const reordered = getIRSceneEntryComposition(convertDSLDocumentToIR(dsl, { preservedData }).scene).layers;

    expect(reordered.map(layer => layer.id)).toEqual([...layers].reverse().map(layer => layer.id));
    expect(reordered[1].transform?.position).toEqual(layers[0].transform?.position);

  });

  it('keeps animated source depth when editing XY or stacking rank', () => {
    const baseline = convertDSLToIRScene(createComposition([createTestLayer('layer', 'Layer', 'null')]));
    const layer = getIRSceneEntryComposition(baseline).layers[0];

    layer.transform!.position = {
      type: 'keyframed',
      keyframes: [{ frame: 0, value: [20, 30, -2] }, { frame: 30, value: [40, 50, -8] }],
    };
    const { dsl, preservedData } = convertIRToDSL(baseline);
    const position = dsl.layers[0].position;

    if (!position.a) {
      throw new Error('Expected animated position');
    }
    position.animation[0].start[2] = 99;
    position.animation[0].end[2] = 99;
    expect(getIRSceneEntryComposition(convertDSLDocumentToIR(dsl, { preservedData }).scene)
      .layers[0].transform?.position).toEqual(layer.transform!.position);
    position.animation[0].start[0] = 70;
    const edited = getIRSceneEntryComposition(convertDSLDocumentToIR(dsl, { preservedData }).scene)
      .layers[0].transform?.position;

    expect(getKeyframes(edited).map(keyframe => keyframe.value)).toEqual([[70, 30, -2], [40, 50, -8]]);
  });

  it.each([null, undefined])('assembles transparent compositions with background_color %s', backgroundColor => {
    const composition = createComposition();

    composition.meta.loop = false;
    if (backgroundColor === undefined) {
      delete composition.meta.background_color;
    } else {
      composition.meta.background_color = backgroundColor;
    }

    expect(validateDSL(composition).errors).toEqual([]);
    const animationIR = convertDSLToIR(composition);

    expect(animationIR.endBehavior).toBe(IREndBehavior.Destroy);
    expect(animationIR).not.toHaveProperty('backgroundColor');
  });

  it('clears a preserved background when background_color is omitted', () => {
    const baselineScene = convertDSLToIRScene(createComposition());
    const { dsl, preservedData } = convertIRToDSL(baselineScene);

    delete dsl.meta.background_color;

    const result = convertDSLDocumentToIR(dsl, { preservedData });

    expect(getIRSceneEntryComposition(result.scene).backgroundColor).toBeUndefined();
    expect(getIRSceneEntryComposition(baselineScene).backgroundColor).toBeDefined();
  });
});

describe('color conversion', () => {
  it('emits canonical #rrggbb for opaque colors', () => {
    expect(colorToHex([0, 0, 0, 1])).toBe('#000000');
    expect(colorToHex([1, 0, 0, 1])).toBe('#ff0000');
    expect(colorToHex([0.4, 0.6, 0.8, 1])).toBe('#6699cc');
  });

  it('emits #rrggbbaa only when alpha is not 1', () => {
    expect(colorToHex([0, 0, 0, 0.5])).toBe('#00000080');
    expect(colorToHex([1, 1, 1, 0])).toBe('#ffffff00');
  });

  it('defaults missing alpha to 1 for short IR colors', () => {
    expect(colorToHex([0.4, 0.6, 0.8])).toBe('#6699cc');
  });

  it('collapses semantically equal hex forms', () => {
    expect(isHexEqual('#fff', '#ffffff')).toBe(true);
    expect(isHexEqual('#FFFFFF', '#ffffff')).toBe(true);
    expect(isHexEqual('#666666', '#666666FF')).toBe(true);
    expect(isHexEqual('#666666FF', '#666666')).toBe(true);
    expect(isHexEqual('#666666', '#666667')).toBe(false);
  });

  it('compares nullable hex values symmetrically', () => {
    expect(isHexEqual(null, null)).toBe(true);
    expect(isHexEqual(undefined, null)).toBe(true);
    expect(isHexEqual(null, '#000000')).toBe(false);
    expect(isHexEqual('#000000', null)).toBe(false);
  });

  it('normalizes case and strips opaque alpha', () => {
    expect(normalizeHex('#FFF')).toBe('#ffffff');
    expect(normalizeHex('#FFFFFF')).toBe('#ffffff');
    expect(normalizeHex('#FFFFFFFF')).toBe('#ffffff');
    expect(normalizeHex('#ABCDEF22')).toBe('#abcdef22');
  });

  it('accepts only supported hex color forms', () => {
    expect(isValidHexColor('#fff')).toBe(true);
    expect(isValidHexColor('#abcdef')).toBe(true);
    expect(isValidHexColor('#abcdef22')).toBe(true);
    expect(isValidHexColor('#ab')).toBe(false);
    expect(isValidHexColor('rgb(0,0,0)')).toBe(false);
    expect(isValidHexColor(123)).toBe(false);
  });
});
