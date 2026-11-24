/** Round a number to the given decimal precision. */
export function roundNumber(value: number, precision = 4): number {
  const factor = 10 ** precision;

  return Math.round(value * factor) / factor;
}

/** Interpolate linearly between `a` and `b`. */
export function lerp(a: number, b: number, factor: number): number {
  return (1 - factor) * a + factor * b;
}
