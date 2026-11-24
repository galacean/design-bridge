import { getBanner, getPlugins } from '../../scripts/rollup-config-helper';
import pkg from './package.json';

const banner = getBanner(pkg);
// Bundle effects-specification because its published ESM uses extensionless
// relative imports that native Node cannot resolve. Keeping it external makes
// both ge-ir and downstream GE/DSL integration modules fail at module load time.
const external = [/^@galacean\/animation-ir(?:\/.*)?$/, /^@galacean\/dsl-ir(?:\/.*)?$/, 'uuid'];
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
