import js from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import typescriptEslint from 'typescript-eslint';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default typescriptEslint.config([
  eslintPluginUnicorn.configs.recommended,
  eslintPluginPrettierRecommended,
  js.configs.recommended,
  typescriptEslint.configs.recommended,
  {
    ignores: ['eslint.config.mjs', 'dist'],
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },

      parser: typescriptEslint.parser,
      ecmaVersion: 5,
      sourceType: 'module',

      parserOptions: {
        project: 'tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },

    rules: {
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      'unicorn/prefer-module': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-process-exit': 'off',
      'unicorn/import-style': 'off',
      curly: 2,
      'prettier/prettier': 0,
      'object-shorthand': ['error', 'always'],
    },
  },
  {
    // The migrate module is a SQLite + API-DTO layer: `null` is the value better-sqlite3
    // binds/returns and the shape SDK response types use (`string | null`). `undefined` is
    // not a valid substitute (better-sqlite3 throws on undefined binds), so allow `null` here.
    files: ['src/commands/migrate/**/*.ts'],
    rules: {
      'unicorn/no-null': 'off',
    },
  },
]);
