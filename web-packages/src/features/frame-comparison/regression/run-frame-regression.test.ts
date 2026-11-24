import { afterEach, describe, expect, it, vi } from 'vitest';
import { runFrameRegression } from './run-frame-regression';

function createEnvironment() {
  const instances: FakeMocha[] = [];

  class FakeMocha {
    suite = { suites: [], emit: vi.fn(), timeout: vi.fn(), slow: vi.fn() };
    abort = vi.fn();
    dispose = vi.fn();
    reporter = vi.fn();
    run = vi.fn(() => ({ abort: this.abort }));

    constructor() {
      instances.push(this);
    }
  }

  const previous = { dispose: vi.fn() };

  vi.stubGlobal('window', { Mocha: FakeMocha, mocha: previous });

  return {
    instances, previous,
    mochaRoot: { innerHTML: 'old report' } as HTMLElement,
    galleryRoot: { innerHTML: 'old gallery' } as HTMLElement,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('frame regression lifecycle', () => {
  it('replaces the previous suite and report when another regression page starts', async () => {
    const environment = createEnvironment();
    const registerSuite = vi.fn().mockResolvedValue(2);
    const first = await runFrameRegression({ ...environment, registerSuite });

    expect(environment.previous.dispose).toHaveBeenCalledOnce();
    expect(environment.mochaRoot.innerHTML).toBe('');
    expect(environment.galleryRoot.innerHTML).toBe('');
    expect(first.fixtureCount).toBe(2);
    expect(environment.instances[0].run).toHaveBeenCalledOnce();
    first.stop();
    expect(environment.instances[0].abort).toHaveBeenCalledOnce();

    await runFrameRegression({ ...environment, registerSuite });
    expect(environment.instances[0].dispose).toHaveBeenCalledOnce();
    expect(environment.instances).toHaveLength(2);
    expect(environment.instances[1].run).toHaveBeenCalledOnce();
  });

  it('does not start rendering if the page leaves while fixtures are loading', async () => {
    const environment = createEnvironment();
    const controller = new AbortController();
    let finishLoading: (count: number) => void = () => undefined;
    const registration = new Promise<number>(resolve => { finishLoading = resolve; });
    const registerSuite = vi.fn(() => registration);
    const pending = runFrameRegression({ ...environment, registerSuite, signal: controller.signal });

    expect(registerSuite).toHaveBeenCalledWith(environment.galleryRoot, { signal: controller.signal });
    controller.abort();
    finishLoading(3);
    const session = await pending;

    expect(environment.instances[0].run).not.toHaveBeenCalled();
    session.stop();
    expect(environment.instances[0].abort).not.toHaveBeenCalled();
  });
});
