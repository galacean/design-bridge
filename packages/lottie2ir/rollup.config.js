import { getBanner, getPlugins } from '../../scripts/rollup-config-helper';
import pkg from './package.json';

const banner = getBanner(pkg);
const external = [/^@galacean\/animation-ir(?:\/.*)?$/, 'uuid'];
const plugins = getPlugins(pkg, { external });

export default () => {
  return {
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
  };
};
