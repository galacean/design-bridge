import { init } from '@bokuweb/zstd-wasm';

const ZSTD_INITIALIZATION_KEY = '__vvfxHtml2FigmaZstdInitializations';

type ZstdGlobal = typeof globalThis & {
  [ZSTD_INITIALIZATION_KEY]?: WeakMap<typeof init, Promise<void>>;
};

export async function ensureZstdInitialized(): Promise<void> {
  const runtime = globalThis as ZstdGlobal;

  const initializations = runtime[ZSTD_INITIALIZATION_KEY] ??= new WeakMap();

  // ESM and standalone bundles can own distinct WASM instances on the same page.
  if (!initializations.has(init)) {
    initializations.set(init, init());
  }
  await initializations.get(init);
}
