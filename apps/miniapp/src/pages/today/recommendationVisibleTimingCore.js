'use strict';

const COMPLETE_FIELDS = [
  'clientResponseReceivedMs',
  'stateCommitMs',
  'contentVisibleMs',
  'imageLoadMs',
  'imageVisibleMs',
];

const FAILURE_REASONS = Object.freeze({
  CONTENT_SELECTOR_EMPTY: 'CONTENT_SELECTOR_EMPTY',
  CONTENT_IDENTITY_MISMATCH: 'CONTENT_IDENTITY_MISMATCH',
  CONTENT_ZERO_SIZE: 'CONTENT_ZERO_SIZE',
  IMAGE_ONLOAD_NOT_FIRED: 'IMAGE_ONLOAD_NOT_FIRED',
  IMAGE_SELECTOR_EMPTY: 'IMAGE_SELECTOR_EMPTY',
  IMAGE_ZERO_SIZE: 'IMAGE_ZERO_SIZE',
  STALE_SEQ: 'STALE_SEQ',
  STALE_BATCH: 'STALE_BATCH',
  MISSING_AUDIT_ID: 'MISSING_AUDIT_ID',
});

function finiteTime(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function elapsed(record, at) {
  const measuredAt = finiteTime(at);
  return Math.max(0, (measuredAt === null ? record.requestStart : measuredAt) - record.requestStart);
}

function snapshot(record) {
  return {
    auditId: record.auditId,
    seq: record.seq,
    sceneKey: record.sceneKey,
    trigger: record.trigger,
    batchId: record.batchId,
    outfitKey: record.outfitKey,
    requestStart: record.requestStart,
    clientResponseReceivedMs: record.clientResponseReceivedMs,
    stateCommitMs: record.stateCommitMs,
    contentVisibleMs: record.contentVisibleMs,
    imageLoadMs: record.imageLoadMs,
    imageVisibleMs: record.imageVisibleMs,
    complete: COMPLETE_FIELDS.every((field) => record[field] !== undefined),
  };
}

function classifyVisibleNode({ stage, node, expected, current }) {
  const isImage = stage === 'image';
  if (!node) {
    return { ok: false, reason: isImage ? FAILURE_REASONS.IMAGE_SELECTOR_EMPTY : FAILURE_REASONS.CONTENT_SELECTOR_EMPTY };
  }
  if (!(Number(node.width) > 0) || !(Number(node.height) > 0)) {
    return { ok: false, reason: isImage ? FAILURE_REASONS.IMAGE_ZERO_SIZE : FAILURE_REASONS.CONTENT_ZERO_SIZE };
  }
  const dataset = node.dataset || {};
  if (current?.batchId !== expected.batchId
    || current?.outfitKey !== expected.outfitKey
    || dataset.recommendationBatchId !== expected.batchId
    || dataset.outfitKey !== expected.outfitKey) {
    return { ok: false, reason: FAILURE_REASONS.CONTENT_IDENTITY_MISMATCH };
  }
  return { ok: true };
}

function createRecommendationVisibleTimingRecorder({
  now = () => Date.now(),
  emit = () => undefined,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (handle) => clearTimeout(handle),
  imageLoadTimeoutMs = 5000,
  maxHistory = 10,
} = {}) {
  const byAudit = new Map();
  const byBatch = new Map();
  let history = [];
  let latestSeq = null;
  let latestBatchId = null;

  function emitStage(stage, record, fields = {}) {
    emit(`[RecommendationVisibleTiming:${stage}]`, {
      ...(record ? snapshot(record) : {}),
      ...fields,
    });
  }

  function failure(record, stage, reason, fields = {}) {
    const failureKey = `${stage}:${reason}`;
    if (record?.reportedFailures?.has(failureKey)) return false;
    record?.reportedFailures?.add(failureKey);
    emitStage('failure', record, { stage, reason, ...fields });
    return false;
  }

  function resolveAudit(auditId, stage) {
    if (!auditId) {
      failure(null, stage, FAILURE_REASONS.MISSING_AUDIT_ID);
      return null;
    }
    const record = byAudit.get(auditId);
    if (!record) {
      failure(null, stage, FAILURE_REASONS.MISSING_AUDIT_ID, { auditId });
      return null;
    }
    if (latestSeq !== null && record.seq !== latestSeq) {
      failure(record, stage, FAILURE_REASONS.STALE_SEQ, { latestSeq });
      return null;
    }
    return record;
  }

  function resolveBatch(identity, stage) {
    const record = identity?.batchId ? byBatch.get(identity.batchId) : null;
    if (!record) {
      failure(null, stage, FAILURE_REASONS.STALE_BATCH, {
        batchId: identity?.batchId,
        outfitKey: identity?.outfitKey,
        latestBatchId,
      });
      return null;
    }
    if (latestSeq !== null && record.seq !== latestSeq) {
      failure(record, stage, FAILURE_REASONS.STALE_SEQ, { latestSeq });
      return null;
    }
    if (latestBatchId !== record.batchId) {
      failure(record, stage, FAILURE_REASONS.STALE_BATCH, { latestBatchId });
      return null;
    }
    if (record.outfitKey !== identity.outfitKey) {
      failure(record, stage, FAILURE_REASONS.CONTENT_IDENTITY_MISMATCH, {
        receivedOutfitKey: identity.outfitKey,
      });
      return null;
    }
    return record;
  }

  function maybeComplete(record) {
    if (record.completed || !COMPLETE_FIELDS.every((field) => record[field] !== undefined)) return;
    record.completed = true;
    if (record.imageLoadTimer !== undefined) cancel(record.imageLoadTimer);
    emitStage('complete', record);
    emit('[RecommendationVisibleTiming]', snapshot(record));
  }

  function create(input) {
    if (!input?.auditId) {
      failure(null, 'create', FAILURE_REASONS.MISSING_AUDIT_ID, { seq: input?.seq });
      return null;
    }
    if (latestSeq !== null && input.seq < latestSeq) {
      failure(null, 'create', FAILURE_REASONS.STALE_SEQ, { seq: input.seq, latestSeq });
      return null;
    }
    latestSeq = input.seq;
    const record = {
      auditId: input.auditId,
      seq: input.seq,
      sceneKey: input.sceneKey,
      trigger: input.trigger,
      requestStart: finiteTime(input.requestStart) ?? now(),
      reportedFailures: new Set(),
    };
    byAudit.set(record.auditId, record);
    history = [record, ...history.filter((entry) => entry.auditId !== record.auditId)].slice(0, maxHistory);
    emitStage('create', record);
    return record;
  }

  function response(input) {
    const record = resolveAudit(input?.auditId, 'response');
    if (!record) return false;
    if (!input.batchId) return failure(record, 'response', FAILURE_REASONS.STALE_BATCH);
    record.batchId = input.batchId;
    record.outfitKey = input.outfitKey;
    record.clientResponseReceivedMs = elapsed(record, input.at ?? now());
    latestBatchId = record.batchId;
    byBatch.set(record.batchId, record);
    emitStage('response', record);
    maybeComplete(record);
    return true;
  }

  function mark(identity, stage, field, at) {
    const record = resolveBatch(identity, stage);
    if (!record) return false;
    if (record[field] === undefined) {
      record[field] = elapsed(record, at ?? now());
      emitStage(stage, record);
    }
    maybeComplete(record);
    return true;
  }

  function commit(identity, at) {
    const record = resolveBatch(identity, 'commit');
    if (!record) return false;
    if (record.stateCommitMs === undefined) {
      record.stateCommitMs = elapsed(record, at ?? now());
      emitStage('commit', record);
    }
    if (record.imageLoadTimer === undefined && imageLoadTimeoutMs >= 0) {
      record.imageLoadTimer = schedule(() => {
        if (record.imageLoadMs === undefined && !record.completed) {
          failure(record, 'image-load', FAILURE_REASONS.IMAGE_ONLOAD_NOT_FIRED, { timeoutMs: imageLoadTimeoutMs });
        }
      }, imageLoadTimeoutMs);
    }
    maybeComplete(record);
    return true;
  }

  function imageLoad(identity, at) {
    const record = resolveBatch(identity, 'image-load');
    if (!record) return false;
    if (record.imageLoadTimer !== undefined) {
      cancel(record.imageLoadTimer);
      record.imageLoadTimer = undefined;
    }
    return mark(identity, 'image-load', 'imageLoadMs', at);
  }

  function reportFailure(identity, stage, reason, fields = {}) {
    const record = identity?.batchId ? byBatch.get(identity.batchId) : byAudit.get(identity?.auditId);
    if (record?.imageLoadTimer !== undefined && reason === FAILURE_REASONS.IMAGE_ONLOAD_NOT_FIRED) {
      cancel(record.imageLoadTimer);
      record.imageLoadTimer = undefined;
    }
    return failure(record || null, stage, reason, fields);
  }

  function reset() {
    for (const record of history) {
      if (record.imageLoadTimer !== undefined) cancel(record.imageLoadTimer);
    }
    byAudit.clear();
    byBatch.clear();
    history = [];
    latestSeq = null;
    latestBatchId = null;
  }

  return {
    create,
    response,
    commit,
    content: (identity, at) => mark(identity, 'content', 'contentVisibleMs', at),
    imageLoad,
    imageVisible: (identity, at) => mark(identity, 'image-visible', 'imageVisibleMs', at),
    reportFailure,
    getByBatch: (batchId) => byBatch.get(batchId) || null,
    read: () => history.map(snapshot),
    reset,
  };
}

module.exports = {
  FAILURE_REASONS,
  classifyVisibleNode,
  createRecommendationVisibleTimingRecorder,
};
