import { describe, it, expect } from 'vitest';
import { enrichSceneForBaseline } from '@galacean/html2figma';
import type { SceneNode } from '@galacean/html2figma';
import { makeIR, makeSceneNode } from '../helpers/scene-factories';

describe('snapshot normalization', () => {
  it('keeps measured icon boxes and margin geometry instead of rebuilding flow', () => {
    const root = makeSceneNode({
      x: 40, y: 60,
      ir: makeIR({ autoLayout: { stackMode: 'VERTICAL', stackSpacing: 0 } }),
      children: [
        makeSceneNode({ x: 44, y: 64, styles: { marginBottom: '16px' } }),
        makeSceneNode({ type: 'icon', x: 44, y: 130, width: 40, height: 40,
          styles: { fontFamily: 'Material Symbols', fontSize: '20px', lineHeight: '40px' } }),
      ],
    });
    const result = enrichSceneForBaseline(root, 'snapshot');

    expect(result).toEqual(root);
    expect(result).not.toBe(root);
    expect(result.children[0]).not.toBe(root.children[0]);
  });

  it.each(['snapshot', 'auto-layout'] as const)('%s retains gradient mask groups and measured coordinates', layoutMode => {
    const image = makeSceneNode({ type: 'image', x: 24, y: 36, width: 80, height: 60,
      styles: { maskImage: 'linear-gradient(90deg, transparent, black)' } });
    const result = enrichSceneForBaseline(makeSceneNode({ children: [image] }), layoutMode);
    const group = result.children[0];

    expect(group.name).toBe('Img:mask-group');
    expect(group.children).toHaveLength(2);
    expect(group.children[0]).toMatchObject({ mask: true, maskType: 'ALPHA', x: 24, y: 36, width: 80, height: 60 });
    expect(group.children[0].ir.fills[0]?.type).toBe('GRADIENT_LINEAR');
    expect(group.children[1]).toMatchObject({ x: 24, y: 36, width: 80, height: 60 });
    expect(image.styles.maskImage).not.toBe('none');
  });
});

// ---- Helpers ----

function makeFrameIR(overrides: Parameters<typeof makeIR>[0] = {}) {
  return makeIR(overrides);
}

function makeFrame(overrides: Partial<SceneNode> = {}): SceneNode {
  return makeSceneNode({
    name: 'Frame',
    width: 100,
    height: 100,
    ...overrides,
  });
}

function makeText(overrides: Partial<SceneNode> = {}): SceneNode {
  return makeSceneNode({
    type: 'text',
    name: 'Text',
    x: 10,
    y: 10,
    width: 80,
    height: 20,
    text: 'Hello',
    svg: null,
    styles: { fontSize: '14px', color: 'rgb(0,0,0)', lineHeight: 'normal' },
    children: [],
    ...overrides,
  });
}

function makeIcon(overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    type: 'icon',
    name: 'icon',
    x: 0,
    y: 0,
    width: 24,
    height: 24,
    text: null,
    svg: '<svg/>',
    svgContent: true,
    styles: { fontFamily: 'Material Symbols Outlined', fontSize: '24px', lineHeight: '24px' },
    children: [],
    ir: makeFrameIR({ isAbsolute: false }),
    ...overrides,
  } as unknown as SceneNode;
}

// ---- BUTTON normalization ----

describe('measured icon normalization', () => {
  it.each([16, 20, 24, 32])('preserves a %spx vector icon wrapper', size => {
    const root = makeFrame({
      children: [makeIcon({ width: size, height: size })],
      ir: makeIR({ autoLayout: { stackMode: 'HORIZONTAL', stackSpacing: 0 } }),
    });
    const result = enrichSceneForBaseline(root);

    expect(result.children[0].width).toBe(size);
    expect(result.children[0].height).toBe(size);
  });

  it('preserves explicit backdrop blur and the measured frosted icon size', () => {
    const root = makeFrame({
      styles: {
        backgroundColor: 'rgba(255,255,255,0.2)', borderTopWidth: '1px',
        boxShadow: '0px 2px 6px rgba(0,0,0,0.2)',
      },
      children: [makeIcon({ width: 16, height: 16 })],
      ir: makeIR({ effects: [{ type: 'BACKGROUND_BLUR', radius: 4 }] }),
    });
    const result = enrichSceneForBaseline(root);

    expect(result.ir.effects).toEqual([{ type: 'BACKGROUND_BLUR', radius: 4 }]);
    expect(result.children.find(child => child.name === 'Container')).toMatchObject({ width: 16, height: 16 });
  });
});

