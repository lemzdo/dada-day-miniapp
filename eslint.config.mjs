import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.test/**',
      '**/.next/**',
      '**/.taro/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-console': 'warn',
    },
  },
  {
    files: [
      'apps/miniapp/scripts/cloud-artifact-*.js',
      'apps/miniapp/scripts/cloud-dependency-audit.js',
      'apps/miniapp/scripts/cloud-deploy*.js',
      'apps/miniapp/scripts/deployment-contract-lite*.js',
      'apps/miniapp/scripts/stage-recommendation-artifacts.js',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        Atomics: 'readonly',
        console: 'readonly',
        global: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
        SharedArrayBuffer: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['packages/garment-assets/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        URL: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
