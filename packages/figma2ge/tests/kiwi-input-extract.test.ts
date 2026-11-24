import { describe, expect, it } from 'vitest';
import { extractKiwiIR } from '@galacean/figma2ge';

describe('extractKiwiIR', () => {
  it('reconstructs a tree from flat nodeChanges via parentIndex', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 10 },
          type: 4,
          name: 'Root',
          visible: true,
          size: { x: 375, y: 812 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
        },
        {
          guid: { sessionID: 1, localID: 20 },
          parentIndex: { guid: { sessionID: 1, localID: 10 }, position: 'a' },
          type: 10,
          name: 'Card',
          visible: true,
          size: { x: 200, y: 100 },
          transform: { m00: 1, m01: 0, m02: 16, m10: 0, m11: 1, m12: 50 },
          opacity: 0.9,
          cornerRadius: 12,
        },
        {
          guid: { sessionID: 1, localID: 30 },
          parentIndex: { guid: { sessionID: 1, localID: 10 }, position: 'b' },
          type: 13,
          name: 'Title',
          visible: true,
          size: { x: 120, y: 24 },
          transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 200 },
          opacity: 1,
          fontSize: 18,
          textData: { characters: 'Hello Kiwi' },
          fontName: { family: 'PingFang SC', style: 'Semibold', postscript: '' },
          textAlignHorizontal: 1,
        },
      ],
    };

    const { nodes } = extractKiwiIR(input);

    expect(nodes).toHaveLength(1);
    const root = nodes[0];

    expect(root.name).toBe('Root');
    expect(root.kind).toBe('frame');
    expect(root.width).toBe(375);
    expect(root.height).toBe(812);
    expect(root.children).toHaveLength(2);

    const card = root.children[0];

    expect(card.name).toBe('Card');
    expect(card.kind).toBe('shape');
    expect(card.x).toBe(16);
    expect(card.y).toBe(50);
    expect(card.opacity).toBe(0.9);
    expect(card.cornerRadius).toBe(12);

    const title = root.children[1];

    expect(title.name).toBe('Title');
    expect(title.kind).toBe('text');
    expect(title.text).toBe('Hello Kiwi');
    expect(title.textFontSize).toBe(18);
    expect(title.textFontFamily).toBe('PingFang SC');
    expect(title.textFontWeight).toBe(600);
    expect(title.textAlignHorizontal).toBe('CENTER');
  });

  it('maps Kiwi fillPaints (SOLID, GRADIENT, IMAGE)', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 40 },
          type: 10,
          name: 'Painted',
          visible: true,
          size: { x: 100, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          fillPaints: [
            { type: 0, color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 0.8, visible: true },
            {
              type: 1,
              stops: [
                { color: { r: 0, g: 1, b: 0, a: 1 }, position: 0 },
                { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
              ],
              visible: true,
            },
          ],
        },
      ],
    };

    const { nodes } = extractKiwiIR(input);
    const node = nodes[0];

    expect(node.fills).toHaveLength(2);
    expect(node.fills![0].type).toBe('solid');
    expect(node.fills![0].color![0]).toBe(1);
    expect(node.fills![1].type).toBe('gradient');
    expect(node.fills![1].gradient!.type).toBe('linear');
    expect(node.fillColor).toBeDefined();
    expect(node.fillGradient).toBeDefined();
  });

  it('maps Kiwi effects (DROP_SHADOW, FOREGROUND_BLUR)', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 50 },
          type: 4,
          name: 'Shadowed',
          visible: true,
          size: { x: 100, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          effects: [
            {
              type: 1,
              color: { r: 0, g: 0, b: 0, a: 0.25 },
              offset: { x: 0, y: 4 },
              radius: 8,
              spread: 0,
              visible: true,
            },
            {
              type: 2,
              radius: 4,
              visible: true,
            },
          ],
        },
      ],
    };

    const { nodes } = extractKiwiIR(input);
    const node = nodes[0];

    expect(node.effects).toHaveLength(2);
    expect(node.effects![0].type).toBe('DROP_SHADOW');
    expect(node.effects![0].offset).toEqual({ x: 0, y: 4 });
    expect(node.effects![0].radius).toBe(8);
    expect(node.effects![1].type).toBe('FOREGROUND_BLUR');
  });

  it('extracts rotation from Kiwi transform matrix', () => {
    const angle45 = Math.PI / 4;
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 60 },
          type: 10,
          name: 'Rotated',
          visible: true,
          size: { x: 100, y: 50 },
          transform: {
            m00: Math.cos(angle45),
            m01: -Math.sin(angle45),
            m02: 10,
            m10: Math.sin(angle45),
            m11: Math.cos(angle45),
            m12: 20,
          },
        },
      ],
    };

    const { nodes } = extractKiwiIR(input);

    expect(nodes[0].rotation).toBeCloseTo(45, 1);
  });

  it('extracts gradient handles from Paint transform matrix', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 70 },
          type: 10,
          name: 'GradientRect',
          visible: true,
          size: { x: 200, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          fillPaints: [
            {
              type: 1,
              stops: [
                { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
                { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
              ],
              transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
              visible: true,
            },
          ],
        },
      ],
    };

    const { nodes } = extractKiwiIR(input);
    const gradient = nodes[0].fills![0].gradient!;

    expect(gradient.handles).toBeDefined();
    expect(gradient.handles).toHaveLength(3);
    expect(gradient.handles![0]).toEqual({ x: 0, y: 0.5 });
    expect(gradient.handles![1]).toEqual({ x: 1, y: 0.5 });
    expect(gradient.handles![2]).toEqual({ x: 0.5, y: 1 });
  });

  it('extracts image scale mode from fillPaints', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 71 },
          type: 10,
          name: 'ImageRect',
          visible: true,
          size: { x: 100, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          fillPaints: [
            {
              type: 5,
              image: { hash: 'abc123' },
              imageScaleMode: 2,
              opacity: 1,
              visible: true,
            },
          ],
        },
      ],
    };

    const { nodes } = extractKiwiIR(input);

    expect(nodes[0].fills![0].imageScaleMode).toBe('FILL');
  });

  it('extracts stroke cap, join, and dash pattern', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 72 },
          type: 8,
          name: 'DashedLine',
          visible: true,
          size: { x: 200, y: 0 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          strokePaints: [{ type: 0, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }],
          strokeWeight: 2,
          strokeCap: 1,
          strokeJoin: 2,
          dashPattern: [8, 4],
        },
      ],
    };

    const { nodes } = extractKiwiIR(input);
    const stroke = nodes[0].strokes![0];

    expect(stroke.cap).toBe('ROUND');
    expect(stroke.join).toBe('ROUND');
    expect(stroke.dashPattern).toEqual([8, 4]);
  });

  it('extracts auto-layout (stack) properties', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 80 },
          type: 4,
          name: 'AutoLayoutFrame',
          visible: true,
          size: { x: 300, y: 400 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          stackMode: 2,
          stackSpacing: 16,
          stackPadding: 12,
          stackHorizontalPadding: 20,
          stackVerticalPadding: 24,
          stackPaddingRight: 20,
          stackPaddingBottom: 24,
          stackPrimaryAlignItems: 1,
          stackCounterAlignItems: 2,
          stackPrimarySizing: 1,
          stackCounterSizing: 0,
        },
        {
          guid: { sessionID: 1, localID: 81 },
          parentIndex: { guid: { sessionID: 1, localID: 80 }, position: 'a' },
          type: 10,
          name: 'Child',
          visible: true,
          size: { x: 100, y: 50 },
          transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 24 },
          stackChildPrimaryGrow: 1,
          stackChildAlignSelf: 3,
          stackPositioning: 0,
        },
      ],
    };

    const { nodes } = extractKiwiIR(input);
    const frame = nodes[0];

    expect(frame.autoLayout).toBeDefined();
    expect(frame.autoLayout!.direction).toBe('VERTICAL');
    expect(frame.autoLayout!.spacing).toBe(16);
    expect(frame.autoLayout!.paddingTop).toBe(24);
    expect(frame.autoLayout!.paddingRight).toBe(20);
    expect(frame.autoLayout!.paddingBottom).toBe(24);
    expect(frame.autoLayout!.paddingLeft).toBe(20);
    expect(frame.autoLayout!.primaryAlign).toBe('CENTER');
    expect(frame.autoLayout!.counterAlign).toBe('MAX');
    expect(frame.autoLayout!.primarySizing).toBe('HUG');
    expect(frame.autoLayout!.counterSizing).toBe('FIXED');

    const child = frame.children[0];

    expect(child.layoutGrow).toBe(1);
    expect(child.layoutAlignSelf).toBe('STRETCH');
  });

  it('extracts corner smoothing', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 90 },
          type: 12,
          name: 'Squircle',
          visible: true,
          size: { x: 100, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          cornerRadius: 20,
          cornerSmoothing: 0.6,
        },
      ],
    };

    const { nodes } = extractKiwiIR(input);

    expect(nodes[0].cornerRadius).toBe(20);
    expect(nodes[0].cornerSmoothing).toBe(0.6);
  });

  it('skips DOCUMENT and CANVAS nodes, descending into their children', () => {
    const input = {
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: 1, name: 'Document' },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 1, localID: 1 }, position: 'a' },
          type: 2,
          name: 'Canvas',
        },
        {
          guid: { sessionID: 1, localID: 3 },
          parentIndex: { guid: { sessionID: 1, localID: 2 }, position: 'a' },
          type: 4,
          name: 'Frame',
          visible: true,
          size: { x: 100, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
      ],
    };

    const { nodes } = extractKiwiIR(input);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe('Frame');
    expect(nodes[0].kind).toBe('frame');
  });
});
