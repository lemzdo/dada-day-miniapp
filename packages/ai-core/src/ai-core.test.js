const test = require('node:test'); const assert = require('node:assert/strict'); const { createXiaodaAI, getTask, registerTask, registerValidator, mapValidator, LegacyEnvSecretSource, SecretProvider } = require('./index');
test('formal recommendation task metadata is frozen', () => { const task = getTask('recommendation_reason'); assert.equal(task.model, 'qwen3.7-max'); assert.equal(task.prompt, 'recommendation_reason'); assert.equal(task.validator, 'recommendation_production'); assert.equal(task.promptVariant, 'compressed-v2'); assert.equal(task.stream, true); assert.equal(task.retry, 0); assert.equal(task.timeoutMs, 25000); });
test('single entry executes with injected fetch and auth', async () => { let seen; const ai = createXiaodaAI({ authLookup: 'secret', fetch: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')); c.close(); } }) }; } }); const result = await ai.execute('recommendation_reason', { text: 'x' }); assert.equal(result.text, 'ok'); assert.match(seen.init.headers.Authorization, /secret/); });
test('consumer task, validator mapping and telemetry are available', async () => { let called = false; registerTask('test_task', { model: 'test', stream: false }, async (input) => input); registerValidator('test_validator', () => true); mapValidator('test_task', 'test_validator'); const ai = createXiaodaAI(); assert.deepEqual(await ai.execute('test_task', 3), 3); called = true; assert.equal(called, true); });
test('request body is passed unchanged and raw response is exposed', async () => {
  const request = { model: 'qwen3.7-max', messages: [{ role: 'system', content: 'compressed-v2' }], stream: true };
  let captured;
  const ai = createXiaodaAI({ secretProvider: new SecretProvider(new LegacyEnvSecretSource({ BAILIAN_API_KEY: 'legacy-key' })), fetch: async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, body: new ReadableStream() };
  } });
  const result = await ai.execute('recommendation_reason', { ignored: true }, { request, rawResponse: true });
  assert.deepEqual(JSON.parse(captured.init.body), request);
  assert.equal(result.response.status, 200);
  assert.equal(captured.init.headers.Authorization, 'Bearer legacy-key');
  assert.equal(result.metadata.promptVersion, 'voice-contract-v2.0-compressed-v2-production-1');
});

test('real registry validator rejection emits the contract failure code', async () => {
  registerTask('contract_validation_task', { model: 'test', stream: false, validator: 'contract_validation_validator' });
  registerValidator('contract_validation_validator', () => false);
  const ai = createXiaodaAI({ authLookup: 'secret', fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }) });
  await assert.rejects(ai.execute('contract_validation_task', { text: 'x' }), (error) => {
    assert.equal(error.failure.code, 'VALIDATION_REJECTED');
    assert.equal(error.failure.stage, 'validation');
    assert.equal(error.failure.retryability, 'unknown');
    assert.equal(error.failure.providerIssue, 'no');
    assert.equal(error.failure.businessRejected, 'yes');
    assert.equal(error.failure.deadline.causedFailure, 'no');
    assert.deepEqual(error.failure.evidence.validatorCodes, ['VALIDATOR_FAIL']);
    return true;
  });
});