describe('input decoration preservation', () => {
  it.each(['snapshot', 'auto-layout'] as const)('%s keeps input border, background, corners and positioning', layoutMode => {
    const input = makeText({
      tagName: 'INPUT',
      styles: { paddingLeft: '12px', backgroundColor: 'rgb(255,255,255)' },
      ir: makeIR({
        opacity: 0.8,
        isAbsolute: true,
        absoluteConstraints: { horizontal: 'MAX', vertical: 'MIN' },
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
        border: { width: 2, color: { r: 1, g: 0, b: 0, a: 1 }, style: 'SOLID' },
        cornerRadii: { tl: 8, tr: 8, bl: 8, br: 8, allSame: true },
      }),
    });
    const result = enrichSceneForBaseline(input, layoutMode);

    expect(result.type).toBe('frame');
    expect(result.ir).toMatchObject({
      opacity: 0.8, isAbsolute: true, border: input.ir.border,
      fills: input.ir.fills, cornerRadii: input.ir.cornerRadii,
      absoluteConstraints: input.ir.absoluteConstraints,
    });
    expect(result.ir.textProps).toBeUndefined();
    expect(result.children[0].children[0].ir).toMatchObject({ opacity: 1, effects: [], fills: [] });
    expect(result.children[0].children[0].ir.border).toBeUndefined();
    expect(input.type).toBe('text');
  });
});

describe('decorative inline text preservation', () => {
  it.each(['snapshot', 'auto-layout'] as const)('%s applies decoration and opacity once on the outer frame', layoutMode => {
    const node = makeText({
      x: 20, y: 30, width: 100, height: 50,
      textMetrics: { charWidths: [50], ascent: 14, fontLineHeight: 18, baselineOffset: 23.5 },
      styles: {
        backgroundColor: 'rgb(0,102,255)', opacity: '0.5', borderRadius: '8px', position: 'absolute', right: '12px',
        paddingTop: '6px', paddingBottom: '6px', paddingLeft: '10px', paddingRight: '10px',
        borderTopWidth: '2px', borderBottomWidth: '2px', borderLeftWidth: '2px', borderRightWidth: '2px',
      },
      ir: makeIR({
        figmaType: 'TEXT', opacity: 0.5, isAbsolute: true,
        absoluteConstraints: { horizontal: 'MAX', vertical: 'MIN' },
        fills: [{ type: 'SOLID', color: { r: 0, g: 0.4, b: 1, a: 1 } }],
        border: { width: 2, style: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } },
        effects: [{ type: 'DROP_SHADOW', radius: 4, spread: 0, offset: { x: 0, y: 2 },
          color: { r: 0, g: 0, b: 0, a: 0.5 } }],
      }),
    });
    const result = enrichSceneForBaseline(node, layoutMode);

    expect(result.ir).toMatchObject({
      opacity: 0.5, border: node.ir.border, effects: node.ir.effects, fills: node.ir.fills,
      isAbsolute: true, absoluteConstraints: node.ir.absoluteConstraints,
    });
    expect(result.children[0]).toMatchObject({ x: 32, y: 38, width: 76, height: 34 });
    expect(result.children[0].ir).toMatchObject({ opacity: 1, fills: [], effects: [], isAbsolute: false });
    expect(result.children[0].ir.border).toBeUndefined();
    expect(result.children[0].ir.cornerRadii).toBeUndefined();
    expect(result.children[0].textMetrics?.baselineOffset).toBe(15.5);
    expect(node.textMetrics?.baselineOffset).toBe(23.5);
    expect(node.ir.opacity).toBe(0.5);
  });
});

