import { getBanner, getPlugins } from '../../scripts/rollup-config-helper';
import pkg from './package.json';

const banner = getBanner(pkg);
const external = [
  '@galacean/animation-ir',
  '@galacean/animation-ir/adapter',
  '@galacean/animation-ir/validator',
  '@galacean/ge-ir',
  '@svgdotjs/svg.js',
];
const plugins = getPlugins(pkg, { external });
// Node 入口(src/node.ts)经 parse-svg/node 引 svgdom,
// svgdom 是 Node 运行时依赖,交由消费方安装,不进 bundle。
const nodeExternal = [...external, 'svgdom'];
const nodePlugins = getPlugins(pkg, { external: nodeExternal });

export default () => {
  return [
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
      input: 'src/node.ts',
      external: nodeExternal,
      output: [{
        file: 'dist/node.mjs',
        format: 'es',
        banner,
        sourcemap: true,
      }, {
        file: 'dist/node.js',
        format: 'cjs',
        banner,
        sourcemap: true,
      }],
      plugins: nodePlugins,
    },
  ];
};
