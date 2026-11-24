import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup/browser-mocks.ts'],
    testTimeout: 30000,
  },
});