describe('maybeNormalizeButtonFrame (via enrichSceneForBaseline)', () => {
  it('BUTTON tag → renamed to "Button" with CENTER auto-layout', () => {
    const btn = makeFrame({
      tagName: 'BUTTON',
      name: 'btn',
      styles: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: '12px',
        paddingRight: '24px',
        paddingBottom: '12px',
        paddingLeft: '24px',
      },
      children: [makeText({ text: 'Click me' })],
      ir: makeFrameIR({
        autoLayout: {
          stackMode: 'HORIZONTAL',
          stackSpacing: 0,
          stackVerticalPadding: 12,
          stackHorizontalPadding: 24,
          stackPaddingRight: 24,
          stackPaddingBottom: 12,
          stackPrimaryAlignItems: 'CENTER',
          stackCounterAlignItems: 'CENTER',
        },
      }),
    });
    const result = enrichSceneForBaseline(btn);

    expect(result.name).toBe('Button');
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
    expect(result.ir?.autoLayout?.stackPrimaryAlignItems).toBe('CENTER');
    expect(result.ir?.autoLayout?.stackCounterAlignItems).toBe('CENTER');
  });

  it('BUTTON with only icon child → icon-only compact layout', () => {
    const btn = makeFrame({
      tagName: 'BUTTON',
      name: 'icon-btn',
      styles: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: '0px',
        paddingRight: '0px',
        paddingBottom: '0px',
        paddingLeft: '0px',
      },
      children: [makeIcon()],
      ir: makeFrameIR(),
    });
    const result = enrichSceneForBaseline(btn);

    expect(result.name).toBe('Button');
  });
});

// ---- Dashed promo card (bugfix verification) ----

describe('maybeNormalizeDashedPromoCard — container position offset', () => {
  function makePromoCard(iconX: number, iconY: number) {
    const icon = makeIcon({
      x: iconX,
      y: iconY,
      width: 96,
      height: 96,
      styles: {
        fontFamily: 'Material Symbols Outlined',
        fontSize: '60px',
        lineHeight: '60px',
        position: 'absolute',
        bottom: '-8px',
        right: '-8px',
        top: 'auto',
        left: 'auto',
      },
      ir: makeFrameIR({
        isAbsolute: true,
        absoluteConstraints: { horizontal: 'MAX', vertical: 'MAX' },
      }),
    });

    const textContent = makeText({ x: iconX - 90, y: iconY - 60, text: '5元', tagName: 'SPAN' });

    return makeFrame({
      name: 'promo',
      x: 0,
      y: 0,
      width: 160,
      height: 112,
      styles: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        borderTopStyle: 'dashed',
      },
      children: [textContent, icon],
      ir: makeFrameIR({
        autoLayout: {
          stackMode: 'VERTICAL',
          stackSpacing: 0,
          stackVerticalPadding: 0,
          stackHorizontalPadding: 0,
          stackPaddingRight: 0,
          stackPaddingBottom: 0,
          stackPrimaryAlignItems: 'SPACE_BETWEEN',
          stackCounterAlignItems: 'MIN',
        },
      }),
    });
  }

  function findContainer(result: SceneNode) {
    return (result.children || []).find(c => c.type === 'frame' && c.ir?.isAbsolute && c.name === 'Container');
  }

  it('icon with right:-8px bottom:-8px → container x offset by -8', () => {
    const iconX = 72;
    const iconY = 22;
    const result = enrichSceneForBaseline(makePromoCard(iconX, iconY));
    const containerChild = findContainer(result);

    expect(containerChild).toBeDefined();
    expect(containerChild!.x).toBe(iconX - 8);
    expect(containerChild!.y).toBe(iconY - 8);
  });

  it('container width/height includes overflow space', () => {
    const result = enrichSceneForBaseline(makePromoCard(72, 22));
    const containerChild = findContainer(result)!;

    expect(containerChild.width).toBe(96 + 8);
    expect(containerChild.height).toBe(96 + 8);
  });

  it('inner icon child position reset to (0,0)', () => {
    const result = enrichSceneForBaseline(makePromoCard(72, 22));
    const containerChild = findContainer(result);
    const innerIcon = containerChild?.children?.[0];

    expect(innerIcon?.x).toBe(0);
    expect(innerIcon?.y).toBe(0);
  });

  it('container stackVerticalPadding = extraBottom (8)', () => {
    const result = enrichSceneForBaseline(makePromoCard(72, 22));
    const containerChild = findContainer(result);

    expect(containerChild!.ir?.autoLayout?.stackVerticalPadding).toBe(8);
    expect(containerChild!.ir?.autoLayout?.stackPaddingBottom).toBe(0);
  });
});

