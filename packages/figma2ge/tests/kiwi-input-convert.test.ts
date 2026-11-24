import { spec } from '@galacean/effects';
import { describe, expect, it } from 'vitest';
import { convertFigmaToEffects } from '@galacean/figma2ge';
import { expectNoErrorIssues } from './helpers/assertions';

const GUID_RE = /^[0-9a-f]{32}$/;

describe('convertFigmaToEffects with Kiwi input', () => {
  it('auto-detects Kiwi input and produces valid scene', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 100 },
          type: 4,
          name: 'KiwiFrame',
          visible: true,
          frameMaskDisabled: true,
          size: { x: 375, y: 812 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          fillPaints: [{ type: 0, color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
        },
        {
          guid: { sessionID: 1, localID: 101 },
          parentIndex: { guid: { sessionID: 1, localID: 100 }, position: 'a' },
          type: 13,
          name: 'KiwiText',
          visible: true,
          size: { x: 200, y: 30 },
          transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 50 },
          textData: { characters: 'Hello from Kiwi' },
          fontSize: 16,
          fontName: { family: 'Arial', style: 'Bold' },
          textAlignHorizontal: 1,
          textAlignVertical: 0,
          fillPaints: [{ type: 0, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }],
        },
      ],
    };

    const result = convertFigmaToEffects(input);

    expect(result.scene.version).toBe(spec.JSONSceneVersion['3_7']);
    expect(result.scene.items.length).toBe(2);
    expect(result.scene.components.length).toBe(3);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);

    for (const item of result.scene.items) {
      expect(item.id).toMatch(GUID_RE);
      expect(item.endBehavior).toBe(4);
      expect(item.delay).toBe(0);
      expect(item.renderLevel).toBe('B+');
      expect(item.duration).toBe(5);
    }
    for (const comp of result.scene.components) {
      expect(comp.id).toMatch(GUID_RE);
    }
    expect(result.scene.compositionId).toMatch(GUID_RE);

    const textComp = result.scene.components.find(c => c.dataType === spec.DataType.TextComponent);

    expect(textComp).toBeDefined();
    expect(textComp?.name).toBeUndefined();
    const textOpts = (textComp as { options?: Record<string, unknown> } | undefined)?.options;

    expect(textOpts).toBeDefined();
    expect(textOpts?.text).toBe('Hello from Kiwi');
    expect(textOpts?.fontSize).toBe(16);
    expect(textOpts?.textAlign).toBe('center');
    expect(textOpts?.fontFamily).toBe('Arial');
    expect(textOpts?.fontWeight).toBe(700);

    expectNoErrorIssues(result.issues);
  });

  it('maps rotation and blendMode into GE scene', () => {
    const angle30 = (30 * Math.PI) / 180;
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 200 },
          type: 10,
          name: 'RotatedBlended',
          visible: true,
          size: { x: 100, y: 50 },
          transform: {
            m00: Math.cos(angle30),
            m01: -Math.sin(angle30),
            m02: 10,
            m10: Math.sin(angle30),
            m11: Math.cos(angle30),
            m12: 20,
          },
          blendMode: 3,
          fillPaints: [{ type: 0, color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }],
        },
      ],
    };

    const result = convertFigmaToEffects(input);
    const item = result.scene.items.find(i => i.name === 'RotatedBlended');

    expect(item?.transform?.eulerHint).toEqual(expect.objectContaining({ x: 0, y: 0 }));
    expect(item?.transform?.eulerHint.z).toBeCloseTo(30, 1);

    const sprite = result.scene.components.find(c => c.item.id === item?.id);
    const spriteRenderer = (sprite as { renderer?: Record<string, unknown> } | undefined)?.renderer;

    expect(spriteRenderer?.blending).toBe(1);
  });

  it('maps auto-layout to flexbox options in GE scene', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 400 },
          type: 4,
          name: 'FlexFrame',
          visible: true,
          frameMaskDisabled: true,
          size: { x: 300, y: 200 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          stackMode: 1,
          stackSpacing: 8,
          stackPadding: 16,
          stackPrimaryAlignItems: 4,
          stackCounterAlignItems: 1,
        },
      ],
    };

    const result = convertFigmaToEffects(input);
    const item = result.scene.items.find(i => i.name === 'FlexFrame');
    const options = item?.content?.options as Record<string, unknown>;

    expect(options.flexDirection).toBe('row');
    expect(options.gap).toBe(8);
    expect(options.justifyContent).toBe('space-between');
    expect(options.alignItems).toBe('center');
    expect(options.paddingTop).toBe(16);
    expect(options.paddingRight).toBe(16);
  });

  it('maps shadows and blur into item content.options', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 300 },
          type: 4,
          name: 'EffectFrame',
          visible: true,
          frameMaskDisabled: true,
          size: { x: 200, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          effects: [
            {
              type: 1,
              color: { r: 0, g: 0, b: 0, a: 0.5 },
              offset: { x: 2, y: 4 },
              radius: 10,
              spread: 1,
              visible: true,
            },
            { type: 2, radius: 6, visible: true },
          ],
        },
      ],
    };

    const result = convertFigmaToEffects(input);
    const item = result.scene.items.find(i => i.name === 'EffectFrame');
    const options = item?.content?.options as Record<string, unknown>;

    expect(options.shadows).toBeDefined();
    const shadows = options.shadows as Array<Record<string, unknown>>;

    expect(shadows).toHaveLength(1);
    expect(shadows[0].type).toBe('dropShadow');
    expect(shadows[0].radius).toBe(10);

    expect(options.blur).toBeDefined();
    const blur = options.blur as Record<string, unknown>;

    expect(blur.radius).toBe(6);
  });

  it('uses object format for transforms and camera', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 500 },
          type: 4,
          name: 'TransformCheck',
          visible: true,
          frameMaskDisabled: true,
          size: { x: 100, y: 200 },
          transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 20 },
        },
      ],
    };

    const result = convertFigmaToEffects(input);
    const item = result.scene.items[0];
    const pos = item.transform?.position;

    expect(pos?.z).toBe(0);
    // A single root node is centered at origin (center-to-center offset from bbox center = 0).
    expect(pos?.x).toBe(0);
    expect(pos?.y).toBe(0);
    expect(item.transform?.position).toHaveProperty('x');
    expect(item.transform?.position).toHaveProperty('y');
    expect(item.transform?.position).toHaveProperty('z');
    expect(item.transform?.eulerHint).toEqual({ x: 0, y: 0, z: 0 });
    expect(item.transform?.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(item.transform?.size).toHaveProperty('x');
    expect(item.transform?.size).toHaveProperty('y');
    expect(item.transform!.size!.x / item.transform!.size!.y).toBeCloseTo(0.5, 4);
    expect(item.transform?.anchor).toEqual({ x: 0, y: 0 });

    const comp = result.scene.compositions[0];

    expect(comp.camera.position).toEqual([0, 0, 8]);
    expect(comp.camera.rotation).toEqual([0, 0, 0]);
    expect(comp.camera.far).toBe(40);
    expect(comp.endBehavior).toBe(4);
  });

  it('generates complete timeline data for all items', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 600 },
          type: 4,
          name: 'TimelineFrame',
          visible: true,
          frameMaskDisabled: true,
          size: { x: 375, y: 812 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          fillPaints: [{ type: 0, color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
        },
        {
          guid: { sessionID: 1, localID: 601 },
          parentIndex: { guid: { sessionID: 1, localID: 600 }, position: 'a' },
          type: 13,
          name: 'TimelineText',
          visible: true,
          size: { x: 200, y: 30 },
          transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 50 },
          textData: { characters: 'Text' },
          fontSize: 14,
          fillPaints: [{ type: 0, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }],
        },
      ],
    };

    const result = convertFigmaToEffects(input);

    // miscs should not be empty — must contain timeline objects
    expect(result.scene.miscs.length).toBeGreaterThan(0);

    // Find TimelineAsset
    const timelineAsset = result.scene.miscs.find(m => m.dataType === spec.DataType.TimelineAsset);

    expect(timelineAsset).toBeDefined();
    expect((timelineAsset as unknown as Record<string, unknown>).tracks).toBeDefined();
    const tracks = (timelineAsset as unknown as Record<string, unknown>).tracks as Array<{
      id: string;
    }>;

    // Should have one ObjectBindingTrack per item
    expect(tracks.length).toBe(2);

    // Each ObjectBindingTrack should have children (ActivationTrack + TransformTrack + optional SpriteColorTrack)
    for (const trackRef of tracks) {
      const objTrack = result.scene.miscs.find(m => m.id === trackRef.id);

      expect(objTrack).toBeDefined();
      expect(objTrack!.dataType).toBe(spec.DataType.ObjectBindingTrack);
      const children = (objTrack as unknown as Record<string, unknown>).children as Array<{
        id: string;
      }>;

      expect(children.length).toBeGreaterThanOrEqual(2); // At least Activation + Transform
    }

    // CompositionComponent should have timelineAsset and sceneBindings
    const compComponent = result.scene.components.find(c => c.dataType === spec.DataType.CompositionComponent);

    expect(compComponent).toBeDefined();
    const compData = compComponent as unknown as Record<string, unknown>;

    expect(compData.timelineAsset).toBeDefined();
    expect((compData.timelineAsset as { id: string }).id).toBe(timelineAsset!.id);
    expect(compData.sceneBindings).toBeDefined();
    const bindings = compData.sceneBindings as Array<{
      key: { id: string };
      value: { id: string };
    }>;

    expect(bindings.length).toBe(2); // One per item

    // Each binding value should reference an item
    const itemIds = new Set(result.scene.items.map(i => i.id));

    for (const binding of bindings) {
      expect(itemIds.has(binding.value.id)).toBe(true);
    }

    expectNoErrorIssues(result.issues);
  });

  it('applies opacity to sprite startColor alpha', () => {
    // Use a FRAME node (type:4) which still creates SpriteComponent
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 700 },
          type: 4,
          name: 'SemiTransparent',
          visible: true,
          frameMaskDisabled: true,
          opacity: 0.5,
          size: { x: 100, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          fillPaints: [{ type: 0, color: { r: 1, g: 0, b: 0, a: 0.8 }, opacity: 1, visible: true }],
        },
      ],
    };

    const result = convertFigmaToEffects(input);
    const spriteComp = result.scene.components.find(
      c => c.dataType === spec.DataType.SpriteComponent,
    ) as spec.SpriteComponentData;

    expect(spriteComp).toBeDefined();
    const startColor = (spriteComp.options as Record<string, unknown>).startColor as number[];

    // fill alpha 0.8 * opacity 0.5 = 0.4
    expect(startColor[0]).toBe(1);
    expect(startColor[1]).toBe(0);
    expect(startColor[2]).toBe(0);
    expect(startColor[3]).toBeCloseTo(0.4, 4);

    expectNoErrorIssues(result.issues);
  });

  it('generates SpriteColorTrack for sprite items but not for null items', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 800 },
          type: 4, // FRAME → kind: 'frame' → SpriteComponent
          name: 'SpriteFrame',
          visible: true,
          frameMaskDisabled: true,
          size: { x: 100, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          fillPaints: [{ type: 0, color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
        },
        {
          guid: { sessionID: 1, localID: 801 },
          type: 99, // Unknown type → kind: 'unknown' → no component
          name: 'NullNode',
          visible: true,
          size: { x: 100, y: 100 },
          transform: { m00: 1, m01: 0, m02: 100, m10: 0, m11: 1, m12: 0 },
        },
      ],
    };

    const result = convertFigmaToEffects(input);

    // Find ObjectBindingTracks
    const objTracks = result.scene.miscs.filter(m => m.dataType === spec.DataType.ObjectBindingTrack);

    expect(objTracks.length).toBe(2);

    // Sprite item's ObjectBindingTrack should have 3 children (Activation, Transform, SpriteColor)
    // Null item's ObjectBindingTrack should have 2 children (Activation, Transform)
    const compComponent = result.scene.components.find(
      c => c.dataType === spec.DataType.CompositionComponent,
    ) as unknown as Record<string, unknown>;
    const bindings = compComponent.sceneBindings as Array<{
      key: { id: string };
      value: { id: string };
    }>;

    const spriteItem = result.scene.items.find(i => i.name === 'SpriteFrame');
    const nullItem = result.scene.items.find(i => i.name === 'NullNode');

    const spriteBinding = bindings.find(b => b.value.id === spriteItem!.id);
    const nullBinding = bindings.find(b => b.value.id === nullItem!.id);

    const spriteObjTrack = result.scene.miscs.find(m => m.id === spriteBinding!.key.id) as unknown as Record<
      string,
      unknown
    >;
    const nullObjTrack = result.scene.miscs.find(m => m.id === nullBinding!.key.id) as unknown as Record<
      string,
      unknown
    >;

    expect((spriteObjTrack.children as unknown[]).length).toBe(3); // Has SpriteColorTrack
    expect((nullObjTrack.children as unknown[]).length).toBe(2); // No SpriteColorTrack

    expectNoErrorIssues(result.issues);
  });

  it('renders gradient-filled frame with clipContent as ShapeComponent', () => {
    const input = {
      nodeChanges: [
        {
          guid: { sessionID: 1, localID: 900 },
          type: 4,
          name: 'Frame4',
          visible: true,
          size: { x: 200, y: 200 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          cornerRadius: 16,
          fillPaints: [{ type: 0, color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, opacity: 1, visible: true }],
        },
        {
          guid: { sessionID: 1, localID: 901 },
          parentIndex: { guid: { sessionID: 1, localID: 900 }, position: 'a' },
          type: 4,
          name: 'IMG',
          visible: true,
          size: { x: 200, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          // Gradient fill (type=1 = GRADIENT_LINEAR in kiwi)
          fillPaints: [
            {
              type: 1,
              visible: true,
              opacity: 1,
              stops: [
                { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
                { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
              ],
            },
          ],
        },
      ],
    };

    const result = convertFigmaToEffects(input);

    // IMG should be rendered as ShapeComponent (not SpriteComponent)
    const imgItem = result.scene.items.find(i => i.name === 'IMG');

    expect(imgItem).toBeDefined();
    expect(imgItem!.type).toBe(spec.ItemType.shape);

    // Its ShapeComponent should have gradient fills
    const imgCompRef = imgItem!.components[0];
    const imgComp = result.scene.components.find(c => c.id === imgCompRef.id) as unknown as Record<string, unknown>;

    expect(imgComp).toBeDefined();
    expect(imgComp.dataType).toBe(spec.DataType.ShapeComponent);

    const fills = imgComp.fills as Array<Record<string, unknown>>;

    expect(fills.length).toBeGreaterThan(0);
    // First fill should be a gradient type
    expect(fills[0].type).not.toBe(spec.FillType.Solid);

    // Frame4 should have clipContent, creating a _clip mask child
    const frame4Item = result.scene.items.find(i => i.name === 'Frame4');

    expect(frame4Item).toBeDefined();
    const clipItem = result.scene.items.find(i => i.name === 'Frame4_clip');

    expect(clipItem).toBeDefined();

    // IMG's component should reference Frame4's clip mask
    expect(imgComp.mask).toBeDefined();
    expect((imgComp.mask as Record<string, unknown>).reference).toBeDefined();

    expectNoErrorIssues(result.issues);
  });
});
