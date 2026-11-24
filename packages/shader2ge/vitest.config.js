import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@galacean\/shader2ge$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
    ],
    tsconfigPaths: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    passWithNoTests: true,
  },
});
