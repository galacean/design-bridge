import { describe, expect, it } from 'vitest';
import { DataType, TextSizeMode } from '@galacean/effects-specification';
import { convertDSLToIR, type Composition, type Layer } from '@galacean/dsl-ir';
import { convertIRToGE } from '@galacean/ge-ir';

describe('DSL baseline-local text to GE', () => {
  it.each(['left', 'center', 'right'] as const)('keeps %s text rotating around its layout center', align => {
    const alignment = align === 'left' ? 0 : align === 'center' ? 0.5 : 1;
    const text: Layer = {
      id: 'title', name: 'Title', type: 'text', width: 240, height: 80,
      description: { self: '', composite: '' },
      text: { content: 'Travel', size: 30, color: '#ffffff', align },
      anchor: { a: false, value: [120 - alignment * 240, 8, 0] },
      position: { a: false, value: [320, 240, 1] },
      rotation: { a: true, animation: [{ t: [0, 2], start: [0, 0, 0], end: [0, 0, 90], easing: [0, 0, 1, 1] }] },
      scale: { a: true, animation: [{ t: [0, 2], start: [1, 1, 1], end: [1.2, 1.2, 1], easing: [0, 0, 1, 1] }] },
    };
    const dsl: Composition = {
      meta: { name: 'Text center', width: 640, height: 480, fps: 30, duration: 2, loop: false },
      layers: [text],
    };
    const snapshot = structuredClone(dsl);
    const result = convertIRToGE(convertDSLToIR(dsl).scene);
    const component = result.scene.components.find(value => value.dataType === DataType.TextComponent);

    // GE's first baseline is 32 px from the top; the baseline-local center is (W/2 - aW, H/2 - 32).
    expect(component).toMatchObject({
      options: { textWidth: 240, textHeight: 80, fontSize: 30, lineHeight: 36, autoResize: TextSizeMode.fixed },
      renderer: { anchor: [0.5, 0.5] },
    });
    expect(dsl).toEqual(snapshot);
  });
});
