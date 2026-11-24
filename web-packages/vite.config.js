import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFileApiPlugin } from './server/vite-file-api-plugin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const development = mode === 'development';

  return {
    base: './',
    optimizeDeps: {
      entries: ['**/*.html', '!tmp/**', '!**/__tests__/**', '!**/coverage/**'],
    },
    server: {
      port: 8080,
      strictPort: true,
    },
    define: {
      __DEBUG__: development,
    },
    resolve: {
      tsconfigPaths: true,
      alias: {
        '@galacean/html2figma/browser/clipboard': path.resolve(
          __dirname,
          '../packages/html2figma/src/browser-clipboard-entry.ts',
        ),
        '@galacean/html2figma/browser/file': path.resolve(
          __dirname,
          '../packages/html2figma/src/browser-file-entry.ts',
        ),
        '@galacean/html2figma/browser/zip': path.resolve(__dirname, '../packages/html2figma/src/browser-zip-entry.ts'),
        '@galacean/html2figma/browser': path.resolve(__dirname, '../packages/html2figma/src/browser.ts'),
        '@galacean/html2figma': path.resolve(__dirname, '../packages/html2figma/src'),
        '@galacean/svg2ir': path.resolve(__dirname, '../packages/svg2ir/src'),
        '@galacean/ge-ir': path.resolve(__dirname, '../packages/ge-ir/src'),
        '@galacean/dsl-ir': path.resolve(__dirname, '../packages/dsl-ir/src'),
        '@galacean/animation-ir/adapter': path.resolve(__dirname, '../packages/animation-ir/src/adapter'),
        '@galacean/animation-ir/validator': path.resolve(__dirname, '../packages/animation-ir/src/validator'),
        '@galacean/animation-ir': path.resolve(__dirname, '../packages/animation-ir/src'),
      },
    },
    ssr: {
      noExternal: ['@galacean/effects-specification'],
    },
    plugins: [
      tailwindcss(),
      react(),
      createFileApiPlugin({ rootDir: __dirname }),
    ],
  };
});
