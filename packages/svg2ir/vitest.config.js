import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@galacean/svg2ir/helper', replacement: fileURLToPath(new URL('./src/helper.ts', import.meta.url)) },
      { find: '@svg2ir/internal-debug', replacement: fileURLToPath(new URL('./src/debug.ts', import.meta.url)) },
    ],
    tsconfigPaths: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    passWithNoTests: true,
  },
});