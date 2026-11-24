import { fileURLToPath } from 'node:url';
import { normalizeBase } from '@galacean/docs-site';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  plugins: [react()],
  base: normalizeBase(process.env.SITE_BASE_PATH ?? '/'),
  resolve: { dedupe: ['react', 'react-dom', 'react-router-dom'] },
  server: {
    host: true,
    port: 8081,
    strictPort: true,
  },
  build: {
    outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0,
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        notFound: fileURLToPath(new URL('./404.html', import.meta.url)),
      },
    },
    target: ['chrome110', 'edge110', 'firefox110', 'safari16.4'],
  },
}));