// ---- INPUT → frame conversion ----

describe('maybeConvertInputToInputFrame', () => {
  it('INPUT text node → Input > Container > Text structure', () => {
    const input = makeText({
      type: 'text',
      tagName: 'INPUT',
      name: 'Search',
      text: 'Placeholder',
      x: 0,
      y: 0,
      width: 200,
      height: 44,
      styles: {
        paddingTop: '12px',
        paddingRight: '16px',
        paddingBottom: '12px',
        paddingLeft: '16px',
        fontSize: '14px',
        color: 'rgb(100,100,100)',
        lineHeight: 'normal',
      },
      ir: makeFrameIR({
        figmaType: 'TEXT',
        textProps: {
          fontFamily: 'Inter',
          fontWeight: 400,
          fontSize: 14,
          lineHeightPx: 17.5,
          letterSpacing: 0,
          textAlign: 'LEFT',
          color: { r: 0.39, g: 0.39, b: 0.39, a: 1 },
        },
      }),
    });
    const parent = makeFrame({ children: [input] });
    const result = enrichSceneForBaseline(parent);
    const inputFrame = result.children[0];

    expect(inputFrame.name).toBe('Input');
    expect(inputFrame.type).toBe('frame');
    expect(inputFrame.children).toHaveLength(1);

    const container = inputFrame.children[0];

    expect(container.name).toBe('Container');
    expect(container.type).toBe('frame');
    expect(container.children).toHaveLength(1);

    const textNode = container.children[0];

    expect(textNode.type).toBe('text');
  });

  it('INPUT frame auto-layout padding matches CSS padding', () => {
    const input = makeText({
      type: 'text',
      tagName: 'INPUT',
      text: 'Search',
      x: 0,
      y: 0,
      width: 200,
      height: 40,
      styles: {
        paddingTop: '8px',
        paddingRight: '12px',
        paddingBottom: '8px',
        paddingLeft: '12px',
        fontSize: '14px',
        color: 'rgb(0,0,0)',
        lineHeight: 'normal',
      },
    });
    const result = enrichSceneForBaseline(makeFrame({ children: [input] }));
    const inputFrame = result.children[0];
    const al = inputFrame.ir?.autoLayout;

    expect(al?.stackVerticalPadding).toBe(8);
    expect(al?.stackHorizontalPadding).toBe(12);
    expect(al?.stackPaddingRight).toBe(12);
    expect(al?.stackPaddingBottom).toBe(8);
  });
});

// ---- Decorative text overlay ----

