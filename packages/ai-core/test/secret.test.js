'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EncryptedDbSecretSource, LegacyEnvSecretSource, SecretProvider } = require('../src/secret');

const KEY = Buffer.alloc(32, 7);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('AES-256-GCM roundtrip and SecretProvider access', async () => {
  const record = EncryptedDbSecretSource.encrypt('sk-roundtrip', KEY);
  const source = new EncryptedDbSecretSource({ masterKey: KEY, loadRecord: async () => record });
  assert.equal(await new SecretProvider(source).getSecret('key'), 'sk-roundtrip');
});

test('wrong key and tampering fail authentication', async () => {
  const record = EncryptedDbSecretSource.encrypt('secret', KEY);
  const wrong = new EncryptedDbSecretSource({ masterKey: Buffer.alloc(32, 8), loadRecord: async () => record });
  await assert.rejects(wrong.getSecret('key'));
  const tampered = { ...record, ciphertext: Buffer.from(record.ciphertext, 'base64').map((v, i) => i === 0 ? v ^ 1 : v).toString('base64') };
  const source = new EncryptedDbSecretSource({ masterKey: KEY, loadRecord: async () => tampered });
  await assert.rejects(source.getSecret('key'));
});

test('invalid authTag is rejected', async () => {
  const record = EncryptedDbSecretSource.encrypt('secret', KEY);
  const source = new EncryptedDbSecretSource({ masterKey: KEY, loadRecord: async () => ({ ...record, authTag: Buffer.alloc(15).toString('base64') }) });
  await assert.rejects(source.getSecret('key'), /authTag/);
});

for (const count of [2, 5, 10]) {
  test(`deduplicates ${count} concurrent loads and caches result`, async () => {
    let calls = 0;
    const record = EncryptedDbSecretSource.encrypt(`value-${count}`, KEY);
    const source = new EncryptedDbSecretSource({ masterKey: KEY, loadRecord: async () => { calls += 1; await sleep(5); return record; } });
    const values = await Promise.all(Array.from({ length: count }, () => source.getSecret('key')));
    assert.deepEqual(values, Array(count).fill(`value-${count}`));
    assert.equal(calls, 1);
    assert.equal(await source.getSecret('key'), `value-${count}`);
    assert.equal(calls, 1);
  });
}

test('clear then reloads encrypted record', async () => {
  let calls = 0;
  const records = [EncryptedDbSecretSource.encrypt('one', KEY), EncryptedDbSecretSource.encrypt('two', KEY)];
  const source = new EncryptedDbSecretSource({ masterKey: KEY, loadRecord: async () => records[calls++] });
  assert.equal(await source.getSecret('key'), 'one');
  source.clear('key');
  assert.equal(await source.getSecret('key'), 'two');
  assert.equal(calls, 2);
});

test('LegacyEnvSecretSource prefers Bailian key and defaults endpoint', async () => {
  const source = new LegacyEnvSecretSource({ BAILIAN_API_KEY: 'bailian', DASHSCOPE_API_KEY: 'dash' });
  assert.equal(source.getApiKey(), 'bailian');
  assert.equal(source.getBaseUrl(), 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.deepEqual(await new SecretProvider(source).getBailianConfig(), { apiKey: 'bailian', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' });
});
