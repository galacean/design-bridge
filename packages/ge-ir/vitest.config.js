import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@galacean/animation-ir/adapter': path.resolve(__dirname, '../animation-ir/src/adapter'),
      '@galacean/animation-ir/validator': path.resolve(__dirname, '../animation-ir/src/validator'),
      '@galacean/animation-ir': path.resolve(__dirname, '../animation-ir/src'),
    },
  },
});
