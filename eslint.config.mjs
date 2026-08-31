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
