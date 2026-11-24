import { beforeEach, describe, expect, it } from 'vitest';
import { convertNode, resetLocalIdCounter } from '../../src/core/convert-node';
import { makeIR, makeSceneNode } from '../helpers/scene-factories';
import type { TextConversionRuntime } from '../../src/core/text-conversion-runtime';
import type { FigmaBlob, FigmaGUID, FigmaNodeChange } from '../../src/types';

describe('convertNode core branches', () => {
  const parentGUID: FigmaGUID = { sessionID: 0, localID: 1 };

  beforeEach(() => {
    resetLocalIdCounter(100);
  });

  it.each(['image', 'frame'] as const)('retains CSS background beneath a transparent %s image', type => {
    const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
      'AAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const node = makeSceneNode({
      type,
      ...(type === 'image' ? { image: data } : { backgroundImage: data }),
      ir: makeIR({ fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 0.5 } }] }),
    });
    const changes: FigmaNodeChange[] = [];

    convertNode(node, parentGUID, '!', changes, 0, [], 0, 0, null, 375, 812);

    expect(changes[0].fillPaints).toMatchObject([
      { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 0.5 },
      { type: 'IMAGE', opacity: 1 },
    ]);
  });

  it('preserves measured child positions and fixed frame dimensions in snapshot mode', () => {
    const node = makeSceneNode({
      x: 20, y: 30, width: 300, height: 200,
      styles: { display: 'flex', flexDirection: 'column', gap: '12px' },
      children: [makeSceneNode({ x: 61, y: 87, width: 80, height: 25 })],
      ir: makeIR({ autoLayout: { stackMode: 'VERTICAL', stackSpacing: 12 } }),
    });
    const changes: FigmaNodeChange[] = [];

    convertNode(node, parentGUID, '!', changes, 0, [], 0, 0, null,
      375, 812, undefined, undefined, undefined, 'snapshot');

    expect(changes[0].stackMode).toBe('NONE');
    expect(changes[0].size).toEqual({ x: 300, y: 200 });
    expect(changes[1].transform).toMatchObject({ m02: 41, m12: 57 });
    expect(changes[1].stackChildPrimaryGrow).toBeUndefined();
  });

  it('maps BACKGROUND_BLUR effect without shadow-only fields', () => {
    const node = makeSceneNode({
      ir: {
        figmaType: 'FRAME',
        opacity: 1,
        isAbsolute: false,
        fills: [],
        effects: [
          {
            type: 'BACKGROUND_BLUR',
            radius: 12,
            visible: false,
            blurOpType: 'NORMAL',
          },
        ],
        clipsContent: false,
        flexGrow: 0,
      },
    });
    const nodeChanges: FigmaNodeChange[] = [];
    const blobs: FigmaBlob[] = [];

    convertNode(node, parentGUID, '!', nodeChanges, 0, blobs, 0, 0, null, 375, 812);

    const effect = nodeChanges[0].effects?.[0];

    expect(effect).toBeDefined();
    if (!effect) {
      throw new Error('Expected BACKGROUND_BLUR effect to exist');
    }

    expect(effect.type).toBe('BACKGROUND_BLUR');
    expect(effect.radius).toBe(12);
    expect(effect.visible).toBe(false);
    expect(effect.blurOpType).toBe('NORMAL');
    expect(effect).not.toHaveProperty('offset');
    expect(effect).not.toHaveProperty('color');
  });

  it('maps DROP_SHADOW and defaults showShadowBehindNode=false', () => {
    const node = makeSceneNode({
      ir: {
        figmaType: 'FRAME',
        opacity: 1,
        isAbsolute: false,
        fills: [],
        effects: [
          {
            type: 'DROP_SHADOW',
            color: { r: 0, g: 0, b: 0, a: 0.4 },
            offset: { x: 0, y: 4 },
            radius: 8,
            spread: 0,
          },
        ],
        clipsContent: false,
        flexGrow: 0,
      },
    });
    const nodeChanges: FigmaNodeChange[] = [];
    const blobs: FigmaBlob[] = [];

    convertNode(node, parentGUID, '!', nodeChanges, 0, blobs, 0, 0, null, 375, 812);

    const effect = nodeChanges[0].effects?.[0];

    expect(effect?.type).toBe('DROP_SHADOW');
    expect(effect?.showShadowBehindNode).toBe(false);
    expect(effect?.offset).toEqual({ x: 0, y: 4 });
    expect(effect?.color).toEqual({ r: 0, g: 0, b: 0, a: 0.4 });
  });

  it('repositions fixed-bottom absolute node and forces MAX vertical constraint', () => {
    const node = makeSceneNode({
      y: 20,
      height: 60,
      styles: {
        position: 'fixed',
        bottom: '0',
      },
      ir: {
        figmaType: 'FRAME',
        opacity: 1,
        isAbsolute: true,
        absoluteConstraints: { horizontal: 'MIN', vertical: 'MIN' },
        fills: [],
        effects: [],
        clipsContent: false,
        flexGrow: 0,
      },
    });
    const nodeChanges: FigmaNodeChange[] = [];
    const blobs: FigmaBlob[] = [];

    convertNode(node, parentGUID, '!', nodeChanges, 0, blobs, 0, 0, null, 375, 812);

    const changed = nodeChanges[0];

    expect(changed.transform?.m12).toBe(752);
    expect(changed.verticalConstraint).toBe('MAX');
    expect(changed.stackPositioning).toBe('ABSOLUTE');
  });

  it('does not apply fixed-bottom correction when bottom inset is large', () => {
    const node = makeSceneNode({
      y: 20,
      height: 60,
      styles: {
        position: 'fixed',
        bottom: '24px',
      },
      ir: {
        figmaType: 'FRAME',
        opacity: 1,
        isAbsolute: true,
        absoluteConstraints: { horizontal: 'MIN', vertical: 'MIN' },
        fills: [],
        effects: [],
        clipsContent: false,
        flexGrow: 0,
      },
    });
    const nodeChanges: FigmaNodeChange[] = [];
    const blobs: FigmaBlob[] = [];

    convertNode(node, parentGUID, '!', nodeChanges, 0, blobs, 0, 0, null, 375, 812);

    const changed = nodeChanges[0];

    expect(changed.transform?.m12).toBe(20);
    expect(changed.verticalConstraint).toBe('MIN');
  });

  it('emits fallbackFonts for CJK text and omits for plain latin text', () => {
    const cjkTextNode = makeSceneNode({
      type: 'text',
      name: 'CJK Text',
      text: '中文测试',
      width: 120,
      height: 24,
      ir: {
        figmaType: 'TEXT',
        opacity: 1,
        isAbsolute: false,
        fills: [],
        effects: [],
        clipsContent: false,
        flexGrow: 0,
        textProps: {
          fontFamily: 'Inter',
          fontWeight: 400,
          fontSize: 16,
          lineHeightPx: 24,
          letterSpacing: 0,
          textAlign: 'LEFT',
          color: { r: 0, g: 0, b: 0, a: 1 },
        },
      },
    });
    const latinTextNode = makeSceneNode({
      type: 'text',
      name: 'Latin Text',
      y: 30,
      text: 'plain ascii',
      width: 120,
      height: 24,
      ir: {
        figmaType: 'TEXT',
        opacity: 1,
        isAbsolute: false,
        fills: [],
        effects: [],
        clipsContent: false,
        flexGrow: 0,
        textProps: {
          fontFamily: 'Inter',
          fontWeight: 400,
          fontSize: 16,
          lineHeightPx: 24,
          letterSpacing: 0,
          textAlign: 'LEFT',
          color: { r: 0, g: 0, b: 0, a: 1 },
        },
      },
    });
    const nodeChanges: FigmaNodeChange[] = [];
    const blobs: FigmaBlob[] = [];

    convertNode(cjkTextNode, parentGUID, '!', nodeChanges, 0, blobs, 0, 0, null, 375, 812);
    convertNode(latinTextNode, parentGUID, '"', nodeChanges, 0, blobs, 0, 0, null, 375, 812);

    const cjkTextData = nodeChanges[0].textData as { fallbackFonts?: unknown[] };
    const latinTextData = nodeChanges[1].textData as { fallbackFonts?: unknown[] };

    expect(Array.isArray(cjkTextData.fallbackFonts)).toBe(true);
    expect(cjkTextData.fallbackFonts?.length).toBeGreaterThan(0);
    expect(latinTextData.fallbackFonts).toBeUndefined();
  });

  it.each(['IR', 'styles'] as const)('uses %s italic style with the injected text runtime', source => {
    const node = makeSceneNode({
      type: 'text',
      text: 'AB',
      fontSource: 'virtual-font.ttf',
      styles: { fontStyle: source === 'IR' ? 'normal' : 'italic' },
      ir: makeIR({
        figmaType: 'TEXT',
        textProps: {
          fontFamily: 'Example Sans',
          fontWeight: 400,
          ...(source === 'IR' ? { fontStyle: 'italic' } : {}),
          fontSize: 10,
          lineHeightPx: 12,
          letterSpacing: 0,
          textAlign: 'LEFT',
          color: { r: 0, g: 0, b: 0, a: 1 },
        },
      }),
    });
    const runtime: TextConversionRuntime = {
      resolveFontFamily: (_family, style) => {
        expect(style).toBe('Italic');

        return 'Resolved Sans';
      },
      computeCharWidths: () => [5, 6],
      getGlyphBlobIndex: (_family, _style, _weight, _source, character, blobStore) =>
        blobStore.add('glyph', Uint8Array.from([character.charCodeAt(0)])),
    };
    const nodeChanges: FigmaNodeChange[] = [];
    const blobs: FigmaBlob[] = [];

    convertNode(node, parentGUID, '!', nodeChanges, 0, blobs, 0, 0, null, 375, 812, undefined, undefined, runtime);

    expect(nodeChanges[0].fontName?.family).toBe('Resolved Sans');
    expect(nodeChanges[0].fontName?.style).toBe('Italic');
    expect(nodeChanges[0].textData?.glyphs).toHaveLength(2);
    expect(blobs).toEqual([{ bytes: [65] }, { bytes: [66] }]);
  });

  it('does not add CSS leading twice to a DOM range baseline', () => {
    const node = makeSceneNode({
      type: 'text', text: 'AB', width: 40, height: 10,
      textMetrics: { charWidths: [10, 10], ascent: 8, fontLineHeight: 10, baselineOffset: 8 },
      ir: makeIR({ textProps: {
        fontFamily: 'Example Sans', fontWeight: 400, fontSize: 10, lineHeightPx: 20,
        letterSpacing: 0, textAlign: 'LEFT', color: { r: 0, g: 0, b: 0, a: 1 },
      } }),
    });
    const changes: FigmaNodeChange[] = [];
    const runtime: TextConversionRuntime = {
      resolveFontFamily: () => null, computeCharWidths: () => null, getGlyphBlobIndex: () => 0,
    };

    convertNode(node, parentGUID, '!', changes, 0, [], 0, 0, null, 375, 812, undefined, undefined, runtime);

    expect(changes[0].textData?.baselines?.[0].position?.y).toBe(8);
    expect(changes[0].textData?.glyphs?.[0].position?.y).toBe(8);
  });

  it('preserves measured character positions and soft line breaks in snapshot output', () => {
    const node = makeSceneNode({
      type: 'text', text: 'ABC', width: 40, height: 32,
      textMetrics: {
        charWidths: [10, 10, 10], ascent: 8, fontLineHeight: 10,
        characterPositions: [
          { x: 4, y: 8, advance: 10 }, { x: 14, y: 8, advance: 10 }, { x: 9, y: 24, advance: 10 },
        ],
      },
      ir: makeIR({ textProps: {
        fontFamily: 'Example Sans', fontWeight: 400, fontSize: 10, lineHeightPx: 16,
        letterSpacing: -1, textAlign: 'CENTER', color: { r: 0, g: 0, b: 0, a: 1 },
      } }),
    });
    const changes: FigmaNodeChange[] = [];
    const runtime: TextConversionRuntime = {
      resolveFontFamily: () => null, computeCharWidths: () => [5, 5, 5], getGlyphBlobIndex: () => 0,
    };

    convertNode(node, parentGUID, '!', changes, 0, [], 0, 0, null, 375, 812,
      undefined, undefined, runtime, 'snapshot');

    expect(changes[0].textData?.glyphs?.map(glyph => glyph.position))
      .toEqual([{ x: 4, y: 8 }, { x: 14, y: 8 }, { x: 9, y: 24 }]);
    expect(changes[0].textData?.baselines?.map(line => [line.firstCharacter, line.endCharacter]))
      .toEqual([[0, 2], [2, 3]]);
    expect(changes[0].size).toEqual({ x: 40, y: 32 });
    expect(changes[0].textAlignVertical).toBe('TOP');
  });

  it.each([-1, 2])('includes CSS tracking %s in baked glyph positions and layout width', tracking => {
    const node = makeSceneNode({
      type: 'text', text: 'AB', width: 40, height: 12,
      textMetrics: { charWidths: [10, 10], ascent: 8, fontLineHeight: 10 },
      ir: makeIR({ textProps: {
        fontFamily: 'Example Sans', fontWeight: 400, fontSize: 10, lineHeightPx: 12,
        letterSpacing: tracking, textAlign: 'LEFT', color: { r: 0, g: 0, b: 0, a: 1 },
      } }),
    });
    const changes: FigmaNodeChange[] = [];
    const runtime: TextConversionRuntime = {
      resolveFontFamily: () => null, computeCharWidths: () => null, getGlyphBlobIndex: () => 0,
    };

    convertNode(node, parentGUID, '!', changes, 0, [], 0, 0, null, 375, 812, undefined, undefined, runtime);

    expect(changes[0].textData?.glyphs?.[1].position?.x).toBe(10 + tracking);
    expect(changes[0].textData?.layoutSize?.x).toBe(20 + tracking * 2);
    expect(changes[0].letterSpacing).toEqual({ value: tracking, units: 'PIXELS' });
  });

  it('assigns grid row/column anchors and span from placement hints', () => {
    const gridContainer = makeSceneNode({
      name: 'Grid Container',
      width: 220,
      height: 120,
      children: [
        makeSceneNode({
          name: 'Wide Item',
          width: 220,
          height: 50,
          ir: {
            figmaType: 'FRAME',
            opacity: 1,
            isAbsolute: false,
            fills: [],
            effects: [],
            clipsContent: false,
            flexGrow: 0,
            gridPlacement: { row: 0, col: 0, rowSpan: 1, colSpan: 2 },
          },
        }),
        makeSceneNode({
          name: 'Second Row Item',
          y: 60,
          width: 100,
          height: 50,
        }),
      ],
      ir: {
        figmaType: 'FRAME',
        opacity: 1,
        isAbsolute: false,
        fills: [],
        effects: [],
        clipsContent: false,
        flexGrow: 0,
        autoLayout: {
          stackMode: 'GRID',
          stackSpacing: 0,
          stackCounterSpacing: 0,
          stackVerticalPadding: 0,
          stackHorizontalPadding: 0,
          stackPaddingRight: 0,
          stackPaddingBottom: 0,
          stackPrimaryAlignItems: 'MIN',
          stackCounterAlignItems: 'MIN',
          stackPrimarySizing: 'FIXED',
          stackCounterSizing: 'FIXED',
          gridColumns: [110, 110],
          gridRows: [50, 50],
          gridColumnGap: 0,
          gridRowGap: 0,
        },
      },
    });
    const nodeChanges: FigmaNodeChange[] = [];
    const blobs: FigmaBlob[] = [];

    convertNode(gridContainer, parentGUID, '!', nodeChanges, 0, blobs, 0, 0, null, 375, 812);

    const wideItem = nodeChanges.find(change => change.name === 'Wide Item');
    const secondRowItem = nodeChanges.find(change => change.name === 'Second Row Item');

    expect(wideItem).toBeDefined();
    expect(secondRowItem).toBeDefined();
    expect(wideItem?.gridRowAnchor).toBeDefined();
    expect(wideItem?.gridColumnAnchor).toBeDefined();
    expect(wideItem?.gridColumnSpan).toBe(2);
    expect(secondRowItem?.gridRowAnchor).toBeDefined();
    expect(secondRowItem?.gridColumnAnchor).toBeDefined();
    expect(secondRowItem?.gridRowAnchor).not.toEqual(wideItem?.gridRowAnchor);
  });
});
