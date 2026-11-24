export function buildFrameTestReport(last, targetHref, consoleErrors) {
  const tests = last.tests || [];
  const pass = tests.filter(test => test.passed).length;
  const skip = tests.filter(test => test.skipped).length;

  return {
    done: !!last.done,
    url: targetHref,
    stats: last.stats,
    total: tests.length,
    pass,
    fail: tests.length - pass - skip,
    ...(last.isSvg ? { skip } : {}),
    ...(last.empty ? { empty: true, error: 'No cases matched the selection.' } : {}),
    consoleHints: consoleErrors.filter(Boolean),
    failed: tests.filter(test => !test.passed && !test.skipped),
    passed: tests.filter(test => test.passed).map(test => test.name),
    ...(last.isSvg ? { skipped: tests.filter(test => test.skipped).map(test => test.name) } : {}),
  };
}
