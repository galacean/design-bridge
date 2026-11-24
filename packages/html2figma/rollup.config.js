import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import resolve from '@rollup/plugin-node-resolve';
import { getBanner, getPlugins } from '../../scripts/rollup-config-helper';
import pkg from './package.json';

const banner = getBanner(pkg);
const external = [...Object.keys(pkg.dependencies || {}), 'woff2-encoder/decompress'];
const plugins = getPlugins(pkg, { external, target: 'ES2022' });
const browserPlugins = getPlugins(pkg, { external, target: 'ES2022' });
const browserClipboardExternal = external.filter(dependency =>
  dependency !== 'fontkit' && dependency !== 'kiwi-schema' && dependency !== 'pako' &&
    !dependency.startsWith('woff2-encoder'),
);
const browserClipboardPlugins = getPlugins(pkg, {
  external: browserClipboardExternal,
  commonjsFirst: true,
});
const require = createRequire(import.meta.url);
const standalonePlugins = getPlugins(pkg, { commonjsFirst: true, target: 'ES2022' })
  .map(plugin => plugin.name === 'node-resolve'
    ? resolve({ browser: true, exportConditions: ['browser'] })
    : plugin);

standalonePlugins.push({
  name: 'standalone-browser-resources',
  resolveImportMeta(property) {
    if (property === 'url') {
      return 'html2figmaScriptURL';
    }
  },
  generateBundle() {
    const zstdDirectory = path.resolve(path.dirname(require.resolve('@bokuweb/zstd-wasm')), '../web');

    this.emitFile({ type: 'asset', fileName: 'zstd.wasm', source: readFileSync(path.join(zstdDirectory, 'zstd.wasm')) });
  },
});

export default () => {
  return [
    {
      input: 'src/browser-standalone-entry.ts',
      output: {
        file: 'dist/browser.umd.js',
        format: 'umd',
        name: 'Html2Figma',
        banner,
        sourcemap: true,
        inlineDynamicImports: true,
        intro: `const html2figmaScript = document.currentScript;
const html2figmaScriptURL = html2figmaScript?.getAttribute('data-html2figma-base-url')
  ? new URL('dist/browser.umd.js', html2figmaScript.getAttribute('data-html2figma-base-url')).href
  : html2figmaScript?.src;
if (!html2figmaScriptURL) throw new Error('Load html2figma UMD with a script src attribute.');`,
      },
      plugins: standalonePlugins,
    },
    {
      input: 'src/index.ts',
      external,
      output: [{
        file: pkg.module,
        format: 'es',
        banner,
        sourcemap: true,
      }, {
        file: pkg.main,
        format: 'cjs',
        banner,
        sourcemap: true,
      }],
      plugins,
    },
    {
      input: 'src/browser.ts',
      external,
      output: {
        file: 'dist/browser.mjs',
        format: 'es',
        banner,
        sourcemap: true,
      },
      plugins: browserPlugins,
    },
    {
      input: 'src/browser-zip-entry.ts',
      external,
      output: {
        file: 'dist/browser-zip.mjs',
        format: 'es',
        banner,
        sourcemap: true,
      },
      plugins,
    },
    {
      input: {
        'browser-clipboard': 'src/browser-clipboard-entry.ts',
        'browser-file': 'src/browser-file-entry.ts',
      },
      external: browserClipboardExternal,
      output: {
        dir: 'dist',
        format: 'es',
        banner,
        entryFileNames: '[name].mjs',
        chunkFileNames: 'browser-shared-[hash].mjs',
        sourcemap: true,
      },
      plugins: browserClipboardPlugins,
    },
  ];
};
