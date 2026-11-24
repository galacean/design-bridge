import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDSLEditing } from '../src/pages/ge2dsl-bundle/use-dsl-editing';
import { useLottieConverter } from '../src/pages/lottie2ge/hooks/use-lottie-converter';
import { useFrameComparisonSession } from '../src/pages/frame-test/hooks/use-frame-comparison-session';
import { runFrameComparison } from '../src/features/frame-comparison/core/run-frame-comparison';
import type { LottieFrameResult } from '../src/features/frame-comparison/core/types';

const hooks = vi.hoisted(() => {
  const cells: Array<{ value: unknown; dependencies?: readonly unknown[]; cleanup?: () => void }> = [];
  let cursor = 0;
  const effects: Array<() => void> = [];

  function memoize<T>(factory: () => T, dependencies?: readonly unknown[]): T {
    const index = cursor++;
    const previous = cells[index];

    if (dependencies == null || previous?.dependencies == null ||
      dependencies.length !== previous.dependencies.length ||
      dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]))) {
      cells[index] = { value: factory(), dependencies };
    }

    return cells[index].value as T;
  }

  return {
    useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] {
      const index = cursor++;

      cells[index] ??= { value: typeof initial === 'function' ? (initial as () => T)() : initial };

      return [cells[index].value as T, value => {
        cells[index].value = typeof value === 'function'
          ? (value as (previous: T) => T)(cells[index].value as T) : value;
      }];
    },
    useRef<T>(initial: T) {
      const index = cursor++;

      cells[index] ??= { value: { current: initial } };

      return cells[index].value as { current: T };
    },
    useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
      const index = cursor++;
      const previous = cells[index];
      const changed = dependencies == null || previous?.dependencies == null ||
        dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]));

      if (changed) {
        effects.push(() => {
          previous?.cleanup?.();
          const cleanup = effect();

          cells[index] = { value: undefined, dependencies, cleanup: cleanup ?? undefined };
        });
      }
    },
    useCallback<T>(callback: T, dependencies?: readonly unknown[]) { return memoize(() => callback, dependencies); },
    useMemo: memoize,
    render<T>(hook: () => T) {
      cursor = 0;
      const result = hook();

      effects.splice(0).forEach(effect => effect());

      return result;
    },
    unmount() { cells.forEach(cell => cell.cleanup?.()); },
    reset() { cells.length = 0; cursor = 0; effects.length = 0; },
  };
});

vi.mock('react', () => hooks);
vi.mock('../src/features/local-inputs/use-input-files', () => ({
  useInputFiles: () => ({ files: [], error: null, refresh: vi.fn() }),
}));
vi.mock('../src/features/dsl-conversion/ge-dsl-workflow', () => ({
  convertGEToDSL: (scene: { name: string }) => ({ dsl: { name: scene.name }, preservedData: scene }),
  convertDSLToGE: (dsl: { name: string }) => ({ scene: { name: dsl.name, compositions: [], items: [] } }),
}));
vi.mock('../src/features/lottie-conversion/convert-lottie-to-ge', () => ({
  convertLottieTextToGE: vi.fn(async (text: string) => ({ data: JSON.parse(text) as unknown, diagnostics: [] })),
}));
vi.mock('../src/features/frame-comparison/core/run-frame-comparison', () => ({ runFrameComparison: vi.fn() }));

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>(resolve => { resolvePromise = resolve; });

  return { promise, resolve: resolvePromise };
}

beforeEach(() => {
  hooks.reset();
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('window', { location: { href: 'http://workbench.test/ge2dsl-bundle' } });
});

afterEach(() => {
  hooks.unmount();
  vi.unstubAllGlobals();
});

