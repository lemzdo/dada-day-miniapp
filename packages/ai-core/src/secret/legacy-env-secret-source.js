'use strict';

const DEFAULT_BAILIAN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const { SecretSource } = require('./secret-source');

/** Reads the legacy environment variables without ever logging their values. */
class LegacyEnvSecretSource extends SecretSource {
  constructor(env = process.env) {
    super();
    this.env = env;
  }

  getSecret(name) {
    if (name === 'BAILIAN_API_KEY' || name === 'DASHSCOPE_API_KEY' || name === 'apiKey') {
      return this.getApiKey();
    }
    if (name === 'BAILIAN_BASE_URL' || name === 'baseUrl') return this.getBaseUrl();
    return this.env[name];
  }

  get(name) { return this.getSecret(name); }

  getApiKey() {
    return this.env.BAILIAN_API_KEY || this.env.DASHSCOPE_API_KEY;
  }

  getBaseUrl() {
    return this.env.BAILIAN_BASE_URL || DEFAULT_BAILIAN_BASE_URL;
  }

  async load(name) { return this.getSecret(name); }

  async resolve() {
    return { apiKey: this.getApiKey(), baseUrl: this.getBaseUrl() };
  }
}

module.exports = { LegacyEnvSecretSource, DEFAULT_BAILIAN_BASE_URL };
