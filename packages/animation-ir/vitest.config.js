import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@galacean/animation-ir/adapter': fileURLToPath(new URL('./src/adapter/index.ts', import.meta.url)),
      '@galacean/animation-ir/validator': fileURLToPath(new URL('./src/validator/index.ts', import.meta.url)),
      '@galacean/animation-ir': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
