import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import { wasm } from '@rollup/plugin-wasm';
import { swc, defineRollupSwcOption } from 'rollup-plugin-swc3';

export function getPlugins (pkg, options = {}) {
  const { target, external, useWasm = false, commonjsFirst = false } = options;
  const defines = {
    __VERSION__: JSON.stringify(pkg.version),
    __DEBUG__: false,
  };
  const replacePlugin = replace({
    preventAssignment: true,
    values: defines,
  });
  const resolvePlugin = resolve();
  const commonjsPlugin = commonjs();
  const swcPlugin = getSWCPlugin({ target }, external);
  const plugins = commonjsFirst
    ? [replacePlugin, resolvePlugin, commonjsPlugin, swcPlugin]
    : [replacePlugin, swcPlugin, resolvePlugin, commonjsPlugin];

  if (useWasm) {
    plugins.unshift(wasm({
      targetEnv: 'auto-inline', // auto-inline
    }));
  }

  return plugins;
}

export { wasm };

export function getSWCPlugin (
  jscOptions = {},
  external = [],
) {
  const jsc = {
    loose: true,
    externalHelpers: true,
    target: 'ES2015',
    ...jscOptions,
  }
  const options = {
    exclude: [],
    jsc,
    sourceMaps: true,
  };

  // swc 会把 tsconfig 中配置的 paths 当作依赖打进包中，rollup 设置的 external 无效
  // 故此处通过独立的 tsconfig 配置 paths 为空来做
  if (external.length !== 0) {
    options['tsconfig'] = './tsconfig.external.json';
  }

  return swc(
    defineRollupSwcOption(options),
  );
}

export function getBanner (pkg) {
  return `/*!
 * Name: ${pkg.name}
 * Description: ${pkg.description}
 * Author: ${pkg.author}
 * Contributors: ${pkg.contributors.map(c => c.name).join(',')}
 * Version: v${pkg.version}
 */
`;
}
