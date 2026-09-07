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
      'apps/miniapp/scripts/production-first-card-smoke/*.js',
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
        TextEncoder: 'readonly',
        wx: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
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
  {
    // First-card runtime code and its contract tests execute in Node/CommonJS.
    files: [
      'packages/ai-core/src/{failure,provider,index,provider.test,ai-core.test}.js',
      'apps/miniapp/cloudfunctions/generateOutfit/index.js',
      'apps/miniapp/cloudfunctions/recommendationStream/index{,.test}.js',
      'apps/miniapp/cloudfunctions/generateOutfit/services/firstCardObservability.js',
      'apps/miniapp/cloudfunctions/generateOutfit/services/recommendationCopyProductionArchitecture.test.js',
      'apps/miniapp/cloudfunctions/generateOutfit/services/recommendationCopyProductionJobV2{,.test}.js',
      'apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator{,.test}.js',
      'apps/miniapp/cloudfunctions/generateOutfit/services/recommendation{FirstCardRenderer,VoiceRendererProductionV2}{,.test}.js',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Buffer: 'readonly',
        Headers: 'readonly',
        ReadableStream: 'readonly',
        Response: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        global: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
        setImmediate: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
);
