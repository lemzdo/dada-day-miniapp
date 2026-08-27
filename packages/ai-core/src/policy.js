'use strict';
const DEFAULT_TIMEOUT_MS = 25000;
function resolvePolicy(task, options = {}) { return { timeoutMs: Math.max(1, Number(options.timeoutMs || task?.timeoutMs || DEFAULT_TIMEOUT_MS)), retry: Math.max(0, Number.isInteger(options.retry) ? options.retry : (task?.retry || 0)) }; }
function withDeadline(signal, timeoutMs) { const controller = new AbortController(); let timer; const abort = () => controller.abort(signal?.reason || new Error('deadline exceeded')); if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true }); timer = setTimeout(() => controller.abort(new Error('deadline exceeded')), timeoutMs); timer.unref?.(); return { signal: controller.signal, cancel() { clearTimeout(timer); signal?.removeEventListener('abort', abort); } }; }
module.exports = { DEFAULT_TIMEOUT_MS, resolvePolicy, withDeadline };
