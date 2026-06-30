const TERMINAL_STATUSES = new Set(['saved', 'discarded', 'deleted', 'expired']);
const DEFAULT_TTL_MS = 5 * 1000;

const caches = new Map();
const terminalBatches = new Map();

function writeUploadTaskLocalCache({ authRuntimeKey, data, createdAt = Date.now(), ttlMs = DEFAULT_TTL_MS }) {
  if (!authRuntimeKey) return;
  caches.set(authRuntimeKey, {
    data: filterTerminalBatches(authRuntimeKey, Array.isArray(data) ? data : []),
    createdAt,
    ttlMs,
  });
}

function getUploadTaskLocalCache({ authRuntimeKey, now = Date.now() } = {}) {
  if (!authRuntimeKey) return null;
  const cache = caches.get(authRuntimeKey);
  if (!cache) return null;
  if (now - cache.createdAt > cache.ttlMs) {
    caches.delete(authRuntimeKey);
    return null;
  }
  const filtered = filterTerminalBatches(authRuntimeKey, cache.data);
  if (filtered.length !== cache.data.length) {
    caches.set(authRuntimeKey, { ...cache, data: filtered });
  }
  return filtered;
}

function clearUploadTaskLocalCache(authRuntimeKey) {
  if (authRuntimeKey) {
    caches.delete(authRuntimeKey);
    terminalBatches.delete(authRuntimeKey);
    return;
  }
  caches.clear();
  terminalBatches.clear();
}

function removeUploadBatchFromLocalCache({ authRuntimeKey, batchId, batchTerminal = true } = {}) {
  if (!authRuntimeKey || !batchId || !batchTerminal) return;
  const cache = caches.get(authRuntimeKey);
  if (!cache) return;
  caches.set(authRuntimeKey, {
    ...cache,
    data: cache.data.filter((batch) => getBatchId(batch) !== batchId),
  });
}

function markUploadBatchTerminal({ authRuntimeKey, batchId, status = 'discarded' } = {}) {
  if (!authRuntimeKey || !batchId || !TERMINAL_STATUSES.has(status)) return;
  const set = terminalBatches.get(authRuntimeKey) || new Set();
  set.add(batchId);
  terminalBatches.set(authRuntimeKey, set);
  removeUploadBatchFromLocalCache({ authRuntimeKey, batchId, batchTerminal: true });
}

function filterTerminalBatches(authRuntimeKey, batches) {
  const terminal = terminalBatches.get(authRuntimeKey);
  if (!terminal || terminal.size === 0) return batches;
  return batches.filter((batch) => !terminal.has(getBatchId(batch)));
}

function isUploadBatchLocallyTerminal({ authRuntimeKey, batchId } = {}) {
  return Boolean(authRuntimeKey && batchId && terminalBatches.get(authRuntimeKey)?.has(batchId));
}

function getBatchId(batch) {
  return batch && (batch.id || batch._id);
}

module.exports = {
  clearUploadTaskLocalCache,
  filterTerminalBatches,
  getUploadTaskLocalCache,
  isUploadBatchLocallyTerminal,
  markUploadBatchTerminal,
  removeUploadBatchFromLocalCache,
  writeUploadTaskLocalCache,
};
