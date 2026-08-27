'use strict';

const tasks = new Map();
const prompts = new Map();
const validators = new Map();

const recommendationReasonTask = Object.freeze({
  name: 'recommendation_reason', model: 'qwen3.7-max', promptVariant: 'compressed-v2',
  promptVersion: 'voice-contract-v2.0-compressed-v2-production-1',
  prompt: 'recommendation_reason', stream: true, retry: 0, timeoutMs: 25000,
  validator: 'recommendation_production',
});
tasks.set(recommendationReasonTask.name, recommendationReasonTask);

function registerTask(name, metadata, executor) {
  if (!name || typeof name !== 'string') throw new TypeError('task name is required');
  const task = Object.freeze({ name, ...metadata, ...(executor ? { executor } : {}) });
  tasks.set(name, task); return task;
}
function getTask(name) { return tasks.get(name); }
function listTasks() { return [...tasks.values()].map(({ executor, ...task }) => task); }
function registerPrompt(name, prompt, metadata = {}) { const value = Object.freeze({ name, prompt, ...metadata }); prompts.set(name, value); return value; }
function getPrompt(name) { return prompts.get(name); }
function registerValidator(name, validator) { if (typeof validator !== 'function') throw new TypeError('validator must be a function'); validators.set(name, validator); return validator; }
function getValidator(name) { return validators.get(name); }
function mapValidator(taskName, validatorName) { const task = tasks.get(taskName); if (!task) throw new Error(`unknown task: ${taskName}`); tasks.set(taskName, Object.freeze({ ...task, validator: validatorName })); return tasks.get(taskName); }

module.exports = { recommendationReasonTask, registerTask, getTask, listTasks, registerPrompt, getPrompt, registerValidator, getValidator, mapValidator };
