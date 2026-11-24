export interface FrameRegressionOptions {
  mochaRoot: HTMLElement;
  galleryRoot: HTMLElement;
  signal?: AbortSignal;
  registerSuite: (root: HTMLElement, options: { signal?: AbortSignal }) => Promise<number>;
}

interface FrameRegressionSession {
  fixtureCount: number;
  stop: () => void;
}

type MochaLike = {
  setup?: (options: Record<string, unknown>) => void;
  reporter?: (name: string) => void;
  run: () => {
    abort?: () => void;
  };
  dispose?: () => void;
  suite?: {
    suites: unknown[];
    timeout?: (ms: number) => void;
    slow?: (ms: number) => void;
    emit?: (event: string, context: unknown, file: string | null, mocha: unknown) => void;
  };
};

function createFreshMochaInstance(): MochaLike {
  const GlobalMocha = (
    window as Window & {
      Mocha?: new (options?: Record<string, unknown>) => MochaLike;
    }
  ).Mocha;

  if (!GlobalMocha) {
    throw new Error('Mocha constructor is not loaded');
  }

  const mocha = new GlobalMocha({
    ui: 'bdd',
    timeout: 180000,
    cleanReferencesAfterRun: false,
  });

  // Bind BDD globals to the new suite when re-entering a regression route.
  mocha.suite?.emit?.('pre-require', window, null, mocha);

  return mocha;
}

function configureMocha(mochaApi: MochaLike): void {
  mochaApi.reporter?.('html');

  if (typeof mochaApi.setup === 'function') {
    mochaApi.setup({
      ui: 'bdd',
      timeout: 180000,
      slow: 30000,
      reporter: 'html',
      cleanReferencesAfterRun: false,
    });

    return;
  }

  mochaApi.suite?.timeout?.(180000);
  mochaApi.suite?.slow?.(30000);
}

export async function runFrameRegression(options: FrameRegressionOptions): Promise<FrameRegressionSession> {
  const { mochaRoot, galleryRoot, signal, registerSuite } = options;

  if (!window.Mocha && !window.mocha) {
    throw new Error('Mocha is not loaded');
  }

  const previousMocha = window.mocha;

  previousMocha?.dispose?.();

  const mochaApi = createFreshMochaInstance();

  window.mocha = mochaApi;

  mochaRoot.innerHTML = '';
  galleryRoot.innerHTML = '';
  if (mochaApi.suite?.suites) {
    mochaApi.suite.suites.length = 0;
  }

  configureMocha(mochaApi);

  const fixtureCount = await registerSuite(galleryRoot, { signal });

  if (signal?.aborted) {
    return {
      fixtureCount,
      stop: () => undefined,
    };
  }

  const runner = mochaApi.run();

  return {
    fixtureCount,
    stop: () => {
      runner?.abort?.();
    },
  };
}
