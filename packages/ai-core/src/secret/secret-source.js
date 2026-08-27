'use strict';

/** Replaceable secret lookup boundary. Implementations must keep secret values in memory only. */
class SecretSource {
  async getSecret(_name) {
    throw new Error('SecretSource.getSecret must be implemented');
  }
}

module.exports = { SecretSource };
