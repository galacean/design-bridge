import { describe, expect, it } from 'vitest';
import type { IRTextLayer } from '@galacean/animation-ir';
import { convertDSLToIR, convertIRToDSL, type Composition, type Layer } from '../src';

function createText(align: 'left' | 'center' | 'right'): Layer {
  return {
    id: 'title', name: 'Title', type: 'text', width: 240, height: 80,
    description: { self: '', composite: '' },
    position: { a: false, value: [100, 120, 0] },
    anchor: { a: false, value: [7, 9, 0] },
    rotation: { a: false, value: [0, 0, -12] },
    scale: { a: false, value: [1.2, 0.8, 1] },
    text: { content: 'First\nSecond', font: 'sans-serif', size: 30, color: '#ffffff', align, line_height: 42 },
  };
}

function createDSL(text: Layer): Composition {
  return {
    meta: { name: 'Text origin', width: 640, height: 480, duration: 2, fps: 30, loop: false },
    layers: [{
      id: 'group', name: 'Group', type: 'null', width: 400, height: 300,
      description: { self: '', composite: '' },
      position: { a: true, animation: [{
        t: [0, 2], start: [200, 180, 0], end: [220, 190, 0], easing: [0.42, 0, 0.58, 1],
      }] },
      anchor: { a: false, value: [40, 30, 0] },
      rotation: { a: false, value: [0, 0, 25] },
      scale: { a: false, value: [0.7, 1.3, 1] },
      children: [text],
    }],
  };
}

function getText(scene: ReturnType<typeof convertDSLToIR>['scene']): IRTextLayer {
  const text = scene.compositions[0].layers.find(layer => layer.type === 'text');

  if (text?.type !== 'text') {
    throw new Error('Expected text layer');
  }

  return text;
}

describe('text alignment and first-line baseline coordinates', () => {
  it.each([['left', 0], ['center', 120], ['right', 240]] as const)(
    'places the %s alignment point at the text origin without changing transforms', (align, offsetX) => {
      const dsl = createDSL(createText(align));
      const snapshot = structuredClone(dsl);
      const { scene } = convertDSLToIR(dsl);
      const text = getText(scene);

      expect(text.localBounds).toEqual({ x: 0 - offsetX, y: -34, width: 240, height: 80 });
      expect(text.transform).toMatchObject({
        position: { type: 'static', value: [100, 120, 0] },
        anchor: { type: 'static', value: [7, 9, 0] },
        rotation: { z: { type: 'static', value: -12 } },
        scale: { type: 'static', value: [1.2, 0.8, 1] },
      });
      expect(scene.compositions[0].layers[0].transform?.anchor?.value).toEqual([40, 30, 0]);
      expect(dsl).toEqual(snapshot);

      const exported = convertIRToDSL(scene);
      const exportedText = exported.dsl.layers[0].children![0];

      expect(exportedText.anchor).toEqual(dsl.layers[0].children![0].anchor);
      expect(convertDSLToIR(exported.dsl, { preservedData: exported.preservedData }).scene).toEqual(scene);
      expect(getText(convertDSLToIR(exported.dsl).scene)).toEqual({
        ...text, content: { ...text.content, fontAssetId: expect.any(String) },
      });
    },
  );

  it.each(['center', 'right'] as const)('retains %s text placement when IR omits measured bounds', align => {
    const layer = createText(align);

    layer.text = { content: 'Hello', size: 20, color: '#ffffff', align };
    const { scene } = convertDSLToIR(createDSL(layer));
    const original = getText(scene);

    delete original.localBounds;
    const exported = convertIRToDSL(scene);
    const restored = getText(convertDSLToIR(exported.dsl, { preservedData: exported.preservedData }).scene);

    expect(restored.localBounds).toEqual({ x: 0, y: 0, width: 60, height: 24 });
    expect(restored.transform).toEqual(original.transform);
  });

  it('keeps the baseline fixed through text and bounds edits, including an omitted anchor', () => {
    const { scene } = convertDSLToIR(createDSL(createText('center')));
    const exported = convertIRToDSL(scene);
    const edited = exported.dsl.layers[0].children![0];

    edited.width = 320;
    edited.height = 120;
    edited.text = { ...edited.text!, align: 'right', size: 40, line_height: 52 };
    delete edited.anchor;
    const updated = getText(convertDSLToIR(exported.dsl, { preservedData: exported.preservedData }).scene);

    expect(updated.localBounds).toEqual({ x: -320, y: -44, width: 320, height: 120 });
    expect(updated.transform).toEqual(getText(scene).transform);
  });

  it('projects box-local IR to baseline-local DSL and maps anchor edits back only once', () => {
    const { scene } = convertDSLToIR(createDSL(createText('center')));
    const original = getText(scene);

    original.localBounds = { x: 12, y: 15, width: 240, height: 80 };
    const snapshot = structuredClone(scene);
    const exported = convertIRToDSL(scene);
    const text = exported.dsl.layers[0].children![0];

    expect(text.anchor).toEqual({ a: false, value: [-125, -40, 0] });
    expect(convertDSLToIR(exported.dsl, { preservedData: exported.preservedData }).scene).toEqual(snapshot);

    text.anchor = { a: false, value: [5, 6, 0] };
    text.width = 300;
    text.text = { ...text.text!, size: 36, line_height: 48, align: 'right' };
    const updated = getText(convertDSLToIR(exported.dsl, { preservedData: exported.preservedData }).scene);

    expect(updated.transform?.anchor?.value).toEqual([137, 55, 0]);
    expect(updated.localBounds).toEqual({ x: -168, y: 9, width: 300, height: 80 });
    expect(scene).toEqual(snapshot);
  });

  it('rebases a text parent’s child coordinates without changing the child motion', () => {
    const text = createText('center');

    text.children = [{
      id: 'child', name: 'Child', type: 'null', width: 10, height: 10,
      description: { self: '', composite: '' },
      position: { a: true, animation: [{
        t: [0, 2], start: [20, 30, 0], end: [40, 50, 0], easing: [0, 0, 1, 1],
        out: [2, 3, 0], in: [-2, -3, 0],
      }] },
    }];
    const { scene } = convertDSLToIR(createDSL(text));

    getText(scene).localBounds = { x: 0, y: 0, width: 240, height: 80 };
    const exported = convertIRToDSL(scene);
    const child = exported.dsl.layers[0].children![0].children![0];

    expect(child.position).toMatchObject({ a: true, animation: [{
      start: [-100, -4, 2], end: [-80, 16, 2], out: [2, 3, 0], in: [-2, -3, 0],
    }] });
    expect(convertDSLToIR(exported.dsl, { preservedData: exported.preservedData }).scene).toEqual(scene);

    if (!child.position.a) {
      throw new Error('Expected animation');
    }
    child.position.animation[0].end[0] += 10;
    const updated = convertDSLToIR(exported.dsl, { preservedData: exported.preservedData }).scene;
    const updatedChild = updated.compositions[0].layers.find(layer => layer.name === 'Child');

    expect(updatedChild?.transform?.position).toMatchObject({ type: 'keyframed', keyframes: [
      { value: [20, 30, 0], endValue: [50, 50, 0] }, { value: [50, 50, 0] },
    ] });
  });
});
