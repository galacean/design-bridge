import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}', 'server/**/*.test.js'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@galacean/animation-ir/adapter': path.resolve(__dirname, '../packages/animation-ir/src/adapter'),
      '@galacean/animation-ir/validator': path.resolve(__dirname, '../packages/animation-ir/src/validator'),
      '@galacean/animation-ir': path.resolve(__dirname, '../packages/animation-ir/src'),
      '@galacean/dsl-ir': path.resolve(__dirname, '../packages/dsl-ir/src'),
      '@galacean/svg2ir': path.resolve(__dirname, '../packages/svg2ir/src/index.ts'),
      '@galacean/ge-ir': path.resolve(__dirname, '../packages/ge-ir/src'),
      '@galacean/html2figma': path.resolve(__dirname, '../packages/html2figma/src'),
      '@galacean/figma2ge': path.resolve(__dirname, '../packages/figma2ge/src'),
    },
  },
});
