import { describe, expect, it } from 'vitest';
import type { IRLayer } from '@galacean/animation-ir';
import { buildIRStaticLayers } from '../../../../../src/adapter/svg2layers/converter/layers/build-layers';
import { createLayerConverterRegistry } from '../../../../../src/adapter/svg2layers/converter/layers/registry';
import { buildImageLayer, buildLayerBase, buildSession, buildTextLayer } from '../build-layer-fixtures';

const baseState = { opacity: 1, visible: true };

describe('IR layer converter registry', () => {
  it('preserves painter order and generates IDs independently of source IDs', () => {
    const session = buildSession([buildTextLayer('plain'), buildImageLayer(), buildTextLayer('rich')]);
    const registry = createLayerConverterRegistry(session);
    const layers = buildIRStaticLayers(session);

    expect([...registry.keys()]).toEqual(['image', 'text']);
    expect(layers.map(layer => layer.id)).toEqual(['text_0001', 'image_0001', 'text_0002']);
    expect(layers.map(layer => layer.type)).toEqual(['text', 'image', 'text']);
    expect(session.warnings).toEqual([]);
  });

  it('supports orthogonal nonuniform image scale and off-center anchors', () => {
    const session = buildSession([buildImageLayer()]);
    const rotated = { ...session, resolveLayerState: () => ({
      ...baseState, matrix: { a: 0, b: 2, c: -3, d: 0, e: 100, f: 50 },
    }) };
    const layers = buildIRStaticLayers(rotated);

    expect(layers[0]).toMatchObject({
      size: [40, 30], rotation: [0, 0, 90], bbox: [70, 50, 100, 90], width: 30, height: 40,
    });
    expect(session.warnings).toEqual([]);
  });

  it.each([
    { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    { a: 1, b: 0, c: 0.5, d: 1, e: 0, f: 0 },
  ])('diagnoses reflections and skew rather than treating them as rotations', matrix => {
    const session = buildSession([buildImageLayer()]);
    const unsupported = { ...session, resolveLayerState: () => ({ matrix, ...baseState }) };

    expect(buildIRStaticLayers(unsupported)).toEqual([]);
    expect(session.warnings.map(warning => warning.code)).toEqual(['svg2ge_layers_unsupported_feature']);
  });

  it('skips mask sources and continues allocating IDs after unsupported content', () => {
    const solid: IRLayer = { ...buildLayerBase('solid'), type: 'solid',
      localBounds: { x: 0, y: 0, width: 20, height: 10 }, content: { color: [1, 0, 0, 1] } };
    const mask: IRLayer = { ...buildLayerBase('mask'), type: 'shape', content: { shapes: [] } };
    const target = { ...buildImageLayer('hidden'), visible: false,
      matte: { sourceLayerId: 'mask', mode: 'geometry' as const } };
    const session = buildSession([solid, mask, target, buildImageLayer()]);
    const layers = buildIRStaticLayers(session);

    expect(layers.map(layer => layer.id)).toEqual(['image_0001']);
    expect(session.warnings.map(warning => warning.code)).toEqual(['svg2ge_layers_unsupported_type']);
  });

  it('does not report unsupported content or allocate IDs for hidden layers', () => {
    const hidden: IRLayer = { ...buildLayerBase('hidden'), type: 'shape', visible: false, content: { shapes: [] } };
    const session = buildSession([hidden, { ...buildImageLayer(), visible: false }]);

    expect(buildIRStaticLayers(session)).toEqual([]);
    expect(session.warnings).toEqual([]);
  });
});
