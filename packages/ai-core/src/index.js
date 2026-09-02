'use strict';

const registry = require('./registry');
const provider = require('./provider');
const { resolvePolicy, withDeadline } = require('./policy');
const { createTelemetry } = require('./telemetry');
const { attachFailure, createFailureEnvelope, getFailure, sanitizeFailure } = require('./failure');
const secrets = require('./secret');
const { SecretProvider, LegacyEnvSecretSource } = secrets;

function metadataFor(taskName, task, policy, started) {
  return { task: taskName, model: task.model, promptVariant: task.promptVariant,
    promptVersion: task.promptVersion, stream: task.stream, retry: policy.retry,
    timeoutMs: policy.timeoutMs, durationMs: Date.now() - started };
}

function createXiaodaAI(config = {}) {
  const secretProvider = config.secretProvider || new SecretProvider(new LegacyEnvSecretSource());
  const telemetry = createTelemetry(config.telemetry || config.onTelemetry);
  return {
    registry,
    secretProvider,
    async execute(taskName, input, options = {}) {
      const task = registry.getTask(taskName);
      if (!task) throw new Error(`unknown task: ${taskName}`);
      const policy = resolvePolicy(task, options);
      const started = Date.now();
      telemetry.event('task_start', { task: taskName });
      let failureStage = 'ai_core';
      try {
        if (typeof task.executor === 'function') {
          return task.executor(input, { ...options, policy, task, telemetry });
        }
        failureStage = 'credentials';
        const credentials = await secretProvider.getBailianConfig();
        failureStage = 'request';
        const request = options.request || {
          model: task.model,
          messages: [{ role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) }],
          stream: task.stream,
        };
        const providerOptions = { ...options,
          failureContext: { ...(options.failureContext || {}), model: request.model, handlerStartedAt: options.failureContext?.handlerStartedAt },
          endpoint: options.endpoint || config.endpoint || credentials.baseUrl,
          authLookup: options.authLookup || config.authLookup || credentials.apiKey,
          fetch: options.fetch || config.fetch, timeoutMs: policy.timeoutMs };
        const metadata = metadataFor(taskName, task, policy, started);
        if (options.rawResponse) {
          const response = await provider.requestDashScope({ body: request }, providerOptions);
          return { response, metadata };
        }
        const result = task.stream
          ? await provider.streamDashScope({ body: request }, providerOptions)
          : await provider.executeDashScope({ body: request }, providerOptions);
        failureStage = 'validation';
        const validator = task.validator && registry.getValidator(task.validator);
        if (validator && (await validator(result, input)) === false) {
          throw attachFailure(Object.assign(new Error('validator rejected provider result'), { code: 'VALIDATOR_FAIL' }), { ...(options.failureContext || {}), provider: { name: 'dashscope', model: request.model }, deadline: { causedFailure: 'no', source: null } }, { stage: 'validation', code: 'VALIDATION_REJECTED', retryability: 'unknown', providerIssue: 'no', businessRejected: 'yes', validatorCodes: ['VALIDATOR_FAIL'] });
        }
        return { ...result, metadata };
      } catch (error) {
        const failure = getFailure(error) || createFailureEnvelope(error, options.failureContext || {}, {
          stage: failureStage,
          code: failureStage === 'credentials' ? 'CREDENTIALS_UNAVAILABLE' : failureStage === 'request' ? 'REQUEST_FAILED' : 'RUNTIME_FAILED',
          ...(failureStage === 'credentials' ? { providerIssue: 'no', businessRejected: 'no', deadline: { causedFailure: 'no', source: null } } : {}),
        });
        attachFailure(error, options.failureContext || {});
        telemetry.event('task_error', { task: taskName, code: error?.code || 'TASK_ERROR', failure });
        throw error;
      }
    },
  };
}

const xiaodaAI = createXiaodaAI();
module.exports = { createXiaodaAI, xiaodaAI, ...registry, ...provider,
  resolvePolicy, withDeadline, createTelemetry, createFailureEnvelope, attachFailure, getFailure, sanitizeFailure, ...secrets };
