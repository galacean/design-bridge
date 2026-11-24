import { IREndBehavior, type IRColor, type IRComposition, type IRLayer } from '@galacean/animation-ir';
import {
  convertIRToGE as convertIRSceneToGE, type GEToIRPreservedData,
} from '@galacean/ge-ir';
import { createTestIRScene, migrateTestLayerAsset, type TestIRLayerOverrides } from './ir';

type EffectsLayerPreservedData = GEToIRPreservedData['compositionBindings'][string]['layerDataById'][string];

/**
 * Synthetic scenes covering hierarchy, text, animation passthrough, masks,
 * shapes, and keyframed transforms. Each scene is generated through
 * `convertIRToGE` so round-trip tests receive production-shaped GE JSON.
 */

export const IR_FRAME_RATE = 30;

function layer(
  overrides: TestIRLayerOverrides & { orderIndex: number; name: string },
): IRLayer {
  const { orderIndex, imageUrl, imageAssetId, asset, ...layerOverrides } = overrides;
  const id = `layer-${orderIndex}`;

  return {
    id,
    time: { inFrame: 0, outFrame: 60 },
    visible: true,
    transform: {
      position: { type: 'static', value: [100, 200, 0] },
      anchor: { type: 'static', value: [50, 50, 0] },
      scale: { type: 'static', value: [1, 1, 1] },
      rotation: { z: { type: 'static', value: 0 } },
      opacity: { type: 'static', value: 1 },
    },
    ...layerOverrides,
    ...migrateTestLayerAsset(id, overrides.type, imageUrl, imageAssetId, asset, overrides.localBounds),
  } as IRLayer;
}

function composition(layers: IRLayer[], overrides: Partial<IRComposition> = {}): IRComposition {
  return {
    id: 'test-composition',
    name: 'synthetic',
    width: 400,
    height: 300,
    frameRate: IR_FRAME_RATE,
    inPoint: 0,
    outPoint: 60,
    endBehavior: IREndBehavior.Loop,
    layers,
    ...overrides,
  };
}

function convertIRToGE(
  ir: IRComposition,
  layerDataById?: Record<string, EffectsLayerPreservedData>,
): ReturnType<typeof convertIRSceneToGE>['scene'] {
  const scene = createTestIRScene(ir);

  if (layerDataById == null) {
    return convertIRSceneToGE(scene).scene;
  }

  const preservedData: GEToIRPreservedData = {
    version: '1.0.0',
    particleSourceData: { particleEffectGroups: [], layers: [] },
    compositionBindings: {
      [ir.id]: { sourceCompositionId: `source:${ir.id}`, sourceItemOrder: [], layerDataById },
    },
  };

  return convertIRSceneToGE(scene, { preservedData }).scene;
}

function layeredSceneWithPassthrough(): IRComposition {
  return composition([
    layer({
      orderIndex: 0,
      name: 'parent',
      type: 'null',
    }),
    layer({
      orderIndex: 1,
      name: 'spinner',
      type: 'image',
      parentId: 'layer-0',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
      imageUrl: 'https://example.com/spinner.png',
      transform: {
        position: { type: 'static', value: [100, 200, 0] },
        anchor: { type: 'static', value: [50, 50, 0] },
        scale: { type: 'static', value: [1, 1, 1] },
        rotation: {
          z: {
            type: 'keyframed',
            keyframes: [
              { frame: 0, value: 0, outTangent: { x: 0.42, y: 0 } },
              { frame: 30, value: 360, inTangent: { x: 0.58, y: 1 } },
            ],
          },
        },
        opacity: { type: 'static', value: 1 },
      },
      // Mirrors input with both normalized rotation and raw GE preserved data.
    }),
    layer({
      orderIndex: 2,
      name: 'title',
      type: 'text',
      localBounds: { x: 0, y: 0, width: 200, height: 40 },
      content: {
        text: 'hello',
        fontAssetId: 'font:test-sans',
        fontSize: 24,
        color: [1, 0, 0, 1] as IRColor,
        letterSpacing: 0,
        lineHeight: 24,
        textAlign: 'center',
      },
    }),
  ]);
}

function sceneWithMaskAndShape(): IRComposition {
  return composition([
    layer({
      orderIndex: 0,
      name: 'backdrop',
      type: 'image',
      localBounds: { x: 0, y: 0, width: 200, height: 200 },
      imageUrl: 'https://example.com/bg.png',
      masks: [{
        mode: 'add',
        path: {
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 0, y: 200 },
          ],
          inTangents: [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 0, y: 0 },
          ],
          outTangents: [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 0, y: 0 },
          ],
          closed: true,
        },
      }],
    }),
    layer({
      orderIndex: 1,
      name: 'blob',
      type: 'shape',
      content: { shapes: [] },
    }),
    layer({
      orderIndex: 2,
      name: 'plain',
      type: 'image',
      localBounds: { x: 0, y: 0, width: 64, height: 64 },
      imageUrl: 'https://example.com/p.png',
    }),
  ]);
}

function sceneWithScaleAnimation(): IRComposition {
  return composition([
    layer({
      orderIndex: 0,
      name: 'card',
      type: 'image',
      localBounds: { x: 0, y: 0, width: 120, height: 120 },
      imageUrl: 'https://example.com/card.png',
      transform: {
        position: { type: 'static', value: [60, 60, 0] },
        anchor: { type: 'static', value: [60, 60, 0] },
        scale: {
          type: 'keyframed',
          keyframes: [
            { frame: 0, value: [1, 1, 1], outTangent: { x: 0.42, y: 0 } },
            { frame: 30, value: [1.2, 1.2, 1], inTangent: { x: 0.58, y: 1 } },
          ],
        },
        rotation: { z: { type: 'static', value: 0 } },
        opacity: { type: 'static', value: 1 },
      },
    }),
  ]);
}

const SCENE_BUILDERS = [
  {
    name: 'layered-passthrough',
    build: layeredSceneWithPassthrough,
    layerDataById: {
      'layer-1': { rotationOverLifetime: { asRotation: true, z: ['bezier', [[0, 0, 0, 1]]] } },
    },
  },
  {
    name: 'mask-and-shape',
    build: sceneWithMaskAndShape,
    layerDataById: { 'layer-1': { sourceComponentId: 'shape-component' } },
  },
  { name: 'scale-animation', build: sceneWithScaleAnimation },
] satisfies Array<{
  name: string;
  build: () => IRComposition;
  layerDataById?: Record<string, EffectsLayerPreservedData>;
}>;

export interface SyntheticScene {
  name: string;
  scene: Record<string, unknown>;
}

export const syntheticScenes: SyntheticScene[] = SCENE_BUILDERS.map(({ name, build, layerDataById }) => {
  const ir = build();

  return {
    name,
    scene: convertIRToGE(ir, layerDataById) as unknown as Record<string, unknown>,
  };
});
