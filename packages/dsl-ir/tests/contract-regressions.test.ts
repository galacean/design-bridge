import { describe, expect, it } from 'vitest';
import type { IRComposition, IRKeyframe, IRLayer, IRScene, IRVec3 } from '@galacean/animation-ir';
import { convertDSLToIR, convertIRToDSL, validateDSL, type DSLToIRChange } from '../src';

function nullLayer(id: string): IRLayer {
  return { id, name: id, type: 'null', visible: true, time: { inFrame: 0, outFrame: 60 } };
}

function composition(id: string, layers: IRLayer[]): IRComposition {
  return { id, width: 100, height: 100, frameRate: 30, inPoint: 0, outPoint: 60, endBehavior: 'loop', layers };
}

function scene(layers: IRLayer[], children: IRLayer[] = []): IRScene {
  return {
    format: 'animation-ir', schemaVersion: '1.0.0', entryCompositionId: 'root', assets: [],
    compositions: [composition('root', layers), composition('child', children)],
  };
}

function precomp(id: string): IRLayer {
  return { ...nullLayer(id), type: 'precomp', content: { compositionId: 'child', clipToBounds: false } };
}

describe('DSL boundary regressions', () => {
  it.each([7, [], 'meta', true].map(meta => ({ meta })))('rejects non-object meta $meta', ({ meta }) => {
    const result = validateDSL({ meta, layers: [] });

    expect(result.result).toBe('fail');
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'R005', path: 'meta' }));
  });

  it('round-trips fractional frame rates and canvas dimensions', () => {
    const source = scene([]);

    Object.assign(source.compositions[0], { frameRate: 29.97, width: 100.5, height: 90.25 });
    source.compositions[1].frameRate = 29.97;
    const projected = convertIRToDSL(source);

    expect(convertDSLToIR(projected.dsl, { preservedData: projected.preservedData }).scene).toEqual(source);
  });

  it.each(['__proto__', 'constructor', 'toString'])('retains the mapping for %s through JSON storage', id => {
    const projected = convertIRToDSL(scene([nullLayer(id)]));
    const preservedData = JSON.parse(JSON.stringify(projected.preservedData));

    projected.dsl.layers[0].name = 'edited';
    const result = convertDSLToIR(projected.dsl, { preservedData });

    expect(result.scene.compositions[0].layers[0].name).toBe('edited');
    expect(result.diagnostics).toEqual([]);
  });

  it.each([0, -1])(
    'rejects invalid text size %s', size => {
      const dsl = convertIRToDSL(scene([nullLayer('text')])).dsl;

      dsl.layers[0] = {
        ...dsl.layers[0], type: 'text', text: { content: 'hello', size, color: '#000000' },
      };
      expect(validateDSL(dsl).result).toBe('fail');
      expect(() => convertDSLToIR(dsl)).toThrow();
    },
  );
});