describe('maybeConvertDecorativeInlineTextToOverlay', () => {
  it('text with background + rounded + padding → Overlay > Text', () => {
    const badge = makeText({
      text: '2',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      styles: {
        display: 'inline-flex',
        backgroundColor: 'rgb(255, 100, 0)',
        borderRadius: '10px',
        borderTopLeftRadius: '10px',
        borderTopRightRadius: '10px',
        borderBottomLeftRadius: '10px',
        borderBottomRightRadius: '10px',
        paddingTop: '2px',
        paddingRight: '6px',
        paddingBottom: '2px',
        paddingLeft: '6px',
        fontSize: '12px',
        color: 'rgb(255,255,255)',
        lineHeight: 'normal',
      },
      ir: makeFrameIR({
        figmaType: 'TEXT',
        textProps: {
          fontFamily: 'Inter',
          fontWeight: 700,
          fontSize: 12,
          lineHeightPx: 15,
          letterSpacing: 0,
          textAlign: 'CENTER',
          color: { r: 1, g: 1, b: 1, a: 1 },
        },
      }),
    });
    const result = enrichSceneForBaseline(makeFrame({ children: [badge] }));
    const overlay = result.children[0];

    expect(overlay.name).toBe('Overlay');
    expect(overlay.type).toBe('frame');
    expect(overlay.children).toHaveLength(1);
    expect(overlay.children[0].type).toBe('text');
  });

  it('plain text node without background is unchanged', () => {
    const plain = makeText({
      text: 'Hello',
      styles: { fontSize: '14px', color: 'rgb(0,0,0)', lineHeight: 'normal' },
    });
    const result = enrichSceneForBaseline(makeFrame({ children: [plain] }));

    expect(result.children[0].type).toBe('text');
    expect(result.children[0].name).not.toBe('Overlay');
  });
});

// ---- align-self: flex-start wrapping ----

describe('maybeWrapAlignSelfStartChildren', () => {
  it('child with align-self:flex-start gets wrapped in align-flex-start container', () => {
    const child = makeText({
      text: 'Short label',
      x: 16,
      y: 0,
      width: 80,
      height: 20,
      styles: {
        fontSize: '14px',
        color: 'rgb(0,0,0)',
        lineHeight: 'normal',
        alignSelf: 'flex-start',
      },
      ir: makeFrameIR({ figmaType: 'TEXT', alignSelf: 'STRETCH' }),
    });
    const parent = makeFrame({
      width: 300,
      height: 100,
      styles: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
      },
      children: [child],
      ir: makeFrameIR({
        autoLayout: {
          stackMode: 'VERTICAL',
          stackSpacing: 0,
          stackVerticalPadding: 0,
          stackHorizontalPadding: 0,
          stackPaddingRight: 0,
          stackPaddingBottom: 0,
          stackPrimaryAlignItems: 'MIN',
          stackCounterAlignItems: 'MIN',
        },
      }),
    });
    const result = enrichSceneForBaseline(parent);
    const wrapper = result.children?.find(c => (c.name || '').includes('align-flex-start'));

    expect(wrapper).toBeDefined();
    expect(wrapper!.type).toBe('frame');
    expect(wrapper!.ir?.autoLayout?.stackCounterAlignItems).toBe('MIN');
  });
});

// ---- SECTION flattening ----

describe('maybeFlattenSingleChildSection', () => {
  it('single-child SECTION with no fills → promotes child layout', () => {
    const child = makeFrame({
      name: 'Content',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      ir: makeFrameIR({
        autoLayout: {
          stackMode: 'VERTICAL',
          stackSpacing: 8,
          stackVerticalPadding: 0,
          stackHorizontalPadding: 0,
          stackPaddingRight: 0,
          stackPaddingBottom: 0,
          stackPrimaryAlignItems: 'MIN',
          stackCounterAlignItems: 'MIN',
        },
      }),
    });
    const section = makeFrame({
      tagName: 'SECTION',
      name: 'Section',
      children: [child],
      ir: makeFrameIR({ fills: [] }),
    });
    // Call directly on the section node — it checks its own tagName
    const result = enrichSceneForBaseline(section);

    expect(result.ir?.autoLayout?.stackSpacing).toBe(8);
  });
});

// ---- Collapsed fixed wrapper ----

describe('maybeFlattenCollapsedFixedWrapper', () => {
  it('fixed 1px nav with taller fixed child → child is promoted', () => {
    const innerDiv = makeFrame({
      name: 'inner',
      x: 0,
      y: 820,
      width: 390,
      height: 64,
      styles: { position: 'fixed', bottom: '0px' },
      ir: makeFrameIR({
        isAbsolute: true,
        absoluteConstraints: { horizontal: 'MIN', vertical: 'MAX' },
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      }),
    });
    const nav = makeFrame({
      tagName: 'NAV',
      name: 'nav',
      x: 0,
      y: 884,
      width: 390,
      height: 1,
      styles: { position: 'fixed', bottom: '0px' },
      children: [innerDiv],
      ir: makeFrameIR({
        isAbsolute: true,
        absoluteConstraints: { horizontal: 'MIN', vertical: 'MAX' },
      }),
    });
    const root = makeFrame({ width: 390, height: 884, children: [nav] });
    const result = enrichSceneForBaseline(root);
    const promoted = result.children[0];

    expect(promoted.height).toBe(64);
    expect(promoted.name).toBe('nav');
  });
});

