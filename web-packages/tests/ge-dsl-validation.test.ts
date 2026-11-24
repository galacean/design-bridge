import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataType, EndBehavior, ItemType, ValueType } from '@galacean/effects-specification';
import * as workflow from '../src/features/dsl-conversion/ge-dsl-workflow';
import { convertGEInputRoundTrip } from '../src/pages/ge2dsl/convert-ge-input-round-trip';

function createSource() {
  return {
    version: '3.6', type: 'ge', compositionId: 'root',
    compositions: [{
      id: 'root', name: 'GE input', duration: 2, startTime: 0,
      endBehavior: EndBehavior.restart, previewSize: [400, 300],
      components: [{ id: 'composition-component' }],
    }],
    items: [{
      id: 'particle', name: 'Particle', type: ItemType.particle,
      duration: 2, delay: 0, visible: true, endBehavior: EndBehavior.restart,
      components: [{ id: 'particle-component' }],
      transform: { position: { x: 0, y: 0, z: 0 } },
    }],
    components: [
      {
        id: 'composition-component', dataType: DataType.CompositionComponent,
        item: { id: 'root' }, items: [{ id: 'particle' }], sceneBindings: [],
      },
      {
        id: 'particle-component', dataType: DataType.ParticleSystem, item: { id: 'particle' },
        options: { maxCount: 17, startLifetime: [ValueType.CONSTANT, 1], startSize: [ValueType.CONSTANT, 0.5] },
        renderer: { renderMode: 1 }, shape: { type: 1, radius: 0.5, arc: 360 },
        emission: { rateOverTime: [ValueType.CONSTANT, 5] },
      },
    ],
    images: [], textures: [], fonts: [], plugins: [], miscs: [],
  };
}

afterEach(() => vi.restoreAllMocks());

describe('manual GE to DSL round trip', () => {
  it('keeps the original GE baseline and restores particles with paired preserved data at the selected frame rate', () => {
    const source = createSource();
    const importSpy = vi.spyOn(workflow, 'convertGEToDSL');
    const result = convertGEInputRoundTrip(JSON.stringify(source), 24);
    const imported = importSpy.mock.results[0].value as ReturnType<typeof workflow.convertGEToDSL>;

    expect(result.error).toBeNull();
    expect(result.source).toEqual(source);
    expect(imported.dsl.meta.fps).toBe(24);
    expect(result.scene?.compositions).toEqual(expect.arrayContaining([
      expect.objectContaining({ duration: 2, previewSize: [400, 300] }),
    ]));
    expect(result.scene?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dataType: DataType.ParticleSystem,
        options: expect.objectContaining({ maxCount: 17 }),
        emission: { rateOverTime: [ValueType.CONSTANT, 5] },
      }),
    ]));
  });

  it('retains the original preview and import diagnostics when the export fails', () => {
    const source = createSource();
    const imported = workflow.convertGEToDSL(source, { frameRate: 30 });
    const diagnostic = { severity: 'warning' as const, code: 'test-warning', message: 'Import warning', action: 'approximated' as const, path: 'layers[0]' };

    vi.spyOn(workflow, 'convertGEToDSL').mockReturnValue({ ...imported, diagnostics: [diagnostic] });
    vi.spyOn(workflow, 'convertDSLToGE').mockImplementation(() => { throw new Error('export failed'); });
    const result = convertGEInputRoundTrip(JSON.stringify(source), 30);

    expect(result.source).toEqual(source);
    expect(result.scene).toBeNull();
    expect(result.error).toBe('DSL → GE 转换失败：export failed');
    expect(result.diagnostics).toEqual([diagnostic]);
  });

  it.each(['{', 'null', '[]', '{"meta":{},"layers":[]}'])('rejects invalid or DSL input: %s', json => {
    expect(() => convertGEInputRoundTrip(json, 30)).toThrow();
  });

  it.each([0, NaN])('rejects an invalid frame rate: %s', frameRate => {
    expect(() => convertGEInputRoundTrip(JSON.stringify(createSource()), frameRate)).toThrow('转换帧率');
  });
});
