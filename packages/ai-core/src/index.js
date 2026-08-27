'use strict';

const registry = require('./registry');
const provider = require('./provider');
const { resolvePolicy, withDeadline } = require('./policy');
const { createTelemetry } = require('./telemetry');
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
      try {
        if (typeof task.executor === 'function') {
          return task.executor(input, { ...options, policy, task, telemetry });
        }
        const credentials = await secretProvider.getBailianConfig();
        const request = options.request || {
          model: task.model,
          messages: [{ role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) }],
          stream: task.stream,
        };
        const providerOptions = { ...options,
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
        const validator = task.validator && registry.getValidator(task.validator);
        if (validator && (await validator(result, input)) === false) {
          throw Object.assign(new Error('validator rejected provider result'), { code: 'VALIDATOR_FAIL' });
        }
        return { ...result, metadata };
      } catch (error) {
        telemetry.event('task_error', { task: taskName, code: error.code || 'TASK_ERROR' });
        throw error;
      }
    },
  };
}

const xiaodaAI = createXiaodaAI();
module.exports = { createXiaodaAI, xiaodaAI, ...registry, ...provider,
  resolvePolicy, withDeadline, createTelemetry, ...secrets };
