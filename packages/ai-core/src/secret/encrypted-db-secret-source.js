'use strict';

const crypto = require('node:crypto');
const { SecretSource } = require('./secret-source');

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function asBuffer(value, field) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value !== 'string') throw new TypeError(`${field} must be a buffer or encoded string`);
  // Records conventionally use base64. Hex is accepted for DB migrations and fixtures.
  return /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0
    ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
}

function normalizeKey(masterKey) {
  const key = Buffer.isBuffer(masterKey) || masterKey instanceof Uint8Array
    ? Buffer.from(masterKey) : Buffer.from(String(masterKey), 'utf8');
  if (key.length !== 32) throw new RangeError('AES-256-GCM master key must be exactly 32 bytes');
  return key;
}

function decryptRecord(record, key) {
  if (!record || typeof record !== 'object') throw new TypeError('encrypted secret record is required');
  const iv = asBuffer(record.iv ?? record.initializationVector, 'iv');
  const authTag = asBuffer(record.authTag ?? record.auth_tag ?? record.tag, 'authTag');
  const ciphertext = asBuffer(record.ciphertext ?? record.encryptedValue ?? record.value, 'ciphertext');
  if (iv.length !== IV_BYTES) throw new Error('invalid AES-GCM IV');
  if (authTag.length !== AUTH_TAG_BYTES) throw new Error('invalid AES-GCM authTag');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

class EncryptedDbSecretSource extends SecretSource {
  constructor(options = {}, positionalMasterKey) {
    super();
    const config = typeof options === 'function'
      ? { loadRecord: options, masterKey: positionalMasterKey }
      : options;
    const { loadRecord, recordLoader, loader, masterKey } = config;
    this.loadRecord = loadRecord || recordLoader || loader;
    if (typeof this.loadRecord !== 'function') throw new TypeError('loadRecord must be a function');
    this.key = normalizeKey(masterKey);
    this.cache = new Map();
    this.inFlight = new Map();
  }

  async getSecret(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    const pending = this.inFlight.get(name);
    if (pending) return pending;
    const request = Promise.resolve().then(() => this.loadRecord(name)).then((record) => {
      if (record == null) return undefined;
      const value = decryptRecord(record, this.key);
      this.cache.set(name, value);
      return value;
    }).finally(() => this.inFlight.delete(name));
    this.inFlight.set(name, request);
    return request;
  }

  get(name) { return this.getSecret(name); }
  load(name) { return this.getSecret(name); }

  clear(name) {
    if (name === undefined) this.cache.clear();
    else this.cache.delete(name);
  }

  async refresh(name) {
    this.clear(name);
    return this.getSecret(name);
  }

  static encrypt(value, masterKey, options = {}) {
    const key = normalizeKey(masterKey);
    const iv = options.iv ? asBuffer(options.iv, 'iv') : crypto.randomBytes(IV_BYTES);
    if (iv.length !== IV_BYTES) throw new Error('invalid AES-GCM IV');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
  }
}

module.exports = { EncryptedDbSecretSource, decryptRecord };
