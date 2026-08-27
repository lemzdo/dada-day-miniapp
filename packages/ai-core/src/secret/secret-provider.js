'use strict';

class SecretProvider {
  constructor(sourceOrOptions) {
    const source = sourceOrOptions && sourceOrOptions.source ? sourceOrOptions.source : sourceOrOptions;
    if (!source || typeof source.getSecret !== 'function') throw new TypeError('SecretProvider requires a SecretSource');
    this.source = source;
  }

  getSecret(name) { return this.source.getSecret(name); }
  get(name) { return this.getSecret(name); }

  async getBailianConfig() {
    if (typeof this.source.resolve === 'function') return this.source.resolve();
    return { apiKey: await this.getSecret('BAILIAN_API_KEY'), baseUrl: await this.getSecret('BAILIAN_BASE_URL') };
  }
}

module.exports = { SecretProvider };
