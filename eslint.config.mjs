import galacean from '@galacean/eslint-config';
import browser from '@galacean/eslint-config/browser';
import strict from '@galacean/eslint-config/strict';
import tests from '@galacean/eslint-config/tests';
import { defineConfig, globalIgnores } from 'eslint/config';

const BASE_IGNORES = [
  '**/{node_modules,dist,lib,.history,tmp}/**',
  '**/*.{js,mjs,cjs}',
  '**/*.d.ts',
  'temp',
];

export default defineConfig([
  globalIgnores(BASE_IGNORES),
  galacean,
  browser,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ...strict,
    files: ['**/src/**/*.ts'],
  },
  {
    files: ['packages/ge-ir/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@galacean/dsl-ir', '@galacean/dsl-ir/*'],
          message: 'Compose GE and DSL adapters in the caller.',
        }],
      }],
    },
  },
  {
    files: ['packages/dsl-ir/src/**/*.ts'],
    rules: {
      'id-length': ['error', { min: 2, properties: 'never', exceptions: ['T'] }],
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@galacean/ge-ir', '@galacean/ge-ir/*'],
          message: 'DSL conversion must remain GE-independent.',
        }],
      }],
    },
  },
  {
    ...tests,
    files: ['**/tests/**/*.ts'],
    rules: {
      ...tests.rules,
      'compat/compat': 'off',
    },
  },
  {
    files: ['**/{web-packages,site}/**/*.{ts,tsx}'],
    rules: {
      ...tests.rules,
      'compat/compat': 'off',
    },
  },
]);
