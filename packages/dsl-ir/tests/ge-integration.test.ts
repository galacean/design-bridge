import { describe, it, expect } from 'vitest';
import type { IRScene } from '@galacean/animation-ir';
import { getIRResourceSourceUrl, getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import {
  convertDSLToIR, DSLValidationError,
  type Composition, type DSLToIROptions, type IRToDSLPreservedData, type Layer,
} from '../src';
import {
  convertDSLToGE as convertDSLDocumentToGE, convertGEToDSL,
  type ConvertDSLToGEOptions, type GEDSLPreservedData,
} from './helpers/ge-dsl-integration';
import { createTestAnimatedProperty, createTestLayer } from './fixtures/dsl';
import { syntheticScenes, type SyntheticScene } from './fixtures/synthetic-scenes';

function createMinimalComposition(layers: Layer[] = []): Composition {
  return {
    meta: {
      name: 'test',
      duration: 3,
      fps: 30,
      width: 720,
      height: 1280,
      loop: false,
      background_color: null,
    },
    layers,
  };
}

function convertDSLToGE(composition: Composition): ReturnType<typeof convertDSLDocumentToGE>['scene'] {
  return convertDSLDocumentToGE(composition).scene;
}

function updateIRFromDSL(
  baselineScene: IRScene,
  editedDSL: Composition,
  layerMapping: IRToDSLPreservedData['layerMapping'],
  options: Omit<DSLToIROptions, 'preservedData'> = {},
): IRScene {
  return convertDSLToIR(editedDSL, {
    ...options,
    preservedData: { baselineScene, layerMapping },
  }).scene;
}

describe('DSL to GE integration', () => {
  it('returns the generated scene with structured diagnostics', () => {
    const result = convertDSLDocumentToGE(createMinimalComposition());

    expect(result.scene.type).toBe('ge');
    expect(result.diagnostics).toEqual([]);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  it('exports generated child layers without descriptions and recovers optional appearance data', () => {
    const group = createTestLayer('group', 'Group', 'null');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
    const children = Array.from({ length: 22 }, (_, i) => {
      const child = createTestLayer(`image-${i}`, `Image ${i}`, 'layer');

      Reflect.deleteProperty(child, 'description');
      child.asset = { source: 'llm_svg', format: 'svg', svg, url: 'invalid.svg', prompt: '' };

      return child;
    });
    const title = createTestLayer('title', 'Title', 'text');

    Reflect.deleteProperty(title, 'name');
    Object.assign(title, {
      text: { content: 'Hello', size: 20, color: 'red', font: 42, align: 'justify', line_height: 0, letter_spacing: 'wide' },
      opacity: { a: true, value: 0.7, animation: [{ t: [0, 1], start: [-1], end: [2], in: [1, 0, 0] }] },
      position: { a: true, animation: [{ t: [0, 1], start: [0, 0, 0], end: [100, 50, 0], easing: [2, 0, 1, 1],
        out: [10, 0] }] },
      anchor: { a: true, animation: [{ t: [0, 1], start: [2, 3, 0], end: [8, 9, 0], easing: [0, 0, 1, 1] }] },
    });
    group.children = children;
    Object.assign(children[0], { opacity: { a: false, value: 2, animation: [] } });
    Reflect.deleteProperty(children[0].asset!, 'prompt');
    const dsl = createMinimalComposition([group, title]);

    Reflect.deleteProperty(dsl.meta, 'name');
    dsl.meta.background_color = 'invalid';
    const { scene: ir } = convertDSLToIR(dsl);
    const { scene: ge, diagnostics } = convertDSLDocumentToGE(dsl);
    const entry = getIRSceneEntryComposition(ir);
    const text = entry.layers.find(layer => layer.type === 'text');

    expect(entry.backgroundColor).toBeUndefined();
    expect(text).toMatchObject({
      name: title.id,
      content: { text: 'Hello', color: [0, 0, 0, 1], textAlign: 'left', lineHeight: 24, letterSpacing: 0 },
      transform: {
        anchor: { type: 'static', value: [2, 3, 0] },
        opacity: { keyframes: [{ value: 0, outTangent: { x: 0, y: 0 } }, { value: 1, inTangent: { x: 1, y: 1 } }] },
        position: { keyframes: [{ outTangent: { x: 0, y: 0 } }, { inTangent: { x: 1, y: 1 } }] },
      },
    });
    if (text?.transform?.position?.type === 'keyframed') {
      expect(text.transform.position.keyframes[0]).not.toHaveProperty('spatialOut');
    }
    expect(ir.assets).toContainEqual(expect.objectContaining({ type: 'font', family: 'sans-serif' }));
    expect(entry.layers.find(layer => layer.name === 'Image 0')?.transform?.opacity).toEqual({ type: 'static', value: 1 });
    const imageUrls = ir.assets.filter(asset => asset.type === 'image').map(asset => getIRResourceSourceUrl(asset.source));

    expect(imageUrls).toHaveLength(22);
    expect(new Set(imageUrls)).toEqual(new Set([`data:image/svg+xml;base64,${btoa(svg)}`]));
    expect(ge.items).toHaveLength(24);
    expect(diagnostics.filter(value => value.code === 'L012')).toHaveLength(22);
    expect(diagnostics.filter(value => value.severity === 'warning').map(value => value.code))
      .toEqual(expect.arrayContaining([
        'M001', 'M004', 'L004', 'P006', 'P009', 'P014', 'P015', 'C011', 'C012', 'C013', 'C014', 'C017',
        'A007', 'A015', 'A018', 'A019', 'A020', 'A021', 'A027',
      ]));
  });

  it('rejects an unusable generated asset when its invalid URL has no inline fallback', () => {
    const layer = createTestLayer('image', 'Image', 'layer');

    layer.asset = { source: 'llm_svg', format: 'svg', svg: '', url: 'invalid.svg', prompt: '' };
    expect(() => convertDSLToGE(createMinimalComposition([layer]))).toThrow(/A021/);
  });

  it('should convert empty composition', () => {
    const comp = createMinimalComposition();
    const GEScene = convertDSLToGE(comp);

    expect(JSON.parse(JSON.stringify(GEScene))).toStrictEqual(GEScene);
    expect(GEScene['type']).toBe('ge');
    expect(GEScene['version']).toBe('3.7');
    expect(GEScene['compositions'] as unknown[]).toHaveLength(1);
    expect(GEScene['items'] as unknown[]).toHaveLength(0);
  });

  it('should convert single image layer', () => {
    const layer = createTestLayer('img-1', 'Background', 'layer');

    layer.width = 720;
    layer.height = 1280;
    layer.time_range = [0, 3];
    layer.asset = {
      url: 'https://example.com/bg.png',
      source: 'user',
      prompt: '',
    };
    layer.anchor = createTestAnimatedProperty([360, 640, 0]);

    const comp = createMinimalComposition([layer]);
    const GEScene = convertDSLToGE(comp);

    expect(GEScene['items'] as unknown[]).toHaveLength(1);
    expect(GEScene['images'] as unknown[]).toHaveLength(1);
    expect(GEScene['textures'] as unknown[]).toHaveLength(1);
    expect(
      (GEScene['components'] as unknown as Record<string, unknown>[]).some(c => c['dataType'] === 'SpriteComponent'),
    ).toBe(true);
  });

  it('rejects a relative DSL asset URL at the IR import boundary', () => {
    const layer = createTestLayer('img-relative', 'Relative', 'layer');

    layer.asset = { url: './image.png', source: 'user', prompt: '' };

    expect(() => convertDSLToGE(createMinimalComposition([layer]))).toThrow(/must be absolute/);
  });

  it('should convert text layer', () => {
    const layer = createTestLayer('txt-1', 'Title', 'text');

    layer.width = 200;
    layer.height = 40;
    layer.time_range = [0, 3];
    layer.text = {
      content: 'Hello World',
      font: 'Arial',
      size: 24,
      color: '#ff0000',
      align: 'center',
      line_height: 1.2,
      letter_spacing: 0,
    };

    const comp = createMinimalComposition([layer]);
    const GEScene = convertDSLToGE(comp);

    const textComponent = (GEScene['components'] as unknown as Record<string, unknown>[]).find(
      c => c['dataType'] === 'TextComponent',
    );

    expect(textComponent).toBeDefined();
    const options = textComponent!['options'] as Record<string, unknown>;

    expect(options['text']).toBe('Hello World');
    expect(options['fontSize']).toBe(24);
    expect(options['textAlign']).toBe(1);
  });

  it('should convert null layer', () => {
    const layer = createTestLayer('null-1', 'Container', 'null');

    layer.time_range = [0, 3];

    const comp = createMinimalComposition([layer]);
    const GEScene = convertDSLToGE(comp);

    const item = (GEScene['items'] as unknown as Record<string, unknown>[])[0];

    expect(item['type']).toBe('3');
  });

  it('should handle parent-child relationships', () => {
    const parent = createTestLayer('parent-1', 'Parent', 'null');

    parent.time_range = [0, 3];

    const child = createTestLayer('child-1', 'Child', 'layer');

    child.width = 100;
    child.height = 100;
    child.time_range = [0, 3];
    child.parent = 'parent-1';
    child.asset = { url: 'https://example.com/img.png', source: 'user', prompt: '' };
    child.anchor = createTestAnimatedProperty([50, 50, 0]);

    parent.children = [child];

    const comp = createMinimalComposition([parent]);
    const GEScene = convertDSLToGE(comp);

    const items = GEScene['items'] as unknown as Record<string, unknown>[];

    expect(items).toHaveLength(2);

    const childItem = items.find(i => i['name'] === 'Child');

    expect(childItem).toBeDefined();
    expect(childItem!['parentId']).toBeDefined();
  });

  it('should handle loop composition', () => {
    const comp = createMinimalComposition();

    comp.meta.loop = true;
    const GEScene = convertDSLToGE(comp);

    const composition = (GEScene['compositions'] as unknown as Record<string, unknown>[])[0];

    expect(composition['endBehavior']).toBe(5);
  });

  it('should handle background color', () => {
    const comp = createMinimalComposition();

    comp.meta.background_color = '#336699';
    const GEScene = convertDSLToGE(comp);

    const composition = (GEScene['compositions'] as unknown as Record<string, unknown>[])[0];

    expect(composition['background']).toBeDefined();
    const bg = composition['background'] as Record<string, unknown>;

    expect(bg['color'] as number[]).toHaveLength(4);
  });

  it('should handle animated opacity', () => {
    const layer = createTestLayer('img-1', 'FadeIn', 'layer');

    layer.width = 100;
    layer.height = 100;
    layer.time_range = [0, 3];
    layer.asset = { url: 'https://example.com/img.png', source: 'user', prompt: '' };
    layer.anchor = createTestAnimatedProperty([50, 50, 0]);
    layer.opacity = {
      a: true,
      animation: [
        {
          t: [0, 1.5],
          start: [0],
          end: [1],
          easing: [0, 0, 1, 1],
        },
      ],
    };

    const comp = createMinimalComposition([layer]);
    const GEScene = convertDSLToGE(comp);

    const spriteColorAsset = (GEScene['miscs'] as unknown as Record<string, unknown>[]).find(
      m => m['dataType'] === 'SpriteColorPlayableAsset' && m['colorOverLifetime'] != null,
    );

    expect(spriteColorAsset).toBeDefined();
  });

  it('should deduplicate textures with same URL', () => {
    const layer1 = createTestLayer('img-1', 'Image1', 'layer');

    layer1.width = 100;
    layer1.height = 100;
    layer1.time_range = [0, 3];
    layer1.asset = { url: 'https://example.com/same.png', source: 'user', prompt: '' };
    layer1.anchor = createTestAnimatedProperty([50, 50, 0]);

    const layer2 = createTestLayer('img-2', 'Image2', 'layer');

    layer2.width = 100;
    layer2.height = 100;
    layer2.time_range = [0, 3];
    layer2.asset = { url: 'https://example.com/same.png', source: 'user', prompt: '' };
    layer2.anchor = createTestAnimatedProperty([50, 50, 0]);

    const comp = createMinimalComposition([layer1, layer2]);
    const GEScene = convertDSLToGE(comp);

    expect(GEScene['images'] as unknown[]).toHaveLength(1);
    expect(GEScene['textures'] as unknown[]).toHaveLength(1);
  });

  it('uses DSL Z as stacking order without moving GE items toward the camera', () => {
    const topLayer = createTestLayer('top', 'Top', 'layer');
    const bottomLayer = createTestLayer('bottom', 'Bottom', 'layer');

    for (const layer of [topLayer, bottomLayer]) {
      layer.width = 100;
      layer.height = 100;
      layer.time_range = [0, 3];
      layer.asset = { url: `https://example.com/${layer.id}.png`, source: 'user', prompt: '' };
      layer.anchor = createTestAnimatedProperty([50, 50, 0]);
    }
    topLayer.position = createTestAnimatedProperty([100, 200, 8]);
    bottomLayer.position = createTestAnimatedProperty([100, 200, 0]);

    const GEScene = convertDSLToGE(createMinimalComposition([bottomLayer, topLayer]));
    const items = GEScene['items'] as unknown as Record<string, unknown>[];
    const itemById = new Map(items.map(item => [item['id'], item]));
    const compositionComponent = (GEScene['components'] as unknown as Record<string, unknown>[]).find(
      component => component['dataType'] === 'CompositionComponent',
    );
    const itemPaths = (GEScene['compositions'] as Array<{ children: { id: string }[] }>)[0].children;
    const sceneBindings = compositionComponent!['sceneBindings'] as { value: { id: string } }[];

    expect(itemPaths.map(itemPath => itemById.get(itemPath.id)?.['name'])).toEqual(['Bottom', 'Top']);
    expect(sceneBindings.map(binding => itemById.get(binding.value.id)?.['name'])).toEqual(['Bottom', 'Top']);
    const transforms = items.map(item => item['transform'] as { position: { x: number; y: number; z: number } });

    expect(transforms[0].position.z).toBe(0);
    expect(transforms[1].position).toEqual(transforms[0].position);
  });

  it('rejects an invalid parent before generating GE', () => {
    const layer = createTestLayer('orphan', 'Orphan', 'null');

    layer.parent = 'missing';

    expect(() => convertDSLToGE(createMinimalComposition([layer]))).toThrow(DSLValidationError);
  });
});

function getSyntheticScene(name: string): SyntheticScene {
  const fixture = syntheticScenes.find(scene => scene.name === name);

  if (fixture == null) {
    throw new Error(`Missing synthetic scene: ${name}`);
  }

  return fixture;
}

function cloneScene(fixture: SyntheticScene): Record<string, unknown> {
  return structuredClone(fixture.scene);
}

const editingScene = getSyntheticScene('layered-passthrough');

function convertPreservedDSLToGE(
  composition: Parameters<typeof convertDSLDocumentToGE>[0],
  preservedData: GEDSLPreservedData,
  options: Omit<ConvertDSLToGEOptions, 'preservedData'> = {},
): ReturnType<typeof convertDSLDocumentToGE>['scene'] {
  return convertDSLDocumentToGE(composition, { ...options, preservedData }).scene;
}

describe('preserved GE editing', () => {
  for (const scene of syntheticScenes) {
    it(`${scene.name}: no-op update preserves baseline IR`, () => {
      const {
        dsl,
        preservedData: { ir: { baselineScene, layerMapping } },
      } = convertGEToDSL(cloneScene(scene), { frameRate: 30 });
      const updatedIR = updateIRFromDSL(baselineScene, dsl, layerMapping);

      expect(updatedIR).toEqual(baselineScene);
    });
  }

  it('removes the mapped IR subtree when a root DSL layer is deleted', () => {
    const {
      dsl,
      preservedData: { ir: { baselineScene, layerMapping } },
    } = convertGEToDSL(cloneScene(editingScene), { frameRate: 30 });
    const editedDSL = structuredClone(dsl);
    const removedLayer = editedDSL.layers.pop();

    if (removedLayer == null) {
      throw new Error('Expected the synthetic scene to contain a removable root layer.');
    }

    const deletedLayerIds = collectIRLayerIds(removedLayer, layerMapping);
    const updatedIR = updateIRFromDSL(baselineScene, editedDSL, layerMapping);
    const baselineComposition = getIRSceneEntryComposition(baselineScene);
    const updatedComposition = getIRSceneEntryComposition(updatedIR);

    expect(deletedLayerIds.size).toBeGreaterThan(0);
    expect(updatedComposition.layers).toHaveLength(baselineComposition.layers.length - deletedLayerIds.size);
    expect(updatedComposition.layers.some(layer => deletedLayerIds.has(layer.id))).toBe(false);
  });

  it('reorders root sibling subtrees by Z through the public API', () => {
    const { dsl, preservedData } = convertGEToDSL(cloneScene(editingScene), { frameRate: 30 });
    const editedDSL = structuredClone(dsl);

    expect(editedDSL.layers.length).toBeGreaterThan(1);
    const unchanged = convertGEToDSL(
      convertPreservedDSLToGE(
        { ...editedDSL, layers: [...editedDSL.layers].reverse() }, preservedData,
      ) as unknown as Record<string, unknown>,
      { frameRate: 30 },
    );

    expect(unchanged.dsl.layers.map(layer => layer.name)).toEqual(dsl.layers.map(layer => layer.name));
    editedDSL.layers.forEach((layer, index) => {
      if (!layer.position.a && Array.isArray(layer.position.value)) {
        layer.position.value[2] = index;
      }
    });

    const expectedOrder = [...editedDSL.layers].reverse().map(layer => layer.name);
    const recombined = convertPreservedDSLToGE(editedDSL, preservedData) as unknown as Record<string, unknown>;
    const secondSplit = convertGEToDSL(recombined, { frameRate: 30 });
    const spinner = findLayer(secondSplit.dsl.layers, 'spinner');
    const parent = findLayer(secondSplit.dsl.layers, 'parent');

    expect(secondSplit.dsl.layers.map(layer => layer.name)).toEqual(expectedOrder);
    expect(spinner?.parent).toBe(parent?.id);
  });

  it('matches rewritten ids by tree path and name', () => {
    const {
      dsl,
      preservedData: { ir: { baselineScene, layerMapping } },
    } = convertGEToDSL(cloneScene(editingScene), { frameRate: 30 });
    const target = dsl.layers[0];
    const targetIRLayerId = layerMapping.layers[target.id]?.irLayerId;
    const editedDSL = structuredClone(dsl);
    const rewrittenIdById = collectRewrittenIds(editedDSL.layers);

    expect(targetIRLayerId).toBeDefined();
    rewriteLayerIds(editedDSL.layers, rewrittenIdById);
    editedDSL.layers[0].opacity = { a: false, value: 0.42 };

    const updatedIR = updateIRFromDSL(baselineScene, editedDSL, layerMapping);
    const baselineComposition = getIRSceneEntryComposition(baselineScene);
    const updatedComposition = getIRSceneEntryComposition(updatedIR);
    const targetIR = updatedComposition.layers.find(layer => layer.id === targetIRLayerId);

    expect(updatedComposition.layers).toHaveLength(baselineComposition.layers.length);
    expect(targetIR?.transform?.opacity).toEqual({ type: 'static', value: 0.42 });
  });

  it('skips invented layers and reports diagnostics while returning a scene', () => {
    const { dsl, preservedData } = convertGEToDSL(cloneScene(editingScene), { frameRate: 30 });
    const { baselineScene, layerMapping } = preservedData.ir;
    const editedDSL = structuredClone(dsl);
    const inventedLayer = structuredClone(editedDSL.layers[0]);
    const warnings: string[] = [];

    assignInventedIds(inventedLayer, null, 'root');
    editedDSL.layers.push(inventedLayer);

    const updatedIR = updateIRFromDSL(baselineScene, editedDSL, layerMapping, {
      onWarning: warning => warnings.push(warning.code),
    });

    expect(updatedIR).toEqual(baselineScene);
    expect(warnings).toContain('INVENTED_LAYER');
    const recombinedWarnings: string[] = [];
    const result = convertDSLDocumentToGE(editedDSL, {
      preservedData,
      onWarning: warning => recombinedWarnings.push(warning.code),
    });

    expect(recombinedWarnings).toContain('INVENTED_LAYER');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'INVENTED_LAYER',
        severity: 'warning',
        action: 'unsupported',
        sourceId: inventedLayer.id,
      }),
    );
  });
});

