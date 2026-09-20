const UPLOAD_WORKFLOW_SCHEMA_VERSION = 2;
const MAX_UPLOAD_WORKFLOW_REFS = 10;
const MAX_IMAGE_REFS_PER_BATCH = 9;
const UPLOAD_WORKFLOW_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const TERMINAL_UPLOAD_STATUSES = new Set(['saved', 'discarded', 'deleted', 'expired']);

function createUploadWorkflowEnvelope(refs = []) {
  return {
    schemaVersion: UPLOAD_WORKFLOW_SCHEMA_VERSION,
    refs: normalizeRefs(refs),
  };
}

function upsertUploadWorkflowRef(envelope, input, now = Date.now()) {
  const current = createUploadWorkflowEnvelope(envelope?.refs);
  const replaceCloudImageIds = input?.replaceCloudImageIds === true;
  const next = normalizeRef(input, now);
  if (!next) return { status: 'invalid', envelope: current };

  const existingIndex = current.refs.findIndex((ref) => ref.batchId === next.batchId);
  if (existingIndex < 0 && current.refs.length >= MAX_UPLOAD_WORKFLOW_REFS) {
    return { status: 'full', envelope: current };
  }

  const previous = existingIndex >= 0 ? current.refs[existingIndex] : null;
  const merged = normalizeRef({
    ...previous,
    ...next,
    cloudImageIds: replaceCloudImageIds
      ? next.cloudImageIds
      : uniqueStrings([
          ...(previous?.cloudImageIds || []),
          ...(next.cloudImageIds || []),
        ]),
    createdAt: previous?.createdAt || next.createdAt,
    updatedAt: now,
  }, now);
  if (!merged) return { status: 'invalid', envelope: current };

  const refs = existingIndex >= 0
    ? current.refs.map((ref, index) => (index === existingIndex ? merged : ref))
    : [...current.refs, merged];
  return { status: 'updated', envelope: createUploadWorkflowEnvelope(refs) };
}

function removeUploadWorkflowRef(envelope, batchId) {
  const current = createUploadWorkflowEnvelope(envelope?.refs);
  if (!batchId) return current;
  return createUploadWorkflowEnvelope(current.refs.filter((ref) => ref.batchId !== batchId));
}

function markUploadWorkflowTerminal(envelope, batchId, status) {
  if (!TERMINAL_UPLOAD_STATUSES.has(String(status || ''))) {
    return createUploadWorkflowEnvelope(envelope?.refs);
  }
  return removeUploadWorkflowRef(envelope, batchId);
}

function reconcileUploadWorkflowRefs(envelope, options = {}) {
  const current = createUploadWorkflowEnvelope(envelope?.refs);
  if (options.cloudAvailable === false) {
    return { envelope: current, removedBatchIds: [], retainedBatchIds: current.refs.map((ref) => ref.batchId) };
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const serverBatches = Array.isArray(options.serverBatches) ? options.serverBatches : [];
  const serverById = new Map(serverBatches
    .map((batch) => [String(batch?.id || batch?._id || ''), batch])
    .filter(([id]) => Boolean(id)));
  const removedBatchIds = [];
  const retained = [];

  current.refs.forEach((ref) => {
    const server = serverById.get(ref.batchId);
    const serverStatus = String(server?.status || '');
    const terminal = TERMINAL_UPLOAD_STATUSES.has(serverStatus);
    const missing = !server;
    const orphaned = now - ref.updatedAt >= UPLOAD_WORKFLOW_ORPHAN_AGE_MS;

    if (terminal || missing || orphaned) {
      removedBatchIds.push(ref.batchId);
      return;
    }
    retained.push({ ...ref, needsServerVerification: false });
  });

  return {
    envelope: createUploadWorkflowEnvelope(retained),
    removedBatchIds,
    retainedBatchIds: retained.map((ref) => ref.batchId),
  };
}

function normalizeRefs(refs) {
  const byBatch = new Map();
  (Array.isArray(refs) ? refs : []).forEach((value) => {
    const ref = normalizeRef(value);
    if (!ref) return;
    byBatch.set(ref.batchId, ref);
  });
  return [...byBatch.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_UPLOAD_WORKFLOW_REFS);
}

function normalizeRef(value, now = Date.now()) {
  if (!value || typeof value !== 'object') return null;
  const batchId = String(value.batchId || '').trim();
  if (!batchId) return null;
  const createdAt = normalizeTimestamp(value.createdAt, now);
  return {
    batchId,
    cloudImageIds: uniqueStrings(value.cloudImageIds).slice(0, MAX_IMAGE_REFS_PER_BATCH),
    phase: normalizePhase(value.phase),
    createdAt,
    updatedAt: normalizeTimestamp(value.updatedAt, createdAt),
    needsServerVerification: value.needsServerVerification !== false,
  };
}

function normalizeTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function normalizePhase(value) {
  return ['created', 'uploading', 'processing', 'confirming'].includes(value) ? value : 'created';
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

module.exports = {
  MAX_IMAGE_REFS_PER_BATCH,
  MAX_UPLOAD_WORKFLOW_REFS,
  TERMINAL_UPLOAD_STATUSES,
  UPLOAD_WORKFLOW_ORPHAN_AGE_MS,
  UPLOAD_WORKFLOW_SCHEMA_VERSION,
  createUploadWorkflowEnvelope,
  markUploadWorkflowTerminal,
  reconcileUploadWorkflowRefs,
  removeUploadWorkflowRef,
  upsertUploadWorkflowRef,
};