describe('DSL editing source ownership', () => {
  it('discards pending paired file reads when the editor is cleared', async () => {
    const dsl = deferred<string>();
    const preserved = deferred<string>();
    const editor = hooks.render(useDSLEditing);
    const reading = [
      editor.loadLocalFile('dsl', { name: 'dsl.json', text: () => dsl.promise } as File),
      editor.loadLocalFile('preservedData', { name: 'preserved.json', text: () => preserved.promise } as File),
    ];

    editor.clearAll();
    dsl.resolve('{}');
    preserved.resolve('{}');
    await Promise.all(reading);
    const current = hooks.render(useDSLEditing);

    expect(current.dslText).toBe('');
    expect(current.preservedDataText).toBe('');
  });
  it('allows the DSL and its paired preservation file to finish independent reads', async () => {
    const dsl = deferred<string>();
    const preserved = deferred<string>();
    const editor = hooks.render(useDSLEditing);
    const readDSL = editor.loadLocalFile('dsl', { name: 'dsl.json', text: () => dsl.promise } as File);
    const readPreserved = editor.loadLocalFile(
      'preservedData', { name: 'preserved.json', text: () => preserved.promise } as File,
    );

    preserved.resolve('{"name":"pair"}');
    await readPreserved;
    dsl.resolve('{"name":"dsl"}');
    await readDSL;
    const current = hooks.render(useDSLEditing);

    expect(current.dslText).toBe('{"name":"dsl"}');
    expect(current.preservedDataText).toBe('{"name":"pair"}');
  });
  it.each(['source', 'frameRate', 'file'] as const)('invalidates the paired bundle after a %s change', async change => {
    let editor = hooks.render(useDSLEditing);

    editor.setGEText('{"name":"A"}');
    editor = hooks.render(useDSLEditing);
    editor.convertInput();
    editor = hooks.render(useDSLEditing);
    editor.convertBundle();
    editor = hooks.render(useDSLEditing);
    expect(editor.convertedData?.['name']).toBe('A');

    if (change === 'source') {
      editor.setGEText('{"name":"B"}');
    } else if (change === 'frameRate') {
      editor.setFrameRate(60);
    } else {
      vi.mocked(fetch).mockResolvedValue(new Response('{"name":"B"}'));
      await editor.loadInputFile('B.json');
    }
    editor = hooks.render(useDSLEditing);
    expect(editor.dslText).toBe('');
    expect(editor.preservedDataText).toBe('');
    expect(editor.convertedData).toBeNull();
    expect(editor.previewEnabled).toBe(false);
  });

  it('uses the latest edited source for the original preview when generating a bundle', () => {
    let editor = hooks.render(useDSLEditing);

    editor.setGEText('{"name":"A"}');
    editor = hooks.render(useDSLEditing);
    editor.convertInput();
    editor = hooks.render(useDSLEditing);
    editor.setGEText('{"name":"B"}');
    editor = hooks.render(useDSLEditing);
    editor.convertInput();
    editor = hooks.render(useDSLEditing);
    expect(editor.originalData?.['name']).toBe('B');
  });
});

describe('input request ordering', () => {
  it('does not restore a conversion result after clear', async () => {
    const converter = hooks.render(useLottieConverter);
    const converting = converter.actions.doConvert('{"name":"A"}');

    converter.actions.clear();
    await converting;
    const current = hooks.render(useLottieConverter);

    expect(current.state.status).toBe('idle');
    expect(current.state.effectsData).toBeNull();
  });
  it('cancels an active frame comparison and ignores its late progress and result', async () => {
    const frames = deferred<LottieFrameResult[]>();

    vi.mocked(runFrameComparison).mockReturnValue(frames.promise);
    const session = hooks.render(useFrameComparisonSession);
    const loading = session.loadFromFile({ name: 'test.json', text: async () => '{}' } as File);

    await vi.waitFor(() => expect(runFrameComparison).toHaveBeenCalled());
    session.clear();
    const options = vi.mocked(runFrameComparison).mock.lastCall?.[1];

    options?.onFrameProgress?.(1, 15, 0.1);
    frames.resolve([]);
    await loading;
    const current = hooks.render(useFrameComparisonSession);

    expect(options?.signal?.aborted).toBe(true);
    expect(current.status).toBe('idle');
    expect(current.statusMsg).toBe('');
    expect(current.results).toEqual([]);
  });
  it('keeps the most recent URL when responses arrive out of order', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();

    vi.mocked(fetch).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const converter = hooks.render(useLottieConverter);
    const firstLoad = converter.actions.loadFromUrl('https://example.test/A.json');
    const secondLoad = converter.actions.loadFromUrl('https://example.test/B.json');

    second.resolve(new Response('{"name":"B"}'));
    await secondLoad;
    first.resolve(new Response('{"name":"A"}'));
    await firstLoad;
    const current = hooks.render(useLottieConverter);

    expect(current.state.inputJson).toBe('{"name":"B"}');
    expect(current.state.effectsData?.['name']).toBe('B');
  });

  it.each(['clear', 'edit', 'unmount'] as const)('cancels a URL load after %s', async action => {
    const response = deferred<Response>();

    vi.mocked(fetch).mockReturnValue(response.promise);
    const converter = hooks.render(useLottieConverter);
    const loading = converter.actions.loadFromUrl('https://example.test/A.json');

    if (action === 'clear') {
      converter.actions.clear();
    } else if (action === 'edit') {
      converter.actions.setInputJson('{"name":"edited"}');
    } else {
      hooks.unmount();
    }
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;

    response.resolve(new Response('{"name":"A"}'));
    await loading;
    expect(signal?.aborted).toBe(true);
    const current = hooks.render(useLottieConverter);

    expect(current.state.effectsData).toBeNull();
    expect(current.state.inputJson).toBe(action === 'edit' ? '{"name":"edited"}' : '');
  });

  it('ignores a DSL source response that arrives after clear', async () => {
    const response = deferred<Response>();

    vi.mocked(fetch).mockReturnValue(response.promise);
    const editor = hooks.render(useDSLEditing);
    const loading = editor.loadInputFile('A.json');

    editor.clearAll();
    response.resolve(new Response('{"name":"A"}'));
    await loading;
    expect(hooks.render(useDSLEditing).GEText).toBe('');
  });
});
