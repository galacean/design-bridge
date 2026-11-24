/** Scope deterministic randomness to synchronous simulation without affecting asset loading. */
export function withSeededRandom<T>(callback: () => T): T {
  const originalRandom = Math.random;
  let state = 1;

  Math.random = () => {
    state = state * 16807 % 2147483647;

    return (state - 1) / 2147483646;
  };
  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}