function findLayer(layers: Layer[], name: string): Layer | undefined {
  for (const layer of layers) {
    if (layer.name === name) {
      return layer;
    }

    const child = findLayer((layer.children ?? []), name);

    if (child != null) {
      return child;
    }
  }

  return undefined;
}

function collectIRLayerIds(
  layer: Layer,
  layerMapping: ReturnType<typeof convertGEToDSL>['preservedData']['ir']['layerMapping'],
  layerIds = new Set<string>(),
): Set<string> {
  const irLayerId = layerMapping.layers[layer.id]?.irLayerId;

  if (irLayerId != null) {
    layerIds.add(irLayerId);
  }
  (layer.children ?? []).forEach(child => collectIRLayerIds(child, layerMapping, layerIds));

  return layerIds;
}

function collectRewrittenIds(layers: Layer[]): Map<string, string> {
  const rewrittenIdById = new Map<string, string>();

  const visit = (layer: Layer): void => {
    rewrittenIdById.set(layer.id, `rewritten_${layer.id}`);
    (layer.children ?? []).forEach(visit);
  };

  layers.forEach(visit);

  return rewrittenIdById;
}

function rewriteLayerIds(layers: Layer[], rewrittenIdById: Map<string, string>): void {
  const visit = (layer: Layer): void => {
    layer.id = rewrittenIdById.get(layer.id) ?? layer.id;
    if (layer.parent != null) {
      layer.parent = rewrittenIdById.get(layer.parent) ?? layer.parent;
    }
    (layer.children ?? []).forEach(visit);
  };

  layers.forEach(visit);
}

function assignInventedIds(layer: Layer, parentId: string | null, path: string): void {
  layer.id = `invented_${path}`;
  layer.parent = parentId;
  (layer.children ?? []).forEach((child, index) => assignInventedIds(child, layer.id, `${path}_${index}`));
}