describe('precomposition write-back', () => {
  it('preserves mixed frame rates and source offsets without edits', () => {
    const instance = precomp('p');

    instance.time = { inFrame: 0, outFrame: 60, sourceStartFrame: 30 };
    const source = scene([instance], [nullLayer('inside')]);

    source.compositions[1].frameRate = 60;
    const projected = convertIRToDSL(source);
    const changes: DSLToIRChange[] = [];
    const result = convertDSLToIR(projected.dsl, {
      preservedData: projected.preservedData, onChange: change => changes.push(change),
    });

    expect(result.scene).toEqual(source);
    expect(changes).toEqual([]);
  });

  it.each([30, 24, 60])('uses each composition frame domain when editing at %s fps', fps => {
    const instance = precomp('p');

    instance.time = { inFrame: 0, outFrame: 60, sourceStartFrame: 30 };
    const source = scene([instance], [nullLayer('inside')]);

    source.compositions[1].frameRate = 60;
    const projected = convertIRToDSL(source);
    const child = projected.dsl.layers[0].children![0];

    projected.dsl.meta.fps = fps;
    child.time_range = [0.25, 0.75];
    child.opacity = { a: true, animation: [
      { t: [0.25, 0.75], start: [0.2], end: [0.8], easing: [0, 0, 1, 1] },
    ] };
    const result = convertDSLToIR(projected.dsl, { preservedData: projected.preservedData });
    const [root, nested] = result.scene.compositions;
    const nestedFps = fps === 30 ? 60 : fps;
    const opacity = nested.layers[0].transform?.opacity;

    expect(nested.frameRate).toBe(nestedFps);
    expect(root.layers[0].time).toMatchObject({ sourceStartFrame: nestedFps / 2 });
    expect(nested.layers[0].time).toEqual({ inFrame: nestedFps / 4, outFrame: nestedFps * 0.75 });
    expect(opacity?.type).toBe('keyframed');
    if (opacity?.type === 'keyframed') {
      expect(opacity.keyframes.map(keyframe => keyframe.frame)).toEqual([nestedFps / 4, nestedFps * 0.75]);
    }
    expect(source.compositions[1].frameRate).toBe(60);
  });

  it('uses composition-local identity when root and expanded layers share an ID', () => {
    const projected = convertIRToDSL(scene([nullLayer('same'), precomp('p')], [nullLayer('same')]));
    const child = projected.dsl.layers.find(layer => layer.id === 'p')!.children![0];

    child.name = 'edited child';
    const result = convertDSLToIR(projected.dsl, { preservedData: projected.preservedData });

    expect(result.scene.compositions[0].layers.find(layer => layer.id === 'same')!.name).toBe('same');
    expect(result.scene.compositions[1].layers[0].name).toBe('edited child');
  });

  it('keeps conflicting fields unchanged while applying compatible edits to shared layers', () => {
    const projected = convertIRToDSL(scene([precomp('a'), precomp('b')], [nullLayer('inside')]));
    const [first, second] = projected.dsl.layers.map(layer => layer.children![0]);

    first.name = 'first';
    second.name = 'second';
    first.opacity = { a: false, value: 0.5 };
    const result = convertDSLToIR(projected.dsl, { preservedData: projected.preservedData });

    expect(result.scene.compositions[1].layers[0].name).toBe('inside');
    expect(result.scene.compositions[1].layers[0].transform?.opacity).toEqual({ type: 'static', value: 0.5 });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SHARED_PRECOMP_EDIT_CONFLICT' }));
  });

  it('applies a shared edit even when another instance is unchanged', () => {
    const projected = convertIRToDSL(scene([precomp('a'), precomp('b')], [nullLayer('inside')]));

    projected.dsl.layers[0].children![0].name = 'shared name';
    const result = convertDSLToIR(projected.dsl, { preservedData: projected.preservedData });

    expect(result.scene.compositions[1].layers[0].name).toBe('shared name');
    expect(result.diagnostics).toEqual([]);
  });

  it('applies identical shared edits once without mutating input DSL', () => {
    const projected = convertIRToDSL(scene([precomp('a'), precomp('b')], [nullLayer('inside')]));

    for (const instance of projected.dsl.layers) {
      instance.children![0].name = 'shared';
    }
    const before = structuredClone(projected.dsl);
    const names: string[] = [];
    const result = convertDSLToIR(projected.dsl, {
      preservedData: projected.preservedData,
      onChange: change => {
        if (change.field === 'name') {
          names.push(String(change.newValue));
        }
      },
    });

    expect(names).toEqual(['shared']);
    expect(result.diagnostics).toEqual([]);
    expect(projected.dsl).toEqual(before);
  });

  it('keeps shared contents when only a precomposition instance is removed', () => {
    const projected = convertIRToDSL(scene([precomp('a'), precomp('b')], [nullLayer('inside')]));

    projected.dsl.layers = projected.dsl.layers.filter(layer => layer.id !== 'a');
    const result = convertDSLToIR(projected.dsl, { preservedData: projected.preservedData });

    expect(result.scene.compositions[0].layers.map(layer => layer.id)).toEqual(['b']);
    expect(result.scene.compositions[1].layers).toEqual([nullLayer('inside')]);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports unsupported edits on later shared instances even when supported fields are applied once', () => {
    const projected = convertIRToDSL(scene([precomp('a'), precomp('b')], [nullLayer('inside')]));

    projected.dsl.layers[1].children![0].description.self = 'unsupported description';
    const result = convertDSLToIR(projected.dsl, { preservedData: projected.preservedData });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'LAYER_DESCRIPTION_CHANGE_IGNORED' }));
  });

  it('ignores conflicting shared edits regardless of instance traversal order', () => {
    const projected = convertIRToDSL(scene([precomp('a'), precomp('b')], [nullLayer('inside')]));

    for (const instance of projected.dsl.layers) {
      instance.children![0].name = instance.id;
    }
    const forward = convertDSLToIR(projected.dsl, { preservedData: projected.preservedData });

    projected.dsl.layers.reverse();
    const reversed = convertDSLToIR(projected.dsl, { preservedData: projected.preservedData });

    expect(forward.scene).toEqual(reversed.scene);
    expect(forward.scene.compositions[1].layers[0].name).toBe('inside');
  });

  it('reports that deleting a shared layer affects every instance', () => {
    const projected = convertIRToDSL(scene([precomp('a'), precomp('b')], [nullLayer('inside')]));

    projected.dsl.layers[0].children = [];
    const result = convertDSLToIR(projected.dsl, { preservedData: projected.preservedData });

    expect(result.scene.compositions[1].layers).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SHARED_PRECOMP_LAYER_DELETED' }));
  });
});

