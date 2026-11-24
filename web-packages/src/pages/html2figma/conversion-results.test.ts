import { describe, expect, it } from 'vitest';
import { partitionSceneConversionResults } from './conversion-results';

describe('partitionSceneConversionResults', () => {
  it('does not treat error-only scene results as successful conversions', () => {
    const result = partitionSceneConversionResults([
      { name: 'index', error: 'Sandbox returned an invalid Scene payload.' },
    ]);

    expect(result.successfulScenes).toEqual([]);
    expect(result.failedScenes).toHaveLength(1);
    expect(result.failureMessage).toBe('index: Sandbox returned an invalid Scene payload.');
  });

  it('keeps successful scenes when another input fails', () => {
    const sceneData = {
      type: 'frame' as const,
      name: 'Body',
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      styles: {},
      children: [],
      ir: {
        figmaType: 'FRAME' as const,
        opacity: 1,
        isAbsolute: false,
        fills: [],
        effects: [],
        clipsContent: false,
        flexGrow: 0,
      },
    };
    const result = partitionSceneConversionResults([
      { name: 'valid', sceneData },
      { name: 'invalid', error: 'failed' },
    ]);

    expect(result.successfulScenes).toEqual([{ name: 'valid', sceneData }]);
    expect(result.failedScenes).toEqual([{ name: 'invalid', error: 'failed' }]);
  });
});