// ---- Icon wrapping ----

describe('maybeWrapIconsInContainer', () => {
  it('icon inside auto-layout frame → wrapped in Container', () => {
    const icon = makeIcon({ x: 8, y: 8, width: 24, height: 24 });
    const parent = makeFrame({
      width: 40,
      height: 40,
      children: [icon],
      ir: makeFrameIR({
        autoLayout: {
          stackMode: 'HORIZONTAL',
          stackSpacing: 0,
          stackVerticalPadding: 8,
          stackHorizontalPadding: 8,
          stackPaddingRight: 8,
          stackPaddingBottom: 8,
          stackPrimaryAlignItems: 'CENTER',
          stackCounterAlignItems: 'CENTER',
        },
      }),
    });
    const result = enrichSceneForBaseline(parent);
    const firstChild = result.children[0];

    expect(firstChild.type).toBe('frame');
    expect(firstChild.name).toBe('Container');
    expect(firstChild.children[0].type).toBe('icon');
  });

  it('icon without svgContent is NOT wrapped', () => {
    const icon = { ...makeIcon(), svgContent: undefined };
    const parent = makeFrame({
      children: [icon],
      ir: makeFrameIR({
        autoLayout: {
          stackMode: 'HORIZONTAL',
          stackSpacing: 0,
          stackVerticalPadding: 0,
          stackHorizontalPadding: 0,
          stackPaddingRight: 0,
          stackPaddingBottom: 0,
          stackPrimaryAlignItems: 'MIN',
          stackCounterAlignItems: 'MIN',
        },
      }),
    });
    const result = enrichSceneForBaseline(parent);

    expect(result.children[0].type).toBe('icon');
  });
});

// ---- Preserve measured icon geometry ----

describe('font-independent icon geometry', () => {
  it('preserves measured geometry even when a Material font has extra line height', () => {
    const icon = makeIcon({
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      styles: {
        fontFamily: 'Material Symbols Outlined',
        fontSize: '12px',
        lineHeight: '24px',
      },
    });
    const result = enrichSceneForBaseline(makeFrame({ children: [icon] }));
    const resultIcon = result.children[0];

    expect(resultIcon.width).toBe(24);
    expect(resultIcon.height).toBe(24);
  });

  it('non-material icon is unchanged', () => {
    const icon = makeIcon({
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      styles: { fontFamily: 'FontAwesome', fontSize: '12px', lineHeight: '24px' },
    });
    const result = enrichSceneForBaseline(makeFrame({ children: [icon] }));

    expect(result.children[0].width).toBe(24);
  });

  it('icon with lineHeight <= fontSize is unchanged', () => {
    const icon = makeIcon({
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      styles: {
        fontFamily: 'Material Symbols Outlined',
        fontSize: '24px',
        lineHeight: '24px',
      },
    });
    const result = enrichSceneForBaseline(makeFrame({ children: [icon] }));

    expect(result.children[0].width).toBe(24);
  });
});

// ---- A-tag → Link rename ----

describe('maybeRenameAnchorToLink', () => {
  it('<a> tag frame → renamed to "Link"', () => {
    const link = makeFrame({ tagName: 'A', name: 'some-class' });
    const result = enrichSceneForBaseline(link);

    expect(result.name).toBe('Link');
  });

  it('non-anchor frame is not renamed', () => {
    const div = makeFrame({ tagName: 'DIV', name: 'my-div' });
    const result = enrichSceneForBaseline(div);

    expect(result.name).toBe('my-div');
  });
});