describe('preserved editing isolation', () => {
  it('does not bind a deleted layer to a surviving layer with the same name', () => {
    const source = scene(['a', 'b'].map((id, index) => ({
      ...nullLayer(id), name: 'same', transform: { opacity: { type: 'static', value: index === 0 ? 0.2 : 0.8 } },
    })));
    const projected = convertIRToDSL(source);

    projected.dsl.layers = projected.dsl.layers.filter(layer => layer.id !== 'b');
    const result = convertDSLToIR(projected.dsl, { preservedData: projected.preservedData });

    expect(result.scene.compositions[0].layers).toEqual([source.compositions[0].layers[0]]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each<{ name: string; keyframes: IRKeyframe<IRVec3>[] }>([
    { name: 'implicit endpoints', keyframes: [
      { frame: 0, value: [20, 30, -2] }, { frame: 30, value: [40, 50, -8] },
      { frame: 60, value: [60, 70, -14] },
    ] },
    { name: 'explicit endpoint jump', keyframes: [
      { frame: 0, value: [20, 30, -2], endValue: [40, 50, -8] }, { frame: 30, value: [40, 50, -20] },
    ] },
    { name: 'held depth', keyframes: [
      { frame: 0, value: [20, 30, -2], hold: true }, { frame: 30, value: [40, 50, -8] },
    ] },
  ])('preserves source depth segments during an XY edit: $name', ({ keyframes }) => {
    const source = scene([{ ...nullLayer('moving'), transform: { position: { type: 'keyframed', keyframes } } }]);
    const projected = convertIRToDSL(source);
    const position = projected.dsl.layers[0].position;

    if (!position.a) {
      throw new Error('Expected animated position');
    }
    position.animation[0].start[0] = 70;
    const result = convertDSLToIR(projected.dsl, { preservedData: projected.preservedData });
    const updated = result.scene.compositions[0].layers[0].transform?.position;

    if (updated?.type !== 'keyframed') {
      throw new Error('Expected keyframed position');
    }
    expect(updated.keyframes[0].value[0]).toBe(70);
    expect(updated.keyframes.map(keyframe => keyframe.value[2])).toEqual(keyframes.map(keyframe => keyframe.value[2]));
    for (let index = 0; index < keyframes.length - 1; index++) {
      const original = keyframes[index];
      const expectedEnd = original.hold === true
        ? original.value[2]
        : (original.endValue ?? keyframes[index + 1].value)[2];
      const actual = updated.keyframes[index];
      const actualEnd = (actual.endValue ?? updated.keyframes[index + 1].value)[2];

      expect((actual.value[2] + actualEnd) / 2).toBe((original.value[2] + expectedEnd) / 2);
    }
    expect(projected.preservedData.baselineScene).toEqual(source);
  });

  it.each(['fill', 'stroke'] as const)('isolates image replacements from a shared shape %s', channel => {
    const paint = { type: 'texture' as const, assetId: 'shared' };
    const source = scene([
      { ...nullLayer('image'), type: 'image', content: { assetId: 'shared' },
        localBounds: { x: 0, y: 0, width: 100, height: 100 } },
      { ...nullLayer('shape'), type: 'shape', content: { shapes: [{
        primitiveType: 'rectangle', position: [0, 0], width: 100, height: 100,
        fills: channel === 'fill' ? [paint] : [],
        strokes: channel === 'stroke' ? [{ paint, width: 2, cap: 'butt', join: 'miter' }] : [],
      }] } },
    ]);

    source.assets = [{ id: 'shared', type: 'image', source: { kind: 'url', url: 'https://example.com/original.png' } }];
    const projected = convertIRToDSL(source);
    const image = projected.dsl.layers.find(layer => layer.id === 'image')!;

    if (image.type !== 'layer') {
      throw new Error('Expected image layer');
    }
    image.asset = { source: 'user', prompt: '', url: 'https://example.com/edited.png' };
    const result = convertDSLToIR(projected.dsl, { preservedData: projected.preservedData });
    const updated = result.scene.compositions[0].layers[0];

    if (updated.type !== 'image') {
      throw new Error('Expected image layer');
    }
    expect(updated.content.assetId).not.toBe('shared');
    expect(result.scene.assets.find(asset => asset.id === 'shared')).toEqual(source.assets[0]);
    expect(result.scene.assets.find(asset => asset.id === updated.content.assetId)?.source).toEqual({
      kind: 'url', url: 'https://example.com/edited.png',
    });
    expect(result.scene.compositions[0].layers[1]).toEqual(source.compositions[0].layers[1]);
  });

  it('keeps a single-keyframe scale isolated from in-place DSL edits', () => {
    const source = scene([{ ...nullLayer('scaled'), transform: {
      scale: { type: 'keyframed', keyframes: [{ frame: 0, value: [1, 1, 1] }] },
    } }]);
    const projected = convertIRToDSL(source);
    const scale = projected.dsl.layers[0].scale;

    if (scale?.a !== false) {
      throw new Error('Expected static scale projection');
    }
    scale.value[0] = 2;
    expect(projected.preservedData.baselineScene).toEqual(source);
    const changes: DSLToIRChange[] = [];
    const result = convertDSLToIR(projected.dsl, {
      preservedData: projected.preservedData, onChange: change => changes.push(change),
    });

    expect(result.scene.compositions[0].layers[0].transform?.scale).toEqual({ type: 'static', value: [2, 1, 1] });
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'transform', field: 'scale' }));
  });

  it('retains unedited full-precision text colors when changing content', () => {
    const source = scene([{ ...nullLayer('text'), type: 'text',
      localBounds: { x: 0, y: 0, width: 100, height: 40 },
      content: { text: 'before', fontAssetId: 'font', fontSize: 20, color: [0.123, 0.345, 0.567, 1],
        letterSpacing: 0, lineHeight: 20, textAlign: 'left' },
    }]);

    source.assets = [{ id: 'font', type: 'font', family: 'sans-serif', style: 'normal', weight: 400,
      source: { kind: 'system' } }];
    const projected = convertIRToDSL(source);
    const text = projected.dsl.layers[0];

    if (text.type !== 'text') {
      throw new Error('Expected text layer');
    }
    text.text.content = 'after';
    const changes: DSLToIRChange[] = [];
    const result = convertDSLToIR(projected.dsl, {
      preservedData: projected.preservedData, onChange: change => changes.push(change),
    });
    const updated = result.scene.compositions[0].layers[0];

    expect(updated).toMatchObject({ content: { text: 'after', color: [0.123, 0.345, 0.567, 1] } });
    expect(changes.map(change => change.field)).toEqual(['text.content']);
  });
});

