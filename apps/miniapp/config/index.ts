import { defineConfig } from '@tarojs/cli';
import path from 'node:path';

const config = defineConfig({
  projectName: 'miniapp',
  date: '2026-05-14',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    375: 2,
    828: 1.81 / 2,
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: ['@tarojs/plugin-platform-weapp', '@tarojs/plugin-platform-h5'],
  // Taro does not provide a Node `process` object in the mini-program
  // runtime. Keep the build-time flag explicit so the client bundle cannot
  // emit a free `process.env` reference (the default remains OFF).
  defineConstants: {
    'process.env.TARO_APP_RECOMMENDATION_V2_ENABLED': JSON.stringify(
      process.env.TARO_APP_RECOMMENDATION_V2_ENABLED || 'false',
    ),
  },
  copy: {
    patterns: [],
    options: {},
  },
  framework: 'react',
  compiler: 'webpack5',
  alias: {
    '@': path.resolve(__dirname, '..', 'src'),
  },
  mini: {
    webpackChain(chain) {
      // The workspace types package exports source TypeScript. Taro's script
      // rule otherwise limits Babel processing to the miniapp source root.
      const scriptRule = chain.module.rule('script');
      scriptRule.exclude.clear();
      scriptRule.include.add(path.resolve(__dirname, '..', '..', '..', 'packages', 'types', 'src'));
    },
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
      url: {
        enable: true,
        config: {
          limit: 1024,
        },
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    postcss: {
      autoprefixer: {
        enable: true,
        config: {},
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
  },
});

export default config;