describe('independent rotation channels', () => {
  it('evaluates temporal easing and outgoing end values before linearizing', () => {
    const layer = nullLayer('eased');

    layer.transform = { rotation: {
      x: { type: 'keyframed', keyframes: [
        { frame: 0, value: 10, endValue: 90, outTangent: { x: 1 / 3, y: 0 } },
        { frame: 60, value: 110, inTangent: { x: 2 / 3, y: 0 } },
      ] },
      z: { type: 'keyframed', keyframes: [{ frame: 30, value: 20 }, { frame: 90, value: 40 }] },
    } };
    const rotation = convertIRToDSL(scene([layer])).dsl.layers[0].rotation;

    if (rotation?.a !== true) {
      throw new Error('Expected animated rotation');
    }
    expect(rotation.animation[0].start).toEqual([10, 0, 20]);
    expect(rotation.animation[0].end[0]).toBeCloseTo(20, 8);
    expect(rotation.animation[1].end[0]).toBeCloseTo(90, 8);
    expect(rotation.animation[2].start[0]).toBe(110);
    expect(rotation.animation[2].end[0]).toBe(110);
  });

  it('retains hold jumps at independently authored keyframe times', () => {
    const layer = nullLayer('held');

    layer.transform = { rotation: {
      x: { type: 'keyframed', keyframes: [{ frame: 0, value: 10, hold: true }, { frame: 60, value: 70 }] },
      z: { type: 'keyframed', keyframes: [{ frame: 0, value: 0 }, { frame: 30, value: 30 }, { frame: 90, value: 90 }] },
    } };
    const rotation = convertIRToDSL(scene([layer])).dsl.layers[0].rotation;

    if (rotation?.a !== true) {
      throw new Error('Expected animated rotation');
    }
    expect(rotation.animation[0].end[0]).toBe(10);
    expect(rotation.animation[1].end[0]).toBe(10);
    expect(rotation.animation[2].start[0]).toBe(70);
  });

  it('samples between axis keyframes and reports the linearized projection', () => {
    const layer = nullLayer('animated');

    layer.transform = { rotation: {
      x: { type: 'keyframed', keyframes: [{ frame: 0, value: 0 }, { frame: 60, value: 60 }] },
      z: { type: 'keyframed', keyframes: [
        { frame: 0, value: 10 }, { frame: 30, value: 40 }, { frame: 60, value: 70 },
      ] },
    } };
    const source = scene([layer]);
    const projected = convertIRToDSL(source);
    const rotation = projected.dsl.layers[0].rotation;

    expect(rotation?.a).toBe(true);
    if (rotation?.a !== true) {
      throw new Error('Expected animated rotation');
    }
    expect(rotation.animation[0].end).toEqual([30, 0, 40]);
    expect(projected.diagnostics).toContainEqual(expect.objectContaining({ code: 'ROTATION_CHANNELS_APPROXIMATED' }));
    expect(convertDSLToIR(projected.dsl, { preservedData: projected.preservedData }).scene).toEqual(source);
  });
});
